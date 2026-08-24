# Caracterização causal da capacidade da Goma para o workload qwen3-coder

Data: 2026-08-23
Tipo: investigação + medição viva (sem mudança de código)

`CANONICAL_AUTO_EXECUTION (até review) = NOT_PROVEN — barreira de HARDWARE (RAM), bem medida`
`GOMA_QWEN3CODER_FIT = classe C para o stack residente completo; degrada a classe B só com a máquina anormalmente livre`
`RESOURCE_GOVERNOR_FOOTPRINT_GAP = CONFIRMADO (lacuna de design V0, NÃO bug)`

## Objetivo

Caracterizar, com evidência medida e read-only primeiro, se a Goma (16 GB RAM / RTX 5060 Ti
16 GB) sustenta o `qwen3-coder:latest` no uso residente pretendido do Anima; isolar se a
barreira é RAM, VRAM, configuração ou concorrência; e diagnosticar a lacuna do Resource
Governor revelada pela última prova diferencial. **Não** fabricar `CANONICAL_AUTO_EXECUTION=PASS`.

## Estado Git

- Branch `dev`. HEAD inicial `583ef0d` = `origin/dev`. `origin/main` `99bec54`, intacta.
- Working tree limpa exceto `.worktrees/` (preservado). Máquina reiniciada antes do ciclo;
  só Claude + ChatGPT abertos → baseline quase limpo.
- Sessão de investigação: registro (este arquivo) + ponteiro tático no PRD. Sem PR/merge/
  deploy/db reset/service_role/integração. `.worktrees/`, `.claude/settings.local.json`,
  `apps/web/.env.local` preservados.

## Inventário do host (fatos locais, read-only)

- **CPU:** Intel Core i7-11700K, 8C/16T, 3.6 GHz base (Rocket Lake).
- **RAM: 16 GB (16253 MB visíveis).** UM único módulo DDR4-2666 (Apacer) em
  `Controller0-ChannelA-DIMM1`. **4 slots, 1 usado → SINGLE-CHANNEL + 3 slots livres; máximo
  suportado 64 GB.** O single-channel penaliza a banda de memória exatamente nas camadas que
  derramam para a CPU.
- **GPU:** NVIDIA GeForce RTX 5060 Ti, **16311 MiB VRAM** (~15.1 GiB livres no baseline),
  driver 610.62.
- **Memória virtual:** pagefile em `G:\pagefile.sys`, 34 GB alocado, gerenciado automático;
  **commit limit ≈ 50 GB** (16 físico + 34 pagefile). Uso de pagefile ~0 no baseline.
- **Discos:** C: 465 GB SSD Kingston (130 livre); G: 1863 GB SSD Crucial P2 (785 livre) — repo
  + pagefile em G:. Modelos Ollama em `C:\Users\GeanTeco\.ollama\models` (43 GB de blobs).
- **OS:** Windows 10 Pro build 19045. **Ollama 0.32.15** (sem overrides de env → `keep_alive`
  default 5 min).
- **Modelo:** `qwen3-coder:latest` == `:30b` (mesmo digest `1194192cf2a1`) = **qwen3-coder-30B-A3B
  (MoE, 30B total / ~3B ativos), 17.28 GiB de pesos**, ~19 GB de footprint de runtime.

## Configuração REAL do coder (código, não alterada)

- `OllamaCoderBackend` (`apps/web/lib/work-orchestration/ollama-coder.ts`): `timeoutMs=120000`
  (default), `operationalContextCap=8192` (num_ctx), `numPredict=1536`, `outputReserveTokens=1536`,
  `maxReadRounds=3` (protocolo limitado de leitura+edição, nunca arquivo integral).
- `callOllamaChat` (`ollama-protocol.ts`): `/api/chat` com `stream:false`, `format:json`,
  `options:{num_ctx, num_predict, temperature:0}`. **Sem `keep_alive`** enviado (→ 5 min default
  do Ollama) e **sem `streamIdleTimeoutMs`** (esse é do caminho pi-ai/host, não deste). O único
  timeout é o hard-abort de 120 s. Comentário no código: `num_ctx=32768 já falhou nesta máquina`
  → o cap 8192 é conservador de propósito.
- Construção no fluxo real: `executor-selection.ts backendFor` cria `new OllamaCoderBackend({ model })`
  sem override de timeout/num_ctx → valem os defaults acima.

## Perfil de memória MEDIDO (baseline quase limpo, sem navegador do usuário)

Amostragem read-only (`node:os` free RAM, `Win32_PageFileUsage`, `nvidia-smi`, `ollama ps`).
Incremental, medindo antes/depois. Nenhum processo do usuário encerrado; Resource Governor
não tocado.

| Etapa | RAM livre | VRAM usada | Observações |
|---|---|---|---|
| A. Baseline limpo (Claude+ChatGPT+runtime VR) | **8754 MB (53.9%)** | 951 MB | commit 9.6 GB; pagefile ~0 |
| C. + Ollama daemon ocioso | 8682 MB | 951 MB | daemon ~47 MB WS — negligível |
| D. + `qwen3-coder` carregado + inferência | **~3200 MB (~20%)** | **~15188 MB** | split **25% CPU / 75% GPU**, ctx 8192, commit **~30 GB**, pagefile pico 151 MB |
| B. + Docker+Supabase essenciais (medido à parte) | **4391 MB (27%)** | — | `vmmem` 3276 MB; **Δ ≈ 4.0 GiB**; containers db/auth/rest/realtime/kong (auxiliares já off) |
| Recuperação (unload + teardown) | 8745 MB (53.8%) | 935 MB | footprint TOTALMENTE reclamado, sem vazamento |

**Footprint isolado do `qwen3-coder` (medido):** **~14.2 GiB VRAM + ~5.5 GiB RAM física
residente + ~19–20 GB de commit charge**, a num_ctx=8192. O runtime de 19 GB **não cabe** nos
~15 GiB de VRAM utilizável → Ollama força **25% em CPU/RAM**. O `ollama.exe` principal fica ~60
MB (o modelo roda no subprocesso runner); a medida honesta é o delta machine-wide de RAM livre.

**Desempenho sob condições LIMPAS (medido):** wall **28.4 s**, dos quais **load a frio 26.6 s**
(ler 19 GB do disco + alocar VRAM/RAM), prompt eval 0.85 s (142 tok), geração 0.91 s (27 tok) a
**29.8 tok/s**, `done_reason=stop`. **O custo dominante é o load a frio, não a geração** — e a
inferência **completou** quando havia headroom de RAM.

## Diagnóstico causal da barreira (reproduzido por soma de deltas medidos)

Demanda estrutural do Anima residente (sem navegador do usuário, mas com a interface Claude/ChatGPT
que o Gean de fato mantém aberta):

```
Windows + Claude + ChatGPT + runtime VR   ~7.8 GiB
+ Docker Desktop + WSL2(vmmem) + Supabase  +4.0 GiB   (medido)
+ resident host (node)                     +~0.4 GiB  (estimado, pequeno)
+ qwen3-coder (RAM residente)              +5.5 GiB   (medido)
= ~17.7 GiB demandados   >   16.25 GiB físicos  →  déficit ~1.4 GiB → SWAP forçado
```

Com Docker+Supabase no ar restavam **4391 MB livres**; o coder exige **~5.5 GiB de RAM** → a RAM
livre desaba para perto de zero → thrashing de pagefile → o **load a frio (que é limpo em ~27 s)
estoura os 120 s** → `ollama_timeout` (o desfecho `execution_failed` da prova diferencial:
`[ollama_timeout] … 120000 ms`, `durationMs=120153`, `backendId=ollama:qwen3-coder:latest`,
retryable). **É RAM starvation, não lentidão intrínseca do modelo, não bug, não planner, não auth.**

- **VRAM** é a razão pela qual a RAM é carregada: 16 GiB não seguram o runtime de 19 GB → 25%
  derrama para a CPU → esse derrame ocupa a RAM que já é escassa.
- **Concorrência** é o gatilho: o stack estrutural sozinho já ultrapassa 16 GiB; navegadores do
  usuário (a prova diferencial tinha Opera/Discord/Steam/ChatGPT → 1.15 GiB livres) só pioram.
- **Configuração NÃO é a culpada:** num_ctx=8192 e timeout=120 s já são conservadores; aumentar
  o timeout às cegas só troca "timeout" por "turno lentíssimo em swap". (Descartada a classe D.)

## Lacuna do Resource Governor (seção 6) — CONFIRMADA, sem bug

Diagnóstico com código (`resource-classification.ts`, `resource-advisory.ts`,
`resource-observation.ts`, `machine-telemetry.ts`):

- `decideResourceAdmission` recebe **só** `MachinePressure`, derivada de
  `freeMemBytes/totalMemBytes` **do instante** (< 0.10 = high; < 0.25 = moderate; ≥ 0.25 = low →
  permit). É um snapshot de RAM livre **antes** do coder carregar — **não reserva headroom para o
  footprint do próprio workload que vai lançar**, e não revê após o load.
- O histórico de custo é **`durationMs`** (tempo), não memória. Existe o slot opcional
  `WorkloadResourceSample { memBeforeBytes, memAfterBytes }` mas as derivações **não o populam**.
- `MachineSnapshotV1` **não tem VRAM nem pagefile** (`node:os` não enxerga a GPU).
- ⇒ O Governor admitiu (`permit`, ~5.88 GiB livres) e **o próprio carregamento do coder** starvou
  a RAM depois. **Não é bug** — é a fronteira observacional deliberada do V0.

**Dados que JÁ existem:** RAM livre atual (snapshot); `SIZE`/split do `ollama ps`; tamanho do
modelo (manifesto/`ollama ps`); num_ctx; o slot `WorkloadResourceSample` (vazio); a evidência
host-observed do coder (duração + desfecho). **E agora existe uma medição real de footprint** (este
registro: ~5.5 GiB RAM + ~14.2 GiB VRAM @ ctx 8192 para o `qwen3-coder`).

**Dados que FALTAM:** estimativa de footprint esperado por `(backend, modelo, num_ctx)`; VRAM
total/livre no snapshot (exige fonte de telemetria de GPU além de `node:os`); pressão de pagefile;
pico de RSS por run (popular `WorkloadResourceSample.memAfterBytes`).

**Desenho mínimo proposto (NÃO implementado neste ciclo):** admitir novo workload só se
`freeMem − footprintResidenteEsperado ≥ reserva` **e** houver headroom de VRAM (ou aceitar o
derrame dentro do headroom de RAM). Isto é: subtrair o footprint do próprio workload **antes** de
admitir, alimentado por (a) VRAM no `MachineSnapshotV1` e (b) um perfil de footprint por modelo
(medido/declarado). Preserva a separação EVIDÊNCIA ≠ CLASSIFICAÇÃO ≠ ADVISORY/DECISÃO e não afrouxa
a reserva.

## Meta-prova canônica (seção 7) — NÃO executada, por honestidade

A condição do ciclo era rodar a meta-prova **somente** sob janela realmente segura. A soma de
deltas medidos mostra que o stack completo (Docker+Supabase + resident host + coder + a interface
do usuário) **excede os 16.25 GiB físicos**. Não há janela sustentável. Rodar reproduziria a
barreira conhecida (`ollama_timeout`) ou exigiria fechar apps do usuário para fabricar um PASS
marginal — proibido pelo enunciado. **`CANONICAL_AUTO_EXECUTION` permanece NOT_PROVEN; a barreira é
hardware (RAM), agora bem medida.**

## Respostas objetivas

1. **A Goma sustenta o `qwen3-coder` para o Anima?** Não para o stack residente completo. Isolado,
   com a máquina quase livre, sim (carregou e respondeu em 28 s). Com Docker+Supabase+resident host
   simultâneos, ultrapassa 16 GiB → starvation.
2. **RAM, VRAM, config ou concorrência?** **RAM-bound** (16 GiB single-channel), porque a **VRAM
   (16 GiB) é pequena demais** para o runtime de 19 GB → 25% derrama para a RAM; a **concorrência**
   é o gatilho. Config já é conservadora (não é a causa).
3. **Quanto consome de fato?** ~14.2 GiB VRAM + ~5.5 GiB RAM física + ~19–20 GB commit @ ctx 8192,
   split 25% CPU / 75% GPU; load a frio ~27 s; ~30 tok/s carregado.
4. **32 GB resolvem o gargalo imediato?** **Sim, decisivamente para a RAM.** Coder (5.5 GiB) +
   Docker (4 GiB) + resident host caberiam com folga; o timeout de starvation some. Recomendado
   **2×16 GB dual-channel** (corrige também a penalidade single-channel nas camadas em CPU). Não
   muda o derrame de 25% para CPU (VRAM inalterada) → throughput segue ~30 tok/s, mas o modelo
   **carrega e responde dentro do timeout**.
5. **64 GB se justificam para o roadmap?** Para o workload atual, 32 GB bastam. 64 GB se justifica
   com: paralelismo (planner + coder simultâneos), contexto maior (num_ctx 32k já deu OOM aqui),
   **Computer Interaction** (um modelo de visão/UI residente ao lado do coder) e manter o ambiente
   de dev (Next + testes + typecheck) quente junto. Para rodar o coder **inteiro na GPU** (sem
   derrame, mais tok/s) o lever é **VRAM (GPU ≥24 GB)**, não RAM de sistema.
6. **Lacuna no Governor?** Sim — confirmada e caracterizada (acima). Admissão só por pressão atual;
   sem reserva do footprint do workload; sem VRAM/pagefile no snapshot; custo histórico é tempo, não
   memória. Não é bug; é limitação de design V0.
7. **A meta-prova chega a review sob janela sustentável?** Não nesta máquina de 16 GiB com o stack
   completo. Só passaria esvaziando a máquina (classe B, "quase livre"), não sustentável.

## Requisitos de hardware derivados (seção 9) — derivação, NÃO compra

- **ATUAL (16 GB / RTX 5060 Ti 16 GB):** suporta o `qwen3-coder` só isolado e com a máquina quase
  ociosa; não sustenta coder + Docker/Supabase + resident host em concorrência. Planner+coder local
  residente = inviável hoje.
- **MÍNIMO RECOMENDADO:** **32 GB DDR4-2666 como 2×16 (dual-channel)** — um módulo 16 GB no slot
  livre (ChannelB). Elimina a RAM starvation e o `ollama_timeout` da cadeia atual. Mantém a RTX
  5060 Ti 16 GB (aceita o derrame de 25% / ~30 tok/s).
- **CONFORTÁVEL / FUTURO:** **64 GB (2×32 ou 4×16)** + **GPU com ≥24 GB VRAM** (segura o runtime de
  19 GB inteiro na GPU → sem derrame → maior throughput, e headroom para um segundo modelo residente
  de Computer Interaction). Suporta resident host + Docker/Supabase + coder + dev + paralelismo.

## Direção canônica futura do Anima (seção 10) — registrada, NÃO implementada

Esta sessão é o **protótipo manual** de uma capacidade futura do próprio Anima: **Host Inventory +
Host Telemetry + Workload Profile → Capacity Planner** (diagnóstico de capacidade → recomendação de
upgrade) e, depois, **Procurement Advisor** (pesquisa de hardware, compatibilidade, custo/benefício).
Encaixa na arquitetura existente do Resource Governor (a telemetria e o histórico de custo já são o
substrato; falta o eixo de MEMÓRIA/VRAM e a estimativa de footprint). **Procurement NÃO deve ser
implementado agora.** Separação preservada: EVIDÊNCIA (hardware/RAM/VRAM/tempos) ≠ CLASSIFICAÇÃO
(pressão/fit) ≠ DIAGNÓSTICO (gargalo=RAM) ≠ RECOMENDAÇÃO (32/64 GB / GPU) ≠ DECISÃO (humana).

## Invariantes / segurança / efeitos

- `origin/main` intacta; sem PR/merge/deploy/integração/service_role/db reset/cleanup destrutivo;
  nenhum segredo em log ou no Git.
- Nada de código alterado (só registro + ponteiro no PRD). Nenhum work_item, aprovação, tentativa,
  worktree, gate ou parecer criado. OpenAI: zero chamadas, zero custo.
- Efeitos reversíveis realizados e desfeitos: subi Ollama daemon e Docker Desktop apenas para medir;
  ao fim, `supabase stop` + Ollama parado + Docker Desktop encerrado + `wsl --shutdown` → **baseline
  restaurado (8745 MB livres, `vmmem` fora, VRAM 935 MB)**. Dados do Supabase preservados no volume
  Docker (nada apagado). `.worktrees/`, `.claude/settings.local.json`, `apps/web/.env.local`
  preservados.

## Próximo ponto exato de retomada

1. **Fronteira de hardware (RATIFICADA como barreira, bem medida):** a cadeia canônica local até
   `review` só é provável após **+16 GB de RAM (total 32 GB, dual-channel)**. Decisão de compra é
   humana; requisitos derivados acima.
2. **Fechar a lacuna do Governor (recorte próprio, quando priorizado):** adicionar VRAM ao
   `MachineSnapshotV1` (fonte de telemetria de GPU) + perfil de footprint por `(backend, modelo,
   num_ctx)` + admissão com reserva de footprint. Começar populando `WorkloadResourceSample` com o
   pico medido do coder (este registro já fornece o primeiro ponto: ~5.5 GiB RAM / ~14.2 GiB VRAM).
   Se um dia surgir um bug determinístico na admissão, provar antes de corrigir.
3. **Fronteira do planner LOCAL** (qwen3-coder-como-planner exaure rodadas) segue aberta e
   desacoplada — ver [diferencial](2026-08-23-diferencial-openai-e-fix-ordem-auto-aprovacao.md).
   `OPENAI_PLANNER_TERMINALITY=PASS` permanece.

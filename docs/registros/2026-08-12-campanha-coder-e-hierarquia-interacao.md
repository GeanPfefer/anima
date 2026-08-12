# Campanha de evidência do coder local + hierarquia de interação (2º ciclo)

**Data:** 2026-08-12
**Tipo:** ambos (correção documental + campanha de prova controlada)
**Branch:** `claude/integration-application-layer`
**HEAD inicial:** `c5fc88f`
**HEAD final:** `5b43173` (+ este registro; ver "Commits")
**`origin/main`:** `973ef46` — **intacta, sem push**

## Objetivo

Segundo ciclo manual controlado (sem recorrência) do Supervisor: (2) explicitar a
**hierarquia de interação** do Marco 007; (3) ampliar a **campanha de evidência do
coder local** por classes de tarefa e modelos, medindo determinismo vs
estocasticidade, **sem** alterar contrato/prompt/`maxReadRounds`/gates/roteamento.

## Papéis e proibições confirmadas

Executor sob mandato; Reviewer/Verifier final humano e independente. **Nada** de
push/PR/merge/deploy/reset/limpeza/recorrência. **Não** ratificar "14B é piso";
**não** implementar "âncora de edição"; **não** mudar contrato/protocolo/prompt/
`maxReadRounds`/modelo/default/roteamento/gates com base na campanha. Nenhum
resultado experimental aplicado ao alvo real.

## Commits

- `5b43173` — *Explicite a hierarquia de interação do Marco 007.* (documental)
- (este registro, commit próprio de documentação)

## Parte 2 — Hierarquia de interação (correção documental)

O Marco 007 registrava "preferir caminhos semânticos/API" mas **não explicitava** a
hierarquia ratificada. Perpetuada de forma provider-neutral (níveis de acesso, não
fornecedores), sem virar contrato/taxonomia/backlog:

**API/ferramenta nativa → shell/filesystem → DOM/acessibilidade do navegador →
automação de UI/acessibilidade do OS (ex.: Windows UI Automation) → visão da tela →
mouse/teclado bruto por coordenadas (fallback).** Princípio: **"não clicar se puder
chamar"** — escolher o nível mais semântico/preciso/auditável/seguro que cumpra a
tarefa; descer só quando o anterior for inadequado/indisponível; visão e coordenadas
são legítimas mas fallback, não default.

Arquivos: [Marco 007](../marcos/007-interacao-com-computador-e-aplicacoes-locais.md)
(seção de continuação append-only, §1–§6 intactos); [arquitetura](../arquitetura/orquestracao-de-trabalho.md)
(nota direcional viva, com a escada + princípio); [`anima-prd.md`](../../anima-prd.md)
(linha de decisão §10 em resumo). Sem contrato/implementação.

## Parte 3 — Campanha do coder local

### Método (não invasivo, isolado, descartável)

Classe `OllamaCoderBackend`
([`apps/web/lib/work-orchestration/ollama-coder.ts`](../../apps/web/lib/work-orchestration/ollama-coder.ts))
exercitada **sem modificação**, via cópias descartáveis no scratchpad, `fetchImpl`
**observador** e alvos em memória. Config de **produção fixa**: `maxReadRounds=3`,
`temperature=0`, `num_ctx=8192`, `num_predict=1536`. Sem controle de `seed` (o
código não o expõe; a temp=0 usa decodificação gulosa). Modelos **já locais**:
`qwen2.5-coder:7b`, `qwen2.5-coder:14b`, `qwen3-coder:30b` (nenhum baixado). Métricas
por execução: outcome/failure code, nº e padrão de reads, chamada/momento do edit,
rodadas restantes no edit, exatidão do `before` (ocorrências no arquivo original),
paths tocados, duração. Artefatos brutos (não versionados) no scratchpad:
`coder-exp/campaign-*.json` (9 arquivos).

### FATOS (matriz sucesso/total; config de produção)

| Classe de tarefa | 7b | 14b | 30b |
|---|---|---|---|
| `single_min` — 1 arquivo, edição mínima, indentação | 3/3 | 2/2 | 1/1 |
| `multi_locate` — múltiplos arquivos, localizar função | **0/3** `ambiguous_replacement` | 2/2 | 3/3 |
| `indent_nested` — indentação profunda | 3/3 | 2/2 | 1/1 |
| `multiline_before` — `before` multilinha | **2/13** `read_round_limit`×11 | 2/2 | 3/3 |
| `create_new` — criar arquivo novo | **0/8** `invalid_response_schema`×5, `read_round_limit`×3 | **0/2** `invalid_response_schema` | 3/3 |
| `structural_add` — adicionar export | 3/3 | **0/2** `ambiguous_replacement` (occ=2) | 3/3 |
| `cleanup` — encolher bloco redundante | 3/3 | 2/2 | 1/1 |

Totais brutos (rep counts desiguais; comparar por célula, não por total): 7b 14/36,
14b 10/14, 30b 15/15.

**Fatos derivados (comprovados):**
1. **Capacidade NÃO é monotônica no tamanho.** 7b **passa** `structural_add` (3/3)
   onde 14b **falha** (0/2); 7b **falha** `multi_locate` (0/3) onde 14b **passa**
   (2/2). Logo 14b **não** é superconjunto de 7b.
2. **Criação de arquivo (`create_new`) é a classe mais difícil** para modelos
   pequenos: 7b 0/8, 14b 0/2; só 30b 3/3.
3. **Quatro assinaturas de falha distintas — todas fail-closed corretamente pelo host:**
   - `ollama_ambiguous_replacement` occ=0 → **`before` com indentação alucinada**
     (7b `multi_locate`: emite 4 espaços onde há 2);
   - `ollama_ambiguous_replacement` occ=2 → **âncora `before` não-única** (14b
     `structural_add`: escolhe trecho que casa 2 linhas de export parecidas);
   - `ollama_read_round_limit` → **read-stalling** até a rodada forçada (7b
     `multiline_before`, `create_new`);
   - `ollama_invalid_response_schema` → **confusão de envelope**: emite
     `{"action":"create_file",...}` (kind da operação como `action`) em vez de
     `{"action":"edit","operations":[{"kind":"create_file",...}]}` (14b e 7b em
     `create_new`).
4. **Estocasticidade real a `temperature=0`.** `multiline_before` no 7b variou
   entre execuções (≈2/13 sucesso) e os 2 sucessos ocorreram no batch que rodou
   **após** outros cenários; `create_new` no 7b **sempre falha** mas o **código
   terminal alterna** (`read_round_limit`↔`invalid_response_schema`) entre batches.
   Vários outros casos foram estáveis nas reps. Ou seja: temp=0 **não garante**
   determinismo neste setup (GPU/batching).
5. **30b foi confiável em todas as classes** (15/15), inclusive `create_new` (emite
   `create_file` na estrutura correta, na 1ª chamada) e `structural_add` (âncora
   única).
6. **O host/protocolo está correto.** Toda falha decorre da saída do modelo e é
   recusada fail-closed com o código específico. **Nenhum bug de produção** foi
   encontrado; a exceção de correção de bug **não se aplica**.

### HIPÓTESES (não comprovadas — separadas dos fatos)

- H1: o formato de trecho **numerado** (`NNN| `) dificulta a reconstrução byte-exata
  do `before` por modelos pequenos (some com 14b/30b). Sugerido pela assinatura
  occ=0 sempre em espaço/indentação.
- H2: `create_file` **como `action`** é um atrator do envelope para modelos pequenos;
  o reparo único não corrige porque o modelo repete a mesma estrutura.
- H3: efeito de **ordem/warmup** influencia casos estocásticos (os 2 sucessos de
  `multiline_before` no 7b vieram após aquecimento por cenários anteriores).
- H4: o read-stalling é agravado quando a tarefa exige "entender" antes de editar
  (`multiline_before`, `create_new`), consumindo rodadas.

### LIMITAÇÕES / ameaças à validade

- Fixtures são **proxies** sintéticos, não o repositório real (arquivos pequenos,
  escopo limitado); não reproduzem o volume/estrutura do alvo autônomo real.
- Rep counts **desiguais** entre células (7b tem reps extras); totais por modelo não
  são diretamente comparáveis — a leitura válida é por célula.
- Sem controle de `seed`; o não-determinismo observado impede afirmar taxas exatas
  com poucas reps. `multiline_before`/`create_new` no 7b precisariam de N maior e
  ordem randomizada para uma taxa estável.
- 30b teve 1–3 reps por célula: **forte indício** de robustez, **não** prova de
  confiabilidade estatística.
- Um único protocolo/config (produção). Não se variou prompt/rounds nesta parte (por
  desenho e por proibição), então não se mediu sensibilidade a esses fatores aqui.

### RECOMENDAÇÕES (documentadas, NÃO aplicadas; o que falta provar)

Nada é promovido automaticamente. Cada item abaixo é candidato a **item próprio** com
evidência e testes, sob nova decisão humana:

- **R1 — roteamento por capacidade (não ratificar piso agora).** A evidência
  desaconselha um "piso" único: 14b regride em `create_new` e `structural_add`. Se
  no futuro se quiser um piso, ele deve ser **por classe de tarefa**, com N estatístico,
  ordem randomizada e fixtures realistas. *Falta provar:* taxas estáveis por classe em
  alvo realista; comportamento de 14b em `structural_add`/`create_new` com N maior.
- **R2 — ergonomia de âncora de edição (NÃO implementar neste ciclo).** As falhas
  occ=0/occ=2 e a confusão de `create_file`-como-`action` sugerem que a exigência de
  `before` byte-exato a partir de trecho **numerado** é a maior fonte de fragilidade
  dos modelos pequenos. *Falta provar (e exige ADR/plano):* que uma âncora alternativa
  (ex.: `path`+intervalo+sha servindo texto cru) reduz falhas sem perder as garantias
  fail-closed; medir em A/B isolado antes de qualquer mudança de contrato.
- **R3 — quantificar estocasticidade** com N alto, ordem randomizada e, se disponível,
  `seed` fixo, para separar fragilidade determinística de ruído de execução.

## Gates executados

- **Documentação (Parte 2):** `git diff` confina a `*.md`; links do Marco 007 ↔
  arquitetura resolvem; nenhum arquivo de código/schema tocado. Suíte de código não
  se aplica a mudança documental.
- **Campanha (Parte 3):** experimentos vivos; **não** rodam gates de produção (por
  desenho — nada foi aplicado). Nenhuma alteração em `apps/`, `packages/`, `supabase/`,
  `tools/`.

## Invariantes de segurança / efeitos externos

Nenhuma proteção afrouxada. **Nenhum push/PR/merge/deploy.** `origin/main` intacta
(`973ef46`). Nenhuma migration/RPC/enum/tipo/contrato/gate tocado. Nenhum efeito
externo. Experimentos confinados ao scratchpad; workspace real byte-intacto.

## Arquivos locais preservados

`.worktrees/` (mobile-completed-result, roadmap-003-006), `.claude/settings.local.json`,
`apps/web/.env.local` e não-versionados intactos. Artefatos brutos da campanha
preservados em `scratchpad/coder-exp/campaign-*.json`. Nenhuma operação destrutiva.

## Fronteiras humanas restantes (`BLOCKED_BY_HUMAN_DECISION`)

- Ratificar qualquer "piso" de modelo (R1) — precisa de N estatístico/realista.
- Mudar contrato do coder / âncora de edição (R2) — exige ADR/plano.
- Promover classes de efeito do Marco 007; agendamento/recorrência.
- Review request real, `merged`/`integrated`, deploy, UI de auto-desenvolvimento.

## Próximo passo exato

Escolher, sob decisão humana, entre R1/R2/R3 como item próprio (com testes e sem
afrouxar gate), ou seguir o backlog do [Plano 002](../planos/002-modo-autonomo-v0.md).
Sem push; `origin/main` intacta. **Nenhuma rotina/recorrência criada.**

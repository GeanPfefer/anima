# Diferencial OpenAI (planner) + correção da ordem da auto-aprovação — provado ao vivo até `execution_started`

Data: 2026-08-23
Tipo: prova viva diferencial + diagnóstico + correção causal + prova viva pós-fix

`OPENAI_PLANNER_TERMINALITY = PASS`
`AUTO_APPROVAL_ORDERING_BUG = FIXED (provado ao vivo: work_approved system + classified + claim + execution_started)`
`CANONICAL_AUTO_EXECUTION (até review) = NOT_PROVEN — bloqueado por recurso no coder local (ollama_timeout)`
`CANONICAL_AUTO_EXECUTION_LOCAL_PLANNER = NOT_PROVEN (fronteira qwen3-coder-como-planner segue aberta)`

## Estado Git

- Branch `dev`. HEAD inicial `8d52107`. HEAD final `7a0e501` = `origin/dev` (push OK nesta sessão).
- `origin/main` `99bec54`, intacta. Sem PR/merge/deploy/db reset/service_role runtime.
- Commit desta sessão: `7a0e501` — `Corrija a ordem da auto-aprovação: aprove antes de classificar (INTEL-01)`.

## Recursos (Prioridade 1)

- Governor recuperou naturalmente no início (5,88 GiB livres = 0,37 = permit); depois ficou
  PARADO ~0,244 (100 MiB abaixo da reserva de 25%) e, mais tarde, ~0,18. NÃO forçado, NÃO
  relaxado, reserva de 25% intacta, nenhum processo do usuário encerrado.
- Infra: Docker+Supabase essenciais no ar (db/auth/rest/realtime/kong); auxiliares
  (studio/pg_meta/vector/analytics) já parados de sessão anterior; nenhuma redução auxiliar
  segura restante (pressão é dos apps do usuário: Opera/Discord/Steam/ChatGPT). Ollama subido;
  `qwen3-coder:latest` presente; GPU RTX 5060 Ti (14,8 GiB livres).
- Estratégia honesta: monitor que só LANÇA a prova quando o Governor genuinamente permite com
  margem (free ≥ 0,27, para o footprint do próprio processo não derrubar o check < 0,25). Duas
  janelas naturais abriram (0,36 / 0,35) e dispararam as duas rodadas.

## Prova diferencial OpenAI (planner) — autorização estreita honrada

- Payload minimizado e VERIFICADO no código: as tools read-only do planner (`project_tools.ts`)
  bloqueiam `.env*`, `*.pem/key/p12/pfx`, `id_rsa/ed25519`, e os segmentos `.git/.claude/`
  `.worktrees/node_modules/.next`; `rg` com `--glob '!*.env*'`; requisição OpenAI com
  `store:false, stream:false`. NENHUM segredo/`.env`/chave/token egressou. Egress confirmado
  (probe 401 sem auth). Modelo validado por GET `/v1/models/gpt-5.6-terra` (200, owned_by=system).
- Provider/model: `openai` / `gpt-5.6-terra`; endpoint Responses API. Duas execuções diferenciais
  (dentro do bound). Usage/tokens não capturados pelo código do planner (não logado); custo
  aproximado pequeno (poucas rodadas de investigação + submit por execução). Sem retry loop externo.
- **Resultado: o planner OpenAI produziu proposta TERMINAL VÁLIDA nas duas execuções** →
  materializou FIX-01 → work_item `proposed` (`intent.planner=openai_project_tools_v1`,
  `included_scope` ancorado). Isso PROVA que a terminalidade do planner é atingível com modelo
  capaz; a fronteira local (qwen3-coder-como-planner exaure rodadas) é do modelo, não do protocolo.

## Bug determinístico isolado e corrigido

- 1ª execução parou em `classification_persist_failed: proposal version is not approved`
  (NÃO Governor, NÃO planner). Causa raiz: a auto-aprovação (`6a3ed9e`) classificava ANTES de
  aprovar, mas INTEL-01 (`record_work_intelligence_classification`) exige que a classificação seja
  gravada CONTRA uma versão JÁ APROVADA, e a `autonomous_work_queue`/gate de inteligência só admite
  item classificado. Ordem invertida ⇒ falha fechada ⇒ item preso em `proposed`. Nenhuma meta-prova
  anterior alcançou este passo ao vivo (bloqueada antes pelo planner local e pelo Governor).
- **Correção causal mínima (`7a0e501`, `auto-approval.ts`)**: APROVAR primeiro
  (`author=system`/`autonomous_policy`) e só então derivar/persistir a classificação exigida.
  Sem tocar RPC/migration (as RPCs impõem corretamente a invariante), sem db reset; idempotente,
  fail-closed, honestidade de autoria preservada. Regressão nova com double que espelha a invariante
  INTEL-01 (a ordem invertida reprovaria).
- Gates: web auto-approval 11/11 (inclui a regressão), core autonomous-authorization 23/23,
  resident-host 82/82, typecheck 5/5 workspaces, `git diff --check` limpo.

## Prova viva pós-fix (in_process, Next NÃO necessário, planner OpenAI, coder qwen3-coder LOCAL)

Usuário descartável allowlisted `canonical-auto-proof-20260823@test.invalid`
(`a8230000-…-001`, fila operacional vazia; senha redefinida só nesta identidade-fixture, sem
service_role no runtime da cadeia). Resident host bounded (`materializeWhenIdle`=fixture,
`maxIterations=6`, autonomy=enabled), SEM chamada manual à rota. Cadeia de eventos persistida do
item `65d1f36c` (planner=openai):

```
work_proposed(anima) → context_attached(anima) → work_approved(system) →
work_intelligence_classified(system) → work_routing_adjusted/decided(system) →
work_claimed(system) → work_started(user) → execution_started(anima) →
execution_failed(executor) → work_claim_released(system) →
host_observed_coder_evidence_recorded(system)
```

- **A correção está PROVADA ao vivo**: `work_approved author=system` (seq 31706) + `work_intelligence_
  classified author=system` (31707) persistidos; o item PASSOU o gate de inteligência no claim E no
  `execution_started` — toda a autorização autônoma + fila + seleção + claim + início de execução
  ocorreram SEM humano. A dependência da borda humana de aprovação foi eliminada para esta classe
  estreita (materialização → autorização → classificação → claim → execução), honestamente
  (`author=system`, nunca `user`).
- **Barreira remanescente = RECURSO no coder local**: `execution_failed` com
  `[ollama_timeout] o modelo local não respondeu em 120000 ms` (retryable:true;
  `durationMs=120153`; `backendId=ollama:qwen3-coder:latest`). Ollama reportou split 25%/75%
  GPU/CPU (o modelo de 18 GB não cabe em 14,8 GiB de VRAM → ~13,5 GiB na RAM) com free RAM
  desabada para 1,15 GiB (0,07) sob a carga dos apps do usuário → swap → o modelo não respondeu no
  timeout. É ambiental/retryável, NÃO um bug de código, NÃO o planner, NÃO a autorização. O Governor
  (admissão pré-turno) permitiu antes do coder carregar; o próprio carregamento do coder starvou a
  RAM depois — o gate de admissão não contabiliza o footprint do próprio coder (observação, não
  corrigida: mexer no Governor/coder está fora do escopo do diferencial).

## Invariantes / segurança

- `origin/main` intacta; sem PR/merge/deploy/integração/service_role runtime; nenhum segredo em log
  ou no Git; `.worktrees/`, `.claude/settings.local.json`, `apps/web/.env.local` preservados.
- Repo byte-intacto após a prova: a execução ocorreu em WORKTREE ISOLADA (descartada); nenhum
  `_scratch-fixture-materializer.md` no working tree principal. Item `65d1f36c` (`failed`) e a
  fixture ficam como EVIDÊNCIA na identidade descartável.
- Materialização ≠ aprovação ≠ execução; teto de execução continua `review`. Nada foi aceito,
  integrado, mergeado nem aplicado.

## Próximo ponto exato de retomada

1. **Completar coder → gates → Verifier → review** exige uma janela de recurso em que o
   `qwen3-coder:latest` (18 GB) carregue majoritariamente na GPU e responda dentro do timeout — não
   atingível sob a carga atual dos apps do usuário nesta máquina de 16 GB (o modelo sempre derrama
   para CPU/RAM). Retomar quando houver janela ampla (RAM+VRAM), OU investigar, como recorte próprio
   e fora deste diferencial, a configuração de memória/contexto/timeout do coder (num_ctx 8192,
   split GPU/CPU, `streamIdleTimeoutMs`) sem afrouxar Governor nem trocar o modelo do coder. Para
   re-tentar via re-run, resetar o item `65d1f36c` da identidade-fixture (senão a fixture rende
   `all_settled`).
2. **Fronteira do planner LOCAL** (qwen3-coder-como-planner exaure rodadas) segue aberta e agora
   DESACOPLADA do bug de auto-aprovação (que era comum a qualquer planner). O diferencial confirmou
   que o protocolo/host não são o elo fraco do planner — é a terminalidade do modelo local.

# 2026-08-17 — Custo do Coder host-observed: evidência, histórico e investigação de tokens

**Tipo:** desenvolvimento (+ prova viva pgTAP local).

## Objetivo

Fechar o menor vertical slice do custo do Coder/LLM no Resource Governor, na direção
da [visão de identidade/compute distribuído](../arquitetura/visao-identidade-compute-distribuido.md)
§12 ("preferir evidência observada independentemente pelo host") e §13 (tokens = evidência,
custo monetário = derivado). Preservar `EVIDÊNCIA ≠ CLASSIFICAÇÃO ≠ ADVISORY ≠ DECISÃO ≠ AÇÃO`
e `HOST_OBSERVED ≠ PROVIDER_REPORTED`.

## Branch / HEAD

- Branch de trabalho: `claude/integration-application-layer` (retomada por fast-forward da
  `main` consolidada).
- HEAD inicial: `99bec54` (= `main` = `origin/main`; consolidação manual + doc de visão já
  pushados antes desta sessão).
- HEAD final: `2611e45`.
- `main` / `origin/main` permanecem em `99bec54` — intactas, sem push.

## Commits criados

- `876af54` — Observe a duração host-observed do coder como evidência durável (slice 1).
- `2611e45` — Derive o custo do coder no histórico do Resource Governor (Fork A).

## Mudanças relevantes

### Slice 1 — duração host-observed do coder como evidência durável (`876af54`)

- `packages/core/.../host-observed-coder-evidence.ts` — `HostObservedCoderEvidenceV1`
  (build/parse/project puros, fail-closed). Identidade = `backendId`; desfecho =
  `succeeded | failed | cancelled` (cancelamento = medição parcial distinta). Espelha o
  padrão de [`host-observed-gate-evidence`](../../packages/core/src/work-orchestration/host-observed-gate-evidence.ts).
- `apps/web/.../worktree-executor.ts` — opção `onCoderObserved` + relógio host
  (`Date.now()`) ao redor do único `backend.edit()`, emitido em TODOS os caminhos
  (sucesso/falha/cancelamento), ANTES de qualquer restauração. NÃO muda o contrato
  `CoderBackend`.
- `supabase/migrations/20260817000000..01` — vocabulário `host_observed_coder_evidence_recorded`
  + validador `private.is_valid_host_coder_evidence` + índice único por tentativa + RPC
  `record_host_observed_coder_evidence` (`author=system`/`origin=host`, fail-closed,
  idempotente ignorando `observedAt`, conflito 55000).
- `apps/web/.../coder-evidence.ts` — sink fail-open + persistência na `/supervisor-turn`
  (passo 0b), ao lado da evidência de gate. Gravar a observação NUNCA transforma uma edição
  bem-sucedida em falha da tentativa.
- `packages/types/database.ts` — event type (2 lugares) + assinatura do RPC; conferidos
  contra o regen do banco local (batem).

### Fork A — custo do coder no histórico do Resource Governor (`2611e45`)

- `packages/core/.../resource-observation.ts` — `deriveCoderWorkloadCostObservationsFromEvents`
  (kind=`coder`, command=`backendId`). Chave de perfil `(kind, command, repo)` mantém gate e
  coder em perfis SEPARADOS. Cancelamento é PULADO na derivação (medição parcial, não é amostra
  de custo; a evidência bruta segue persistida e recomputável).
- `apps/web/.../resource-governor.ts` — `deriveAllWorkloadObservations` combina gate+coder em
  `composeHostResourceGovernorView` e `composeSupervisorResourceAdvisory`;
  `composeItemGateAdvisory` fica gate-scoped de propósito.
- `apps/web/.../supervisor-turn/route.ts` — passo (3) lê AMBOS os event types (gate e coder)
  machine-wide e concatena.
- `packages/core/.../presentation.ts` — `projectWorkResourceCost` inclui o coder; o custo do
  coder surfa read-only no card **web e mobile** (presentation é core compartilhado).

## Decisões

- Primitivo durável NOVO (`HostObservedCoderEvidenceV1`), não um `WorkloadCostObservationV1`
  persistido direto: preserva a separação EVIDÊNCIA (primitivo) × OBSERVAÇÃO DE CUSTO (projeção
  pura), igual ao gate. Derivar para `WorkloadCostObservation` (kind=coder) é projeção separada.
- `model` do provider fica FORA da evidência de duração (o host não o observa; é PROVIDER_REPORTED,
  ligado a tokens — mudança contratual separada). Identidade honesta = `backendId`.
- Cancelamento é evidência (persistida) mas NÃO amostra de custo (pulado na derivação).

## Investigação do Fork B — provider-reported usage/tokens (NÃO implementado; direção registrada)

Investigação read-only concluída; **persistência deliberadamente adiada** por ausência de
consumidor concreto (visão §19: "registrar a direção e esperar pela necessidade concreta";
Fork C monetário explicitamente gated em "a evidência de tokens já criar um consumidor legítimo").
Construir persistência de tokens agora seria a infraestrutura especulativa que a visão desaconselha.

Ponto exato de captura (para quando o consumidor existir):

- **Ollama:** [`ollama-protocol.ts`](../../apps/web/lib/work-orchestration/ollama-protocol.ts)
  já parseia `OllamaCallMeta { promptEvalCount, evalCount, doneReason }` de
  `prompt_eval_count`/`eval_count`/`done_reason` da resposta HTTP. Hoje é usado só por
  `assertNotTruncated` e **descartado**: `callProtocol` (em `ollama-coder.ts`) retorna
  `parseProtocolResponse(first.content)` sem o `meta`. Uso total do `edit()` exigiria ACUMULAR
  `meta` pelas N rodadas de leitura + reparo (loop `edit()`, `ollama-coder.ts:113-159`).
- **GPT:** [`gpt-coder.ts:88`](../../apps/web/lib/work-orchestration/gpt-coder.ts) faz
  `body = await response.json()`; `body.usage` (Responses API: `input_tokens`/`output_tokens`/
  `total_tokens`) existe mas é **descartado** após `extractText(body)`. Chamada única (trivial).

Menor mudança contratual identificada: `CoderEditResult.usage?: ProviderReportedUsage`
(`{ provider, model, inputTokens, outputTokens }`, proveniência PROVIDER_REPORTED) →
`onCoderObserved` → campo `usage?` opcional em `HostObservedCoderEvidenceV1` (validador do
RPC estendido a aceitar o objeto opcional) → persistência → surface/derivação de custo
monetário (Fork C) quando houver catálogo/consumidor. Preservar diferenças reais entre
providers; não forçar schema universal além de input/output tokens.

## Provas / gates

- `npm run typecheck` — 5 workspaces, verde.
- Jest core — **892** testes (40 suites), verde (inclui `host-observed-coder-evidence` 19,
  derivação/coexistência coder 7, presentation coder 2).
- Jest web — **533** testes (48 suites), verde (inclui `coder-evidence` 7, `worktree-executor`
  +3 do observador do coder, `supervisor-turn/route` fiação gate+coder).
- pgTAP local (`supabase test db --local`) — **34 arquivos / 820 testes**, verde;
  `host_observed_coder_evidence.test.sql` (15 asserções) incluso. Migrations aplicadas por
  `supabase migration up` (não-destrutivo); regen de tipos confere.

## Flakes conhecidos

Nenhum observado nesta sessão. Um `console.error` no teste de `WorkProposalCard` é rejeição
mockada esperada (o teste passa).

## Limitações / não feito

- Tokens/modelo do provider: investigado, NÃO implementado (sem consumidor — ver acima).
- Custo monetário (Fork C): não iniciado (gated em evidência de tokens + catálogo).
- Compute distribuído (Fork D): não iniciado (visão, não autoridade presente).
- Nenhuma classificação/advisory NOVO por tokens; classificação segue por duração host-observed.

## Invariantes de segurança preservadas

- Zero autoridade automática nova: tudo observacional/advisory/read-only.
- Fail-open na persistência da observação; fail-closed na régua da evidência (RPC + core).
- `EVIDÊNCIA ≠ CLASSIFICAÇÃO ≠ ADVISORY ≠ DECISÃO ≠ AÇÃO` e `HOST_OBSERVED ≠ PROVIDER_REPORTED`.
- Proveniência `author=system`/`origin=host` não forjável pelo sinal do executor.

## Efeitos externos

- **Não realizados:** push, PR, merge, deploy, `integrated`, credenciais. `main`/`origin/main`
  intactas em `99bec54`.
- **Realizados (locais, reversíveis):** Docker Desktop iniciado; Supabase local iniciado;
  `supabase migration up` (aditivo); `supabase test db` (BEGIN/ROLLBACK); regen de tipos
  (comparado, não sobrescrito).

## Worktrees / ambientes preservados

`.worktrees/mobile-completed-result`, `.worktrees/roadmap-003-006`, `G:/anima-local-test`
(detached) — intactos. `.claude/settings.local.json` e `apps/web/.env.local` preservados.

## Próximo ponto exato de retomada

Fork B (tokens) está investigado e pronto para implementação **quando surgir o consumidor**
(Fork C / custo monetário): começar por `CoderEditResult.usage?` + captura no GPT (trivial,
`gpt-coder.ts:88`) e acumulação no Ollama (`ollama-coder.ts` `callProtocol`/`edit`), depois
campo `usage?` opcional em `HostObservedCoderEvidenceV1` + validador do RPC. Até lá, o custo do
coder é honestamente só a duração host-observed.

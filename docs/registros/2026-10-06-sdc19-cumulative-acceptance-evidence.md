# SDC-19 — evidência de aceitação CUMULATIVA (SDC-18 + alinhamento do teste ai-memory + prova isolada de F)

Registro append-only. Data: 2026-10-06. Branch do repositório: `dev` = `origin/dev` = `448fdde`. Nada foi commitado, integrado, empurrado nem aceito.
**Este arquivo NÃO faz parte do escopo de implementação do SDC-19 e NÃO está na branch do candidate.** Ver "Persistência" abaixo.

## Cadeia

- `448fdde` (dev) → `ad669c3` (candidate do SDC-18, attempt `1dae4d70-c5ca-41fa-9be5-58d1023e1706`) → `29cd393de58af67915580f3e453929cf8c0391c8` (1º candidate do SDC-19 `3fe7de88`, attempt `e47766e5-a76c-4a7e-9cbe-5cba82f14185`, verified; recebeu `request_changes` humano pela lacuna F) → `b9d617c33455cd15114698de2fd7a9716b5b78b5` (candidate da CORREÇÃO, successor `c4454835-7de9-4f91-91e4-932a8d169bb8`, lineage `c3b7882b-f67e-489b-b00c-aa1be621904a`, attempt `9f530a09-c61e-47ac-b7ea-0452193dfa30`, verified). O item cuja aceitação futura cobre a árvore cumulativa é o successor `c4454835` (o `3fe7de88` permanece em `changes_requested`).
- SDC-18 `614512ef-e848-4288-808d-c5cd71a68d90`: **estado histórico = `failed`** (`[gate_failed]` no gate `cli-coder`; 1/1 attempts). **Nenhum accept retroativo.** O estado não foi alterado.
- SDC-19 `3fe7de88-ea34-4c5b-abd8-5a3cb02fafa1`: proposal v2 (codex-cli/default), base_sha = `ad669c3` (base NÃO integrada; suporte incidental dos guards, ver auditoria de 2026-10-06), estado `changes_requested`.
- Successor de correção `c4454835-7de9-4f91-91e4-932a8d169bb8`: proposal v2 (adenda aditiva ao objective com o teste exato de F), `resume_from_checkpoint` = `29cd393` (base `ad669c3`), escopo = o mesmo único arquivo de teste, codex-cli/default, estado `review`.
- SDC-17 permanece `failed`, inalterado.

## O que o SDC-19 alterou (diff focal)

- Somente `apps/web/lib/work-orchestration/native-cli-coder.ai-memory.test.ts`: +35/−4 medido `ad669c3..b9d617c` (+13/−4 do 1º candidate; a correção `29cd393..b9d617c` acrescentou +22/−0, um único teste novo, sem produção).
- Evidência do host (correção): `baseSha = ad669c3`; pai de `b9d617c` = `29cd393`; `observedChangedFiles` = `observedChangedFilesSinceStart` = esse único arquivo.
- Caminho direto do Codex: um único `--json` e os demais args iguais (`exec --sandbox workspace-write -c approval_policy=never --cd <root>`, `--model/--profile`, prompt por último), cwd, sem env `AI_MEMORY*`. Caminho wrapped: `expect(native).not.toContain('--json')`.
- Nenhum código de produção alterado nesta unidade.

## Árvore cumulativa (448fdde..29cd393)

- 13 arquivos (+272/−12) em `448fdde..b9d617c`: os 12 do SDC-18 + o teste do SDC-19. Produção: contract, recovery-decision, native-cli-coder, codex-cli-coder, worktree-executor, recovery-assessment.
- **O diff focal do SDC-19 (1 arquivo) NÃO representa a árvore avaliada.** A evidência do host e o Verifier do SDC-19 só enxergam o delta `ad669c3..candidate`; os 12 arquivos do SDC-18 foram observados na attempt do SDC-18 (nenhum fora do escopo) e aqui só são exercitados pelos gates, que rodam sobre a árvore cumulativa.

## Gates (host, árvore cumulativa, candidate `b9d617c`) — todos passaram

typecheck core (4,3 s) · typecheck web (10,5 s) · core `work-orchestration` (28,2 s) · `cli-coder` (23,3 s; baseline em ad669c3 = failed → passed) · worktree-executor (61,5 s) · recovery-assessment (8,3 s) · claude-code-coder (23,1 s) · scope containment (independente). Verifier: `verified`, violations 0, gaps 0 (18 checks: 6 independentes, 12 atestados). (1º candidate `29cd393`: mesmos gates verdes, verified.) Limitação: o Verifier observa o escopo apenas do delta focal.

## Matriz A–S do SDC-18 (casos lidos no candidate; nenhuma cobertura inferida pelo nome da suíte)

Matriz revalidada após a correção (`b9d617c`). Arquivos: CC = `codex-cli-coder.test.ts`; WE = `worktree-executor.test.ts`; RA = `recovery-assessment.test.ts`; RD = core `recovery-decision.test.ts`; WC = core `work-executor-contract.test.ts`; OBS = `native-cli-coder.observation.test.ts`; AIM = `native-cli-coder.ai-memory.test.ts`.

| Item | Caso(s) | Resultado |
|---|---|---|
| A thread.started → threadId | CC `thread, last terminal, malformed and intermediate events` (threadId `thread_1:abc`); WE `Codex terminal failure persists only closed cause…` (`thread-1`) | PASS |
| B usage fixture → usage_limit_exceeded | CC `classifies ONLY terminal` (apóstrofo ASCII e `’`) | PASS |
| C 401 Unauthorized → unauthorized | CC `classifies ONLY terminal` (`unexpected status 401 Unauthorized…`) | PASS |
| D desconhecido → unknown | CC `classifies ONLY terminal` (`some usage limit`, prefixo antes da frase, `429…`) | PASS |
| E error intermediário 401 + terminal diferente | CC `thread, last terminal…` (error 401 + terminal final `different terminal` → unknown); `error` 401 isolado → unknown | PASS |
| F item.completed(error) não determina | AIM `F: Codex direto ignora item.completed(type=error) sem turn.failed como fonte causal` (NOVO): stdout = `thread.started` (thread_id `thread_f:isolado`) + um `item.completed{item:{type:error,message:"You've hit your usage limit. unexpected status 401 Unauthorized"}}`, SEM `turn.failed`, exit 2; resultado `nativeCliFailure = {version:1, category:unknown_native_cli_failure, exitCode:2, threadId:"thread_f:isolado"}`, mensagem exata `Codex CLI terminou com exit 2`, e `JSON.stringify(error)` não contém a mensagem do provider. Produção inalterada. | PASS |
| G sentinelas/cf-ray/request id não persistidos | WE (`JSON.stringify(signals)` sem `private-sentinel|cf-ray|request id|turn.failed`); CC `known failure has stable short message…` | PASS |
| H exit ≠ 0 + category → nativeCliFailure | WE (usage, exitCode 1; `validateWorkExecutorTranscript` = null); CC | PASS |
| I sem thread.started → sem threadId | CC `classifies ONLY terminal` (`toEqual` sem threadId); `thread_id: '/private/path'` → sem propriedade | PASS |
| J exit 0 → sem nativeCliFailure | CC `exit zero ignores terminal-looking stdout…`; OBS `generic turn classifier runs only on nonzero…` | PASS |
| K caminho de sucesso/edição inalterado | CC `exit 0 significa só "turno terminou"`, `exit zero ignores…` (notes `turn-outcome:exited-0`); WE `sucesso: edita, valida pelo gate real…`; CC worktree suite | PASS (testes pré-existentes + notes) |
| L Z2 não piorado | Sem teste novo de Z2. Pré-existentes verdes: CC worktree `turno sem alteração: o host observa zero arquivos…`; WE `backend que retorna sucesso sem tocar arquivo vira error…`; o diff não toca o ramo exit 0 | PASS por regressão pré-existente (sem teste específico novo) |
| M ai-memory sem --json | AIM `wrap Codex` (`not.toContain('--json')`); CC `wrapped args retain old protocol…` e `wrapped Codex keeps legacy failure format…` | PASS |
| N transcript histórico sem o campo | WC `transcrição só com terminal continua válida (compatibilidade)`, `executor falso exercita erro tipado`; RA `malformed native payload and historic failure remain unknown` | PASS (pré-existentes + RA) |
| O parser fechado | WC `native CLI diagnostic parser is closed…`: `provider_unavailable`, exitCode `1.5`, threadId `/secret`, chave extra, `threadId: undefined` | PASS |
| P usage → external_unavailable | RA `projects native usage_limit_exceeded…`; RD `native diagnostics project only usage…` | PASS |
| Q unauthorized ≠ external transient | RA (unknown + `human_required`); RD (`failureKind` unknown, action ≠ retry) | PASS |
| R unknown ≠ external_unavailable | RA; RD | PASS |
| S zero mudança de attempts/budget/retry/authority | RA (`attemptsUsed 1/maxAttempts 2` preservados); RD (política preservada); diff de 13 arquivos sem nenhum arquivo de attempts/budget/retry/authority/SQL | PASS (testes + diff) |

Resumo: **18 PASS, 0 PASS PARCIAL, 0 GAP.**

## Revisão do diff cumulativo (leitura)

JSONL parser: só `thread.started` (thread_id com regex segura) e o ÚLTIMO `turn.failed`; linha inválida ignorada; sem terminal → unknown. `--json` só em `buildCodexExecArgs` direto; `classifyFailure` só quando `!wrap`. Taxonomia exatamente `usage_limit_exceeded | unauthorized | unknown_native_cli_failure`. Matcher de usage ancorado em `^You['’]ve hit your usage limit\.`; unauthorized exige `401` e `Unauthorized` no terminal. Payload fechado `{version, category, exitCode, threadId?}`; mensagem do provider não persistida (mensagem curta `[categoria]`; unknown só com stderr sanitizado). Recovery: só usage → `provider_usage_limit_exceeded` → `external_unavailable`; unauthorized/unknown → null. Nenhuma mudança de política. Código novo em `recovery-assessment.ts` só lê o campo com parse fail-closed.

## Request changes e correção

- `work request-changes` no SDC-19 (`3fe7de88`), razão focal: F sem prova isolada. `work correct --rework <o mesmo arquivo de teste>` materializou o successor `c4454835` (lineage `c3b7882b`, seq 1), `proposed`; objective ampliado só por adenda aditiva; aprovado, preparado, 1 attempt (budget readmitido com `work supervise` uma vez, lease revogada); resultado `review`, verified.

## Persistência deste registro

- Escrito como arquivo NÃO rastreado no checkout principal; **não** foi commitado nem está na branch do candidate (o candidate permanece 1 arquivo).
- **Atenção à integração ff-only:** commitar este registro em `dev` ANTES do fast-forward move `dev` para frente de `448fdde` e impede `448fdde → ad669c3 → 29cd393` por ff-only. Commitar somente DEPOIS da integração (ou em outro ramo/unidade documental).

## Fronteiras humanas / não realizado

Sem accept, integração, push, alteração do SDC-18, SDC-19 grant ou retomada do SDC-17. Supervisões revogadas (zero leases ativas). Zero API paga.

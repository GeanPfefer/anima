# HANDOFF OPERACIONAL — ANIMA, Verifier v4 I1→I2 (2026-10-13, ~23:30Z)

Registro append-only para retomar em nova conversa do Claude Desktop. Fatos lidos do Git e do Supabase residente no momento da escrita; os comandos de verificação da seção 14 reconfirmam tudo. **Nada foi alterado nesta etapa** (sem código de produção, attempt, lease, aceite, integração ou push).

## 1. Git e remotos (verificado por `git ls-remote origin`)
| Ref | SHA |
|---|---|
| `dev` local = HEAD (branch `dev`, índice vazio) | `828f2d180100e9c13d2b15003a71353dfc330d2b` |
| `origin/dev` (remoto real) | `828f2d180100e9c13d2b15003a71353dfc330d2b` (ahead 0 / behind 0) |
| `origin/main` | `99bec54e3ab42bfe882a8686cd1385d8058b916e` (INTACTA; não contém nada desta cadeia) |

Cadeia publicada sobre `a4f46f8` (Single-Item V1): `1a18fc8` (resolvedor do modelo local, item d795e414) → `1f4b052` (I1a Core) → `3c7aab8` (I1b CLI) → `828f2d1` (I2a Core). Todos commits `anima(checkpoint)` por ff_only. O checkpoint do I2c (`51a79198…`) NÃO está em `dev` (só na branch `anima-work/7293fdad-…`).

## 2. Supabase residente (container `supabase_db_anima`, PG 15.8; acesso read-only: `docker exec supabase_db_anima psql -U postgres -At -c "..."`)
- Ledger de migrations: **156** (última aplicada `20261010000001`). Nenhuma migration nova nesta fase.
- Último evento: **seq 86500** (2026-10-13 23:14:40). Ledger/PG íntegros; Docker reiniciou sozinho uma vez no dia (dados intactos).
- Claims **válidas: 0**. Há 1 claim aberta (não liberada) e VENCIDA de teste antigo: `c1313fe5` alvo `race-t1` (outro usuário, jul/2026) — preexistente, não bloqueia o alvo `anima`.
- `in_progress` do usuário residente (`e570e43b-0263-43a1-b8e9-63b4eb2b5ba4`): 0. Leases supervisionados **vigentes: 0**.
- Orçamento (24 h móveis, usuário): **7 `execution_started` nas últimas 24 h** (6 autônomas + 1 supervisionada); a mais antiga libera em **2026-10-14T03:28:50Z** (UTC). Política 6 attempts/24 h bloqueia a 7ª sem lease (ver §11 e plano 059).

## 3. Itens (todos do usuário residente; UUIDs completos)
| Item | UUID | Estado | Observação |
|---|---|---|---|
| I2a (Core, normalizador de relatório Jest) | `8013c5e2-80a4-4aaa-be4e-25545a408684` | **completed v1** | aceito (86482) e integrado (86484); publicado |
| **I2c (Core, test_binding + Verifier v5)** | `b972846e-2a98-459d-8440-9db38c82a821` | **review v1** | **verified (v4 host); NÃO aceito, NÃO integrado** |
| I1b sucessor (CLI) | `fc3b841c-1532-4252-8e21-957b2169f440` | completed | integrado 86465 |
| I1b original | `582b1f22-557f-4016-9c96-e00b19af1ccc` | failed | gate `cli` amplo demais; não reexecutar |
| I1a (Core) | `8e24f4a8-b715-44cd-a9f0-e712c3f938b2` | completed | integrado 86431 |
| I1 original | `bc27103e-a07c-401d-8a43-67865da3860c` | failed | limitação de worktree; não reexecutar |
| 1ª attempt real | `d795e414-d603-4153-883e-124fea9ac732` | completed | integrado 86397 (Verifier v3 `rejected` preservado) |
| histórico | `b5f8178a` cancelled; `cde9684e` changes_requested v2 | — | não tocar |

### I2a — `8013c5e2…`
- Attempt `9351a91d-f688-40f6-8b3c-4bcac627075d` (22:22:10–22:28:31Z), claim liberada; checkpoint **`828f2d180100e9c13d2b15003a71353dfc330d2b`** (= `dev`), branch `anima-work/9351a91d-…`.
- Parecer seq **86480**: `work-verifier-v4` **verified**, 14 checagens, 0 lacunas, 0 violações (md5 do evento `2dd4355b987614b2334dca9f0e221a61`).
- Aceite: `result_accepted` **86482** (resultado `bac45f16-867a-4324-ad90-42171430b60c`). Integração: `integration_effect_authorized` **86483** (auth `8013c5e2-c0de-4e00-8f21-8013c0ffee01`) + `integration_completed` **86484**, receipt `ff_only` `3c7aab87→828f2d18`, `mergeCommitSha null`.
- Conteúdo: `gate-test-report.ts` (+teste, novos: `deriveGateTestReport`, `parseGateTestReport`, `sha256Hex` puro, limites) e extensão aditiva de `host-observed-gate-evidence.ts` (`testReport?` por gate; inválido é omitido), `index.ts`. Ressalvas aceitas: nomes de teste duplicados ⇒ relatório indeterminate (2% das suítes do core); o Codex WSL regravou o arquivo (EOL misto) em LF: churn bruto +314/−301, mudança real +13/−0.

### I2c — `b972846e…` (PRÓXIMO A ACEITAR)
- Base `828f2d18…`; contrato `acceptance_contract:2`, sem `resume_from_checkpoint`; 10 arquivos Core (todos LF): `eligibility`, `acceptance-contract-lint`, `work-verification`, `verifier-opinion`, `host-observed-gate-evidence` + os 5 testes (`packages/core/src/work-orchestration/`).
- Eventos: `work_proposed` 86485, `context_attached` 86486, `work_approved` 86487, `work_intelligence_classified` 86488 (humana: bounded/low/reversible/clear/normal), `work_claimed` 86491, `work_started` 86492 (`supervised_execution`), `execution_started` 86493, `checkpoint_recorded` 86494, `result_submitted` 86495, gate/coder/git evidence 86496–86498, `verifier_opinion_recorded` **86499**, `work_claim_released` 86500.
- Attempt `7293fdad-fce0-4d05-aa06-0a47f9888f57` (23:08:00–23:14:40Z; Codex 352 s), claim `befd6bd0-e704-4124-baa8-4d6472e15a6e`. Checkpoint **`51a79198d6568f46d7013db68c2a57cb53b362e7`** (filho único de `828f2d18`), branch **`anima-work/7293fdad-fce0-4d05-aa06-0a47f9888f57`**, 10 arquivos +391/−13, `git diff --check` limpo.
- **Resultado a aceitar (event id): `c89d419f-723f-4cda-8ad6-e86b9d58c70f`** (`result_submitted` 86495; é o `reviewedResultEventId` do `work accept`).
- Parecer 86499: `work-verifier-v4` (código do host ainda v4) **verified**, 14 checagens, 0 lacunas/violações (md5 `2aaa288c429982979807eb04635097e0`). Gates do host: focado 11,9 s, typecheck 4,3 s, suíte core 27,9 s — passed.
- Revisão independente já feita: core 120 suítes/2823 PASS; web `tsc` 0 erros e 346 testes (cli/ + planner) PASS; 36 testes extras PASS; replay 158 itens/51 pareceres **0 deriva**; vínculo de revisão provável (7/7 attempts V1). Veredito: **GO para aceite**.
- Lease E0 usado: `5e6a8ad3-358b-43e4-b49c-dbbe8ef7bdb7` (23:07:46–23:37:46Z, item+versão 1), **revogado 23:14:49Z**.

## 4. Eventos mais recentes e migrations
Sequência completa 86470–86500 na tabela acima (I2a: 86470–86484; I2c: 86485–86500). Migrations: 156 aplicadas = todas as versionadas relevantes + Single-Item V1 (`20261008000000`, `20261010000000`, `20261010000001` promovidas em 2026-10-13). O diretório tem 158 arquivos: `20261009000000_claim_item_lock_order_candidate.sql` e `20261009000001_budget_item_lock_order_candidate.sql` são **candidatas NUNCA aplicadas e não versionadas** (não aplicar). `20260905000001/2` estão **modificadas no working tree ≠ aplicado** (não aplicar, não commitar). **Nunca `supabase db reset`**; não usar `db push`/`migration repair` sem checkpoint humano.

## 5. O que PRESERVAR (não apagar/commitar/alterar sem autorização)
- Working tree: 226 linhas de `git status`; modificados rastreados (WIP preexistente): `AGENTS.md`, `anima-prd.md`, `docs/planos/008-…`, `supabase/migrations/20260905000001_*.sql`, `…000002_*.sql`, `supabase/tests/{budget_blocked_human_resume,supervisor_reconciliation,work_budget,work_budget_interruption_resumption,work_budget_local_vs_external}.test.sql`. Untracked relevantes: `.worktrees/`, `.tmp/`, `%SystemDrive%/`, `apps/web/scripts/_session/`, `docs/operacao/`, planos `009…059` (incl. `056`, `057`, `058`, `059` desta cadeia), `docs/registros/*` (todos os 2026-10-13-* são untracked, inclusive este), `supabase/bootstrap/`, `supabase/tests/*.py`/fixtures, `watch4-sensors.txt`, `apps/web/.env.local` (credenciais, nunca imprimir).
- **46 worktrees** e **153 branches `anima-work/*`** (inclui `anima-work/9351a91d-…`=828f2d18, `…/7293fdad-…`=51a79198, `…/e6af51bd-…`=3c7aab87, `…/345dc9a4-…`=1f4b052e, `…/2893a772-…`=1a18fc8e, e as branches dos itens failed `410523ee`, `64be3608`).
- Refs de rastreabilidade: `refs/anima/integrated/{d795e414,8e24f4a8,fc3b841c,8013c5e2}`.
- Clones de integração (fora do repo, push desabilitado): `C:\Users\GeanTeco\anima-recovery\anima-integration-{d795e414,8e24f4a8,fc3b841c,8013c5e2}`; evidências e backups em `C:\Users\GeanTeco\anima-recovery\` (somente leitura).
- Scripts operacionais copiados para `C:\Users\GeanTeco\anima-recovery\handoff-20261013\` (com `SHA256SUMS` e `LEIA-ME.txt`): `gov/` (create, classify, budget, admission, readiness, precheck, eligibility, lint, replay, revtie, build_i2c.py, hostexact.ps1, review_i2c.ps1, sondas) e `integ/` (wrappers `integrate-fc3b841c.mjs`, `integrate-8013c5e2.mjs`). Os originais estão no scratchpad da sessão anterior: `C:\Users\GeanTeco\AppData\Local\Temp\claude\G--anima\d9275863-3b8a-4407-acdf-8360d686642d\scratchpad\i1` (podem sumir).

## 6. Procedimento comprovado: aceite → integração governada → sincronização local
Sempre de `G:\anima\apps\web`, executar o CLI **diretamente** (nunca `npm.cmd run anima -- ...` com argumentos com espaço/acento):
`node --no-warnings --experimental-transform-types --import ./scripts/ts-resolve.mjs --env-file-if-exists=.env.local cli/anima.ts <cmd>`
1. **Revalidar** (read-only): item `review` v1; `result_submitted` ↔ attempt ↔ commit do checkpoint (`git rev-list --reverse BASE..CAND` = só o checkpoint; `git rev-list --merges` = 0; `git diff --name-only` = exatamente o escopo); Verifier `verified` (guardar `md5(payload::text)` do evento); 0 integrações do item; claims 0; HEAD==BASE==origin/dev; status Git de referência salvo.
2. **Aceite**: `... cli/anima.ts work accept <UUID> --json` (uma vez). Esperado: `state completed`, `reviewedResultEventId`, evento `result_accepted`; o md5 do parecer não muda. O accept não carrega justificativa (a justificativa vai no registro).
3. **Clone dedicado**: `git clone --no-hardlinks -q /g/anima "$HOME/anima-recovery/anima-integration-<id8>"`; `git remote set-url origin https://github.com/GeanPfefer/anima.git`; `git config remote.origin.pushurl DISABLED-no-push-allowed`; `git checkout -q --detach <BASE>` (dev fora de checkout); `git fetch -q /g/anima refs/heads/anima-work/<attempt>:refs/anima/candidate/<id8>`.
4. **Wrapper**: copiar `integ/integrate-8013c5e2.mjs` para `integrate-<id8>.mjs` e trocar `ITEM`, `ATTEMPT`, `ACCEPTED_RESULT_EVENT`, `BASE`, `CANDIDATE`, `AUTH_ID` (UUID fixo novo), `CLONE_MARK`, a lista `FILES` (linha 19, 10 arquivos no I2c), `scopeExact*Files` e a versão do Verifier esperada no guard `verifierVerifiedPreserved` (hoje `work-verifier-v4`). **Inspeção** (sem efeito): com `ANIMA_INTEGRATION_REPO_ROOT='C:\Users\GeanTeco\anima-recovery\anima-integration-<id8>' ANIMA_INTEGRATION_REPOSITORY_ID='https://github.com/GeanPfefer/anima' ANIMA_INTEGRATION_REMOTE_NAME=origin` rodar o wrapper → exigir **22/22 guards**. **Execução única**: mesmo comando + `--execute` ⇒ `authorizeIntegrationEffect` → `executeAuthorizedIntegrationWithSupabase` → Trusted System Writer; esperar `integration_effect_authorized` + `integration_completed`, receipt `ff_only`, `effected`, `previousTargetSha`=BASE, `resultingTargetSha`=CANDIDATE, `mergeCommitSha null`. Nunca Git manual como substituto; SHA/mensagem do checkpoint não mudam em ff_only.
5. **Sincronização local** (checkout principal): preflight — HEAD==BASE, branch `dev`, índice vazio, status igual ao de referência, sem sobreposição dos arquivos do escopo com WIP/untracked, sem node/codex; `git fetch -q <clone> refs/heads/dev:refs/anima/integrated/<id8>` (conferir SHA==CANDIDATE) e `git merge --ff-only refs/anima/integrated/<id8>`. Sem reset/clean/stash. Verificar `git diff --check`, 0 merges, arquivos = escopo.
6. **Verificações pós**: core `typecheck` + `npm test --workspace=@anima/core`; import nativo (`cd apps/web && node ... -e "import('@anima/core').then(...)"`) das novas exportações; web `tsc` (0 erros fora de `scripts/_session`) e `cli/`; replay dos pareceres (`gov/replay.mjs <rootA> <out>` base × novo, comparar veredito/achados/contagens ⇒ 0 deriva); claims/ledger/status Git; `origin/dev` e `origin/main` inalterados. **Não publicar** sem autorização separada (publicação anterior: push comum `A:refs/heads/dev` após reconfirmar `ls-remote`).

## 7. Verifier: situação e dependências
- Código em `dev`: `VERIFIER_VERSION = work-verifier-v4` (I1: lint de contrato `acceptance_contract:2`, `human_review`, `humanReview.pending`). Os pareceres do host ainda saem como v4.
- **Verifier v5 (`work-verifier-v5`, `claim_kind:'test_binding'`) existe SÓ no checkpoint do I2c** (`51a79198…`) até o aceite+integração. Depois de integrado, o Verifier do host passa a v5 (SQL independe da versão; replay mostrou 0 deriva).
- `test_binding` só poderá ser **provado** quando o host emitir `testReport` por gate e `baseline.testReport` (I2b). Até lá o v5 falha fechado: sem relatório ⇒ lacuna `test_report_missing`; nunca `verified`. Nenhuma evidência real tem `testReport`.
- **I2b (host, apps/web) depende do I2a (feito) e, para a prova, do I2c integrado.** Escopo do plano 058: captura do relatório Jest no host (acrescenta `--json --outputFile=<tmp do host fora da worktree>` ao MESMO comando jest do gate `test_binding`; ler, normalizar com `deriveGateTestReport`, apagar), `baseline.testReport` (mesma captura no `base_sha`), `outputTail` (stdout/stderr sanitizado via `sanitizeStream`) para gates falhos/timeout, digest do diff (gate × git) — esta parte exige acrescentar o campo no Core (item posterior). Arquivos prováveis: `apps/web/lib/work-orchestration/{worktree.ts,worktree-executor.ts,executor-selection.ts,gate-evidence.ts}` + testes (suítes de git real são sensíveis a carga: gates path-restritos, RAM `permit`, 1 tentativa). **Não misturar Core novo com consumidor nativo no mesmo item** (junção de `node_modules` faz o Node nativo ver o `@anima/core` do checkout principal).
- Fatos do Jest 29 (medidos): `pending` cobre skip e filtrado; suíte quebrada = `failed` com 0 asserções (`numRuntimeErrorTestSuites`); **retry = `invocations > 1`** (`retryReasons` vem vazio); `numTotalTests = passed+failed+pending+todo`.
- Pendências conhecidas do v5/I2: ordinal para nomes de teste duplicados; `files.find(...)!` frágil em `evaluateBinding` para spec montado à mão (seguro via parser); digest do diff; policies shadow tratam `test_binding` como `unsupported_claim_kind` (telemetria).

## 8. Mecanismo E0 (supervisão humana) e riscos
- Comando: `... cli/anima.ts work supervise <UUID> --json` (lease de 1800 s, item+versão) e `work unsupervise <UUID> --json` (revoga). Tabela `work_supervision_leases` (49 históricos + 1 do I2c); RPCs `grant_work_supervision`/`revoke_work_supervision`. Com lease: `admitted = unattended OR lease` ⇒ supera **todos** os motivos de orçamento (item, usuário, runtime 24 h, reserva interativa); a admissão mostra `mode human_supervised` e `bypassedUnattendedReason`.
- Uso comprovado (I2c): só quando a ÚNICA recusa é `user_attempt_budget_exhausted` (verificar `admission` = permit, `budget.mjs`, claims 0, Codex ok); conceder imediatamente antes do `execute-one`; **revogar logo após** (sucesso ou falha); nunca reutilizar para outro item/attempt; confirmar `leases vigentes = 0`.
- **Riscos conhecidos:** (a) autenticado só por `auth.uid()` do dono do item = a MESMA identidade residente da automação (presença humana é convenção, não prova); (b) sem evento no ledger (0 eventos de supervisão); (c) lease não é consumido por attempt (várias attempts no TTL; 30 min < `max_duration` 35 min do contrato — attempt longa poderia ter o lease expirado no meio); (d) o bypass inclui o anti-loop de item; (e) NÃO supera RAM (`readResourceAdmission`), claim exclusiva, contrato, aprovação/classificação, Verifier, limites do provedor (`usage_limit_exceeded`) nem monetários. Proposta de endurecimento (E1/E2: lease consumível, auditoria, disjuntor, credencial distinta, `execute-one --supervised`) no `docs/planos/059-…` — **requer migration e autorização própria; não aplicada**.
- Origem do limite: regra do ANIMA em SQL (`private.unattended_work_budget_decision`: 3/item, 6/usuário/24 h, 7200 s/24 h, 2700 s/60 min); v1 de `20260905000000` sobrescreveu a v2 cost-aware (regressão); `codex-cli` seria "external" mesmo na v2.

## 9. Restrições e autorizações AINDA NÃO executadas
Nenhuma destas foi autorizada/realizada: aceite e integração do I2c; criação/aprovação/execução do I2b (e de qualquer item além do I2c); push do commit do I2c; publicação de `main`; migrations (inclusive endurecimento da supervisão); limpeza de worktrees/branches/refs/clones; conceder novo lease. Cada ato exige mandato explícito do humano na nova conversa. Invariantes: nunca `supabase db reset`; AUTO-APPROVAL NÃO EXISTE; Claude não usa service_role; fatos de sistema só via Trusted System Writer; `ANIMA_CODEX_*` (`CLI_TRANSPORT=wsl`, `WSL_DISTRO=Ubuntu-24.04`, `WSL_USER=geanteco`, `WSL_CLI_PATH=/home/geanteco/.nvm/versions/node/v22.23.3/bin/codex`) **somente no processo**, nunca persistidas; 1 attempt por item, sem retry/recovery automático; resume_from_checkpoint é recusado pelo V1.

## 10. Próximo objetivo (em ordem)
1. **Aceitar o I2c** (`work accept b972846e-2a98-459d-8440-9db38c82a821`, resultado `c89d419f-723f-4cda-8ad6-e86b9d58c70f`) — mandato humano.
2. **Integrar o I2c** em clone dedicado (`anima-integration-b972846e`, BASE `828f2d18`, CANDIDATE `51a79198d6568f46d7013db68c2a57cb53b362e7`, 10 arquivos, Verifier esperado `work-verifier-v4`) e **sincronizar** `dev` por ff-only (seção 6); verificar; **sem push** salvo novo mandato. Registrar em `docs/registros/` (padrão `2026-10-13-verifier-i2c-aceite-integracao-sync.md`).
3. **Só então criar o I2b como `PROPOSED`** (base = novo HEAD de `dev`; escopo mínimo apps/web host; 1 tentativa; `acceptance_contract:2`; gates path-restritos; lint com `lintAcceptanceContract`); **não aprovar/executar** sem novo mandato. Orçamento: sem tentativa disponível nas 24 h até 2026-10-14T03:28:50Z — executar depois disso ou com lease E0 explicitamente autorizado.

## 11. Armadilhas operacionais aprendidas (esta cadeia)
- Git Bash: heredocs/regex com barras invertidas e aspas são corrompidos — prefira a ferramenta Write para arquivos, `String.fromCharCode(92)` em JS, e `python` (não `python3`, que é o atalho da Store). PowerShell: `Remove-Item` e `cmd /c rmdir` podem ser BLOQUEADOS; para desfazer junções use `[System.IO.Directory]::Delete(path,$false)` (só o link) e depois `git worktree remove --force`; confirmar `node_modules` principal = 742 entradas.
- Gates jest: padrões path-restritos (`work-orchestration/arquivo`, `cli/`); `cli` solto casa 15 suítes (inclui `EvolutionClient`, `codex-cli-coder` com git real) e gerou flake. Worktrees do host ficam em `G:\anima\.worktrees\anima-wt-*\tree` com junções de `node_modules` para o principal (processos Node nativos resolvem `@anima/core` do checkout principal; o jest mapeia o `src` do worktree).
- Ordem governada: `work approve` ANTES da classificação humana (`record_work_intelligence_classification`, expected revision 0); `prepare-autonomous` não vale para `human_explicit_independent_proposal`. `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` no encerramento do Node/Windows é cosmético (a operação já foi gravada).
- Codex WSL regrava arquivos inteiros: pedir para preservar EOL/bytes (host-observed-gate-evidence.ts tem 1 NUL preexistente). Admissão de recursos: `readResourceAdmission()` precisa de `permit` (≈ ≥25–30% RAM livre; o host recusa single-item em `defer`).
- Replay/verificações usam `scripts` de `gov/` com `ts-resolve.mjs`; CLI usa a identidade residente (`ANIMA_RESIDENT_*` em `apps/web/.env.local`, senha citada com `#`).

## 12. Documentos desta cadeia (todos untracked, em `G:\anima\docs\`)
Planos: `056` (Verifier v4), `057` (I1b), `058` (I2 test_binding), `059` (execução supervisionada). Registros 2026-10-13: promoção/gate/sucessor/aprovação/classificação, primeira attempt, revisão, aceite, integração (lacuna, clone, sync), publicação, `verifier-v4-i1-*`, `verifier-v4-i1a-*`, `verifier-v4-i1b-*`, `verifier-i2a-*` (attempt, aceite-integração-sync-e-diagnóstico), `verifier-i2c-attempt-b972846e.md`, publicação `dev` + plano I2, e este handoff. Memória do projeto: `C:\Users\GeanTeco\.claude\projects\G--anima\memory\project_20261013_single_item_v1_promovido_versionado.md` (+ índice `MEMORY.md`).

## 13. Mensagem curta de retomada (copiar para a nova conversa)
Ver a seção final do arquivo de entrega desta sessão (também reproduzida abaixo).

```text
Retomada ANIMA (supervisor). Leia primeiro G:\anima\docs\registros\2026-10-13-handoff-operacional-verifier-i2.md e siga AGENTS.md. Estado: dev=origin/dev=828f2d18 (I2a integrado e publicado), main=99bec54e intacta, ledger 156, seq 86500, 0 claims/leases. I2c (item b972846e-2a98-459d-8440-9db38c82a821) está em REVIEW v1, Verifier verified, checkpoint 51a79198 (branch anima-work/7293fdad-fce0-4d05-aa06-0a47f9888f57), resultado c89d419f-723f-4cda-8ad6-e86b9d58c70f — revisado, GO. Nada foi aceito/integrado ainda. Revalide (Git, ledger, claims, leases) e aguarde meu mandato explícito para: (1) work accept do I2c, (2) integração governada em clone dedicado + sync ff-only (procedimento §6), (3) depois criar o I2b SOMENTE como PROPOSED. Sem push, sem lease, sem attempt, sem migration, sem limpar WIPs/worktrees. Scripts em C:\Users\GeanTeco\anima-recovery\handoff-20261013.
```

## 14. Verificação rápida de retomada (read-only)
```bash
cd /g/anima && git rev-parse HEAD origin/dev origin/main && git ls-remote origin refs/heads/dev refs/heads/main && git status --short | wc -l
docker exec supabase_db_anima psql -U postgres -At -c "select max(seq) from work_events; select count(*) from work_claims where released_at is null and expires_at>now(); select count(*) from work_supervision_leases where revoked_at is null and expires_at>now(); select state from work_items where id='b972846e-2a98-459d-8440-9db38c82a821'; select count(*) from supabase_migrations.schema_migrations"
# esperado: 828f2d18.. x2, 99bec54e.., seq 86500, 0 claims, 0 leases, review, 156
```

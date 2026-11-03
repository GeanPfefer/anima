# 058 — Verifier v4 I2: `test_binding` com relatório estruturado do host (PROPOSTA; nada criado nem executado)

Status: planejamento (2026-10-13). Base real inspecionada: `dev` = `origin/dev` = `3c7aab87` (I1a `1f4b052e` Core + I1b `3c7aab87` CLI publicados). Nenhum item I2 criado, aprovado ou executado.
Refina a seção "I2" do [plano 056](056-verifier-v4-contratos-de-aceite-verificaveis.md) com os fatos da implementação real.

## 1. Problema
Hoje só `gate_assertion` (o aceite É "o gate passa") e `scope` fecham um aceite; um comportamento substantivo ("o parser rejeita X") coberto por um gate verde é só associação declarada (lacuna). O I1 criou `human_review` para o que não é provável. O I2 cria a primeira prova AUTOMÁTICA de comportamento: o aceite fica ligado a TESTES ESPECÍFICOS cujo resultado o HOST observou por relatório estruturado.

## 2. Fatos da infraestrutura real (inspecionada)
- O gate roda no HOST: `runGate` (`apps/web/lib/work-orchestration/worktree.ts:130`) → `runProcess` (npm.cmd com shell no Windows) com o comando JÁ validado pela allowlist (`GATE_COMMAND_PATTERN`); só `exitCode/timedOut/cancelled/durationMs` são persistidos (`host_observed_gate_evidence_recorded`). stdout/stderr são descartados, exceto o `diagnostic` sumarizado para o reparo interno (`summarizeGateFailureForRetry`) — por isso a falha do gate `cli` (582b1f22) ficou sem causa registrada.
- Precedente de campo aditivo por gate: `baseline` (`DifferentialGateBaselineV1`) — `deriveDifferentialBaseline` valida/deriva a partir de fatos crus, malformado é OMITIDO sem invalidar o gate; `buildHostObservedGateEvidence` (:344) e `parseHostObservedGateEvidence` (:407) reconstroem forma fixa. O SQL (`private.is_valid_host_gate_outcomes`) valida só label/command/exitCode/durationMs/timedOut/cancelled/outcome derivado e TOLERA chaves extras ⇒ **I2 não precisa de migration** (a confirmar com pgTAP no I2a/I2b).
- Baseline: o host já executa o MESMO gate contra o `base_sha` quando o critério declara `target_paths` (`worktree-executor.ts:389`, `differentialBaselines`).
- Jest (testado agora): `npm test --workspace=@anima/core -- <padrões> --json --outputFile=<caminho>` mantém o exit code e grava JSON com `testResults[].name` (caminho absoluto), `assertionResults[]{fullName,title,ancestorTitles,status,duration,failureMessages,retryReasons,invocations}`, totais (`numPassedTests/Failed/Pending/Todo`, `numRuntimeErrorTestSuites`, `success`); 37 testes = 13 KB. Status observados: `passed|failed|pending|skipped|todo|disabled`. **`retryReasons`/`invocations>1` expõem retry (flake)**. O charset do passthrough já admite `--json --outputFile=...`, mas o HOST (não o contrato) acrescenta as flags: o executor não controla o caminho de saída.
- Utilitários prontos: `sanitizeStream(text,maxChars,maxLines)` e `redactSecrets` (`output-sanitization.ts`), `diffSha256` (`worktree-executor.ts:187`), `verifyGateTargetScope`, `gateIdentityFromExecution`.
- Core do Verifier v4 (I1a): `proofKindOf`, achados `human_review_pending`/`no_automated_acceptance_proof`, `parseVerifierOpinion` com `humanReview`; lint `lintAcceptanceContract` (7 códigos); marcador `acceptance_contract:2`.
- Lane obrigatória: `private.mandated_result_verdict` lê só veredito/base de evidência/commit — NÃO a versão do Verifier nem campos novos de gate ⇒ `required_fail_closed` segue valendo sem SQL novo.

## 3. Arquitetura proposta

### 3.1 Contrato (execution_spec, `acceptance_contract:2`)
Critério com `proof:'gate'`, `claim_kind:'test_binding'` (novo valor; desconhecido continua inválido, fail-closed), `command` (jest), `covers:[aceite]`, `target_paths:[arquivos de teste exatos]` e `binding`:
```
binding: { test_files: ["packages/core/src/x/foo.test.ts"],   // paths exatos (sem glob/regex), ⊆ target_paths
           min_new_tests: 1,                                    // testes ausentes no baseline que devem passar
           bound_tests?: [{file, full_name}] }                  // testes JÁ existentes que devem permanecer e passar (nomes exatos)
```
O texto do aceite continua sendo `expectedEffects` (prosa humana); a ligação aceite↔testes é estrutural (`covers` + `binding`), nunca inferida por texto/nome. A identidade do teste vem do relatório do host, não de declaração do executor.

### 3.2 Captura (host)
`runGate` ganha variante `runGateWithJestReport`: se (e somente se) o comando é jest-por-npm (`npm test`/`npm run test` com `--`) e o critério é `test_binding`, o host acrescenta `--json --outputFile=<tmpdir do host>/<attempt>-<gate>.json` (fora da worktree ⇒ não polui escopo), lê, normaliza e APAGA o arquivo. Normalização `deriveGateTestReport(raw)` (Core, puro, no padrão de `deriveDifferentialBaseline`): caminhos absolutos ⇒ relativos à worktree (fora dela ⇒ omitido), `tests[{file,fullName,status,retried}]` ordenados, limites (ex.: 3000 testes, fullName ≤ 400), `totals`, `runtimeErrorSuites`, `digest` sha256 do JSON canônico, `truncated`. Malformado/ausente ⇒ `testReport` omitido (o gate segue válido). Mesma captura no baseline (já existente) para derivar o conjunto de testes ANTES.
Revisão: o gate roda no estado não commitado; para ligar teste↔revisão o host grava `worktreeDiffSha256` (reuso de `diffSha256`) na evidência do gate e `observedDiffSha256` na evidência git (diff base..commit) — o Verifier exige igualdade (senão o relatório não é sobre o commit observado).
Preservação de saída: por gate, `outputTail` aditivo = `sanitizeStream` (stdout+stderr redigidos, ex. 4 KB / 60 linhas, tail) **sempre para gate que falhou ou excedeu tempo**, opcional para passou; no baseline idem. Limite de payload total por evidência (hoje ≤ 200 gates) ⇒ teto de bytes por evidência (ex. 64 KB) com `truncated`.

### 3.3 Verificação (Core)
Para cada critério `test_binding` que cobre um aceite A, o aceite fica **provado** (`acceptance_criterion_covered`, proveniência independent) somente se, no `testReport` do gate correspondente (mesma identidade label+command):
1. o gate passou e o relatório existe e correlaciona (attempt/versão/`worktreeDiffSha256`==`observedDiffSha256`);
2. todo `test_files[i]` aparece no relatório com ≥1 teste; todos `passed`; nenhum `failed/pending/skipped/todo/disabled`; `runtimeErrorSuites=0`;
3. nenhum teste ligado com `retried`/`invocations>1` (flake ⇒ indeterminado);
4. testes NOVOS (ausentes no baseline desses arquivos) ≥ `min_new_tests`; cada `bound_tests[]` presente e `passed`; teste do baseline desse arquivo SUMIU do resultado ⇒ lacuna `bound_test_removed` (não violação: remoção pode ser legítima, mas nunca prova);
5. `totals` coerentes com a lista (digest).
Resultado: **violação** (rejected) só para fato contraditório (relatório diz `failed` num teste ligado, ou digest/correlação incoerente); **lacuna** (inconclusive, nunca verified) para ausência/indeterminação: `test_report_missing`, `test_binding_unmet`, `bound_test_removed`, `test_report_flaky`, `test_report_truncated`, `test_report_uncorrelated`. Nada disso vira `verified` por exit code 0.
Flake: uma única execução NUNCA prova estabilidade; `retryReasons`, retry do jest ou resultado divergente entre baseline e resultado em teste não tocado ⇒ indeterminado. Estabilidade forte = I2e (rerun determinístico opcional).
Legado: sem `claim_kind:'test_binding'` o Verifier produz exatamente os mesmos achados/vereditos/contagens (replay: 0 deriva sobre os 48 pareceres recomputáveis + os 3 novos). `VERIFIER_VERSION` → `work-verifier-v5` (veredito pode mudar para contratos novos); parser do parecer aceita v1..v5.
Lane obrigatória: inalterada — `test_binding` não atendido ⇒ não `verified` ⇒ aceite recusado em `required_fail_closed`.

### 3.4 Lint de contrato (extensão do `lintAcceptanceContract`)
Novos códigos: `test_binding_without_command`, `test_binding_without_test_files`, `test_binding_files_outside_target_paths`, `test_binding_non_exact_path`, `test_binding_command_not_jest`, `binding_on_non_test_binding`. `test_binding` conta como prova AUTOMÁTICA possível.

## 4. Decomposição recomendada (itens pequenos, independentes; Core NUNCA junto de consumidor nativo)
Regra aprendida: novo export de Core consumido por processo Node nativo só funciona depois de integrado/sincronizado no checkout principal. Gates jest sempre path-restritos (`dir/arquivo`), nunca palavra solta.

| Item | Escopo | Gates (host) | Depende |
|---|---|---|---|
| **I2a Core: modelo de evidência** | `host-observed-gate-evidence.ts(+test)`, novo `gate-test-report.ts(+test)` (`deriveGateTestReport`, tipos, digest, limites), `index.ts` | testes core focados + typecheck core + suíte core + scope | — |
| **I2b Host: captura + preservação de saída** | `worktree.ts`, `worktree-executor.ts`, `executor-selection.ts`/`gate-evidence.ts` (plumbing), testes; uso de `deriveGateTestReport`, `sanitizeStream`, `diffSha256` | `lib/work-orchestration/worktree`, `…/gate-evidence`, `…/worktree-executor` (paths restritos; suítes git-real são sensíveis a carga) + scope | I2a integrado e sincronizado |
| **I2c Core: contrato + Verifier v5 + lint** | `eligibility.ts` (claim_kind `test_binding`, `binding`), `acceptance-contract-lint.ts`, `work-verification.ts`, `verifier-opinion.ts` (+ testes) | core focado + typecheck + suíte core + scope | I2a (tipos do relatório) |
| **I2d CLI** | `apps/web/cli/{app,render}.ts` (+ testes): bindings/relatório no `work evidence` | `cli/app cli/render` + `cli/` + scope | I2c integrado |
| **I2e (opcional)** | fail-to-pass (testes novos contra o código da base) e rerun de estabilidade | a definir | I2b+I2c |
I2b e I2c são independentes entre si (ambos só dependem do I2a); executar um por vez.
Cada item: base = `dev` pós-integração do anterior; 1 tentativa; `acceptance_contract:2`; aceites `gate_assertion` canônicos + `scope` (comportamentos, quando precisarem, como `human_review` até o I2c estar vivo).

## 5. Demonstração real de `verified` com `test_binding`
Após I2a–I2c(+I2b): item pequeno e REAL (ex.: o resíduo `createConfiguredProjectPlanner` repassar `env`) com aceite substantivo ligado a um teste novo em arquivo exato. Esperado: `verified` SEM `human_review` para esse aceite; controles negativos como fixtures (teste vacuamente verde sem `min_new_tests`, `it.skip`, teste removido, relatório ausente, flake com retry, diff divergente).

## 6. Riscos e controles
- Testes vacuamente verdes: `min_new_tests`, `bound_tests` e (I2e) fail-to-pass; adequação semântica continua com `human_review`.
- Só jest no início; qualquer outro runner ⇒ `test_binding_command_not_jest` (fail-closed).
- Quoting `npm.cmd` no Windows e `--` obrigatório: testar `withJestReport(argv)` puro; falha de captura ⇒ relatório omitido ⇒ lacuna (nunca verified).
- Tamanho do evento e vazamento: limites + `redactSecrets`; caminhos absolutos fora da worktree descartados.
- Deriva web × Resident Host (versões diferentes): `claim_kind` novo é inválido em código antigo ⇒ spec inválido (fail-closed).
- Carga/flake dos próprios gates de desenvolvimento do I2b (git real): padrões restritos, RAM `permit`, uma tentativa.
- Remoção legítima de teste não pode ser inferida como prova nem como violação ⇒ lacuna.

## 7. Compatibilidade e autoridade
Sem migration; campos aditivos opcionais por gate (padrão `baseline`); legado idêntico; parecer v1–v4 legíveis; evidência só pelo caminho do host existente (Trusted System Writer inalterado); Verifier continua advisory; nenhum novo caminho de escrita humana.

## 8. Próximo mandato sugerido
"Verifier v4 I2a — modelo de evidência de relatório de testes (Core)": criar o item I2a (PROPOSED) sobre `3c7aab87` (ou `dev` publicado), 5 arquivos Core (+2 novos), gates path-restritos de core, classificar/aprovar, preflight, UMA attempt, revisão independente (inclui probe de `deriveGateTestReport` com o JSON real do jest e fixtures adversariais), replay 0 deriva. Só depois I2b → I2c → I2d.

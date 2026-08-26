# Classificação determinística de recovery

- **Data/tipo:** 2026-08-26 — desenvolvimento + prova read-only real.
- **Objetivo:** distinguir retry, decomposição, espera de ambiente e decisão humana a partir da evidência terminal, sem transformar toda falha em retry.
- **Branch / HEAD inicial:** `dev` / `d2630c7`, igual a `origin/dev`; `origin/main` em `99bec54`, intocada.
- **Domínio:** `recovery-decision.ts` normaliza somente códigos allowlisted. `execution_failed` é envelope, não causa; prosa não concede autoridade. O resultado fechado é `retry | decompose | environment_wait | human_required` para falha de código/gate, ambiente, capacidade do modelo, contexto, recursos, timeout, no-progress, externo, contrato ou desconhecida.
- **Política:** limite de leitura/contexto/no-progress decompõe; pressão de recurso espera capacidade; timeout/externo/ambiente só repetem uma vez quando retryable, não repetidos e dentro do budget; falha de código/gate repetida decompõe; contrato/autoridade e desconhecido exigem humano.
- **Aplicação read-only:** `recovery-assessment.ts` lê item/eventos via cliente RLS, usa apenas mensagem sanitizada/limitada, conta attempts da versão vigente, detecta repetição e projeta a decisão pura. Erro, item não failed, limite inválido ou ausência de falha vigente retornam `null`.
- **Provas:** core 17/17 PASS; web 4/4 PASS; typecheck core/web PASS; `git diff --check` PASS.
- **Prova real:** leitura do Item 1 `0cedae21…` projetou a falha `0540c0e2…`, attempt `e2e790bb…`, 2/2 attempts, `model_capability_limit`, código `ollama_read_round_limit`, ação `decompose`. Nenhuma mutação foi realizada.
- **Invariantes:** nenhum successor, retry, approval, classification, claim, attempt, provider, worktree ou autoridade financeira foi criado. Evidência desconhecida permanece fail-closed.
- **Próximo ponto:** validar um candidato de decomposição como recorte estritamente menor e produzir argumentos idempotentes para `propose_recovery_successor`; o desfecho máximo continua `proposed`.


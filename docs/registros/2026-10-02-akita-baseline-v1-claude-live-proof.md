# 2026-10-02 — Claude Code: primeira prova técnica viva

Tipo: prova relatada pelo humano. Fonte: mandato de reconciliação final recebido
em 2026-10-02; execução não repetida nesta sessão.

- Backend: ANIMA → WorktreeExecutorAdapter → ClaudeCodeCoderBackend → Claude Code
  real → código → escopo válido → gate focal host-side PASS.
- Integração: `cd73276b1e18eda70f5a65338d744cca9634addc`.
- Tarefa: TPC-01; base `f94bc5a2dc8076be40471d5f7810d81518cb8bfa`.
- CLI/version: `claude --help` 2.1.286, conforme contrato versionado
  [do backend](../arquitetura/codex-cli-coder-backend.md). Versão na execução
  viva não fornecida separadamente; não foi reconsultada nesta sessão.
- Autenticação por assinatura, conforme relato humano; sem uso de API informado.
- Task spec: mesma CoderTaskSpec completa e mesmo prompt da prova Codex, conforme
  relato. Payload literal não fornecido; não reconstruído como entrada executada.
  Contrato e aceites: [TPC-01](../planos/008-primeira-prova-trusted-produce-change-backlog.md).
- Somente `apps/web/cli/args.ts` e `apps/web/cli/args.test.ts` alterados.
  E1/E2/E3 satisfeitos; sem contract violation.
- Mesmo gate da prova Codex; host verde. Comando canônico do plano:
  `npm test --workspace=apps/web -- cli/args.test.ts`.
  Logs/argv literais não fornecidos.
- Duração e modelo observado: não informados no relatório recebido.
  Não inferir modelo do default/configuração do backend.
- Hash do resultado/IDs operacionais: não fornecidos. Nenhum transcript grande
  ou `.tmp` versionado; nenhuma nova inferência executada nesta reconciliação.
- Natureza **técnica NÃO GOVERNADA**: não houve work item, attempt, authority,
  Verifier ou review governada. Não conclui trusted/governed self-development.
  Nenhuma integração/push do resultado foi solicitada ou realizada nesta sessão.

Representação: WRAP / CURRENT FOCUS / integrated / baseline técnico do executor
atingido / live technical proof PASS / governed proof ainda não demonstrada.
Maturidade projected preservada: sem regra específica no Proof Engine,
not_evaluated e derivedMaturity=null. Evidência em history, sem crédito canônico.
Sessão, testes e retomada: [reconciliação final](2026-10-02-akita-baseline-v1-final-reconciliation.md).

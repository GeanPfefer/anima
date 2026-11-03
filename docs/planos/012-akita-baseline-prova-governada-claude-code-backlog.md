# Backlog dedicado — primeira prova governada do Claude Code

Documento de backlog canônico com UM único candidato. O Claude Code já possui uma prova técnica
viva; este candidato é a PRIMEIRA PROVA GOVERNADA do Claude Code dentro do control plane do ANIMA
(`coder_backend: claude-code` pelo caminho canônico: backlog → materializer → aprovação →
classificação → roteamento → claim → worktree → Claude Code real → gate/escopo → evidências →
Verifier → liberação mandatada → review). O materializer canônico lê só o documento apontado; este
arquivo não altera os documentos 009, 010, 011, o backlog do Modo Autônomo V0 nem o do TPC.

Histórico factual preservado, sem mutação: AKT-01 (FAIL pré-inferência por erro de operador no path do
Codex), AKT-02 (Codex correto, bloqueado por coder evidence ausente, defeito corrigido em `f518d0d`,
cancelado humanamente para liberar o target) e AKT-03 (primeira prova governada do Codex CLI até review,
aceita por humano e integrada manualmente em `dev` como `83f7fd2`).

## AKT — Prova governada com Claude Code

### AKT-04 — Testes unitários de xp.ts

- **Status:** not_started
- **Objetivo:** Criar `packages/core/src/xp.test.ts` para caracterizar comportamentos estáveis e atuais de `packages/core/src/xp.ts`, sem alterar `xp.ts` nem nenhum código de produção. Os testes devem ser legíveis e determinísticos e cobrir: `calculateBonusMultiplier` sem bônus; as taxas e a composição dos bônus conforme o comportamento atual; a combinação normal de tipos únicos de bônus; `calculateActivityXP` com um exemplo representativo de arredondamento; `calculateFinancialEventXP` com valor positivo, negativo e zero; `calculateStateChangeDeltaXP` com casos não ambíguos; `PHYSICAL_ACHIEVEMENT_XP`; `MEANINGFUL_CONNECTION_XP`. NÃO tornar obrigatório fixar o teto 2.5 por meio de bônus duplicados, o comportamento de `Math.round` exatamente em -2.5, nem qualquer outro quirk cuja desejabilidade como contrato ainda não foi decidida.
- **Dependências:** (nenhuma)
- **Escopo incluído:** packages/core/src/xp.test.ts
- **Fora de escopo:** packages/core/src/xp.ts, packages/core/src/quests.ts, apps/web, apps/mobile, packages/types, supabase, todo o restante do repositório
- **Critério de validação:** npm test --workspace=packages/core -- xp.test.ts
- **Tentativas:** max_attempts = 1 (prova experimental: sem retry nem sucessor); max_duration_minutes = 30
- **Verifier:** verifier_requirement = required_fail_closed
- **Aceite:** A execução altera somente `packages/core/src/xp.test.ts`.
- **Aceite:** A suíte focal de xp passa.

Nota de revisão humana: os aceites acima são os únicos claims machine-provable pelo Verifier atual
(contenção de escopo observada pelo host e gate focal verde). Que os testes realmente caracterizam
`xp.ts`, que os casos pedidos estão presentes, que não houve mudança de produção, a legibilidade e que
nenhum quirk ambíguo foi cristalizado sem necessidade serão conferidos na REVIEW HUMANA e NÃO são claims
machine-proven. Um PASS do Verifier significa apenas gate focal verde + escopo contido.

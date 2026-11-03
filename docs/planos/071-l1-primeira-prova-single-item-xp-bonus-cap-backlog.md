# Backlog dedicado — L1-PROOF-01 (sourceId canônico PROOF-01) — Teste de borda do teto de bônus de XP

Documento de backlog canônico com UM único candidato. Primeira prova operacional do Single-Item com o perfil nativo de permissões do Codex WSL (L1, commit `901a774f`). O alvo é deliberadamente trivial para isolar o que se quer provar: o executor `codex-cli` via WSL, sob o perfil L1, altera UM arquivo de teste, os gates do host rodam e o Verifier independente emite parecer. O materializer canônico lê só o documento apontado; este arquivo não altera os documentos 009–070.

Executor: `codex-cli` (assinatura ChatGPT via WSL; sem API paga). Decisão humana, não política fixa.

## L1 — Primeira prova Single-Item com isolamento WSL

### PROOF-01 — L1-PROOF-01: teto de bônus de XP em xp.test.ts

- **Status:** not_started
- **Objetivo:** Adicionar casos de borda determinísticos, ainda não cobertos, ao arquivo de teste existente `packages/core/src/xp.test.ts`, caracterizando o teto do multiplicador de bônus (`MAX_BONUS_MULTIPLIER = 2.5`) de `calculateBonusMultiplier` e `calculateActivityXP` em `packages/core/src/xp.ts`. Editar SOMENTE `packages/core/src/xp.test.ts`. NÃO alterar `xp.ts` nem qualquer outro arquivo. NÃO renomear, remover nem alterar os testes e títulos existentes (apenas ACRESCENTAR). Os títulos novos NÃO podem conter as palavras segredo, senha, token, chave, credencial, key, secret, password nem padrões parecidos com credencial. Comportamento a caracterizar (a implementação atual é a verdade; não corrigir nada): (1) bônus repetidos podem passar do teto: o multiplicador para quatro `forgotten_pillar` (1 + 4×0,5 = 3) é limitado EXATAMENTE a 2,5 (`toBe(2.5)`), e também para uma lista longa de bônus repetidos; (2) fronteira: três `forgotten_pillar` somam exatamente 2,5 e continuam em 2,5; dois `forgotten_pillar` mais um `active_quest` somam 2,4 e NÃO são limitados (`toBeCloseTo(2.4, 10)`); (3) `calculateActivityXP` usa o multiplicador limitado: com `durationMinutes` 10, `xpRate` 1 e quatro `forgotten_pillar` o resultado é `{ baseXP: 10, bonusMultiplier: 2.5, totalXP: 25 }`; com `durationMinutes` 7 e `xpRate` 1 o `totalXP` é 18 (Math.round(7 × 2,5) = 18, arredondando 17,5 para cima); (4) duração zero com bônus ativo devolve `baseXP` 0 e `totalXP` 0 com o multiplicador limitado de 2,5. Use o `buildPillar` e os imports já existentes no arquivo. TypeScript strict, sem `any`, sem `it.skip`, `it.only` ou `it.todo`, sem rede, sem relógio, sem aleatoriedade. Os testes devem FALHAR se o teto for removido ou alterado (por exemplo para 2,4 ou 3), portanto devem afirmar valores exatos e entradas que excedem o teto. LF; `git diff --check` limpo.
- **Dependências:** (nenhuma)
- **Escopo incluído:** packages/core/src/xp.test.ts
- **Fora de escopo:** packages/core/src/xp.ts e todo o restante de packages/core | packages/types | apps/web | apps/mobile | supabase (nenhuma migration) | docs | package.json e configuração | todo o restante do repositório
- **Critério de validação:** npm test --workspace=@anima/core -- src/xp.test.ts
- **Tentativas:** max_attempts = 1 (prova experimental: sem retry nem sucessor); max_duration_minutes = 30
- **Verifier:** verifier_requirement = required_fail_closed
- **Aceite:** A execução altera somente `packages/core/src/xp.test.ts`.
- **Aceite:** O teste focal `src/xp.test.ts` passa, com pelo menos 4 testes novos, todos os testes e títulos existentes preservados, e os novos testes afirmam valores exatos do teto de 2,5 com entradas que o excedem.
- **Aceite:** O typecheck do workspace `@anima/core` passa.

Nota de revisão humana: os aceites acima são os claims machine-provable pelo Verifier atual (contenção de escopo e gates focais/typecheck, com vínculo de teste). Que os testes novos realmente falham se o teto for removido ou alterado, e que nenhum teste existente foi enfraquecido, serão conferidos na REVIEW HUMANA (mutação manual de `MAX_BONUS_MULTIPLIER`) e NÃO são claims machine-proven.

## Observabilidade L1 (o que a prova deve evidenciar além do Verifier)

- O turno do Codex roda com `default_permissions = anima_single_item` (sem `--sandbox`), depois de versão 0.162.x e canário aprovados.
- O diff observado pelo Host tem exatamente um arquivo; nenhuma escrita fora da worktree; nenhum acesso às credenciais do Linux ou do Windows.
- Ressalva conhecida: o Codex acrescenta uma entrada de `trust_level` em `~/.codex/config.toml` para a nova worktree.

## Fora desta unidade

Aceite, integração em `dev`, publicação e qualquer segunda attempt são atos humanos posteriores e separados.

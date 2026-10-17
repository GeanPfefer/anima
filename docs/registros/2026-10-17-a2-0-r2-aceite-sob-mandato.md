# A2-0 / Recorte 2 — aceite sob mandato antecipado (implementação isolada) — 2026-10-17

Append-only. Tipo: desenvolvimento. Branch `claude/a2-0-r2-acceptance-mandate`, worktree `C:\Users\GeanTeco\anima-work-a2-0-r2`, base `2888118d` (= `origin/dev`).
**Nada commitado, publicado ou aplicado no residente.** Contrato: [`docs/arquitetura/acceptance-mandate-v1.md`](../arquitetura/acceptance-mandate-v1.md).

## Decisões aprovadas

D1 identidade de concessão dedicada (grantor) ≠ residente ≠ runner ≠ writer · D2 Acceptance Mandate V1 (item+versão+hash, ≤ 24 h, só `accept`, impacto low, uma attempt,
Verifier v6, sem compute pago, sem integração) · D3 conferência Git independente no lado do writer · D4 candidato A2R1 preservado em `review`, sem aceite retroativo.

## Entregas

- Core puro `acceptance-mandate.ts`: política, escopo seguro, normalização do pedido, integridade do candidato, avaliação espelhada, derivação dos fatos a partir do ledger, leitor do aceite persistido.
- Migrations candidatas (aditivas): `20261017000000` (vocabulário: `work_mandate_granted/revoked`) e `20261017000001` (papel `anima_mandate_grantor`, registro de grantors, tabela
  `work_acceptance_mandates` com RLS, `grant/revoke/preview` do grantor, `accept_work_result_under_mandate` do writer, triggers aditivos). 13 funções novas, 0 alteradas.
- Web: `acceptance-mandate.ts` (sinks, `collectCandidateIntegrity`, `acceptUnderMandate`), `mandate-grantor-cli.ts` + `cli/mandate.ts` (prompt oculto; recusa senha no ambiente, credenciais do runner e e-mail igual ao do residente/writer),
  sink `mandatedAcceptance` no Trusted System Writer. `autonomy-evidence`: conceder/revogar mandato contam como atos humanos.

## Provas (descartável com o schema do residente de 158 migrations)

- pgTAP `acceptance_mandate.test.sql`: **175/175** (154 + 21 da revisão final). Cobre fluxo feliz e replay, fronteira de identidade (runner, anon, service_role, writer, grantor sem registro/revogado/com claim comum),
  concessão fail-closed (risco, executor, Verifier, tentativas, coder pago, resume, classificação, base, escopo, hash, janelas, compute pago, attempt iniciada, request replay/conflito),
  revogação, aceite (expiração, não vigente, item/versão, contrato/base/impacto alterados, não antecipado, política, Verifier v5/gaps/violações/inconclusivo/rejeitado, test_binding, fato de contexto,
  classificação, compute pago, duas attempts, resultado não mais recente, 13 formas de relatório de integridade adulterado, escopo observado pelo host), trigger aditivo, imutabilidade, RLS,
  ACL e compatibilidade do aceite humano.
- Mutações: 25 enfraquecimentos de guardas do aceite + 6 de ACL/trigger + 5 da revisão final (lock do revoke, `branch_published`, `lower()`, caracteres reservados, ponto/espaço final); todos detectados (os 2 que sobraram são camadas redundantes por desenho; ver contrato).
- Regressão: 18 suítes pgTAP existentes verdes sobre o banco com o R2 aplicado (R1, evidências, writer, verifier gate, claims, integração, revisão, etc.).
- Catálogo: +13 funções, 0 alteradas/removidas.

## Defeitos encontrados e corrigidos durante a implementação

Concatenação `text[] || 'literal'` tratava o literal como array (mascarada por testes que casavam o eco do código); trocada por `array_append` e testes passaram a casar a mensagem completa.
Janelas usavam `now()` (congelado na transação) e foram para `clock_timestamp()`. Ordem de chaves do relatório dependia da collation (`COLLATE "C"`).

## Revisão final de segurança e integridade (2026-10-17)

Revisão adversarial do diff completo, sem commit/aplicação. Achados corrigidos no worktree, cada um com teste de regressão:

1. **Deadlock aceite × revogação (40P01)** — `revoke_acceptance_mandate` travava o mandato antes do item; o INSERT do evento exige `FOR KEY SHARE` no item, que conflita com o
   `FOR UPDATE` do aceite (reproduzido com duas sessões: `deadlock detected`, a revogação abortava enquanto o aceite consumia). Agora item → mandato em grant/revoke/aceite.
   Provado com sessões reais: revoke espera o item e revoga; aceite×aceite ⇒ `accepted`+`replayed` (1 evento); aceite×revoke simultâneos ⇒ exatamente um vence, nunca ambos.
2. **Escopo aliasável no NTFS** — prefixo sensível era sensível à caixa e não recusava `~`, `:`, `*`, controle, ponto/espaço final nem `.git*`. Corrigido em SQL e TS (+15 casos).
3. **Candidato reescrevível** — a coleta Git não usava `--no-replace-objects` (um `refs/replace` do runner mudaria o que o writer enxerga) e aceitaria link simbólico/submódulo
   com o nome certo. Agora `--no-replace-objects` em toda chamada e `diff --raw` só com modos 100644/100755.
4. **Publicação prévia** — `branch_published` não contava como integração prévia no aceite; passou a contar. Antes não havia teste de `integration_present`; agora há (publicação e decisão).
5. **Fidelidade do banco de prova** — migrations reaplicadas como `postgres` (não-superuser, dono do banco, como o residente): 13 funções criadas, 0 alteradas, enum 40→42, tudo
   de propriedade de `postgres`; pgTAP do R2 175/175 e 71/73 arquivos pgTAP existentes verdes (2 falham IGUAL sem o R2).

Verificado sem alteração: ACL (writer só aceita; grantor só concede/revoga/prévia; runner/anon/service_role nada; grantor sem SELECT em tabelas), imutabilidade/RLS,
métrica de autonomia (concessão conta como ato humano; ciclo mandatado nunca vira `unattended_verified`), aceite humano intacto.

## Pendente (fora desta etapa)

Revisão final, commit, backup+aplicação das migrations no residente (outro mandato), provisionamento do grantor, prova viva com item NOVO (mandato antes da attempt) e Recorte 3.

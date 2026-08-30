# Verifier distingue delta da attempt e reverifica append-only

- **Data/tipo:** 2026-08-30 — desenvolvimento + prova viva.
- **Objetivo:** eliminar o falso positivo de escopo na attempt retomada sem apagar
  a proveniência completa nem a opinião anterior.
- **Branch / HEAD inicial:** `dev` / `05e607d`.
- **HEAD final:** commit que inclui este registro.

## Mudanças e decisões

- `observedChangedFiles` continua sendo o diff completo contra a base autorizada.
- `observedChangedFilesSinceStart` registra o delta host-observed contra o SHA no
  qual a attempt começou; em resume, esse SHA é o checkpoint.
- O Verifier usa o delta somente para included/excluded scope. Cross-check
  observed × attested continua usando o conjunto completo.
- Eventos históricos sem delta continuam válidos e usam a semântica anterior;
  ausência nunca significa delta vazio.
- A RPC permite uma reobservação atual após uma evidência legada da mesma attempt,
  preservando ambas. Replay idêntico por base semântica é idempotente e divergência
  continua conflito fail-closed.

## Provas

- Regressão vermelha reproduziu `change_in_excluded_scope` para arquivo herdado.
- Core focado: 61/61; web focado: 12/12; typecheck core/web verde.
- Supabase: 44 arquivos / 990 testes pgTAP verdes.
- Git real da attempt `f7fd8c2e-bde1-4b52-9435-a41e8fd33e77`:
  `e54a59e..4b4cf25d` contém implementação+teste; `c89765a..4b4cf25d`
  contém somente `apps/web/lib/ai/chat-surface.test.ts`; implementação preservada.
- Prova persistida no successor `b811aaa1-4ec7-4aa2-bdad-97c3bcaccb77`:
  evidência antiga seq 39094 e parecer `rejected` seq 39095 preservados; nova
  evidência seq 42058; novo parecer `verified` seq 42059 (7 checks, 0 gaps,
  0 violações, cobertura git+gates).

## Segurança, efeitos e retomada

- Nenhuma attempt nova, reescrita/remoção de evento, reset, merge, deploy,
  force-push ou alteração de `origin/main`.
- Migrations `20260830000000` e `20260830000001` aplicadas ao banco local sem reset.
- `.worktrees/`, branches `anima-work/*`, arquivos locais sensíveis e artefatos não
  rastreados foram preservados.
- **Fronteira humana:** o item está em `review`; aceitar o resultado no cartão do
  chat deve levá-lo a `completed`. Depois, reconciliar o estado persistido e
  registrar o marco Dev Local V1 + review/rework incremental completo.

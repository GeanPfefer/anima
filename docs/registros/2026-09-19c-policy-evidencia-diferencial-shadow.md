# Differential Evidence Policy V0 em shadow mode

- **Data/tipo:** 2026-09-19 — desenvolvimento e prova automatizada.
- **Objetivo:** interpretar a evidência diferencial por `claim_kind` sem alterar o
  comportamento operacional.
- **Branch:** `dev`.
- **HEAD inicial:** `1e0651cd9b3174f0f76f2eac0b4d43a6d47dbf42`.
- **HEAD final:** commit que contém este registro (ver histórico de `dev`).

## Resultado

- A policy pura `differential-evidence-policy-v0` produz `allow`,
  `require_review`, `deny` ou `insufficient_evidence`, com reason code, fatos
  relevantes e referência à evidência.
- Os `claim_kind` encontrados e suportados são `gate_assertion` e `substantive`.
  Um gate diferencial limpo pode autorizar somente a afirmação sobre o próprio
  gate; afirmação substantiva continua exigindo revisão mesmo com gate verde.
- `unverified`, `mismatch`, baseline ausente, target novo/alterado, outside-scope e
  os quatro quadrantes base/final têm interpretação explícita.
- O host propaga o `claimKind` estrutural do critério e persiste a decisão shadow
  junto de `HostObservedGateEvidenceV1`. O parser a recomputa deterministicamente.

## Segurança e ausência de enforcement

- A função não possui I/O nem consulta LLM, relógio, rede ou estado global.
- Executor, state machine de attempts, retry, Verifier, review, promoção e
  integração não consomem a decisão. `allow` e `deny` são somente telemetria V0.
- Nenhum browser, Work, Claude, compute pago, banco, push, merge, deploy ou alteração
  de `origin/main` foi realizado.
- WIP preexistente preservado: `.claude/settings.local.json`, `.worktrees/` e
  `watch4-sensors.txt`.

## Provas

- Testes focais da policy e evidência core: executados nesta sessão.
- Testes focais de persistência/executor web: executados nesta sessão.
- Typecheck `packages/core` e `apps/web`: executados nesta sessão.
- `git diff --check`: executado nesta sessão.

## Fronteiras humanas e próximo ponto

Antes de enforcement, decidir explicitamente se `PASS→PASS` deve sustentar `allow`
para `gate_assertion`, quando outside-scope pode ser tolerado por classe e se targets
novos/alterados podem conquistar uma régua mais permissiva. Depois, desenhar uma
fatia separada que conecte policy a comportamento com rollout, rollback e gates
humanos próprios.

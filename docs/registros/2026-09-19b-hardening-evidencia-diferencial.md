# Hardening da evidência diferencial antes de enforcement

- **Data/tipo:** 2026-09-19 — desenvolvimento e prova automatizada.
- **Objetivo:** fechar R1/R2 preservando fatos suficientes e uma fronteira explícita
  entre scope declarado pelo planner e scope verificável pelo host.
- **Branch:** `dev`.
- **HEAD inicial:** `10229a51f306b1537e6f17d3f4fd01dd256ebc8b`.
- **HEAD final:** commit que contém este registro (ver histórico de `dev`).

## Resultado

- Restore pós-baseline é obrigatório: falha ao retornar a `startSha`/checkpoint
  emite `execution_failed`, não é retryable e impede qualquer chamada ao coder.
- `DifferentialGateBaselineV1` preserva fatos por target (`path`, `kindAtBase`,
  `existedAtBase`, `changed`) e `changedFiles` particionado em dentro/fora do scope.
  `targetExistedAtBase` e `changeTouchedGateTargets` são derivados dos fatos.
- `scopeVerification` distingue `verified`, `mismatch` e `unverified`. A forma
  verificável atual é somente filtro concreto de teste por path exato; gates amplos
  não recebem força probatória por declaração do planner.
- `classifyDifferentialGate` exige scope verificado para produzir
  `discriminating`; legado/ambíguo cai em `inconclusive`. Nenhum enforcement novo.
- Paths significam arquivos exatos. O planner recusa diretório existente; globs e
  trailing slash são recusados; igualdade nunca é prefix match.

## Provas

- Core focal: **3 suítes / 105 testes PASS**.
- Executor + planner focal: **2 suítes / 59 testes PASS**.
- Planner compartilhado + persistência web: **3 suítes / 31 testes PASS**.
- Executor isolado após correção da fixture: **53 testes PASS**.
- Typecheck `packages/core`: **PASS**; typecheck `apps/web`: **PASS**.
- `git diff --check`: **PASS** (avisos LF→CRLF não são defeitos).

## Incidente de teste

A primeira rodada web falhou porque a fixture passou a procurar `retry` em todo
`process.argv`, incluindo o nome `retry-gate.js` do próprio script. Isso tornou o
gate default artificialmente vermelho. A fixture foi corrigida para considerar
somente argumentos (`slice(2)`); a suíte completa do executor voltou a verde.

## Segurança e efeitos externos

- Nenhum browser, Work, Claude, compute pago, rede externa, banco, push, merge,
  deploy ou alteração de `origin/main`.
- WIP preexistente preservado: `.claude/settings.local.json`, `.worktrees/` e
  `watch4-sensors.txt`.
- Nenhuma alteração outside-scope é bloqueada por esta evidência advisory.

## Próximo ponto

Antes de enforcement, definir policy explícita por `claim_kind` e quadrante
base/final, incluindo o significado de `mismatch`, targets novos e mudanças fora do
scope. Só então conectar o status diferencial a bloqueio/promoção, mantendo o gate
humano e versionando a policy.

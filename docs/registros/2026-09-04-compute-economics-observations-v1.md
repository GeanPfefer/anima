# Compute Economics Observations / Cohorts V1

- **Data/tipo:** 2026-09-04 — desenvolvimento e prova automatizada.
- **Objetivo:** criar a ponte pura entre evidência de attempts e o Compute Economics já existente, com observações normalizadas e coortes comparáveis.
- **Branch:** `codex/compute-economics-observations-v1`.
- **Worktree:** `G:\anima\.worktrees\compute-economics-observations-v1`.
- **HEAD inicial/base:** `5c044429105214a078c9da53c8d3d847bd0be953` (`origin/dev`).
- **HEAD final:** commit atômico que contém este registro.

## Mudanças e decisões

- `EconomicObservationV1` versionada cobre identidade, coorte, tempos, resultado, uso API, runtime local, lease cloud, custos e exposição reservada.
- Proveniência conceitual permanece explícita; chamadas observadas pelo host não são confundidas com tokens reportados pelo provider.
- `reserved_exposure` é tipo distinto de custo `settled`/`derived`; ausência de settlement permanece indisponível.
- Coortes usam capability, taskClass, provider, model, placement e configVersion opcional. taskClass ausente normaliza deterministicamente para `unknown`.
- Normalização e agregação falham fechado com defeitos tipados. Um lote com observação inválida não é agregado parcialmente.
- Agregação conta attempts, VERIFIED, falhas, no-progress, categorias e cobertura de custo; reutiliza `calculateCohortMetrics` em vez de reimplementar pricing, custos ou break-even.
- `AttemptOutcomeV1.durationMs` aceita ausência honesta (`null`); o Compute Economics valida somente duração conhecida.

## Provas

- Testes focados: 27/27 verdes.
- Suíte completa do core: 72/72 suites e 1544/1544 testes verdes.
- Typecheck do core: verde.
- `git diff --check`: executado antes do commit.
- Suíte raiz adicional: mobile verde; web apresentou duas falhas de infraestrutura por dependências físicas do Next ausentes nesta worktree (`next/navigation` e `apps/web/node_modules/next/dist/bin/next`), fora do escopo e sem alteração web.
- Fixture real: OpenAI / `gpt-5.6-terra`, 3 calls, 4123 input, 1142 output, 1121 cached, 14,9 s, review alcançado e Verifier inconclusive. Resultado não é VERIFIED e US$ 0,25 permanece somente exposição reservada, nunca custo real.

## Segurança, efeitos e limites

- Zero chamadas pagas; zero tokens consumidos; zero custo externo.
- Zero mutações de banco, SQL, migrations, RPC, provisionamento cloud ou lifecycle.
- Nenhuma alteração em `apps/web`, `supabase`, Resident Host, Resource Governor, Compute Router, transport OpenAI, planner/chat ou branch `dev`.
- Nenhum merge/integração em `dev` ou `main`; somente a branch desta sessão será publicada.
- Sem decisão de Router: o output apenas prepara métricas empíricas futuras.

## Próximo ponto de retomada

Consumir `EconomicObservationV1` numa borda de persistência/adaptação somente depois que o trabalho concorrente do Compute Router estiver integrado e houver um recorte explicitamente aprovado para essa integração.

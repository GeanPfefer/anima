# AUDIT-02 — higiene de estado e Evolution Refresh V1 — 2026-11-03

Append-only. Tipo: **implementação + auditoria** (código, testes e documentação; sem schema; sem escrita no banco residente; sem integração em `dev`/`main`; sem push). Formato de [`README.md`](README.md). Antecede: AUDIT-01 (relatório de chat de 2026-11-03).

## Dados

- Base: `dev` = `origin/dev` = `21b2af9` (revalidada). `main` = `origin/main` = `99bec54`, intacta.
- Branch desta entrega: `claude/audit-02-evolution-refresh` (worktree `C:\Users\GeanTeco\anima-work-audit-02-evolution`). Branch documental irmã: `claude/audit-02-docs` (commit `8a8f9c0`, worktree `C:\Users\GeanTeco\anima-work-audit-02-docs`). Nada integrado, nada publicado.
- Serviços observados (somente leitura): Supabase no ar (API 54321 responde, contêineres `Up`; `supabase_vector_anima` em reinício), Ollama não responde em 11434. Um aplicativo Codex desktop estava em execução na máquina durante a auditoria; nenhum arquivo do checkout principal foi alterado por esta sessão.

## Preservação (nada descartado)

- O checkout principal continua com os mesmos 273 itens sujos (10 modificados + 263 não rastreados); **nenhum arquivo dele foi alterado**. O commit documental foi feito numa worktree separada, a partir de **cópias**.
- `claude/audit-02-docs` (`8a8f9c0`) versiona: `anima-prd.md` (+404 linhas só de acréscimo), `AGENTS.md` (+2), plano 008 (+22), 65 planos (009–044), 128 registros de nível superior, a decisão de locks do Single-Item, o runbook Codex WSL e o diff do hardening **não aplicado** das migrations `20260905000001/02` e de cinco testes SQL. Varredura de padrões de segredo em todos os arquivos não rastreados de `docs/`, `supabase/tests`, `supabase/bootstrap` e `supabase/migrations`: nenhum achado.
- **Não** foram commitados e continuam apenas no disco do checkout principal: 23 diretórios `*-evidencias/` (≈30,5 mil arquivos), `supabase/bootstrap/`, `supabase/tests/*.py` e fixtures da campanha Single-Item, as migrations candidatas `20261009000000/01`, `.tmp/`, `apps/web/scripts/_session/`, `watch4-sensors.txt`, `%SystemDrive%/` e `.worktrees/`.

## Migrations (leitura)

- Banco: 161 versões em `supabase_migrations.schema_migrations`; repositório: 161 rastreadas + 2 candidatas não rastreadas (`20261009000000/01`) que **não** estão no banco (pendência conhecida e deliberada).
- `20260905000001/02`: o texto aplicado no banco é **idêntico ao `HEAD`** (diferença apenas do `;` final, que o histórico remove). As edições do working tree (datadas de 2026-10-08, reforço com hash do corpo da função e pós-condição) **nunca foram aplicadas**. Editar migration existente viola a imutabilidade; o caminho compatível é uma migration nova e aditiva que faça o endurecimento (a mesma lógica de hash serve), com os testes SQL ajustados juntos. O diff está preservado em `claude/audit-02-docs`. Nada foi aplicado, restaurado ou editado.

## Worktrees e branches (classificação, sem remoção)

- 256 branches locais (antes desta sessão): 175 contidas em `dev`, 81 com commits fora de `dev`. Dessas 81, 68 são `anima-work/<uuid>` (checkpoints de attempts do próprio ANIMA, 1–4 commits cada: candidatos/checkpoints preservados). As outras 13 são únicas: `evolution-ux-v2` (13), `anima-recovery/seq5-base`, `archive/anima/prisma-persona-rescue` e `resgate/prisma-persona-v1` (exploração Prisma, jul/2026), `backup/*` (2, jul/2026), `claude/ux-trabalhos-2` (UX-TRABALHOS incremento 2, 1 commit), `codex/compute-economics-v1` e `-observations-v1` (set/2026), `codex/roadmap-003-006`, `codex/scope-verification-path`, `fix/mobile-completed-result` e `claude/audit-02-docs`.
- 33 worktrees: 26 sem commits fora de `dev` (inclui o checkout principal; integradas ou idênticas à `dev`), 6 com 1 commit único, `evolution-ux-v2` com 13. **Trabalho não commitado e valioso**: `anima-work-a2-uac` (protótipo `mandate-approver*` + doc, 5 itens), `anima-work-a3` (`gate-isolation-activate.ps1` + alteração em `gate-isolation-acl.ps1`, 3 itens), `d1-import-wt` (1 registro, hoje também no commit documental), `evolution-ux-v2` (`.tmp/`).
- `codex/evolution-ux-v2` (2026-10-03): contém o modelo de **direção** (`current_focus/next/experimental/parked`), a separação conquista × maturidade, a apresentação da história recente e seis registros. Um `merge-tree` de teste (sem escrever) mostra **conflito** em `capability-registry.ts` e `capability-registry.test.ts`. Não foi integrada nem descartada; a reconciliação V6 de 2026-10-20 e esta entrega não a incorporam. Decisão pendente: portar seletivamente o modelo de direção ou aposentá-la.

## Evolution Refresh V1 — o que mudou

- `packages/core/src/capability-map.ts`: novo `CapabilityEvidenceProfile` opcional (seis níveis: planejado, implementado, testado, comprovado em execução real, operacional sob supervisão, operacional sem supervisão; estados `yes/partial/lab_only/no/unknown`) + validação `invalid_evidence_profile`: o perfil nunca excede a maturidade declarada, é monotônico, e "sem supervisão = sim" exige `autonomous`. **A semântica de `maturity` não mudou.**
- `packages/core/src/capability-registry.ts`: baseline passou para `21b2af9` / 2026-10-26; novo nó `agency.external-project-builder` (**proven**, não operational; laboratório descartável; PROOF-EXT-02/03 com Verifier `verified`, aceite humano e `integration_completed` lidos do ledger; PROOF-EXT-01 cancelada por humano; PROOF-EXT-04 inexistente no ledger e nos registros — nada afirmado); perfis de evidência em dez nós; histórico de V1-04, ai-memory S1 e integração externa; uma linha de fronteira corrigida (CLI de integração existe para integração externa).
- `apps/web/.../EvolutionClient.tsx` e `.module.css`: seção "Perfil de evidência" no detalhe de cada capacidade (níveis, supervisão, evidência mais recente, data de validação, limites; "não avaliado nesta revisão" quando não há perfil) e painel de visão geral (cobertura, "operacional sem supervisão: nenhuma capacidade comprovada", contagem por nível, baseline do registro).
- Maturidades preservadas: 67 nós anteriores com a mesma maturidade; distribuição agora operational 15, proven 22, projected 14, implemented 14, specified 3 (68 nós). Nenhum nó `autonomous`.

## Desempenho de `readCapabilityEvolution` (medido, somente leitura)

- Banco local (leitura via `psql` como superusuário, sem RLS): `work_events` = 3.396 linhas (seq máx 86.942; a diferença é a sequência global), ≈5,9 MB serializados, maior linha ≈96 KB. Com `PAGE_SIZE` 500: 7 consultas de eventos + páginas de `work_items` e `work_supervision_leases` (≈9–10 consultas por render).
- `EXPLAIN ANALYZE` de uma página: 1,7–2,8 ms no banco (Seq Scan + sort, 328 buffers em cache). CPU da derivação medida em Node com os eventos reais exportados: mapeamento+classificação 43 ms, `evaluateCapabilityProofsFromHistory` 144 ms, `deriveCapabilityAssessmentsFromWorkHistory` 81 ms, `computeAutonomyEvidence` 10 ms, `JSON.parse` de 5,9 MB 46 ms ⇒ ≈330 ms de CPU por render, linear no número de eventos.
- **Conclusão**: gargalo **não demonstrado**; a hipótese do AUDIT-01 (≈175 consultas) estava errada por confundir `seq` com contagem. Não medido: latência HTTP real via PostgREST com RLS e JWT (exigiria sessão de usuário). Reavaliar quando o histórico passar de ~20 mil eventos; nenhuma infraestrutura de cache foi implementada.

## Validação

- `packages/core`: 130 suítes / 3.265 testes passando; `tsc --noEmit` limpo.
- `apps/web`: suítes de `evolution` e `lib/evolution` (5 suítes, 96 testes) e `auto-approval.test` (25) passando; `tsc --noEmit` limpo. Testes novos: 5 em `capability-map.test.ts`, 6 em `capability-registry.test.ts`, 3 em `EvolutionClient.test.tsx`; ajustados os testes das reconciliações V2–V6 para ancorar na baseline V6 que fixaram.
- **Não executado**: `next build` (a worktree usa junctions de `node_modules` para o checkout principal, e o Next não resolve módulos fora da raiz do projeto — falha ambiental, não de código); inspeção visual da `/evolution` (exige sessão autenticada; o ANIMA não faz login por Claude, e o preview isolado esbarrou na mesma falha de junction). Testes de DOM cobrem as strings e os atributos exibidos.

## Limites e fronteiras humanas

- Nenhuma capacidade foi promovida. Autonomia desassistida não é declarada comprovada em nenhum nó. Perfil ausente significa "não avaliado", não "negado".
- Pendente de decisão humana: integrar `claude/audit-02-docs` e `claude/audit-02-evolution-refresh` em `dev`; destino de `evolution-ux-v2`; migration aditiva do hardening de `20260905000001/02`; preservar/commitar o trabalho não versionado de `a2-uac` e `a3`; triagem dos 68 checkpoints `anima-work/*`.

# 064 — Evolution Reconciliation V5 e fatos persistidos ainda não exibidos (PROPOSTA; nada executado)

Status: planejamento (2026-10-14). Base: `dev` = `af9c5577`. Complementa `docs/registros/2026-10-14-auditoria-estrategica-estado-real.md` (§5) e `docs/arquitetura/capability-proof-engine.md`.

## 1. Como a tela funciona hoje (código real)
`apps/web/app/(app)/evolution/page.tsx` → `readCapabilityEvolution` (`apps/web/lib/evolution/capability-assessment-read.ts`, histórico canônico de `work_events` paginado, RLS) + `ANIMA_CAPABILITY_REGISTRY_V0` + `EVOLUTION_BASELINE` + `autonomyReadiness`. Três camadas com frescor distinto:
1. **Declarada** (manual, `capability-registry.ts`): 67 capacidades, `history` com `refs` reais; última entrada 2026-10-07 (SDC-23); baseline 2026-09-16.
2. **Derivada** (Proof Engine): regras para 12 capacidades (`agency.edit-file|run-tests|produce-change|verify-change|supervised-self-development`, `governance.verifier`, `compute.external-provider|paid-settlement`, `research.web.search|open|extract`: 11 `aligned`; `memory.durability`: `insufficient_evidence`); 55 `not_evaluated`. Atualizada em tempo real (inclui a attempt de hoje). Duas projeções convivem: *assessments* (teto `operational` para 7 capacidades) e *avaliação de prova* (mantém `aligned` ao declarado); a UI não explica a diferença.
3. **Readiness de autonomia** (`autonomyReadiness`): referência `agency.run-tests`; bloqueia `autonomous` por falta de operação sem humano e fronteira de rede não provada.

## 2. Respostas diretas
- *Capacidades cadastradas?* 67 (15 operational, 21 proven, 14 projected, 14 implemented, 3 specified).
- *Maturidades/provas?* Declaradas à mão com `proofRefs`; derivadas por regras do engine só quando há evento canônico correspondente; estados fortes pertencem ao engine por contrato (a definição só afirma até `implemented`).
- *Integrações/attempts/Verifier/claims/sessões alimentam a tela?* Attempts, resultados aceitos, evidências do host e `verifier_opinion_recorded` SIM (via engine, 2745 eventos); claims, leases E0, recibos de integração, `test_binding`/árvore e razões de falha NÃO.
- *Desatualizada?* A camada derivada não; a declarada sim (9 dias) e o baseline de "evolução recente" (28 dias).
- *Proof Engine existe e funciona?* Sim (motor, avaliação, work-evidence, leitura, UI). Falta cobertura de regras.
- *Fatos persistidos sem representação:* ver §4.

## 3. Menor incremento recomendado — "Evolution Reconciliation V5" (reuso, sem novo mapa)
Escopo mínimo, padrão já usado em SDC-09/21/23: editar APENAS `packages/core/src/capability-registry.ts` (+ teste de integridade existente do registry, ex. `capability-registry.test.ts`) e registrar o record. Nenhum novo nó; nenhuma promoção de maturidade por texto:
- `EVOLUTION_BASELINE` → data/commit atuais (`af9c5577`, 2026-10-14, "Verifier v6 + Planner P2"), de modo que "evolução recente" seja a janela 10-07→10-14.
- `history` (+ `proofRefs` reais: commits `1f4b052`…`af9c5577`, itens, registros 2026-10-13/14) em: `governance.verifier` (v4 contrato de aceite, v5 `test_binding`, v6 tree-binding/outputTail; reescrever `frontier`: advisory, falso positivo humano já observado, nunca autoridade), `agency.supervised-self-development` (Single-Item V1, Codex/WSL, 16 integrações, dependência humana por ato), `governance.governed-integration` (receipts `ff_only`), `governance.budgets` (E0: 59 leases, TTL < attempt), `agency.external-harness` (Codex/WSL como executor principal), `interaction.resident-host`, `agency.verify-change`.
- `frontier` explícito: "autonomia não comprovada: todos os ciclos tiveram ≥8 atos humanos".
Verificação: typecheck/jest do core + uma asserção de que toda `ref` de commit/registro citada existe (já coberto pelo teste de proofRefs do registry, se houver; senão adicionar teste mínimo). Contrato `acceptance_contract:2` com `test_binding` no teste novo apenas se houver teste novo (preferência: estender o teste existente).

## 4. Incrementos seguintes (somente após o V5)
1. **Painel "Cadeia de verificação" (read-only)**: projeção de fatos que JÁ existem em `work_events`/`work_supervision_leases` — versões e vereditos do Verifier, nº de gates `test_binding`/com árvore, recibos de integração, razões de falha de attempt por backend. Reuso do loader canônico; sem tabela nova.
2. **Métrica de autonomia (a mais importante)**: "atos humanos por item concluído" = count(`work_proposed|work_approved|work_intelligence_classified|result_accepted|integration_effect_authorized` por item) + leases E0. Alimenta `autonomyReadiness` com um sinal honesto (hoje `autonomous_operation_evidence_unavailable`). Regra de derivação para `agency.continuous-self-development`: permanece `projected` até a métrica cair abaixo de um limiar declarado.
3. **Novas regras de derivação do Proof Engine** onde há evento canônico: `governance.governed-integration` (`integration_completed` com recibo), `governance.budgets` (admissão/lease), `agency.isolated-workspace`, `governance.attempt`/`review` (já `operational` declarado).

## 5. Riscos
O registry é grande e hand-authored: risco de inflar maturidade (mitigação: só `history`/`proofRefs`/`frontier`, sem mudar `maturity`; o engine decide). Conflito declarado × derivado: manter visível (já é). `/evolution` é RSC pesado (leitura de todo o histórico): o painel novo deve reaproveitar a mesma leitura.

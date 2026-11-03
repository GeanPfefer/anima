# Auditoria estratégica — estado real do ANIMA e do Mapa de Evolução (2026-10-14)

Registro append-only. Somente leitura (Git, Supabase residente, `/evolution` via a mesma leitura do `page.tsx`, web pública). Nada foi alterado. Documentos derivados: planos 064–067.

## 1. Revalidação
`dev`=`origin/dev`=`af9c5577fadb`; `origin/main`=`99bec54e` (intacta; último commit 2026-08-17, 521 commits atrás de `dev`); ledger 156 migrations; último evento 86664; 0 claims e 0 leases vigentes; nenhum item `in_progress` do usuário residente. Itens: 75 failed, 48 completed, 19 changes_requested, 15 review, 13 proposed, 11 cancelled, 9 approved, 7 rejected, 3 in_progress (históricos de outros usuários/testes), 3 blocked. Eventos: 3135 desde 2026-07-27. WIPs, 46 worktrees e 153 branches `anima-work/*` preservados.

## 2. O que aconteceu desde o Single-Item V1 (cadeia real)
| Marco | Evidência | O que entregou |
|---|---|---|
| Single-Item V1 promovido (2026-10-13) | migrations `20261008000000`, `20261010000000/1`; item `d795e414` | execução governada de UM item, claim/lease/orçamento, integração `ff_only` por recibo |
| Codex CLI/WSL como executor | `docs/operacao/codex-wsl.md`, 49 execuções `codex-cli:default` succeeded | o executor que realmente conclui trabalho (Ollama local: 17 ok × 19 failed; qwen2.5-coder:14b 0 ok × 5; OpenAI 18+3 ok × 5 failed; claude-code 7 ok) |
| Verifier v4 (I1a/I1b) | `acceptance_contract:2`, `human_review`, CLI | contrato de aceite verificável, revisão humana explícita |
| Verifier v5 (I2a/I2c) e host (I2b) | `test_binding` + relatório Jest normalizado + captura no host | prova automática de COMPORTAMENTO por teste novo |
| Verifier v6 (I3a/I3b) | `worktreeTree`/`observedTreeSha`/`outputTail` | vínculo teste↔revisão por árvore Git |
| 5 provas reais de `test_binding` | itens `42053b69`, `aa3a860c`, `9a7503ec`, `5f573801`, `4c47e9e3`, `c42ccb12` | 6 gates `test_binding` reais; 10 gates com árvore real |
| Planner P1/P2 | `project-work-planner-*` | o host monta contratos `test_binding`/`human_review` quando o planner os declara |
| E0 (supervisão humana) | 59 leases (10 desde 13/10) | contorna a cota de 6 attempts/24 h; risco conhecido: TTL 30 min < attempt de 35 min (expirou no P2b) |
Veredictos do Verifier (77 pareceres): `work-verifier-v1` 15 verified/1 rejected; v2 4/2/1 inconclusive; v3 32/3/2; v4 3 verified; v5 3; v6 4; `investigation-verifier-v1` 7. `verified` já teve falso positivo humano (seq4→seq5, 2026-09); a cobertura por árvore/binding reduz, não elimina, esse risco.

## 3. Implementado × provado × operacional × autônomo
- **Provado e repetido (≥5 ocorrências reais com evidência do host):** produzir mudança em worktree isolada com Codex, gates path-restritos, Verifier independente, aceite humano, integração governada `ff_only`, publicação. 16 integrações concluídas, 48 resultados aceitos.
- **Operacional com humano no ciclo (supervised):** todo o self-dev. Em ~2 dias: 16 propostas/aprovações/classificações humanas, 12 aceites, 10 leases E0. Nenhum item foi proposto, aprovado, executado e aceito sem ato humano.
- **Autonomia comprovada: nenhuma.** O próprio `autonomyReadiness` do `/evolution` lista `autonomous_operation_evidence_unavailable` ("operacional ≠ autônomo: não existe sinal de operação sem humano no ciclo") e `network_boundary_unproven`. `agency.continuous-self-development` segue `projected`, `governance.progressive-autonomy` `specified`.
- **Implementado, não demonstrado em uso real:** planner gerando `test_binding` (modelos locais viáveis falharam nas sondas: `test_bindings: []` e rejeições `required_text_list`/`unknown_criterion`); `outputTail` real (nenhum gate falho desde o I3b); negativo REAL de árvore; sincronização/publicação sem humano.
- **Caro e pouco produtivo:** executores Ollama locais (taxa de falha ~50%); a cota de attempts virou o gargalo e é contornada por lease humano.

## 4. Dependências, duplicações e complexidade
- Cadeia de evidência cresceu em camadas (gate/diff/relatório/árvore/tail) e cada item exigiu 8–10 atos humanos de governança; o custo humano por incremento (~1 h de supervisão) é maior que o de implementação (3–9 min de Codex).
- Duplicações: regex de credenciais em Core (`parseOutputTail`) e Host (`gateOutputTail`); 54 scripts operacionais copiados/adaptados item a item fora do repositório (create/classify/integrate-<id>.mjs); duas formas de workspace (`@anima/web` × `apps/web`) com efeitos diferentes em `verifyGateTargetScope`.
- Trabalho possivelmente desnecessário agora: expandir mais o Verifier antes de ter alvo de autonomia; novos executores; P2c do planner antes de decidir modelo/provedor; hardening E1/E2 do plano 059 só se E0 virar caminho permanente.
- Falta infraestrutura que destrava o objetivo (ver plano 067): operar sem escrever scripts ad hoc (CLI/automação do ciclo propose→approve→classify→execute→review), TTL/consumo do lease, e métrica de autonomia (atos humanos por item concluído).

## 5. `/evolution` — auditoria (resumo; detalhe no plano 064)
Fonte: `page.tsx` combina (a) registro declarado `ANIMA_CAPABILITY_REGISTRY_V0` (67 capacidades; maturidades: 15 operational, 21 proven, 14 projected, 14 implemented, 3 specified; hand-authored em `packages/core/src/capability-registry.ts`, 1782 linhas); (b) `EVOLUTION_BASELINE` (`7f276d8`, 2026-09-16, "Evolution UX V1") para "evolução recente"; (c) leitura dinâmica `readCapabilityEvolution` (histórico canônico de `work_events`, 2745 eventos legíveis agora) → projeção de assessments, 67 avaliações de prova e `autonomyReadiness`.
- A parte DINÂMICA está viva: reflete a attempt `6084e96c` (P2) como evidência decisiva; a projeção de *assessments* deriva `operational` para 7 capacidades (edit-file, run-tests, produce-change, verify-change, supervised-self-development, verifier, external-provider), 5 delas DECLARADAS `proven`; já a camada de *avaliação de prova* (67 avaliações: 11 `aligned`, 1 `insufficient_evidence`, 55 `not_evaluated`) as mantém `aligned` em `proven`. Há, portanto, duas projeções dinâmicas com tetos diferentes que a UI deveria explicar.
- A parte DECLARADA está parada em 2026-10-07 (SDC-23): última `history` do registry; o baseline segue 2026-09-16. Nada do que veio depois entra: Single-Item V1, Verifier v4–v6, `test_binding`, tree-binding, outputTail, E0, planner P1/P2. `governance.verifier` ainda diz "advisory/proven" com refs de 2026-10-05.
- 55 das 67 capacidades não têm regra de derivação (`not_evaluated`, maturidade manual); só 12 têm regra (11 `aligned`, 1 `insufficient_evidence`: `memory.durability`).
- Fatos persistidos sem representação: distribuição de versões do Verifier e verdictos; contagem de `test_binding`/árvore reais; leases E0 (59) e atos humanos por item (medida direta de autonomia); recibos de integração (16); taxa de sucesso por executor/backend; razões de falha de attempt.
- A Capability Proof Engine existe e é funcional (`capability-proof-engine/evaluation/work-evidence`, 8,6 mil linhas com testes): a pendência é COBERTURA de regras e reconciliação do declarado, não ausência de motor.

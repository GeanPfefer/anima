# 067 — Roadmap estratégico pós Verifier v6 / Planner P2 (PROPOSTA; nada executado)

Status: planejamento (2026-10-14). Base: auditoria `docs/registros/2026-10-14-auditoria-estrategica-estado-real.md`, planos 064 (Evolution V5), 065 (Akita), 066 (pesquisa recorrente). Critérios de ordenação: impacto real sobre o objetivo maior do ANIMA (sistema de evolução pessoal com memória narrativa, organização implícita e uma única experiência conversacional, capaz de evoluir a si mesmo sob governança), dependências, risco, custo e EVIDÊNCIA de necessidade.

## Diagnóstico em uma frase
Nas últimas três semanas o ANIMA ficou muito bom em PROVAR mudanças feitas com supervisão humana, mas (a) cada incremento custa ~1 h de atos humanos para ~5 min de execução, (b) nenhuma autonomia está comprovada, (c) quase nada do que o usuário final vê avançou (as capacidades de entendimento, memória narrativa e proatividade seguem `projected`).

## A. Infraestrutura fundamental que ainda falta (fazer primeiro)
| # | Item | Evidência de necessidade | Dependência | Risco | Custo |
|---|---|---|---|---|---|
| A1 | **Evolution Reconciliation V5** (registry + baseline; plano 064) | declarado parado em 2026-10-07; baseline 2026-09-16 | nenhuma | baixo (só history/refs/frontier) | muito baixo (1 item, 2 arquivos) |
| A2 | **Ciclo operável pelo CLI** sem scripts ad hoc: `work propose --file` (+validação lint/elegibilidade), `work classify`, `work integrate` (clone dedicado + guards + receipt) incorporando os scripts hoje copiados por item | 54 scripts em `anima-recovery/handoff-20261013`; 16 integrações manuais | nenhuma | médio (toca fluxo de integração: manter guards idênticos) | médio (3–4 itens) |
| A3 | **Métrica de autonomia**: atos humanos por item concluído + leases E0 (plano 064 §4.2) | `autonomyReadiness` sem sinal; 16 atos humanos/2 dias | A1 | baixo | baixo |
| A4 | **E0 robusto**: TTL ≥ `max_duration`, renovação segura e auditoria do uso do lease (ou eliminar a necessidade com política de cota ajustada pelo humano); plano 059 | lease do P2b expirou durante a attempt; 59 leases; sem evento no ledger | migration (E1/E2) — exige checkpoint humano | médio | médio |
| A5 | **Diagnóstico do Codex lento/estourado**: registrar duração por fase e cauda do agente (análogo ao outputTail dos gates) | P2b: 2096 s sem causa, após 6 runs de 3–9 min | nenhuma | baixo | baixo |

## B. Já suficientemente demonstrado — parar de investir (só corrigir defeitos)
Cadeia Verifier v1–v6 (contrato v2, `human_review`, `test_binding`, árvore, `outputTail`): 6 gates `test_binding` reais, 10 com árvore, 0 deriva em replay de 166 itens. Integração governada `ff_only` (16 recibos). Executor Codex/WSL (49 sucessos). Não abrir novas camadas de evidência sem um defeito observado (contrapeso Akita 08-18).

## C. Correções importantes, não urgentes
1. **Fail-to-pass** no `test_binding` (teste novo falha na base e passa no candidato) — hoje a mutação é manual (plano 058 I2e). Maior ganho de confiança por custo.
2. Proveniência de `acceptance_criterion_covered` (sai `attested` mesmo com `test_binding_satisfied` independent).
3. Painel “cadeia de verificação” e scorecard por executor (plano 064 §4.1; Akita #4).
4. Negativo REAL de árvore e falha real de gate com `outputTail` em item controlado.
5. Decisão humana sobre `main`: `origin/main` = `99bec54e` (último commit 2026-08-17) enquanto `dev` está 521 commits à frente; promover/rotular ou manter é decisão de governança, não técnica.
6. Duplicações (regex de credenciais Core×Host; `@anima/web` × `apps/web`) — oportunistas.

## D. Recursos concretos para o usuário final (balancear o esforço de infraestrutura)
Capacidades `projected` que são o PRODUTO: `memory.durability` (backup/restore verificado — protege os dados do usuário; houve reinício espontâneo do Docker em 2026-10-13), `memory.narrative-memory`, `understanding.world-model`, `understanding.github-attention` (ghpending: lógica útil, sem `--json`), `interaction.cognitive-proactivity`. Recomendação: depois de A1–A3, reservar a PRÓXIMA série de itens governados para 1–2 fatias de produto, começando por **durabilidade verificada** (risco de perda de dados real, evidência concreta, executável pelo pipeline atual) e depois uma fatia de **memória narrativa** com valor visível na conversa. O pipeline de self-dev serve a isso; ele não é o produto.

## E. Experimentos inspirados no Akita (pequenos, medidos, descartáveis)
1. Scorecard de executores a partir do ledger (custo ~0). 2. Suíte de falhas plantadas para o Verifier (negativos reais). 3. POC ai-jail dentro do WSL do Codex (após confirmar que o `workspace-write` não bloqueia leitura de credenciais). 4. R1 do plano 066 (scan RSS determinístico). 5. Normas “código para agentes” como checklist de revisão.

## F. Pausar ou abandonar
- **P2c/P3 do planner** (prompt/few-shot e prova do planner) — pausar: os modelos locais viáveis falham em conformidade estrutural; o ganho só existe se o planner passar a ser parte do fluxo diário; decidir antes o papel do planner (humano escreve contrato × planner propõe) e se haverá provedor pago.
- **Executores Ollama locais para código** (≈50% falha, barreira de RAM): manter como fallback, sem novos investimentos.
- **RunPod/compute pago e as reservas abertas** (`cost_unknown`): sem demanda; manter congelado.
- **E1/E2 do plano 059** completos: só se o E0 virar caminho permanente (A4 é a versão mínima).
- **Mais micro-incrementos do Verifier e de investigação** sem defeito observado.

## Sequência sugerida (menor primeiro)
1. A1 Evolution V5 → 2. A3 métrica de autonomia → 3. A5 diagnóstico do Codex → 4. A2 CLI do ciclo (em fatias) → 5. C1 fail-to-pass → 6. D (durabilidade verificada) em paralelo a E1/E2 → 7. A4 conforme dor. A pesquisa recorrente (066) entra como R1 quando houver capacidade ociosa; não antes de A1–A3.
Critério de revisão do roadmap: a cada 5 itens concluídos, recalcular “atos humanos por item” e “fatias de produto entregues”.

## Menor próximo incremento governado
**Evolution Reconciliation V5** (plano 064 §3): 2 arquivos (`capability-registry.ts` + teste), sem mudança de maturidade, sem novo nó, ~10 min de execução. NÃO criado neste mandato.

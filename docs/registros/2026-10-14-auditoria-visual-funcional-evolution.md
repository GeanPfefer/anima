# Auditoria visual e funcional do /evolution (2026-10-14)

Append-only. `dev` = `8b5455d3`. Somente leitura: nenhum código, dado, work item, lease, migration, integração ou push. Sessão autenticada pelo próprio usuário no navegador do app (nenhuma credencial digitada ou extraída por mim). Servidor `npm run dev:web` em `localhost:3000`, 0 erros de servidor, 0 erros de console, 0 requisições com erro.

## Método
Navegador embutido: desktop (1000x700) e mobile (375x812); DOM (`data-capid`, `data-state`), 67 cliques de seleção, Ajustar/Resetar/zoom, 4 lentes, console, rede. Limitação: os screenshots do painel saem em baixa resolução e não foram salvos em arquivo; a evidência é DOM/JS.

## Dados corretos e visíveis
- 67 nós; filtros Todos 67, Compreensão 6, Memória 9, Agência 16, Governança 12, Compute 8, Interação 6, Pesquisa externa 10.
- Lente "Evolução recente" 7 = exatamente as sete da V5; painel "Desde Evolution Reconciliation V4 · Baseline 6226324 (2026-10-07)", 8 entradas.
- Detalhe das sete mostra provas (commits, work_items, event 86647, records), história e "Fronteira e dependência humana" (inclui "Verifier v4–v6 é advisory…", "autonomia não comprovada"). `governed-integration` sem prova kind event.
- 0 nós "Autônoma"; readiness de `agency.run-tests` = "Sob mandato", com bloqueios autonomous_operation_evidence_unavailable e network_boundary_unproven; "Readiness ≠ authority: autorizado = Manual".
- 12 avaliadas pelo motor: 11 Alinhada + 1 Evidência insuficiente (`memory.durability`); 55 "Não avaliada pelo motor". Verifier: "Declarado: Comprovada · Derivado: Comprovada · 56 ocasiões · critérios operacionais pendentes", com a própria attempt b557509b como prova derivada.
- Lentes (Fronteira e humano 15; Reuso externo 8) e seleção funcionam; Ajustar = Resetar (mesma transformação).

## Corretos, mas difíceis de interpretar
1. Três das sete (verifier, verify-change, supervised-self-development) têm duas derivações no motor (`assessments` = operational; avaliação de prova = Comprovada). A UI mostra só a segunda; a divergência não aparece.
2. "Derivado: —" + "Não avaliada pelo motor" em 55 nós não distingue "sem regra" de "sem evidência".
3. Texto da história do verify-change: "V5 capturou test_binding" é ambíguo (Verifier v5 × Evolution V5).
4. Painel de detalhe: ~2858 px de conteúdo numa janela de ~350 px (viewport 700): proveniência, história e fronteira exigem muito scroll.
5. Estado inicial do mapa (translate −60) difere do "Ajustar" (+25).

## Existentes, mas ausentes da UI
Leases E0 (59), recibos de integração (16 `integration_completed`), versões/vereditos do Verifier (12 desde 10-13), contagem de `test_binding`/árvore, taxa de sucesso por executor, razões de falha de attempt, atos humanos por item. Busca no texto da página: `lease`, `ff_only`, `integration_completed`, `test_binding`, `atos humanos` = 0 ocorrências fora do texto dos registros.

## Erros / inconsistências efetivas
- (Média, UX) Mobile: escala fixa 0,35 ⇒ chips 60x20 px, fonte efetiva ~5 px, ilegíveis; 26 botões abaixo de 32 px; selecionar um nó não rola até o painel (painel ~1041 px abaixo do mapa).
- (Baixa) A "evolução recente" agora mostra só 7 nós por escolha do baseline (decisão humana).
- (Informativa, fora do /evolution) Após o login, a home chama `POST /api/ai/generate-insight` (2x, 200). Não foi ação da auditoria; verificar se usa provedor pago.
- Nenhum erro de console, de rede ou de servidor.

## Avaliação estratégica
- Entender o que o Anima faz hoje: sim no nível de capacidade (maturidade/estado), não no de volume/qualidade (quanto, com que taxa).
- Supervisão × autonomia: o readiness e a frontier são claros, mas não há métrica de autonomia (atos humanos por item) — o ponto central.
- Capacidades a evoluir: o objetivo "Self-development contínuo" (23 de 27) e as lentes mostram, mas sem priorização.
- Histórico: lista de notas por capacidade, útil como prova, não como linha do tempo.
- Complexidade desnecessária: dois tetos de derivação; textos longos em `advancement`/`meaning`.

## Recomendações (ordem de impacto)
1. Métrica de autonomia no readiness: atos humanos por item concluído + leases E0 (derivada do ledger).
2. Painel read-only "Cadeia de verificação": versões/vereditos do Verifier, `test_binding`/árvore, recibos de integração, falhas por executor.
3. Explicar na UI a diferença declarado × derivado × avaliado e o motivo de "não avaliada".
4. Painel de detalhe com seções colapsáveis (Provas/História/Fronteira) e resumo no topo.
5. Mobile: escala adaptativa, alvo de toque ≥ 44 px, rolagem ao painel.
6. Novas regras de derivação do Proof Engine (governed-integration, budgets, resident-host).

Menor incremento: (1), reaproveitando a leitura canônica já usada em `page.tsx`, sem tabela nova.

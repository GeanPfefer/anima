# Evolution UX V2 — Akita Baseline + direção de reuso

Data: 2026-10-02. Mandato humano: implementar isoladamente na base
`6eb2dee4971ed7ae649b1bba795d572a2dfb8665`; não integrar nem publicar.

## Objetivo e decisão aprovada

REUSE BEFORE BUILD. O caminho atual passa por Codex CLI executor, Claude Code
executor, continuidade Claude ↔ Codex via ai-memory; só depois retoma
self-development autônomo avançado. É uma sequência de planejamento, não um
workflow executável, uma prova, uma liberação de authority ou uma afirmação de
paridade funcional já alcançada com o workflow citado pelo humano.

Ollama e DeepSeek Harness permanecem pesquisa experimental; RunPod fica parked
para este milestone. Preservar provas anteriores. Codex e Claude são executores
substituíveis; o Anima continua a interface principal.

## Modelo e fronteiras

Reutilizar `Capability.reuse` (ADOPT/WRAP/FORK/BUILD/UPSTREAM/a decidir),
`externalEvidence`, `proofRefs`, `target`, `dependsOn`, `parentId`, histórico e
avaliação dinâmica. A direção WRAP do harness externo foi aprovada neste pedido;
a antiga decisão a decidir permanece no histórico de reconciliação.

Delta aditivo mínimo no contrato de Capability:

- `direction`: current_focus/next/experimental/parked/projected, justificativa e
  referências de decisão separadas das provas.
- `responsibility`: reused_baseline/control_plane, somente quando declarado;
  ausência não significa BUILD ou originalidade.
- `target.steps`: sequência ordenada com IDs reais do grafo; não substitui
  dependências nem afirma que uma dependência atingiu maturidade suficiente.

`agency.akita-baseline-v1` reutiliza target e depende dos dois executores e da
memória cross-harness. Self-development é a etapa posterior do planejamento,
não requisito para concluir o baseline (evita inversão do objetivo). Codex e
Claude especializam `agency.external-harness`, preservado como categoria.
Ollama/DSH ganham representações com provas históricas controladas já presentes
no repositório, nunca operational/autonomous. O registry passa de 63 para 68.
Nenhuma capacidade anterior muda maturidade, provas ou histórico.

## Implementação

/evolution destaca o objetivo atual e mostra quatro passos selecionáveis.
Preserva mapa, pan/zoom, Ajustar/Resetar, domínios, relações, objetivos, provas,
maturidade declarada/derivada e prontidão. Lentes adicionais exibem direção,
baseline reutilizado e control plane. O painel distingue estratégia, direção,
responsabilidade, integração/candidato, evidência externa, referência da decisão
e prova. Sinais de direction safety são advisory, sem enforcement de proposal/work.
Não adicionar skills ou outros projetos sem representação/evidência no registry.

## Aceite e estado

Implementado na branch isolada `codex/evolution-ux-v2`, worktree
`G:/anima/.worktrees/evolution-ux-v2`. Gates e limitações finais no
[registro da sessão](../registros/2026-10-02-evolution-ux-v2-akita-baseline.md).
Testes atuais preservados, com expectativas de contagem atualizadas para a
separação dos dois candidatos; testes novos cobrem direção, reuso, sequência,
responsabilidade e ausência de promoção indevida.

## Retomada / integração humana

Revisar esta branch e integrar somente por decisão humana. Reconciliar
`agency.codex-cli` com a entrega/prova do Claude no checkout principal antes de
qualquer promoção: esta worktree não observa nem presume a integração em WIP.
PRD é o único arquivo de estado vivo com potencial de conflito documental;
preservar ambas as atualizações na integração. Nenhum backend de coding ou
arquivo de work-orchestration faz parte deste delta.

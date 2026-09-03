# Reconciliação final do Plano 007

Retomada local em 2026-09-02; os eventos da prova anterior têm data UTC 2026-09-03.
Branch dev, HEAD inicial `9f214f8755a2663236df7e22a3df3d843d1f2c45`, já em origin/dev.
HEAD final: commit que contém este registro. Objetivo: fechar as pendências do mandato
sem repetir a execução terminal. Plano [007](../planos/007-replanejamento-apos-falha-deterministica.md).

## Correção append-only da evidência anterior

O [registro da prova viva](2026-09-03-replan-pin02-prova-viva-fallback-14b.md)
e o diagnóstico persistido no replan afirmam que serializeProjectIdeaV0 e
deserializeProjectIdeaV0 não existem na API. Isso é **incorreto** no checkpoint
executado: `git show 1ee1921:packages/core/src/project-intake.ts` mostra ambos os
exports, serialização por JSON.stringify e desserialização por JSON.parse seguida
de validateProjectIdea. A ausência de imports nos testes não implica ausência de
exports. draftProjectIdea + validateProjectIdea não substitui a prova do round-trip
de serialização. Histórico e diagnóstico persistido não foram reescritos.

Portanto, a falha observada de edição é real, mas a conclusão de limite do 14b
permanece hipótese: o plano recebido também continha uma premissa falsa. A novidade
estrutural de kind/symbols não valida a verdade semântica do diagnóstico. Essa é uma
limitação material da capability atual, não uma prova completa do objetivo central.

## Estado reconciliado por leitura autenticada

- Predecessor `5b8e371d-6ca9-453c-bbfe-693ae3266468`: failed, duas attempts,
  falha `b6783ef2`, retryable:false intacto.
- Replan `c7532a7a-4c97-48b8-a85f-a4a82ae8c05b`, lineage `4b63fe6b`:
  successor `7b132de5-8ca1-436e-9d23-e4317d59aaea`, failed, uma attempt de uma.
- Attempt `ab7e7b6f-258e-4637-b2e1-a9be60c810de`, falha `07664942`:
  ollama_ambiguous_replacement, âncora encontrada zero vezes; retryable:true
  **do filho** não altera a falha do predecessor nem fornece orçamento adicional.
- Gate `06bf8b1b`: focado exit 1, sem timeout/cancelamento; typecheck não observado.
  Seleção `c6be467c`: preferred qwen3-coder, selected qwen2.5-coder:14b, 16GB,
  preferred_exceeds_capacity. Nenhum result_submitted ou verifier_opinion_recorded.
- Git observado `b29b866f`, commit `967008e54fe890a3920af805384e1915aef7d524`:
  delta contra `1ee1921` = somente teste, +21 linhas. Implementação preservada.
  Branch histórica continua `1ee1921ec1c4dddfdfb74dfeb953d59e4a7e6083`.

## Fechamento desta retomada

Corrigido isolamento de duas assertions pgTAP: contagem/relação agora filtram o
predecessor da fixture. Com um replan real no banco, o teste anterior contava dois
registros e produzia subquery multirow. Nada foi apagado; transação de teste rollback.

Validação: pgTAP 22/22, core replan 29/29, application/classificação/CLI 65/65;
typecheck de todos os workspaces e git diff --check passaram.
PRD atualizado e atualização append-only do Plano 007. Nenhuma migration nova,
attempt, successor, aprovação ou execução real nesta retomada. Artifacts locais
`.worktrees/`, `.claude/settings.local.json`, `watch4-sensors.txt` preservados.
Publicação autorizada: somente fast-forward dev; main deve permanecer `99bec54`.

Próxima decisão humana: reconciliar diagnóstico com o checkpoint e investigar o
protocolo de edição antes de autorizar qualquer novo orçamento/execução. Não criar
outro replan automaticamente, não aceitar/integrar resultado e não abrir PIN-03.

# Reconciliação real do successor do Item 1

- **Data/tipo:** 2026-08-26 — prova read-only + correção de continuidade.
- **Objetivo:** validar/materializar a fatia mínima do Item 1 após publicar o boundary governado, sem duplicar lineage existente.
- **Branch / HEAD:** `dev` / `ad07202`, igual a `origin/dev`; `origin/main` em `99bec54`, intocada.
- **Baseline descoberto:** o original `0cedae21…` já possui lineage seq 1 `af7a2a42…` para successor `27c8d1ba…`. A fatia real coincide com o desenho governado: apenas `work-routing.ts` + teste, sem wiring, web, cloud ou autoridade financeira.
- **Estado do successor:** já foi `proposed`, aprovado pelo usuário, classificado, recebeu pedido autônomo separado e executou uma attempt `311ec98b…`; terminou `failed` em `ollama_read_round_limit`, com evidência do host. Estado atual `failed`, proposal v1, max attempts 2 (1 usado).
- **Decisão de segurança:** nenhuma seq 2 foi criada. Repetir a mesma fatia não é decomposição; ela já é mínima coerente (produção + teste). Alterar backend/provider/base/estratégia é mudança material do mandato e requer proposta/decisão própria. Retry simples ainda existe dentro do budget, mas a mesma causa de capacidade já ocorreu no original e no successor, então retry cego é inadequado.
- **Invariantes provados:** original permanece `failed` 2/2; successor permanece `failed` 1/2; lineage append-only e `satisfies_original_objective=false`; o Item 2 `b2930e81…` permanece `approved` e bloqueado pelo original. Nenhum work item, event, claim, attempt, budget, provider ou worktree foi criado nesta reconciliação.
- **Correção aos registros desta sessão:** o registro de candidato governado apontava materialização como próximo ponto porque a existência da lineage real ainda não havia sido consultada. Este registro a supersede factual e append-only; o código permanece válido e foi justamente o que impediu duplicação/ampliação.
- **Barreira humana:** escolher uma estratégia materialmente nova para a fatia mínima: (a) revisar o protocolo/budget do coder local; (b) usar backend local alternativo já selecionável, com nova proposta; ou (c) autorizar provider externo/custo. Sem essa decisão, o sistema deve parar fail-closed.


# Prova viva de correção de review por retomada

- **Data/tipo:** 2026-08-29 — desenvolvimento + prova viva.
- **Objetivo:** provar `changes_requested → successor → aprovação → resume → coder → gates → Verifier → review → completed` no item `71445254…`.
- **Branch / HEAD inicial:** `dev` / `8d9ed41`.
- **Resultado:** prova parcial; parou em `failed`, 3/3, antes do Verifier.

## Fatos persistidos

- original `71445254-c514-41c0-a86a-d9878f04e5e8` permaneceu `changes_requested`;
- checkpoint revisado `c89765a`, attempt `0aaf828c…`, resultado `e7209bf4…`;
- successor 1 `b62393f4…` falhou fechado ao confundir diff herdado com nova escrita;
- successor 2 `fafd7af1…` foi materializado como sequência 2, aprovado e executado;
- attempts `27236fa3…` e `870ea9b7…` produziram o mesmo teste fora do `describe`, gate falho e repair sem mudança;
- attempt `7bbfbd82…` retomou `755cf95` e terminou sem edit; orçamento 3/3 esgotado;
- nenhum resultado final, parecer do Verifier, review final ou `completed` foi fabricado.

## Correções implementadas

- classificação de successors usa lineage persistida para recuperar o planner, sem alterar o intent aprovado;
- escopo/no-op são medidos contra o estado inicial da attempt; evidência final continua contra a base original;
- novo successor pode ser criado após predecessor terminal, mantendo replay idempotente enquanto houver unidade ativa;
- retry governado prefere o checkpoint Git observado mais recente da attempt fonte, sem trocar a base autorizada.

## Provas e invariantes

- testes focados acumulados: classificação 6/6; executor + classificação 40/40; correção + executor + classificação 47/47; retry-checkpoint + executor 36/36;
- typecheck web verde após cada recorte; `git diff --check` verde (avisos CRLF do ambiente);
- `chat-surface.ts` manteve hash Git `8714ddc9…`, idêntico ao checkpoint `c89765a`;
- base auditável permaneceu `e54a59e`; nenhum merge, deploy, main, force-push ou limpeza de worktrees;
- modelo foi descarregado via keep-alive zero entre attempts para aliviar pressão; Ollama não foi encerrado.

## Bugs/lacunas observados

- card recém-materializado só apareceu após refresh; mudanças no card existente atualizaram sem refresh;
- `checkpoint.touchedResources` e evidência Git final listam também o arquivo herdado, embora ele não tenha sido escrito pela attempt; enforcement está correto, mas a apresentação ainda não distingue herdado de novo;
- o coder repetiu uma inserção lexicalmente inválida 2/2 e não conseguiu repará-la; a terceira attempt não editou.

## Efeitos externos e próximo ponto

- pushes permitidos somente para `origin/dev`; `origin/main` preservada.
- Próximo ponto exato: reproduzir o repair em seam isolado com o checkpoint `755cf95` e o diagnóstico real do gate, sem consumir unidade canônica; corrigir qualidade pós-edit antes de novo successor.

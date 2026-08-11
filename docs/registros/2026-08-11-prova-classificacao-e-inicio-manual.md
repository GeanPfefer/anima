# Prova viva — classificação de programação e início manual

- **Data da prova:** 2026-08-10
- **Data do registro:** 2026-08-11
- **Tipo:** prova
- **Branch observada:** `claude/integration-application-layer`
- **HEAD observado:** `44785fb`
- **Ambiente:** `G:/anima-local-test`, worktree detached preservada apenas como ambiente de prova

## Objetivo

Persistir a continuação da prova manual pós-correção da classificação de
capacidade e o comportamento observado ao iniciar manualmente um trabalho já
aprovado. Este registro descreve somente fatos observados; a análise técnica e
eventuais mudanças pertencem ao registro da sessão de desenvolvimento que o
referenciar.

## Classificação pós-correção

A mesma classe de tarefa explicitamente de programação que, no commit
`1fa67aa`, havia produzido `capability = research`, foi repetida pela interface
real após a atualização da worktree manual para `44785fb`.

Resultado observado em `44785fb`:

- proposta `v1`;
- `capability = programming`;
- `impact = structural`.

Assim, a prova viva confirma a correção da classificação
`programming explícito → programming`. O impacto permaneceu `structural`.

## Início manual e chamada posterior do Supervisor

Após a aprovação do item
`58159655-0213-41e0-bb5a-735f79a81bf6`, o operador acionou o botão **Iniciar
execução manual**. A chamada `POST /api/work-orchestration/start` respondeu
HTTP 200 e levou o item a `in_progress`.

Não foi observada evidência de claim, attempt, worktree ou invocação do coder
nesse passo.

Em seguida, a chamada:

```json
POST /api/work-orchestration/supervisor-turn
{
  "workItemId": "58159655-0213-41e0-bb5a-735f79a81bf6",
  "expectedProposalVersion": 1
}
```

respondeu HTTP 200 com:

- `outcome = no_eligible_work`;
- reconciliação do mesmo item com `finding = attempt_missing`;
- `action = requires_human`;
- `itemState = in_progress`;
- `claimId = null` e `attemptId = null`.

As tentativas anteriores feitas com payload incorreto foram exploração manual e
**não constituem bug**.

## Limites e segurança

- A prova não demonstrou chamada do executor autônomo.
- Nenhum resultado foi registrado ou aceito.
- Nenhuma integração, publicação, push, PR, merge ou deploy foi realizado.
- `G:/anima-local-test` permanece evidência do operador e não foi modificada por
  esta sessão de desenvolvimento.


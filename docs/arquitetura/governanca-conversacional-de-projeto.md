# Governança Conversacional de Projeto V0

## Fronteira

`CONVERSA ≠ PROPOSTA ≠ RATIFICAÇÃO ≠ BACKLOG ≠ EXECUÇÃO`.

Exploração, hipótese e preferência vaga permanecem no chat. Uma preferência
humana explícita e substancial pode originar uma proposta imutável em
`awaiting_confirmation`; isso ainda não é decisão. Somente a RPC autenticada,
associada a exatamente uma proposta/versão e a uma mensagem humana, registra o
evento append-only `ratified`.

## Persistência e lifecycle

- `project_decision_proposals`: conteúdo mínimo estruturado, versão,
  proveniência, idempotência e relação opcional com versão anterior.
- `project_decision_events`: `proposal_created`, `ratified`, `rejected` ou
  `changes_requested`, com actor, versão, proveniência e chave idempotente.
- `project_decision_proposal_state`: projeção RLS do estado, nunca fonte mutável.

Propostas e eventos não aceitam escrita direta do cliente. RPCs `SECURITY
DEFINER` com `search_path` fixo derivam `auth.uid()`, verificam ownership,
versão, estado terminal e replay. Um índice parcial garante uma única resolução
terminal mesmo sob concorrência. Revisão encerra a versão antiga; a nova proposta
referencia `supersedes_id`, incrementa versão e exige nova confirmação.

## Autoridade e conversa natural

O detector puro é conservador: perguntas e linguagem incerta continuam conversa;
uma preferência explícita pode gerar a pergunta natural “Só para confirmar… É
isso?”. `sim`/rejeição/revisão só têm efeito com uma proposta pendente única; com
duas, o host pede esclarecimento. Provider pode futuramente ajudar a estruturar,
mas não chama RPC, não define `actor=user` e não ratifica.

A proposta guarda o enunciado necessário e provenance, não transcript, prompt,
chain-of-thought ou output bruto. A mensagem de origem continua no substrate
normal `ai_conversations`; a decisão apenas referencia seu ID na proveniência.

## Efeito da ratificação

Ratificar cria exatamente um evento de decisão. Não cria `work_item`, não altera
`work_focus`, não aprova trabalho, não aciona coder/Supervisor, não muda arquivos,
configuração, infraestrutura ou docs canônicos.

Direção futura, não implementada: `Ratified Project Decision → Backlog Proposal
→ confirmação humana inicial → criação de backlog → infraestrutura autônoma`.

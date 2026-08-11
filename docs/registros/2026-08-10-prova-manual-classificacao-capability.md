# 2026-08-10 — Prova manual: classificação de capability `programming → research`

**Tipo:** prova viva (defeito observado). **Autor da prova:** operador (Gean), em
instância web local. **Registrado por:** agente, a partir do relato do operador.

> Este registro é **evidência do observado**, não um diagnóstico. A hipótese de
> causa ao final **não está comprovada** e será investigada separadamente (ver
> [Fase 1](2026-08-10-investigacao-classificacao-capability.md), quando existir).

## Contexto / ambiente

- Worktree: `G:/anima-local-test` (ambiente de prova manual do operador).
- HEAD (detached): `1fa67aa`.
- Web local: porta `3200`. Supabase/config local funcional.
- Interface real do chat do Anima (fluxo real: chat → proposta → decisão humana →
  futura execução).

## Tarefa usada

Implementar em `apps/web` um endpoint de desenvolvimento `GET /api/dev-readiness`,
**somente leitura, sem secrets, com testes e typecheck**. A mensagem declarava
explicitamente ser uma tarefa de programação e, em algumas reproduções, chegou a
declarar literalmente `capacidade: programming`.

## Esperado

Um pedido inequívoco de implementação de código deve resultar numa proposta
classificada como **`capability = programming`** (e um `impact` coerente com um
endpoint somente-leitura, não `structural`), permitindo o roteamento para o
executor de programação. O usuário **não** deveria precisar escrever o enum à mão.

## Obtido (4 reproduções)

| # | Provedor/modelo | Entrada relevante | `capability` | `impact` | Desfecho |
|---|---|---|---|---|---|
| 1 | GPT | tarefa de programação (endpoint `GET /api/dev-readiness`) | `research` | `structural` | rejeitada |
| 2 | GPT (revisão "Pedir correção") | pediu explicitamente capability `programming`, execução em worktree, backend de programação, testes, typecheck → gerou v2 | `research` | `structural` | rejeitada |
| 3 | GPT (proposta nova do zero) | mensagem começando com `Tarefa de programação.` e contendo `capacidade de execução: programming` | `research` | `structural` | rejeitada |
| 4 | modelo local | tarefa explicitamente de programação incluindo `capacidade: programming` | `research` | `structural` | não aprovada |

Detalhes por reprodução:

- **Repro 1 (GPT).** A proposta afirmava que incluiria apenas entender/delimitar o
  pedido e **não executar código antes da aprovação** — inadequado para a tarefa
  enviada, que era de implementação.
- **Repro 2 (revisão).** O operador usou "Pedir correção" solicitando explicitamente
  capability `programming`, execução em worktree, backend de programação, testes e
  typecheck. Foi gerada a **v2**. A solicitação apareceu **anexada/incorporada ao
  texto** da proposta, mas a **capability não foi recalculada** (permaneceu
  `research`/`structural`). A proposta foi rejeitada.
- **Repro 3 (nova do zero, GPT).** Mesmo com a mensagem começando por `Tarefa de
  programação.` e contendo `capacidade de execução: programming`, o resultado
  permaneceu `research`/`structural`. Rejeitada.
- **Repro 4 (modelo local).** Trocando o Anima da opção GPT para a opção/modelo
  local e reenviando uma tarefa explicitamente de programação (com `capacidade:
  programming`), o resultado permaneceu `research`/`structural`. Não aprovada.

## Impacto

- Um pedido inequívoco de implementação **não consegue** ser classificado como
  `programming` pelo fluxo do chat, o que impediria o roteamento correto para o
  executor de programação (worktree/coder).
- "Pedir correção" **versiona/altera o conteúdo** da proposta, mas — ao menos nesta
  prova — **não recalcula a classificação** de capability.
- Nenhuma proposta incorretamente classificada foi aprovada; **nenhum
  executor/worktree/coder foi disparado** por estes testes. Não houve efeito no
  código-alvo nem no repositório.

## Reprodução cruzada (o que ela reduz)

Reproduzir com **GPT E com modelo local** reduz fortemente a hipótese de ser um
comportamento específico de um provider/modelo de conversa. Aponta para um defeito
em **alguma etapa da cadeia** do produto — a investigar sem pressupor onde:

> chat (entrada) → interpretação → proposta → parser → classificação →
> persistência → projeção → UI → routing.

## Hipótese (NÃO comprovada)

Há evidência de que a classificação de capability não reflete um pedido
inequívoco de programação, e de que a revisão de proposta não a recalcula. **A
localização exata do defeito na cadeia ainda não foi comprovada no código** — pode
estar em default fixo, parser, prompt/schema, normalização, criação/revisão da
proposta, persistência, projeção ou routing. Não tratar isto como causa raiz até a
investigação por evidência no código.

## Próximo passo

Investigar a cadeia real de classificação de capability no código (Fase 1),
começando por uma **reprodução automatizada** que demonstre objetivamente o
comportamento incorreto no nível apropriado, e só então corrigir a causa raiz — não
o sintoma na UI. Tratar o comportamento de "Pedir correção" separadamente: decidir
pelo contrato do produto se a revisão deve recalcular a classificação; se for
decisão de produto não ratificada, marcar `BLOCKED_BY_HUMAN_DECISION` e corrigir
apenas o defeito inequívoco da classificação inicial.

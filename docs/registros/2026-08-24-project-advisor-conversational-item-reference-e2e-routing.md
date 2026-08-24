# E2E de referência conversacional — falha de roteamento em T1

- **Data / tipo:** 2026-08-24 — prova viva inválida e correção determinística.
- **Branch / HEAD inicial:** `dev` / `4757e995e3f2d6b1c32c1e8fa4d160a835c15d18`.
- **Resultado local:** `PROJECT_ADVISOR_CONVERSATIONAL_ITEM_REFERENCE_V0_LOCAL = PASS`.
- **Resultado E2E:** `PROJECT_ADVISOR_CONVERSATIONAL_ITEM_REFERENCE_V0_E2E = NOT_PROVEN`.

## Evidência da tentativa

T1, “Como está o projeto?”, foi enviada uma única vez pela UI real. O detector
não a reconheceu como Project Advisor: o request seguiu o chat pessoal comum,
consumiu uma chamada OpenAI e persistiu o par usuário/assistente em
`ai_conversations` (`189 → 191`). A resposta não apresentou UUIDs, portanto não
existiam referências A/B e T2, T3 e T4 não foram executados. Não houve retry.

Consulta read-only confirmou que as duas linhas pertencem à conta da UI e
correspondem à pergunta e resposta observadas, sem expor o conteúdo. Os demais
contadores permaneceram em `work_items=60`, `work_events=601` e `work_focus=2`;
Git e `origin/main` permaneceram intactos. As linhas não foram apagadas: são
evidência legítima da rota pessoal incorreta, não mutação produzida pelo Advisor,
cuja bifurcação nunca foi alcançada.

## Causa e correção

`isProjectAdvisorQuestion` reconhecia a formulação longa sobre “desenvolvimento
do Anima”, mas não a frase curta prevista pelo próprio roteiro. A correção mantém
o detector conservador e ancora somente consultas de estado ao próprio
`projeto`, `projeto Anima` ou `Anima`; menções genéricas a começar ou conversar
sobre um projeto continuam no chat comum.

A regressão da rota comprova que a bifurcação do Advisor vem antes do provider
pessoal, dos detectores e de `ai_conversations`, contém apenas leituras de
`work_items`, `work_events` e `work_focus`, declara mutation `none` e não contém
coder, backlog ou RPC de escrita.

## Gates e segurança

- Core focado (Advisor, referência conversacional e drill-down): 66/66.
- Web focado (rota, cliente, Context Builder e provider/validator): 29/29.
- Typecheck dos cinco workspaces: PASS.
- Build web: 56 páginas, com `next dev` parado: PASS.
- `git diff --check`: PASS.
- Nenhum novo egress, retry, browser automation, coder, workflow ou escrita no
  banco ocorreu depois da tentativa inválida.

## Próximo ponto exato

Com nova autorização externa, reiniciar a prova: “Como está o projeto?” →
confirmar dois UUIDs apresentados e zero persistência pessoal → “Me fale mais
sobre o primeiro.” → “E o segundo?”. Se a apresentação real deixar dois
candidatos plausíveis, “E esse?” deve pedir esclarecimento local com zero
provider. Não executar esses turnos sem nova autorização.

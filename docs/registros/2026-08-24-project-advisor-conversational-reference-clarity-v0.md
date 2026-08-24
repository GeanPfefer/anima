# Clareza de referências conversacionais do Project Advisor V0

- **Data / tipo:** 2026-08-24 — desenvolvimento e prova local determinística.
- **Branch / HEAD inicial:** `dev` / `eb1c84230a3d31e0718436ff72b34a1abcb0f532`.
- **Resultado:** `PROJECT_ADVISOR_CONVERSATIONAL_REFERENCE_CLARITY_V0_LOCAL = PASS`.

## Causa e correção

A resolução, RLS e projeção fresh já estavam corretas, mas o Context Builder
recebia como pergunta a mensagem anafórica original do usuário. Embora somente o
item resolvido atravessasse nas fontes, `“o primeiro”`/`“o segundo”` ainda dava ao
provider material para discutir uma interpretação que o host já havia encerrado.

O seam foi reduzido sem memória nova: depois da resolução e da leitura fresh, o
host cria uma pergunta governada com o UUID definitivo, informa que a identidade
foi resolvida deterministicamente e proíbe reinterpretar referência original,
ordinais, anáforas ou candidatos. A mensagem original não atravessa esse boundary.
As fontes continuam sendo somente estado tipado e evidência tipada do item; RLS,
freshness, schema, parser e validador semântico não mudaram.

## Provas e gates

- Core focado — Advisor, drill-down e referências: 69/69.
- Web focado — rota, cliente, Context Builder e provider: 29/29.
- A pergunta governada contém apenas o UUID resolvido e nenhuma referência ao
  primeiro/segundo, outro UUID ou lista de candidatos.
- A rota usa a pergunta governada depois da leitura RLS fresh; ambiguidade ainda
  retorna antes de construir contexto ou chamar provider.
- Typecheck dos cinco workspaces: PASS.
- Build web: 56 páginas, com `next dev` parado: PASS.
- `git diff --check`: PASS.

## Segurança e limites

Nenhuma chamada OpenAI/outro provider, browser automation, banco, memória,
migration, backlog, foco, coder ou workflow foi acionado. Nenhum contexto bruto
novo foi introduzido; o egress conceitual foi reduzido pela retirada da anáfora
original. E2E não foi executada nem autorizada neste recorte.

## Próximo ponto exato

Uma prova futura de apresentação, se desejada e autorizada separadamente, pode
repetir overview → primeiro/segundo e verificar que a resposta vai diretamente
ao item, sem ressalva de interpretação. Nenhuma fronteira de escrita foi aberta.

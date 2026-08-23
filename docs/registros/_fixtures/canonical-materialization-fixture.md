# Fixture — prova do materializer canônico (NÃO é backlog real)

Documento de FIXTURE controlada usado apenas para provar o mecanismo de materialização.
Contém UM candidato `not_started`, sem dependências, com objetivo simples e seguro.
NÃO é consumido pela descoberta do backlog real (a rota lê só o documento apontado).

## FIX — Fixture

### FIX-01 — Criar o arquivo docs/registros/_scratch-fixture-materializer.md com uma unica linha de rascunho

- **Status:** not_started
- **Objetivo:** Criar exclusivamente o arquivo `docs/registros/_scratch-fixture-materializer.md` contendo uma unica linha de texto de rascunho. Nao altere nenhum outro arquivo. Nenhum codigo TypeScript.
- **Dependências:** (nenhuma)
- **Escopo incluído:** docs/registros/_scratch-fixture-materializer.md
- **Critério de validação:** npm run typecheck --workspace=@anima/web

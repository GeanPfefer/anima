# Backlog dedicado — INV-01 — Investigation Sessions Self-Audit

Documento de backlog canônico com UM único candidato. INV-01 NÃO é um SDC e NÃO é programação: é a primeira INVESTIGAÇÃO real
(effect_class `read_only`, executor `investigation-v1`, backend `codex-cli`) conduzida pelo control-plane após a integração do SDC-10
(núcleo) e do SDC-11 (fiação) em `2d8546f`. O materializer canônico lê só o documento apontado; este arquivo não altera os documentos 009–024.

## INV — Investigations

### INV-01 — Investigation Sessions Self-Audit

- **Status:** not_started
- **Objetivo:** Responder, a partir EXCLUSIVAMENTE do snapshot do repositório no commit 2d8546f00ad60a8ee66a99142cce711b93b0e077 (somente leitura; sem web, sem browser, sem banco, sem EXEC com efeito colateral), a pergunta: "Qual é o estado atual do suporte a Investigation Sessions no ANIMA após SDC-10 e SDC-11, quais partes estão comprovadamente operacionais no control-plane e quais limitações ainda permanecem?". Produza um InvestigationResultV1 honesto: cada finding com statement, status epistêmico (established | inferred | undetermined) e evidência rastreável (file_at_commit ou commit); declare gaps (o que não pôde ser determinado a partir do snapshot) e o outcome (conclusive | partial | inconclusive). NÃO altere nenhum arquivo, NÃO crie branch, commit ou diff e NÃO afirme como established o que depende de execução ao vivo que o snapshot não prova.
- **Dependências:** (nenhuma)
- **Escopo incluído:** (somente leitura do snapshot do repositório em 2d8546f; nenhuma escrita)
- **Fora de escopo:** qualquer escrita, web, browser, banco de dados arbitrário, execução com efeito colateral.
- **Critério de validação:** revisão humana do InvestigationResultV1 e do parecer advisory
- **Tentativas:** max_attempts = 1; max_duration_minutes = 30
- **Verifier:** verifier_requirement = advisory
- **Aceite:** O resultado é um InvestigationResultV1 válido cujos findings referenciam evidências que resolvem no snapshot 2d8546f.
- **Aceite:** Nenhuma branch, commit, diff ou handoff de candidate é produzido.

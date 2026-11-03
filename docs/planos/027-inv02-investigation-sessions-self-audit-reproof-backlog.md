# Backlog dedicado — INV-02 — Investigation Sessions Self-Audit Reproof

Documento de backlog canônico com UM único candidato. INV-02 NÃO é um SDC e NÃO é programação: é a segunda INVESTIGAÇÃO real (reprova do INV-01 após o SDC-12)
(effect_class `read_only`, executor `investigation-v1`, backend `codex-cli`) conduzida pelo control-plane após a integração do SDC-10
(núcleo) e do SDC-11 (fiação) em `a173f40`. O materializer canônico lê só o documento apontado; este arquivo não altera os documentos 009–024.

## INV — Investigations

### INV-02 — Investigation Sessions Self-Audit Reproof

- **Status:** not_started
- **Objetivo:** Responder, a partir EXCLUSIVAMENTE do snapshot do repositório no commit a173f40e2d0fce78d674e89103f2854c84d3ac9f (somente leitura; sem web, sem browser, sem banco, sem EXEC com efeito colateral), a pergunta: "Qual é o estado atual do suporte a Investigation Sessions no ANIMA após SDC-10 e SDC-11, quais partes estão comprovadamente operacionais no control-plane e quais limitações ainda permanecem?". Produza um InvestigationResultV1 honesto: cada finding com statement, status epistêmico (established | inferred | undetermined) e evidência rastreável (file_at_commit ou commit); declare gaps (o que não pôde ser determinado a partir do snapshot) e o outcome (conclusive | partial | inconclusive). NÃO altere nenhum arquivo, NÃO crie branch, commit ou diff e NÃO afirme como established o que depende de execução ao vivo que o snapshot não prova.
- **Dependências:** (nenhuma)
- **Escopo incluído:** (somente leitura do snapshot do repositório em a173f40; nenhuma escrita)
- **Fora de escopo:** qualquer escrita, web, browser, banco de dados arbitrário, execução com efeito colateral.
- **Critério de validação:** revisão humana do InvestigationResultV1 e do parecer advisory
- **Tentativas:** max_attempts = 1; max_duration_minutes = 30
- **Verifier:** verifier_requirement = advisory
- **Aceite:** O resultado é um InvestigationResultV1 válido cujos findings referenciam evidências que resolvem no snapshot a173f40.
- **Aceite:** Nenhuma branch, commit, diff ou handoff de candidate é produzido.

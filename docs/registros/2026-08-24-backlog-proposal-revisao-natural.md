# Backlog Proposal V0 — roteamento de revisão natural

- **Data / tipo:** 2026-08-24 — bugfix e prova local determinística.
- **HEAD inicial:** `dd9c0f26885278f6f7fe97199e16addb0b8f946c`.
- **Resultado:** `BACKLOG_PROPOSAL_NATURAL_REVISION_ROUTING_V0_LOCAL = PASS`.

A E2E parou após uma reformulação longa (“A decisão fica assim…”) cair no chat
comum: a V1 permaneceu pendente e uma chamada OpenAI foi consumida sem efeito
governado. Nenhuma V2, materialização ou trabalho foi criado.

A correção substitui o gatilho lexical da rota por classificação pura e
contextual. Confirmação e rejeição exigem evidência inequívoca; perguntas e
acknowledgements permanecem conversa; revisão exige verbos de mudança,
contraste normativo ou reformulação estruturada; expansão de autoridade pede
esclarecimento. Mais de uma proposta também encerra antes do provider.

A V2 determinística futura é reconstruída somente da decisão ratificada e da
mensagem humana: política local-first por capacidade/custo, gate humano antes de
compute pago e auditoria de autorização/custo; auto-provisioning permanece fora.
A resposta OpenAI inválida, “cloud sem custo”, acesso a arquivos e melhoria de
código não são fontes autoritativas.

Gates: core 55/55; web pertinente 36/36; referência conversacional 23/23;
rota/chat 25/25; typecheck cinco workspaces; build Next 56 páginas; diff check.
Sem DB/schema change, pgTAP não foi repetido. Nenhum novo egress ou E2E.

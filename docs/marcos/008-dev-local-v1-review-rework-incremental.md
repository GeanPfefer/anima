# Marco 008 — Dev Local V1 + review/rework incremental completo

> 2026-08-30 · Marco append-only de maturidade operacional.

O Anima completou ao vivo o primeiro ciclo de desenvolvimento local com revisão e
retrabalho incremental governados de ponta a ponta. Um resultado em revisão recebeu
correções; o successor retomou o checkpoint Git durável, preservou byte a byte a
implementação já verificada, alterou apenas o teste restante, atravessou reparo interno
e gate host-side até verde e voltou a `review`.

O fechamento exigiu tornar explícitas duas verdades simultâneas: a proveniência completa
do resultado continua sendo o diff contra a base originalmente autorizada; o enforcement
de escopo da attempt retomada usa somente o delta contra o checkpoint no qual ela começou.
As duas evidências permanecem auditáveis. Uma opinião `rejected` gerada antes dessa
distinção não foi apagada: nova evidência host-observed produziu uma nova opinião
`verified`, ambas append-only.

O usuário aceitou o resultado no cartão do chat, levando o item a `completed`. Isso não
autorizou nem executou integração, publicação, merge ou deploy. O marco prova a cadeia:

`review → changes_requested → successor governado → resume checkpoint → coder → edit
incremental → gate → repair → gate verde → evidência host-observed → Verifier → review
→ aceite humano → completed`.

Este marco encerra o recorte **Dev Local V1**. Ele não transforma o Verifier em autoridade
de aceite e não promove efeitos externos: a decisão final continua humana no estado atual
de maturidade. O próximo horizonte pode investigar Execution Placement V0 / Cloud Burst,
mantendo a Goma como ambiente principal e delegando sob demanda apenas gargalos pesados.

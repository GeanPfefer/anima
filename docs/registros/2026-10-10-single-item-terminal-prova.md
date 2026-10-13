# 2026-10-10 — Prova PostgreSQL focal do terminal Single-Item

Tipo: prova real. [Plano 055](../planos/055-single-item-codex-wsl-integration.md).
Branch dev; HEAD inicial/final `6bc4aadef9414d655600c2ea37c6be436b3628c8`.
Índice vazio, 46 worktrees e WIPs preservados; nenhum commit ou integração.

Um único descartável novo, executado e encerrado, sem remoção:
`9b52f214b4d6e208f4409b6be55abf335783473c2a373f995e0ffab528f62b29`.
Cluster `7695112257510338691`; banco
`anima_single_item_proof_236849bc4c184b2caf14bc026b697ed6`.
Imagem pinada `sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b`.

Preflight: 2.484 arquivos 052r2, 556 hashes de bootstrap, migrations e guard
íntegros; Git Windows conferido; DB/Auth saudáveis. RAM livre inicial Windows
5.058.160 KiB. Rede none, sem portas/binds/volumes persistentes, rootfs read-only,
cap-drop ALL, no-new-privileges; PGDATA/socket tmpfs; 1 CPU, 1 GiB RAM e RAM+swap total (sem swap adicional),
64 PIDs. Guard Docker inspect + mountinfo antes de initdb e nas operações.
Amostra durante bootstrap: 80,57 MiB; não é medição de pico ou throughput.
Vector admitido apenas como falha preexistente independente, não como saudável.

Bootstrap 272/272. Aplicadas exclusivamente as candidatas `20261010000000` e
`20261010000001`, em uma transação. Nenhuma candidata 20261009 aplicada por arrasto.
Comparador/executor 052 existentes reutilizados, sem outro mecanismo de catálogo.

**Catálogo GO:** 279 funções antes/depois, sem extras. Só cinco corpos mudaram:
release_work_claim, start_claimed_work_attempt, private.begin_work_attempt,
record_commanded_work_terminal e private.release_mandated_result. OIDs/identidades,
assinaturas, ownership, ACL/grants, RLS, policies, triggers, constraints, índices,
schemas, extensões/membership e demais atributos protegidos preservados.
Catálogo integral novamente GO após os testes, sem novas diferenças.

| Prova | Resultado |
|---|---|
| Terminal result/error/cancelled com now() anterior a created_at e updated_at | 3 PASS |
| Replay do terminal, sem novo evento nem alteração da linha | PASS nos 3 casos |
| Verifier obrigatório: in_progress → review, replay e liberação própria | PASS |
| Conflito de terminal e rollback integral | Recusa esperada 55000 |
| Terminal por outro usuário | Recusa esperada P0002 |
| Allowlist revogada antes da chamada | Recusa esperada 42501 |
| Verifier direto por humano e helper privado sem EXECUTE | 2 recusas esperadas 42501 |
| Item, eventos e claim vencido de terceiro | Inalterados nos 3 casos positivos |

Total: **8 cenários focais PASS**, cinco deles recusas esperadas. Controle
adversarial temporal usa timestamps válidos persistidos à frente do wall clock;
uma atribuição direta antiga updated_at=now() reproduziu 23514, capturado em
subtransação, nos três controles. As funções candidatas não produziram 23514.
Exemplo UTC: transação 18:55:07.950933; created 19:55:07.950933;
priorUpdated e terminalUpdated 20:55:07.950933. Não houve alteração do relógio.
Não é repetição da campanha antiga nem demonstração de causa de relógio do host.

Orçamento histórico: somente a suíte de 12 asserções local/externo foi repetida:
8 PASS e **4 FAIL (1,2,6,10)**, exatamente iguais à prova anterior. Nenhuma
expectativa/fixture/política alterada; não classificados como PASS.

Cleanup: snapshots das dez tabelas de fixture iguais ao estado vazio inicial;
zero sessões de cliente no banco antes do shutdown. PostgreSQL encerrou com
container exit code 0, sem OOM/restart; docker exec pg_ctl retornou 137 pelo
término do PID 1, confirmado independentemente pelo inspect. Tmpfs perdido após
stop, como previsto. 24 containers anteriores preservados; DB/Auth metadados
inalterados e healthy; redes/volumes e daemon estáveis. Só State/RestartCount do
Vector variaram autonomamente. Nenhum SQL ou credencial do residente utilizado.

**GO para revisão humana de promoção do delta focal.** Não é autorização de
instalação ou execução. O parecer verified usado é sintético, registrado pela
porta de writer de teste existente: não executamos Codex WSL ou Verifier TS.
Terceiro desta prova pertence a outro owner; concorrência entre itens do mesmo
owner e locks permanecem na cobertura anterior, não repetida. Revogação durante
espera e caminhos temporais de decisão/controle/interrupção de orçamento não
foram certificados aqui. Quatro FAIL históricos e deadlocks adversariais anteriores
continuam visíveis; nenhuma garantia global é inferida.

[Evidências reproduzíveis e hashes](2026-10-10-single-item-terminal-prova-evidencias):
preflight, scripts adaptados do transporte anterior, 272 payloads/ledger, catálogo
raw, SQL/stdout/stderr/SQLSTATE por caso, cleanup, logs e estado final.
230 arquivos protegidos permaneceram idênticos. Gate Single-Item intacto;
nenhuma attempt real, Host, proposta/classificação residente, recovery OpenAI,
orçamento, API paga ou migration residente tocada.

Checkpoint: revisão humana conjunta das duas candidatas e dos limites acima.
Não executar migration up genérico, abrir gate ou iniciar self-dev por inferência.

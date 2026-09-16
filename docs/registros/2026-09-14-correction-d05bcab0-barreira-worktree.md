# 2026-09-14 — Correction d05bcab0: barreira pré-provider na worktree

## Tipo e objetivo

Sessão de orquestração governada para conduzir a correction
`d05bcab0-1a2a-4717-ba65-21d4bc2c1b77` até `review` ou a primeira barreira real,
com uma única attempt OpenAI `gpt-5.6-terra`, sem RunPod, integração, merge, push ou deploy.

## Estado reconciliado

- Branch `dev`; HEAD inicial/final `b14a32c1d7ca1d361f1a3c1519e2fbec351a0669`.
- `origin/main` `99bec54e3ab42bfe882a8686cd1385d8058b916e`, intacta.
- Correction inicialmente `proposed` v1, lineage `9de6a432-7728-4775-a4cd-d80d1fd490f9`,
  recovery sequence 1, base `ccb7dccd6ffa25d65ce443657eddb7c97dd4b6fe` e retomada de
  `61eb2eb7ab1b4091e1a53604ef11b560ef99561f` na branch da attempt rejeitada.
- Predecessor `dae3be71-412d-4730-92ac-bf25b36af758` permaneceu `changes_requested`.

## Efeitos canônicos

- Approval v1 persistido pela lifecycle canônica.
- Classification canônica persistida: low/normal/bounded/clear/reversible; policy
  `human-approved-project-planner-v1`; nenhuma política foi alterada.
- Nova authority exclusiva `c922b5be-9d26-4035-9405-af5f99a9f12a`: OpenAI,
  `provider_api:gpt-5.6-terra`, USD 1,50, 30 minutos, válida até o limite autorizado.
- Exatamente uma attempt criada: `9ae76ffc-3871-436a-9889-503a00fd9926`.

## Barreira e causa operacional

A attempt terminou `execution_failed`, checkpoint `worktree-create-failed`, durante
`GitWorktree.create`, antes de reservar compute e antes de chamar o coder. O invocador ad hoc
foi iniciado com cwd `G:\anima`; o caminho in-process existente pressupõe cwd `apps/web` para
`projectRoot()`. Isso reproduz a classe de falha já documentada no PRD em 2026-08-28: a raiz
resolvida não é o repositório esperado e `git worktree add` falha. A mensagem canônica ficou
sanitizada/truncada após `fatal: cannot…`, mas não houve branch nem worktree para a attempt.

## Financeiro, provas e segurança

- Nova authority: reserved 0, committed 0, remaining USD 1,50; nenhuma reservation/evento de budget.
- Authority antiga `1447ebcd-7635-4567-b785-007e3512ca72` e reservation antiga
  `aa692acb-95c5-4b24-aebf-b94c76cd680d` permaneceram intocadas; a reserva antiga segue aberta,
  não liquidada, USD 1,50, `costSource=null`.
- Provider call: nenhuma. Usage: ausente. Custo factual: USD 0 de exposição realizada; nenhum
  settlement e nenhum `cost_unknown` novo porque não houve reservation nem usage terminal.
- Nenhum arquivo do escopo foi alterado pela attempt; nenhum output commit foi criado.
- Nenhum gate ou Verifier rodou; B1/B2/B3 não foram avaliados nem satisfeitos pelo output.
- RunPod e Ollama não foram acionados; `origin/main` não foi tocada.

## Estado final e retomada

Item `failed` v1; claim liberado com `attempt_finished`; sem retry automático porque a autorização
humana limitou a execução a exatamente uma attempt. A sessão para na barreira real pré-provider.
Retomada exige nova decisão humana e novo successor/authority; se autorizada, o invocador deve ser
executado com cwd `G:\anima\apps\web`. O follow-up separado `task_dfd925f9` permanece fora do escopo.

# 2026-09-10 — Prova live RunPod capability-based: timeout SSH com teardown confirmado

- **Tipo:** prova viva.
- **Objetivo:** executar uma única volta canônica cloud self-hosted do Work Item
  `8a2515d8-6967-463e-af2a-fd5d2b5e42a1`, com qwen3-coder remoto, até `review` ou barreira real,
  sempre destruindo o recurso.
- **Git:** branch `dev`; HEAD inicial/final `d783a5dc495da692eb7097f7c7252bb5ba074e51`;
  `origin/dev=4ab99acf80ec69156f7155e203da1bd46dd96529`;
  `origin/main=main=99bec54e3ab42bfe882a8686cd1385d8058b916e`, intacta.
- **Commits/push:** nenhum. WIP amplo preexistente preservado; nenhum reset/stash/drop.

## Reconciliação e autoridade

- Migration `20260910000000_paid_compute_capability_scope` aplicada local e remotamente;
  tipos atuais contêm `capability_scope` e `p_attempt_id` opcional.
- Item: `approved`, proposal v2, sem claim aberto e sem `execution_started`/attempt.
- RunPod autenticou com a credencial atual sem expô-la; leitura inicial: zero Pods.
- Authority SKU-fixed `c1c3c608-cf2b-4b79-8828-c291e72b5431` estava ativa e tinha
  US$ 1,50 comprometidos historicamente. Foi revogada pelo RPC canônico; ledger preservado.
- Nova authority `3b87224f-071f-486d-88b8-a9dfe0259747`: `provider=runpod`, `node_id=NULL`,
  `resource_class=NULL`, item-scoped, 1.800.000 ms, teto agregado USD 1,50 e
  `capability_scope={minimumVramGiB:24,requiredGpuFeatures:[cuda],maxHourlyPrice:{currency:USD,amount:0.55},maxNodes:1}`.
  Releitura confirmou ativa, não revogada e ledger inicialmente vazio.

## Matching e benchmark observado

- Estratégia/provider/modelo: `cloud_self_hosted` / RunPod / `qwen3-coder:latest` via Ollama.
- Requisitos: 24 GiB VRAM, CUDA, 1 node, até US$ 0,55/h e US$ 1,50 total.
- Inventário SECURE: A40 48 GiB US$ 0,49/h selecionada; RTX A6000 sobreviveu como alternativa
  dentro do teto; L40S US$ 1,09/h e A100 80 GB PCIe US$ 1,59/h rejeitadas.
- Ranking: requisitos → disponibilidade → authority → budget → menor custo estimado → menor
  excesso de VRAM → disponibilidade → desempate estável.
- Reserva autoritativa: US$ 0,245 (30 min × US$ 0,49/h), reservation
  `94641959-9bc6-46fd-8810-5bc943b6bc0b`. Permanece comprometida conservadoramente.
- Pod: `9jcybkmvb9c39k`, nome `anima-runpod-a40-test2`, exatamente 1 node, US$ 0,49/h.
- Erro exato: `ssh` exit 255, `connect to host 194.68.245.239 port 22068: Connection timed out`;
  superfície canônica: `provider_unreachable` / `coder_node_unavailable`.
- Attempt/coder/read rounds/edits/retries/gate/Verifier: nenhum; falha pré-claim e pré-attempt.
  `prompt_eval_count`/`eval_count`: não produzidos. OpenAI coder = 0; Anthropic coder = 0.
- Duração faturável estimada pelo lifecycle: ~605,87 s; custo estimado até confirmação do destroy:
  US$ 0,082466. O ledger registra exposição reservada, não settlement final.

## Teardown e estado terminal

- Eventos: `provision_requested` seq 51597; `provider_identified` 51598;
  `shutdown_requested` 51599; `shutdown_confirmed` 51600.
- Leitura final RunPod: HTTP 200, zero Pods.
- Work Item permaneceu `approved v2`; não houve `review`, accept, integrate, merge, publish ou deploy.
- `RUNPOD_AUTOPROVISION_END_TO_END = FAIL` no estágio túnel SSH. O teardown passou.

## Próximo ponto exato

Investigar por que o endpoint TCP SSH publicado não ficou alcançável apesar do Pod RUNNING
(bootstrap early-sshd, port mapping e networking RunPod). Não iniciar outra prova paga nem criar
nova reserva até haver uma correção/prova local focal que reduza esse risco.

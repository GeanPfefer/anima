# 2026-09-11 — A/B vivo do bootstrap RunPod: CONTROLE (golden minimal) vs TRATAMENTO (canonical hardened)

- **Tipo:** prova viva PAGA (GO humano explícito), 2 Pods, um por vez, teardown garantido.
- **Git:** branch `dev`; HEAD inicial/final `d783a5dc495da692eb7097f7c7252bb5ba074e51` (nenhum commit).
  `origin/main` `99bec54` intacta. WIP preservado (migration `20260910000003` + patch `tunnel_unavailable`).
  Sem reset/stash/drop. `.env.local` não editado.
- **Objetivo:** isolar se a regressão endpoint/TCP/SSH vinha do bootstrap canônico ou da variabilidade
  do RunPod SECURE, comparando o golden minimal (`diagnose-runpod-tunnel.ts`) ao canônico endurecido
  (`renderRunPodBootstrapScript`) na MESMA conta/SKU (A40 SECURE).

## Reconciliação read-only (antes de qualquer provider write)
- Docker + Supabase local UP; git dev @ d783a5d; origin/main intacta.
- Authority `3b87224f` ATIVA/válida: runpod, workItem `8a2515d8`, maxCost US$1,50, `validUntil`
  2026-09-17, `revokedAt` null, capability {maxNodes 1, maxHourly US$1,00, ...}.
- **ANOMALIA DE LEDGER (fronteira humana, NÃO causada por esta sessão):** committed **US$1,2553** /
  ceiling US$1,50 ⇒ **remaining US$0,2447** (era 0,8832 no snapshot anterior). **reserved US$3,48** em
  **14 reservas**, **voided 0** ⇒ ~US$2,22 em reservas PENDENTES não reconciliadas (da sessão Codex
  "ampla"). Precisa de void/settle humano OU elevação de teto antes de nova prova GOVERNADA.
- RunPod: **0 Pods**; key read-válida (200). A40 SECURE **US$0,49/h ≤ 1,00**, stock "Low" (volátil).
- **Decisão:** o A/B usa scripts DIAGNÓSTICOS OFF-LEDGER (nomeados pelo usuário), que NÃO postam no
  ledger governado; custo real ~US$0,04, trivial vs saldo de conta US$13,03. Gates duros passaram ⇒
  prosseguir, reportando a anomalia do ledger.

## CONTROLE — golden minimal (`diagnose-runpod-tunnel.ts`), Pod `1b7cvn9rd71cgv`
- Payload: `ollama/ollama:latest`, A40 SECURE, disk **20**, `ports:["22/tcp"]`, **sem supportPublicIp**,
  `sshd -D` foreground, **sem Ollama/pull**.
- Resultado: RUNNING → endpoint publicou → **túnel SSH aberto na 1ª tentativa** (pid 24468,
  processAlive+listenerReady true, **TCP PASS**) → destroy 204 → **0 Pods**. HTTP TypeError (by design,
  sem Ollama). **Wall total ~42s.** Custo ~**US$0,006**.

## TRATAMENTO — canonical hardened (`ab-treatment-canonical.ts`), Pod `doeld52a80zx5z`
- Payload CANÔNICO idêntico ao `createPod`: `ollama/ollama:latest`, A40 SECURE, disk **60**,
  `ports:["22/tcp"]`, **supportPublicIp:true**, env {OLLAMA_KEEP_ALIVE, PUBLIC_KEY}, bootstrap
  ENDURECIDO (`renderRunPodBootstrapScript`, 1556 bytes: control-plane FATAL → worker isolado → `exec
  sshd -D` durável).
- Linha do tempo (t desde start): RUNNING-desejado t=2,1s; **endpoint (publicIp+port22) t≈130s**
  (`194.68.245.75:22024`); **túnel SSH 1ª tentativa t≈132s** (pid 22920, processAlive+listenerReady
  true); marcador `pending` t≈135s (worker log `ANIMA_MODEL_CACHE=cold`); **marcador `ready` t≈227s**
  (pull do modelo concluído em ~92s); **mapping recheck STÁVEL** (`194.68.245.75:22024`, sem oscilação);
  `TREATMENT_RESULT tcpAndSshReady=true`; destroy 204; **0 Pods**. **Wall total ~229s.** Custo ~**US$0,031**.
- **Primeira vez** que o bootstrap canônico do autoprov RunPod chega a `ready` fim-a-fim
  (create→RUNNING→endpoint→SSH→GPU→ollama serve→pull→ready), com SSH VIVO durante as etapas pesadas.

## Interpretação — CASO 1 (controle passa + tratamento passa)
- O endurecimento **não regrediu nada** e o caminho canônico agora **completa fim-a-fim** com mapping
  estável; o SSH permaneceu acessível durante as etapas pesadas (marcador lido em `pending` e `ready`).
  O bootstrap está **removido como causa de falha** ("caixa morre durante etapas pesadas").
- **Ressalva de isolamento:** o A40 SECURE está SAUDÁVEL hoje (o controle publicou em segundos; o
  tratamento em ~130s), então esta rodada sozinha NÃO separa 100% "bootstrap coupling" de "variabilidade
  de infra" como causa da regressão HISTÓRICA. As falhas prévias (`yi133`/`3q3ylg` nunca publicaram;
  `4rag1i` publicou-e-sumiu) são mais consistentes com **variabilidade de publicação de endpoint do
  RunPod SECURE** (lado provider), que HOJE não se manifestou. Para ambos os payloads, hoje, o endpoint
  publicou e o mapping ficou estável.
- Conclusão prática: (1) o endurecimento é seguro e cumpriu o objetivo (SSH sobrevive às etapas pesadas);
  (2) o canônico está saudável fim-a-fim; (3) a barreira histórica remanescente é a **variabilidade de
  infra do SECURE**, não o bootstrap.

## Custos e ledger
- Custo real do A/B ≈ **US$0,037** (controle ~0,006 + tratamento ~0,031). **OFF-LEDGER** (diagnósticos
  não postam no ledger governado) ⇒ ledger governado INALTERADO (committed 1,2553 / remaining 0,2447).
  Saldo de conta RunPod ~US$13,03 → ~US$12,99.
- Zero Pods finais confirmado (independente): `runpod-pods-admin.ts list` count 0.

## Efeitos externos
- Realizados: 2 Pods A40 SECURE criados e DESTRUÍDOS (settlement por teardown; custo real ~US$0,037).
- NÃO realizados: nenhum commit/push; `origin/main` intacta; WIP não tocado; `.env.local` não editado;
  nenhuma reserva do ledger criada/settled/voided; nenhum fallback OpenAI/Anthropic; nenhuma rodada
  ampla resiliente; nenhuma reabertura de aggregate budget/tunnel_unavailable/resource matching.

## Próximo ponto exato de retomada
1. **Fronteira humana — reconciliar o ledger governado:** void/settle as 14 reservas pendentes
   (reserved 3,48 vs committed 1,2553; remaining só 0,2447) OU elevar o teto, ANTES de nova prova
   GOVERNADA. (Scripts: `reconcile-*`/`void-reservation-*` existentes; decisão humana.)
2. Com o ledger reconciliado e GO: rodar a prova GOVERNADA real (`prove-runpod-autoprov-8a2515d8.ts`)
   para levar `8a2515d8` a `review` — o caminho canônico agora está provado fim-a-fim.
3. Isolamento histórico bootstrap-vs-infra fica dispensável: o endurecimento é estritamente mais seguro
   e provado; não vale um 3º Pod com o bootstrap antigo.
- Script operacional do tratamento: `apps/web/scripts/ab-treatment-canonical.ts` (NÃO commitar).

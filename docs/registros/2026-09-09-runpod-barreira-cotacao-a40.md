# RunPod — nova authority e barreira de cotação A40

- **Data/tipo:** 2026-09-09 — reconciliação e prova supervisionada pré-provider.
- **Objetivo:** retomar o Cloud GPU Test #2 do item `8a2515d8-6967-463e-af2a-fd5d2b5e42a1`
  depois da rotação da credencial e validar ao vivo o bootstrap com `sshd` antecipado.
- **Branch/HEAD:** `dev`, HEAD inicial/final `d783a5dc495da692eb7097f7c7252bb5ba074e51`;
  `origin/dev` observado `4ab99acf80ec69156f7155e203da1bd46dd96529`; `origin/main`
  preservado em `99bec54e3ab42bfe882a8686cd1385d8058b916e`.
- **Commits/push:** nenhum.

## Reconciliação e autoridade

- Docker 29.7.2 e Supabase local estavam operacionais; banco e APIs locais responderam.
- O processo do Codex ainda herdava a credencial RunPod anterior. Sem exibir nenhum valor, foi
  comprovado que ela divergia de `.env.local`; removê-la somente do subprocesso fez a nova key
  autenticar. A RunPod respondeu `200` e confirmou zero Pods.
- Item confirmado em `approved`, proposal v2, sem `execution_started` e sem attempt.
- Authority antiga `fd534be7-5b04-4e04-9079-b62a6762480f` revogada; seu ledger append-only
  permaneceu com US$ 1,25 comprometidos e US$ 0,25 remanescentes históricos.
- Nova authority `c1c3c608-cf2b-4b79-8828-c291e72b5431`, escopada a RunPod,
  `runpod-a40-test2`, `gpu-a40-48gb`, mesmo item, um node, 30 minutos e teto agregado de
  US$ 1,50. Ledger novo: zero reservas, zero comprometido, US$ 1,50 restante.

## Provas e resultado

- Suítes focais: 11/11, 115/115 testes PASS com `--runInBand --detectOpenHandles`.
- `git diff --check`: PASS. A falha externa ao recorte em `autonomous-backlog-deps.ts:198`
  permanece conhecida e não foi misturada à prova.
- A volta canônica terminou `selection_not_executable` / `coder_node_unavailable` antes de
  reservar orçamento, criar Pod ou iniciar attempt: `live_price:quote_unavailable`.
- Diagnóstico read-only GraphQL retornou a A40 48 GB, mas preço, estoque e contagens disponíveis
  vieram nulos em SECURE e COMMUNITY. Nenhum probe mutante foi usado.

## Segurança, efeitos externos e retomada

- Zero Pods ao fim; nenhuma cobrança nova, reserva, attempt, coder, gate ou Verifier.
- OpenAI = 0; Anthropic = 0. Nenhum fallback proprietário, accept, integration, merge, publish
  ou deploy. Nenhum segredo foi impresso ou persistido.
- WIP preexistente preservado; a pequena adaptação do script operacional torna a renovação
  idempotente para a authority já criada.
- **Próximo ponto exato:** repetir primeiro a cotação read-only. Quando a A40 SECURE devolver
  preço/estoque, executar o mesmo item pela volta canônica com a authority nova; validar `sshd`
  antecipado, túnel, Ollama/qwen3-coder, coder/gate/Verifier, parar em `review` e destruir o Pod.

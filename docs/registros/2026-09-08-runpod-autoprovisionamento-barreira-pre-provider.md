# RunPod Autoprovisionamento — implementação local e barreira pré-provider

Data: 2026-09-08
Objetivo: preparar a primeira prova canônica de autoprovisionamento RunPod end-to-end, limitada ao
successor `8a2515d8-6967-463e-af2a-fd5d2b5e42a1`, e parar na primeira fronteira humana real.

## Estado reconciliado

- HEAD inicial: `55c45c0`; `origin/dev`: `4ab99ac`; `origin/main`: `99bec54`.
- Lineage real: `ce90eb14…` (`failed`) → `81836dde…` (`cancelled`) → `01fdf66a…`
  (`changes_requested`) → `8a2515d8…` (`approved`, proposal v2).
- `8a2515d8…` tem zero eventos `execution_started`; último evento observado: seq `51517`.
- Nenhum successor adicional e nenhuma attempt foram criados.
- WIP preexistente foi preservado.

## Implementação concluída sem provider

- Bootstrap bounded no payload de criação: valida `nvidia-smi`, instala/inicia SSH e Ollama,
  espera `/api/tags`, distingue cache `warm|cold`, faz pull de `qwen3-coder:latest` com timeout
  de 1.800 s, valida `ollama show` e mantém o runtime vivo.
- Ollama escuta somente em `127.0.0.1:11434`; o Pod publica apenas `22/tcp`.
- A Goma cria um túnel SSH para porta loopback efêmera, com identidade privada somente host-side,
  arquivo `known_hosts` dedicado, `BatchMode`, `ExitOnForwardFailure` e processo rastreado.
- `stop`, `destroy` e `disposeAll` encerram o transporte; reconciliação de órfão não abre túnel.
- Health real exige `/api/tags` com `qwen3-coder:latest` e `/api/chat` curto/bounded pelo túnel.
- Preflight agora falha fechado sem chave privada, chave pública e known-hosts explícitos.

## Provas locais

Comando focal: Jest sobre adapter unitário/integration, preflight, resident lifecycle e reconciler.
Resultado: 5 suites, 76 testes, todos PASS. Cobertos create, erro provider, timeout, health/model,
túnel falho/teardown, destroy, órfão, replay/idempotência e redação de segredo pelos testes
existentes e novos.

O typecheck web permanece bloqueado por WIP preexistente em
`autonomous-backlog-deps.ts:198` (`p_attempt_id: null` incompatível com o tipo gerado). A falha
também impede carregar a suite `autonomous-backlog-deps-ondemand`; não foi alterada por este recorte.

## Barreira humana — nenhuma chamada RunPod realizada

O ambiente de processo/usuário/máquina não contém `ANIMA_RUNPOD_API_KEY`. Também não existem os
arquivos padrão `~/.ssh/id_ed25519`, `.pub` ou `known_hosts`. No banco local não existe nenhuma
linha em `paid_compute_authorizations` para `8a2515d8…`; portanto não há `max_cost_amount`, duração
e janela que autorizem o efeito financeiro. Pela política fail-closed, o executor não pode inventar
esse teto. `RUNPOD_AUTOPROVISION_LIVE = NOT_RUN`; providerRef, preço, custo, attempt, gate e Verifier
permanecem ausentes. OpenAI API = US$0; Anthropic API = US$0; RunPod = US$0.

## Retomada exata

1. O humano cria/disponibiliza localmente uma identidade SSH dedicada e a API key RunPod, sem
   enviar segredos pelo chat, usando `ANIMA_RUNPOD_SSH_PRIVATE_KEY`,
   `ANIMA_RUNPOD_SSH_PUBLIC_KEY`, `ANIMA_RUNPOD_SSH_KNOWN_HOSTS` e `ANIMA_RUNPOD_API_KEY`.
2. O humano concede no Anima uma autorização paga para provider `runpod`, node/resource class da
   prova, work item `8a2515d8…`, com `max_duration_ms`, `max_cost_currency=USD`,
   `max_cost_amount` e janela de validade explícitos.
3. Retomar pelo preflight read-only; só então consultar preço A40 e executar exatamente um Pod.

Nenhum push, merge, publish, deploy, integração ou efeito externo foi realizado.

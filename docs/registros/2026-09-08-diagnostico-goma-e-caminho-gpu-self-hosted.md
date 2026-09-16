# Diagnóstico da Goma e caminho para GPU self-hosted

- **Data/tipo:** 2026-09-08 — auditoria read-only de host, código e estado persistido.
- **Objetivo:** explicar a pressão de RAM e reconciliar o menor caminho para executar
  `8a2515d8-6967-463e-af2a-fd5d2b5e42a1` em inferência remota open/self-hosted, sem
  criar attempt, provisionar cloud ou consumir API de modelo proprietária.
- **Branch/HEAD:** `dev`, `55c45c0` no início e no fim da auditoria.

## Estado autoritativo preservado

O Postgres local confirmou `8a2515d8` em `approved` v2, contrato
`ollama/qwen3-coder:latest`, somente os eventos de proposta/revisão/aprovação/contexto/
classificação e **zero** `execution_started`. Não há autorização de compute pago para
o item. Nenhum evento, lease, successor, retry ou recovery foi criado.

## Memória observada

Snapshot read-only: 15,872 GiB físicos; 5,03 GiB disponíveis; 10,84 GiB não
disponíveis; cache de sistema 3,033 GiB; kernel 1,249 GiB. Commit: 15,646 GiB de
33,872 GiB, pico 22,665 GiB. Pagefile `C:\pagefile.sys`: 18 GiB alocados, 0,543 GiB
em uso, pico 1,896 GiB. O maior processo era `vmmem` (2,03 GiB WS/2,24 GiB private).
Docker/WSL expunha limite de 7,689 GiB, mas os cinco containers Supabase somavam
aproximadamente 571 MiB; a diferença é VM/cache/overhead, não containers ativos.
Ollama estava servido, mas `ollama ps` vazio: nenhum modelo carregado. Grupos relevantes:
Claude 1,68 GiB WS; Codex/ChatGPT 1,57 GiB WS combinados; Spotify 1,10 GiB; `svchost`
1,03 GiB; Node 0,39 GiB. Não havia Next/Jest/Vitest de projeto ativo no snapshot.

O Governor usa `os.freemem()/os.totalmem()` e a reserva padrão de 25%: abaixo de
3,968 GiB livres classifica `moderate`; por isso as amostras anteriores de 3,81 GiB
recusaram e a atual de 5,03 GiB seria `low`. Cache/standby conta como disponível para
o Windows quando recuperável; `SystemCache` não deve ser somado novamente aos 5,03 GiB.

## Reconciliação do compute remoto

- O protocolo Ollama host-mediated já envia apenas manifesto/trechos ao endpoint e
  aplica operações estruturadas na worktree da Goma. Git, gates e Verifier permanecem locais.
- O endpoint remoto explícito já funciona por `ANIMA_WORKTREE_OLLAMA_*`, mas aceita
  deliberadamente apenas HTTP loopback: uma GPU manual precisa ser apresentada por túnel
  local (por exemplo, SSH/Tailscale), não por URL pública direta.
- A prova owned anterior usou um processo HTTP real, porém o servidor de inferência era a
  fixture local `fake-inference-node.cjs`; não foi GPU/modelo remoto real.
- Existe adapter RunPod real: create/list/get, obtenção de `providerRef` e endpoint,
  health externo, stop, destroy, locate/reconciliação, quote e redação da credencial.
  Ele está ligado ao Resident Host atrás dos gates de env, autorização e orçamento, mas
  nunca foi exercitado contra RunPod real.
- A chave RunPod é lida somente de `ANIMA_RUNPOD_API_KEY`, mantida em memória e redigida;
  lifecycle guarda somente ids opacos. Nenhuma variável RunPod/OpenAI/Anthropic estava
  configurada no processo desta auditoria.
- O adapter pressupõe imagem já pronta e endpoint acessível. Não instala Ollama, não baixa
  modelo e não cria túnel/rede privada. O caminho automático atual pode expor Ollama por
  IP/proxy público sem autenticação própria; isso não satisfaz sozinho a fronteira segura.

## Delta e retomada

Para a primeira prova manual, **zero componente novo de código é obrigatório**: escolher
um fornecedor/GPU, subir runtime+modelo, estabelecer túnel loopback, configurar o node como
`already_provisioned`, validar `/api/tags`/chat pelo túnel e retomar exatamente o mesmo item.
O Anima ainda não governa o custo/lifecycle desse node manual; contratação e desligamento
ficam como atos operacionais humanos nessa primeira prova.

Para automação cloud segura há três lacunas de implementação claras: imagem/bootstrap
reprodutível, instalação/cache do runtime+modelo e transporte privado/autenticado. Registro
durável de catálogo multi-node é parcial, mas não bloqueia o primeiro thin slice. A prova
viva de provider, credenciais e autorização financeira começa somente depois da escolha
humana do fornecedor e de um teto de custo.

## Provas e efeitos externos

- Testes focados: 5 suítes / 65 testes, todos verdes (placement, RunPod unit/integration
  mock, Resident on-demand e prova controlada de provisionamento).
- Nenhuma alteração no código operacional; somente este registro e o estado vivo no PRD.
- ZERO OpenAI API, ZERO Anthropic API, ZERO provider cloud, ZERO gasto, ZERO push/merge/deploy.
- Nenhum processo foi encerrado; Docker, WSL, Ollama e WIP existente foram preservados.

## Próximo ponto exato

Escolher fornecedor e GPU somente quando houver intenção de gastar. Para a prova manual,
criar o node fora do Anima, subir `qwen3-coder:latest`, expor `11434` apenas por túnel local,
configurar `ANIMA_WORKTREE_OLLAMA_URL=http://127.0.0.1:<porta>`, locality `remote`, node id,
models e billing `already_provisioned`; então renovar a supervisão de `8a2515d8`, executar
uma única volta e parar em `review`. Não criar seq4, retry de seq2 ou recovery.

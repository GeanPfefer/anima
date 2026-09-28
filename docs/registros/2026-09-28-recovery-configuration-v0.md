# 2026-09-28 — Recovery Configuration V0: catálogo + checker read-only

## Objetivo

Reduzir a dependência de memória humana na recuperação em máquina nova: dizer
quais chaves de ambiente o Anima precisa, o que cada uma é, de onde vem e como
se reprovisiona, e verificar prontidão **sem nunca expor valores**.

- Branch `dev`, HEAD inicial `c94571d`. `main` = `99bec54` (intocada).
- Sem banco, sem provider, sem rede, sem browser. US$0.

## Auditoria de origem

A auditoria read-only (Codex, paralela) encontrou cerca de 30 chaves presentes
no ambiente real do web e ausentes de `apps/web/.env.example`: identidade
residente, Resident Host, Router, tuning do coder OpenAI, RunPod/SSH, Research
Web, Ollama/worktree, integração GitHub, caminhos específicos do host e flags
antigas de prova. O exemplo antigo também trazia valores da Goma (`G:\anima`,
IP Tailscale real).

O inventário desta unidade saiu de três fontes: os nomes (sem valores) do
`.env.local` real, as leituras de `process.env`/`env.` no runtime de
`apps/web` (lib, app, cli, resident host) e `apps/mobile`.

## O que foi entregue

| Artefato | Caminho |
|---|---|
| Catálogo sem segredos | `apps/web/.env.example` (reescrito, agrupado) |
| Manifesto versionado | `apps/web/lib/recovery-config/manifest.ts` (`anima.recovery-config.v0`) |
| Checker puro | `apps/web/lib/recovery-config/check.ts` |
| Borda de I/O mínima | `apps/web/lib/recovery-config/node-env.ts` (lê `apps/mobile/.env.local`, testa caminho) |
| Comando | `anima recovery-config check [--json]` (`apps/web/cli/args.ts`, `cli/anima.ts`) |
| Testes | `apps/web/lib/recovery-config/check.test.ts` (23) |

O runtime produtivo **não lê** o manifesto. Nenhum comportamento de capacidade
mudou.

### Contrato de cada chave

`key`, `envFile` (web | mobile), `classes[]`, `requiredFor[]` (grupo +
condição opcional sobre outra chave), `tunes[]`, `source.kind` (repository |
derived | secret_store | operator | external_auth), `source.reference`,
`reprovisionStrategy` (derive | generate | authenticate | reset_credential |
install | operator_choice), `hostSpecific`, `secret`, `validation`,
`derivation` (wired | derivable_not_wired), `deprecated`, `proofOnly` e
`description`. **Nenhum valor.**

### Classes

`derived`, `non_secret_required`, `secret_required`, `host_specific`,
`optional`, `deprecated`.

## Config ≠ segredo

- **Config** (por exemplo URL do Supabase, provider, IDs de nó, caminhos) é reprovisionada por derivação ou por escolha do operador. Ela pode aparecer como placeholder no `.env.example`.
- **Segredo** (senha residente, OpenAI, RunPod, a chave SSH privada dedicada, token GitHub e, no futuro, chaves de criptografia de backup) só tem presença verificada. No `.env.example` aparece como `CHAVE=` vazio. O checker nunca emite valor, prefixo, sufixo, comprimento nem hash.
- `ANIMA_RESIDENT_EMAIL` é um identificador pessoal não secreto (operator/lookup da identidade restaurada). `ANIMA_RESIDENT_PASSWORD` é segredo e se reprovisiona com `reset_credential`. `ANIMA_DEVELOPMENT_CHAT_USER_IDS` deve ser **rederivado** da identidade restaurada, e não copiado de outra instalação.

## Grupos de prontidão

| Grupo | Tipo | Habilitado quando | Exige |
|---|---|---|---|
| core | core | sempre | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| resident | capacidade | sempre | Supabase + email/senha residentes |
| chat-openai | capacidade | chat **ou** coder = openai (`ANIMA_AI_PROVIDER` ausente ⇒ openai) | `OPENAI_API_KEY` |
| local-ai | capacidade | sempre | nada obrigatório (defaults de localhost no código) |
| self-development | capacidade | sempre | identidade residente, dev chat user ids; `OPENAI_API_KEY` se coder = openai |
| runpod | capacidade | `ANIMA_ON_DEMAND_NODE_ENABLED=true` | provisioner/id/billing, API key, imagem, GPUs, par SSH dedicado, known_hosts |
| research-web | capacidade | sempre (fail-closed) | SearXNG URL, binário agent-browser |
| mobile | capacidade | sempre | `EXPO_PUBLIC_SUPABASE_URL/ANON_KEY`, `EXPO_PUBLIC_ANIMA_WEB_URL` |
| github-integration | capacidade | sempre | repository id, remote, base branch, token GitHub |

Regras:

- **Core nunca exige capacidade opcional nem segredo** (há um teste que trava isso).
- Uma capacidade desabilitada tem as chaves exigidas reportadas como `not_required`.
- Um ajuste inválido (por exemplo caminho placeholder) quebra só a capacidade que ele ajusta, nunca o core.
- Chave deprecated presente nunca bloqueia; o checker aponta o substituto.

Status por item: `present | missing | derived | invalid | not_required`, mais
um motivo fixo (`placeholder`, `not_url`, `path_not_found`,
`not_uuid_list`, `env_file_missing` e outros). Saída: `CORE READY | NOT READY`
e o estado por capacidade. Exit 0 com core pronto, 1 sem core.

## Deprecated / não promovidos

Ficam registrados no manifesto e **fora** do `.env.example`:

- `WHISPER_URL`: sem consumidor no web (o mobile usa `EXPO_PUBLIC_WHISPER_URL`);
- `ANIMA_COMPUTE_ROUTER_V1`: o runtime só lê `ANIMA_COMPUTE_ROUTER_V1_ENABLED`;
- `ANIMA_WORKTREE_CODER_BACKEND`: alias antigo de `ANIMA_CODER_PROVIDER`;
- `SUPABASE_SERVICE_ROLE_KEY`: não é consumida pelo runtime, e a CLI a recusa; service_role nunca faz parte do runtime normal;
- `ANIMA_UX02_DETERMINISTIC_PROOF` e `ANIMA_ON_DEMAND_NODE_TARGET_PATH/TARGET_CONTENT/FAILURE_MODE`: flags de prova;
- `ANIMA_ON_DEMAND_FORCE_BURST`: alavanca de prova/ops (`proofOnly`), aceita mas não recomendada.

## Derivação

- **Já wired** (a ausência é saudável): raiz do projeto (descoberta a partir do cwd), defaults Ollama de localhost, provider/modelos default, timeouts, catálogo de pricing versionado, `ANIMA_RESIDENT_ROUTE_BASE`, GitHub API URL e `ANIMA_INTEGRATION_REPO_ROOT`.
- **Derivable-but-not-wired** (o runtime ainda exige a chave; registrado, não implementado): URL/anon key do Supabase (de `supabase status`/`config.toml`), `ANIMA_LOCAL_RUNNER_ROOT` (`<raiz>/tools/local-agent`), `ANIMA_LOCAL_TARGETS_JSON` (`{"anima": <raiz>}`) e `ANIMA_DEVELOPMENT_CHAT_USER_IDS` (da identidade restaurada).

## Uso em máquina nova

1. Restaurar o banco (Operational Durability; fora desta unidade).
2. `cp apps/web/.env.example apps/web/.env.local` e `apps/mobile/.env.example → .env.local`.
3. Preencher: Supabase via `supabase status`; identidade residente restaurada com senha redefinida; UUID(s) rederivados; segredos a partir do cofre.
4. `npm run anima --workspace=@anima/web -- recovery-config check`. Placeholders copiados aparecem como `invalid (placeholder)`.
5. Resolver o que faltar em cada capacidade que for usada. O core precisa estar READY.

## Validação

- `jest lib/recovery-config`: 23/23. Cobre core mínimo, secret ausente, capacidade opcional ausente, OpenAI exigindo chave, Ollama não exigindo OpenAI, RunPod desligado/ligado, host path placeholder/relativo/inexistente, deprecated não bloqueando, mobile sem arquivo, chaves desconhecidas, **redaction** (sentinelas de ~2 KB: nem valor, nem prefixo/sufixo, nem comprimento, nem hash aparecem no JSON ou no render), e integridade do manifesto contra o `.env.example`.
- `jest cli`: 113/113. `tsc --noEmit`: limpo. `git diff --check`: limpo.
- Execução real na Goma (só nomes/status): CORE READY; resident, chat-openai, local-ai, self-development e mobile READY; runpod disabled; research-web e github-integration NOT READY (não configurados); deprecated presentes: `WHISPER_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANIMA_UX02_DETERMINISTIC_PROOF`; chave desconhecida: `OLLAMA_HOST` (variável do ambiente do sistema, não do `.env.local`).

## Limitações

- Verifica presença e forma, **não validade viva**: não testa se a chave OpenAI funciona nem se o Supabase responde. É read-only e offline por desenho.
- O manifesto é mantido à mão. Os testes pegam chave exigida faltando no `.env.example`, mas não detectam automaticamente uma chave nova lida pelo runtime e não catalogada. Essa detecção só acontece em execução real, via `unknownKeys`.
- Os scripts históricos de prova em `apps/web/scripts/` leem chaves próprias, que não foram catalogadas.
- `tools/local-agent` (Python) tem ambiente próprio, fora do escopo.
- Não há gestão de secret store nem de chaves de criptografia de backup (futuro).

## Separado (não feito)

**Toolchain Manifest** (pin de Node, Supabase CLI, Python, modelos Ollama,
instalação do Research Web) é a próxima unidade. Também não foram tocados:
restore V0.1, destino de backup, Evolution History.

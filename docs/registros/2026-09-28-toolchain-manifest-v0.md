# 2026-09-28 — Toolchain Manifest V0: contrato de reprodutibilidade em máquina nova

## Objetivo

Responder, sem depender da memória do operador: *esta máquina tem o toolchain
necessário para reconstruir e operar o Anima?* Esta unidade **formaliza**
versões, pins e gaps e cria um checker read-only. **Não instala, não
atualiza e não baixa nada.** Ela **não** afirma reprodutibilidade completa.

- Branch `dev`, HEAD inicial `9471642`. `main` = `99bec54` (intocada). US$0; sem provider, banco ou browser.
- Fase 0: snapshot `backup/marco-operational-durability-v0-1-final-2026-09-28` → `9471642` criado e publicado. `backup/marco-operational-durability-v0-1-2026-09-28` continua em `0b05166` (antes do fix de LF).

## Auditoria de origem

A auditoria (Codex) apontou: Node/npm não pinados; Supabase CLI não pinada;
Docker não declarado; Python sem patch pin; dependências Python sem lock;
base `python:3.11-slim` mutável; Ollama não pinado; modelos sem digest;
`qwen3-coder:latest` mutável; SearXNG `latest`; agent-browser sem versão;
Chrome for Testing sem pin; Android SDK/JDK não manifestados; Tailscale sem
requisito; ausência de um validador único.

## O que foi entregue

| Artefato | Caminho |
|---|---|
| Pin de runtime Node/npm | `package.json`: `engines` (`node ^24.16.0`, `npm >=11.13.0`) + `packageManager: npm@11.13.0`; `package-lock.json` sincronizado pelo próprio npm offline (+4 linhas, só `engines`) |
| Manifesto versionado | `apps/web/lib/toolchain/manifest.ts` (`anima.toolchain.v0`) |
| Checker puro | `apps/web/lib/toolchain/check.ts` |
| Borda de sondagem | `apps/web/lib/toolchain/node-probe.ts` (só comandos `--version`/`-V` fixos) |
| Comando | `anima toolchain check [--json]` |
| Testes | `apps/web/lib/toolchain/check.test.ts` |

Campos de cada ferramenta: `tool`, `versionConstraint`, `provenVersion`,
`pinType` (exact | lockfile | digest | major | minimum | mutable_tag |
none), `installSource`, `requiredFor[]`, `optionalFor[]`, `platform[]`,
`validation` (probe | repo_file | none), `reproducible`, `hostSpecific` e
`notes`. Sem tokens, caminhos pessoais ou valores do `.env.local`.

## Versões comprovadas (sondagem read-only na Goma, Windows)

| Ferramenta | Observado | Contrato | Pin |
|---|---|---|---|
| Node | 24.16.0 | `^24.16.0` (engines) | major |
| npm | 11.13.0 | `packageManager npm@11.13.0`; engines `>=11.13.0` | exact |
| git | 2.54.0 | `>=2.40.0` | minimum |
| dependências JS | — | `package-lock.json` v3 | lockfile |
| Docker (cliente) | 29.8.0 | `>=24.0.0` | minimum |
| Supabase CLI | 2.105.0 | `>=2.105.0 <3.0.0` | minimum |
| JDK | 17.0.20 | `^17.0.0` | major |
| Android platform-tools | 37.0.1 | `>=35.0.0` | none |
| Ollama (cliente) | 0.32.15 | `>=0.30.0` | none |
| Python | 3.11.9 | `>=3.11.0` (pyproject) | minimum |
| OpenSSH | 10.3 | `>=8.0.0` | minimum |
| Tailscale | 1.102.2 | opcional, sem requisito | none |

**Supabase CLI:** a **versão usada na prova** (Restore V0.1) é 2.105.0,
que determina `postgres:15.8.1.085` e `gotrue:v2.189.0`. A **compatibilidade
futura permitida** é 2.x ≥ 2.105.0. Uma versão mais nova passa, mas o checker
sinaliza `matchesProven=false` (e isso exige nova prova de restore). A versão
não foi alterada.

**Node:** o runtime usa TS nativo do Node 24 (`--experimental-transform-types`).
A forma mínima e padrão do ecossistema é `engines` + `packageManager`, sem
mecanismo próprio e sem upgrade.

## Grupos

| Grupo | Exige | Opcional |
|---|---|---|
| core | node, npm, git, lockfile | — |
| database | docker, supabase-cli | — |
| web | node, npm, lockfile | — |
| mobile | JDK, platform-tools, pacotes do Android SDK, lockfile; Xcode só em macOS | tailscale |
| local-ai | ollama, `qwen2.5:14b`, `nomic-embed-text` | `qwen3-coder:latest` |
| self-development | node, git | docker, python, imagem do runner, `qwen3-coder:latest`, `qwen2.5-coder:14b`, `qwen3-coder:30b` |
| research-web | searxng, agent-browser, chrome-for-testing | — |
| runpod | openssh | — |

O **core não exige** mobile, Research Web nem RunPod (há teste que trava isso).

### Catálogo Ollama (sem baixar, sem inventar digest)

- **required now:** `qwen2.5:14b` (chat/detecções default), `nomic-embed-text` (embeddings);
- **optional:** `qwen3-coder:latest` (coder Ollama default), **`mutable_tag`/non-reproducible** até haver referência imutável; `qwen2.5-coder:14b` (fallback governado);
- **historical:** `qwen3-coder:30b` (runner local; esbarra na barreira de 16 GB de RAM), `qwen2.5-coder:7b`.

## Checker

Status por item: `present | missing | version_mismatch | not_required |
unverified | non_reproducible`.

- `probe`: comandos fixos, com timeout de 15 s; a versão sai por regex e a saída bruta nunca é emitida. Python tenta `python`, `python3` e `py` (o stub `python3` da Microsoft Store no Windows não conta como Python).
- `unverified` = o checker não consegue provar (modelos exigiriam o daemon; SDK, SearXNG, agent-browser e Chrome não são sondados). **Bloqueia** a capacidade (fail-closed).
- `non_reproducible` = tag mutável. Não bloqueia, mas aparece em `nonReproducible`.
- Cada grupo reporta `state` (ready | not_ready), `blocking[]` e `reproducible`.
- Resumo `CORE TOOLCHAIN READY | NOT READY`; exit 0/1.
- **Varredura de hard-codes de host** nos arquivos de contrato versionados (`package.json` raiz/web/mobile, `app.json`, `.env.example` web/mobile, `supabase/config.toml`, `pyproject.toml`, `Dockerfile`). Detecta drive Windows, caminho pessoal e IP privado/Tailscale, e reporta só arquivo, tipo e contagem, **nunca o valor**. O checker não exige nenhum caminho da Goma.

Nunca instala nem corrige. Nunca inicia daemon, provider ou browser.

## Resultado vivo (Goma)

```
CORE TOOLCHAIN READY
core READY · database READY · web READY · self-development READY · runpod READY
mobile NOT READY — android-sdk-packages:unverified
local-ai NOT READY — model:qwen2.5:14b:unverified, model:nomic-embed-text:unverified (daemon Ollama parado; não iniciado)
research-web NOT READY — agent-browser:unverified, chrome-for-testing:unverified (+ searxng non_reproducible)
hard-codes de host em arquivos de contrato: nenhum
```

Observado sem alterar nada (fora do contrato, só registro): imagem local
`searxng/searxng:latest` com RepoDigest `sha256:5286edb3…` (criada em
2026-09-25). Imagem do runner `anima-local-agent-python:0.1` com id
`sha256:2f35f6bb…` (construída em 2026-07-15). `python:3.11-slim` **não**
está em cache local.

## Reprodutível × não reprodutível

**Reprodutível hoje:** dependências JS (lockfile), versão do npm
(`packageManager`), imagens do Supabase (derivadas da CLI 2.105.0).

**Não reprodutível / gaps (formalizados, não corrigidos):**

- Node só no major (`^24.16.0`); git, Docker, OpenSSH e Python só com mínimo; JDK no major;
- Supabase CLI permite 2.x mais novo (exige nova prova);
- Python: runtime sem pin de patch. **Sem dependências de runtime**, portanto não há lock a gerar. As dev deps (pytest/mypy) têm só mínimo. Gerar constraints exigiria resolver online, então fica como gap;
- base `python:3.11-slim` mutável; pinar por digest exige rede para obter o digest oficial (gap);
- Ollama sem pin; modelos sem digest; `qwen3-coder:latest` mutável;
- SearXNG `:latest` e `settings.yml` (formats/engines) fora do repo;
- agent-browser sem versão; Chrome for Testing decidido pelo agent-browser;
- pacotes do Android SDK não manifestados; iOS exige macOS/Xcode;
- Tailscale opcional, sem requisito formal.

## Limitações

- O checker prova presença e versão de CLIs, não o funcionamento (daemon Docker, servidor Ollama, stack Supabase).
- Os caminhos `host_specific` (SDK Android, binário do agent-browser, chave SSH) continuam configuração do host (Recovery Configuration), não toolchain.
- A varredura de hard-code cobre só os arquivos de contrato declarados; scripts históricos de prova ficam fora.
- `tools/local-agent` não foi reconstruído.

## Validação

- `jest lib/toolchain lib/recovery-config cli`: 10 suítes, 153/153.
- `tsc --noEmit` limpo. `git diff --check` limpo.
- `anima toolchain check` real: exit 0, CORE TOOLCHAIN READY.

## Próximo (não iniciado)

Pins por digest (imagens/modelos) e lock de SearXNG/agent-browser, feitos por
decisão humana; destino off-machine do backup; Evolution History.

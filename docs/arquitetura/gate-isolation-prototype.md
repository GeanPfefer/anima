# Isolamento de gates e executor — protótipo (A2-0 R2)

Estado: implementado e versionado em commit local (branch `claude/a2-uac-approver`), opt-in; NADA ativado no residente (sem `ANIMA_GATE_SANDBOX`, sem ACE de produção).
Arquivos: `lib/work-orchestration/gate-isolation.ts` (+ teste), `worktree.ts` (`runIsolated`, usado por `runGate` e `runCommand`), `scripts/gate-isolation-acl.ps1` (ato do operador, simulação por padrão).

## Mapa de execução (antes)

| Processo | Ambiente | Usuário/SO | Lê `.env.local`? |
|---|---|---|---|
| Resident Host / Writer (control plane) | `--env-file .env.local` (senha residente, senha do writer, chave de serviço…) | GeanTeco | sim (precisa) |
| Executor Codex (`codex exec`) | allowlist (`buildAllowlistedEnvironment`; sem segredos) | agente: GeanTeco; comandos do agente: `CodexSandboxOffline` | ACL permitia (CodexSandboxUsers: Modify herdado) |
| Gates (`runGate`) e `runCommand` do harness | **`process.env` completo** | GeanTeco (executa código escrito pelo executor) | sim |

## Correção (duas camadas, ambas obrigatórias)

1. Ambiente por allowlist + descarte de nomes com cara de segredo (`buildGateEnvironment`): sempre ativo, portátil (Linux/runner remoto).
2. Sandbox do SO opt-in (`ANIMA_GATE_SANDBOX=codex-windows`, `ANIMA_GATE_SANDBOX_CODEX_PATH=<codex.exe>`): `codex sandbox -P :workspace -C <worktree> -- …`
   (usuário `CodexSandboxOffline`) + ACE de negação de leitura para `CodexSandboxUsers` nos arquivos de segredo (`scripts/gate-isolation-acl.ps1 -Apply`, ato do operador).
   Configurado e indisponível ⇒ exit -3, nada executa.

## Evidência (segredos fictícios; `gate-isolation.test.ts`, 9/9 com o sandbox real)

- Filho com env filtrado não vê `ANIMA_RESIDENT_PASSWORD`, senha do writer, `SUPABASE_SERVICE_ROLE_KEY`, chaves de API (nem sob o sandbox).
- CONTROLE: sem sandbox, o filho ainda lê um arquivo de segredo do mesmo usuário ⇒ remover variáveis não basta.
- CONTROLE: sob o sandbox, mas sem o ACE, o arquivo é legível ⇒ o sandbox sozinho não basta.
- Com ACE de negação: gate sandboxed recebe EPERM/EACCES; o Host continua lendo; escrita fora do workspace é negada; escrita no workspace funciona (gate legítimo).
- Experimento manual anterior: `codex sandbox -- cmd /c whoami` ⇒ `goma\codexsandboxoffline`; leitura de arquivo com ACE ⇒ "Acesso negado".
- Regressão (2026-10-17): 6 suites / 206 testes (gate-isolation com o sandbox real, Git isolado, local-runner, worktree, worktree-executor) sem skips; typecheck do `apps/web` limpo.

## Limites

- `%TEMP%` é gravável por desenho no perfil `:workspace`; o executor pode plantar arquivos lá.
- O Git do Host sobre a worktree do candidato usa `--git-dir` confiável e ambiente limpo (`candidateGit`); chamadas Git sobre o repositório principal não são código do candidato.
- O Host (control plane) continua guardando as credenciais no próprio processo e no `.env.local`; outro processo NÃO sandboxed do mesmo usuário as lê.
- Validado com `codex sandbox`; não foi rodado um `codex exec` completo com o ACE aplicado nem uma attempt real.
- O lançamento do sandbox pode conceder ACEs de escrita ao grupo do sandbox na pasta de trabalho (setup refresh do Codex).
- Só Windows/Codex. Linux/remoto: o passo 1 vale; o passo 2 precisa do equivalente local (usuário/contêiner sem montagem dos segredos).

## A3 — proteção da árvore e guarda de reparse points (2026-10-19, não ativado)

- `scripts/gate-isolation-acl.ps1` (simulação por padrão): DENY FullControl herdável para `CodexSandboxUsers` na raiz do checkout; ALLOW Modify explícito no pai dos workspaces; ALLOW ReadAndExecute explícito nos `node_modules`; DENY Read nos segredos. `-Verify` confere ACEs, ordem canônica e (`-ProbeCodexPath`) o acesso efetivo sob o sandbox real; `-Revert -Apply` remove só as ACEs registradas em `-StatePath` como adicionadas. Com `G:\anima` exige `-AllowProductionRepo`.
- `workspace-guard.ts`: o Host não segue symlink/junction/hardlink do candidato (lstat por componente + realpath nativo + nlink). Usado em `readWorkspaceFile`/`writeWorkspaceFile`/`workspacePathKind`, em `stageAll` (o `git add -A` do Git for Windows indexa o conteúdo apontado por uma junction), antes dos gates no executor, e antes de `git clean -fdx`/`dispose` (links hostis são removidos como links).
- `ANIMA_WORKTREE_PARENT` define um pai dedicado dos workspaces (ex.: `G:\anima-workspaces`). Validado e fail-closed: caminho local absoluto, sem UNC/`..`/raiz de unidade, no mesmo volume do repositório, nunca o repositório, um ancestral ou `.git`; configurado e inválido ⇒ erro (não volta ao padrão). O Host cria o pai se ausente, exige diretório real (não link) e cada workspace é `mkdtemp` descartável dentro dele. Ausente ⇒ comportamento anterior.
- Limites: TOCTOU residual; symlinks LX do WSL não detectáveis; Codex interativo com sandbox do Windows no checkout protegido deixa de funcionar.

## E2 — fronteira do AGENTE Codex (2026-10-19, não ativado)

O sandbox contém só os comandos de shell. O processo `codex` roda como o operador e suas ferramentas próprias não passam pelo sandbox. Provado em laboratório (segredos fictícios):

| Achado | Prova |
|---|---|
| `view_image` lê arquivo fora do workspace | transcreveu uma imagem negada ao grupo do sandbox |
| Config pessoal herdada | expôs `node_repl`, `cua_repl`, MCP `runpod` (create/delete pod, secrets), conectores da conta (`codex_apps`), plugins browser/computer-use, `notify` |
| `.codex/config.toml` plantado no workspace | o Codex lançou o MCP do candidato como o operador (marcador criado) |
| `auth.json` real | comandos sandboxed conseguem ABRIR o arquivo (`CodexSandboxUsers:(I)(RX)`); nenhum byte foi lido |

Correção (`codexAgentIsolationArgs`, usada por `buildCodexExecArgs` e pela investigação): `--ignore-user-config --ignore-rules`, `--disable` das ferramentas nativas (`CODEX_AGENT_DISABLED_FEATURES`), `web_search="disabled"` e `windows.sandbox` explícito no Windows (`ANIMA_CODEX_WINDOWS_SANDBOX`, default `elevated`; sem ele o config ignorado derruba o sandbox para somente leitura). A autenticação continua em `CODEX_HOME`. Feature desconhecida falha alto. Efeito colateral: modelo/effort/tier do `config.toml` pessoal deixam de valer (defina `ANIMA_CODEX_CLI_MODEL`).

Resíduo: `collaboration.*` (sub-agentes), `exec` (isolate JS sem fs/rede/require, só ponte `tools`), `request_user_input`, `read_mcp_resource` (sem servidores) permanecem; `auth.json` só é protegido contra o sandbox com `gate-isolation-acl.ps1 -IncludeCodexAuth`.

### E2 — verificações finais (sub-agentes e superfície de ~/.codex)

- Sub-agentes: `--disable multi_agent`/`multi_agent_v2` NÃO remove `collaboration.*`. Em laboratório o agente criou um sub-agente (`collab_tool_call`); ele recebeu o mesmo conjunto restrito de ferramentas (sem view_image, apps, plugins, MCP pessoal, web), comandos como `CodexSandboxOffline`, leitura do arquivo protegido negada e nenhuma ferramenta não-shell capaz de lê-lo. Conclusão: contido por herança, comprovado em uma amostra; revalidar a cada versão do Codex.
- `~/.codex` (só metadados): o grupo do sandbox tem ACE EXPLÍCITA `ReadAndExecute` na raiz, herdada por tudo, exceto `.sandbox-secrets` (negado pelo próprio Codex). Legível pelo grupo: `auth.json`, `config.toml` (+backup), `sessions`, `archived_sessions`, `attachments`, `thread_history_1.sqlite` (~200 MB), `state_5.sqlite`, `logs_2.sqlite`, `memories_1.sqlite`, `secrets`, `cap_sid`, `plugins`, `skills`. `.sandbox` (Modify) e `.sandbox-bin` (RX) têm ACE explícita própria.
- Menor escopo de proteção: UMA negação herdável `FullControl` para `CodexSandboxUsers` na RAIZ de `~/.codex`, mantendo as ACEs explícitas de `.sandbox` e `.sandbox-bin`. Em réplica fictícia com o sandbox real: listagem da raiz, `auth.json` (inclusive abrir o handle), config, sessões, histórico e `secrets` passaram a EPERM; `.sandbox-bin` continuou legível. Preferível a negar arquivo por arquivo (`-IncludeCodexAuth`), que deixa histórico e sessões abertos. Não aplicado em `~/.codex` real: precisa de prova supervisionada de que o Codex (e o app) seguem funcionando.
- Aviso: `icacls /remove:d <grupo>` remove também a ACE explícita de allow do grupo; use a API .NET (como `gate-isolation-acl.ps1`) para reverter só o que foi adicionado.
- Incompatibilidades conhecidas: validado só em codex-cli 0.163.0-alpha.10.2; `--disable` de feature inexistente falha alto (a versão do WSL pode divergir); `--ignore-user-config` descarta model/effort/tier do config pessoal, então defina `ANIMA_CODEX_CLI_MODEL`; no Windows o `windows.sandbox` passa a ser declarado pelo ANIMA.

### E2 — `gate-isolation-acl.ps1 -CodexHome` (2026-10-19, não aplicado em nada real)

Parâmetros novos: `-CodexHome <dir>`, `-CodexHomeOnly`, `-AllowRealCodexHome`, `-ProbeSandboxBinExe <nome>`. Escopo: UM `DENY FullControl` herdável para `CodexSandboxUsers` na raiz do CodexHome, depois de garantir os carve-outs explícitos de `.sandbox-bin` (RX) e `.sandbox` (Modify). No `~/.codex` real os dois já existem (simulação: "já existe", só o deny seria adicionado).

Provas (réplica fictícia + sandbox real; ver o relatório da sessão): caminhos inválidos recusados (relativo, `..`, UNC, raiz de volume, inexistente, arquivo, sem `.sandbox-bin`, raiz/ancestral/`.sandbox-bin` com junction, CodexHome contendo o pai dos workspaces, `~/.codex` "real" sem `-AllowRealCodexHome`); simulação não muda SDDL; apply é idempotente; `-Verify` + sonda efetiva (auth.json, config, histórico, sessões negados; `.sandbox-bin` legível e executável; workspace gravável); a negação herdável não vaza por junction para fora; reversão restaura o SDDL (único ruído: a flag cosmética `AI` do cabeçalho do DACL, presente antes e depois nos testes); DENY idêntico preexistente nunca é removido; carve-out ausente é adicionado e removido; reparse point no lugar de um carve-out é recusado sem tocar o alvo; compatível com o fluxo A3 (modo combinado e regressão).

Limites: não foi aplicado no `~/.codex` real; o comportamento do Codex Desktop e do refresh de setup do Codex sob o deny só se prova em ato supervisionado.
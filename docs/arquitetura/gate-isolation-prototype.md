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

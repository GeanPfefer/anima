# L1 — isolamento nativo do Codex WSL (Single-Item V1)

Data: 2026-10-20. Branch `claude/l1-wsl-profile` (worktree `C:\Users\GeanTeco\anima-work-l1`), base `1d6a7bb`. NÃO commitado.

## Mudança
- `codex-cli-coder.ts`: no transporte WSL, `--sandbox workspace-write` / `sandbox_mode` saem; entra o perfil nativo `anima_single_item` por `-c default_permissions` + `permissions.<perfil>.filesystem` (lista de permissão: `:minimal` e toolchain do Codex = leitura; alvos dos node_modules = leitura; worktree = escrita) + `network.enabled=false`. Idêntico em `exec` e em `exec resume` (só `-c`). Demais transportes inalterados.
- Pré-voo por turno (falha fechada): versão `codex-cli 0.162.x` + canário `codex sandbox -P` com o MESMO perfil (nega `auth.json` do Linux e `/mnt/c/Windows`, enxerga a worktree). Toolchain rasa/em /mnt/no CODEX_HOME e caminhos fora do formato estrito são recusados.
- `CoderWorkspace.dependencyReadRoots` (+ `Worktree.dependencyReadRoots()`): alvos reais dos node_modules religados pelo Host.

## Prova (lab descartável `G:\anima-iso-lab\L1`, dados fictícios, codex 0.162.0 real via WSL)
- Autenticação ChatGPT, escrita na worktree, leitura de deps via junction: OK.
- Negados: bait/credencial fictícia, `~/.codex/{auth.json,config.toml,history.jsonl}`, `/mnt/c`, `.env.local`, repo, `/tmp`, home; escrita/unlink/rename/mv fora; symlink, hardlink, traversal, `/proc/1/root`; rede; exec de binários Windows; docker.sock. `.git` e `.codex` da worktree somente-leitura. deps somente-leitura.
- Ferramentas do agente: `apply_patch` fora/por symlink rejeitado (leitura e escrita); sem view_image/web/browser/MCP/plugins; sub-agentes (`collaboration.*`) HERDAM o perfil (leitura negada).
- `exec resume` com o mesmo perfil: confinado. Perfil inexistente/sintaxe inválida: o Codex recusa (exit 1).

## Limites
- Dentro do sandbox, `git` não lê o gitdir (negado); o Host é quem observa git.
- Listagem de nomes de `/mnt/g` e home mostra só entradas permitidas (visão de montagem).
- O próprio Codex acrescenta `[projects."<worktree>"] trust_level` em `~/.codex/config.toml` a cada diretório novo (comportamento nativo, pré-existente).
- `/proc/self/environ` do comando é legível (ambiente do próprio comando; sem segredos).
- Cancelamento Windows/WSL: limites do registro 2026-10-10 inalterados.

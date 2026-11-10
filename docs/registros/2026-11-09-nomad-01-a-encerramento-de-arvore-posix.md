# NOMAD-01-A: primeira preparação no Nomad e encerramento da árvore de processos no POSIX — 2026-11-09

Append-only. Tipo: **desenvolvimento** (código + testes; sem schema; sem banco; sem attempt, claim, lease ou work item). Formato de [`README.md`](README.md).

## Contexto

- Primeira sessão de desenvolvimento a partir do **Nomad** (Windows 11). A **Goma** (máquina principal, banco residente, worktrees e laboratórios) estava inacessível.
- O código foi obtido do GitHub (`GeanPfefer/anima`, público). Nenhum dos checkpoints conhecidos da Goma existe no remoto: `dev = 506980c`, `ACC-02-A1 = 2fff278` e `CLOUD-04 = 666b73f` **não são objetos** do clone. O `origin/dev` publicado é `21b2af9` (V1-04, 2026-10-26). Logo a Goma tem trabalho **não publicado** em `dev` depois de `21b2af9`, de conteúdo desconhecido nesta sessão.

## Dados

- Branch `nomad/posix-process-tree-kill`, base `origin/dev` = `21b2af9f118f5fa71c3e8b5d8731fb7b9d5b35cb`. Não integrado, não publicado.
- Execução dos testes num workspace Linux (Node 24.22.2, npm 11.13.0, `npm ci` do lockfile), não no Windows do Nomad.

## Bug encontrado e corrigido

`runProcess` ([`worktree.ts`](../../apps/web/lib/work-orchestration/worktree.ts)) encerrava a árvore com `taskkill /T /F` no Windows, mas no POSIX usava `child.kill()`, que só alcança o **filho direto**. Netos sobreviviam ao timeout e ao cancelamento:

- gates com `shell: true` (`sh -c` → `npm`/`jest`): o neto segurava os pipes e o desfecho só vinha pela rede de segurança `KILL_GRACE_MS` (medido: ~11 s num timeout de 1 s), com o processo continuando vivo depois;
- wrapper `ai-memory` → harness (Claude/Codex): o harness ficava órfão.

Prova do defeito: `native-cli-coder.ai-memory.test.ts` (2 testes de árvore) falhava no Linux já na base `21b2af9`.

Correção (mínima, no mesmo ponto): fora do Windows o filho é lançado com `detached: true` (líder de grupo próprio; pipes mantidos, sem `unref`) e o encerramento envia `SIGKILL` ao grupo (`process.kill(-pid)`), equivalente ao `/F`; se o grupo não existir, cai em `child.kill('SIGKILL')`. O caminho Windows não mudou.

## Provas

- 4 testes novos em `worktree.test.ts` (`runProcess — encerramento da árvore`): timeout e cancelamento sem shell, timeout com shell, e controle de processo que termina sozinho. Sem a correção: 3 vermelhos (o controle passa); com a correção: todos verdes.
- `native-cli-coder.ai-memory.test.ts`: os 2 testes de árvore passam a verde.
- Suíte web completa, base × correção, mesmo ambiente Linux: base 25 falhas / 3640 passam; correção 23 falhas / 3646 passam. A diferença é exatamente os 2 testes de árvore; as **21 falhas restantes são idênticas** nas duas versões e são testes que dependem do Windows (junctions/reparse points, letras de unidade em `ANIMA_WORKTREE_PARENT`, `core.autocrlf`, caminhos de projeto) — pré-existentes, não regressões.
- `packages/core`: 130 suítes / 3254 testes (base). `tsc --noEmit` dos quatro workspaces limpo; `git diff --check` limpo.

## Limitações

- **Não executado no Windows.** O caminho `win32` não foi alterado, mas os testes novos ainda precisam rodar no Nomad/Goma (`npm.cmd test --workspace=apps/web -- lib/work-orchestration/worktree.test.ts`).
- Com `detached`, um Ctrl+C no terminal do host não propaga mais `SIGINT` diretamente aos filhos no POSIX; o encerramento deles passa a depender do timeout/cancelamento do próprio `runProcess`. Paridade com o Windows, onde os filhos também não morrem com o pai.
- Sem prova viva contra o residente (banco indisponível nesta sessão).

## Invariantes e efeitos externos

- Nenhum push, PR, merge, migration, escrita em banco, restauração de backup R2 ou alteração de laboratório. Allowlist de gates, sandbox e captura de saída inalteradas.

## Reconciliação com a Goma

Ver o procedimento em [`docs/operacao/reconciliacao-nomad-goma.md`](../operacao/reconciliacao-nomad-goma.md). Risco de conflito: baixo (2 arquivos, um bloco de `runProcess` e um `describe` novo), mas `CLOUD-04` e o `dev` local da Goma podem ter tocado o mesmo trecho.

## Próximo ponto exato de retomada

Na Goma: aplicar o procedimento de reconciliação, rodar os testes novos no Windows e decidir a integração em `dev`.

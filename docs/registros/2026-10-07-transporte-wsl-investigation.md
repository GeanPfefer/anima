# Registro — Transporte WSL opt-in do `investigation-v1` (2026-10-07)

- **Branch/HEAD:** `dev` @ `5391073` (sem commit; alterações no working tree).
- **Objetivo:** permitir que o `investigation-v1`, executado no host Windows, use o Codex CLI Linux (Ubuntu-24.04/WSL2, assinatura ChatGPT), porque o Codex nativo do Windows falha na inicialização do sandbox. Contexto conceitual: [Marco 009](../marcos/009-resiliencia-por-substituicao-versatilidade-infinita.md).
- **Fora de escopo/preservado:** INV-09/INV-10 não tocadas; sem attempts; sem alteração do Supabase; Resident Host não iniciado; sem API OpenAI paga; backend nativo, seleção, elegibilidade e governança inalterados.

## Mudanças

| Arquivo | Papel |
|---|---|
| `apps/web/lib/work-orchestration/investigation-wsl-transport.ts` | Config opt-in, tradução de caminhos, invocações `wsl.exe --exec` |
| `apps/web/lib/work-orchestration/investigation-executor.ts` | Usa o transporte quando configurado; pré-voos; limitação extra no resultado |
| `apps/web/lib/work-orchestration/codex-cli-coder.ts` | `classifyCodexLoginStatus` (fonte única da interpretação de login) |
| `apps/web/lib/work-orchestration/executor-readiness.ts` | Probe do `codex-cli` reconhece o transporte WSL |
| testes `investigation-wsl-transport`, `investigation-executor.wsl`, `…wsl.real` (opt-in), `executor-readiness` | Provas |

Configuração (todas obrigatórias; ausência/`native` = comportamento anterior):
`ANIMA_INVESTIGATION_CODEX_TRANSPORT=wsl`, `ANIMA_CODEX_WSL_DISTRO`, `ANIMA_CODEX_WSL_USER`, `ANIMA_CODEX_WSL_CLI_PATH` (caminho Linux absoluto do `codex`; seu diretório entra no `PATH` para achar o Node 22 do nvm).

## Decisões

- Invocação `wsl.exe -d D -u U --cd <snapshot> --exec /usr/bin/env -u OPENAI_API_KEY -u CODEX_API_KEY PATH=… <codex> exec --sandbox read-only -c approval_policy=never …`: sem shell em nenhum lado; argv chega ao Linux idêntico (verificado com aspas, `$()`, crase, newline, barras, UTF-8).
- Snapshot, schema, resultado, HEAD/status/refs, validação de evidência e limpeza continuam no host Windows com o Git Windows.
- Pré-voos fail-closed: login por assinatura (recusa API key) antes do snapshot; `test -d/-f/-w` dos caminhos antes de lançar o Codex.
- Readiness: com o transporte configurado, a observação de `codex-cli` passa a refletir o Codex **Linux** (`--version` + login), reutilizando `classifyCodexLoginStatus`. Config inválida ⇒ `unavailable/investigation_transport_invalid`.
- Cancelamento/timeout: o mesmo `runProcess` (`taskkill /T /F` no `wsl.exe`); medido que isso encerra também a árvore Linux.

## Limitações registradas (explícitas)

1. **Isolamento do Codex.** O sandbox `read-only` do Codex limita escrita/efeitos, **não garante confinamento de leitura**: o Codex Linux enxerga o sistema de arquivos da distro e `/mnt/c` (DrvFs). O Codex roda sobre `/mnt/<drive>/…` (DrvFs), com permissões e semântica do Windows sob a distro. O isolamento efetivo vem da worktree descartável e da inspeção do host, não de um sandbox perfeito. Mesma limitação já declarada no resultado do `investigation-v1`; o modo WSL acrescenta uma linha de limitação ao resultado.
2. **Git Linux × worktree Windows.** O `.git` de uma worktree criada pelo Git Windows é um arquivo `gitdir: C:/…` que o Git Linux não interpreta. Dentro do WSL, `git` não funciona na worktree; o Codex lê arquivos, e toda verificação Git (HEAD destacado, snapshot limpo, refs, objetos/linhas de evidência) é feita pelo Windows. Nunca usar Git Linux como fonte de verdade deste snapshot.
3. **Readiness.** O provider `codex-cli` tem uma única observação. Com o transporte WSL configurado ela **não** atesta o binário nativo do Windows (coder `workspace-write`). Segregar as duas observações exigiria alterar o contrato de discovery e ficou fora do escopo.
4. `/etc/environment` e perfis Linux não foram auditados quanto a segredos; `--exec` não avalia perfis de shell e `env -u` remove as chaves de API conhecidas.
5. A primeira chamada pode demorar (a distro desliga quando ociosa).

## Provas

- Simuladas (git real + runner falso): argv/caminhos/erros/pré-voos/mutação do snapshot/timeout/cancelamento/diagnósticos de transporte; readiness nativa vs WSL.
- Operacionais (adaptador real, `runProcess` + `wsl.exe` + Codex 0.161.0 por assinatura, repositório temporário descartável, fora da fila): resultado `conclusive` com `hostVerification` íntegra; cancelamento real sem processos remanescentes; timeout derruba a árvore Linux; distro inexistente falha fechada sem snapshot nem diretório temporário.
- Comando: `set ANIMA_WSL_REAL_PROOF=1 && npx jest lib/work-orchestration/investigation-executor.wsl.real.test.ts` (em `apps/web`).

## Retomada

Aceite técnico pendente de revisão humana e commit. Ativar as 4 variáveis no ambiente do Resident Host é ato humano separado; a INV-10 só pode ser executada depois.

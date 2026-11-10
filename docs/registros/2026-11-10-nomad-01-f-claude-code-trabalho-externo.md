# NOMAD-01-F: Claude Code admitido no trabalho externo e no Single-Item — 2026-11-10

Append-only. Tipo: **desenvolvimento** (código + testes) com **consolidação de prova de laboratório** (NOMAD-01-E). Sem schema, migration, banco, attempt real ou ledger. Formato de [`README.md`](README.md). Antecede: [NOMAD-01-D](2026-11-10-nomad-01-d-cli-oficiais-e-causa-executavel-ausente.md).

## Dados

- Branch `nomad/claude-code-external-work`, base `nomad/executor-not-found-cause` = `05e4247` (cadeia `21b2af9` → `9262cfb` → `69ccb11` → `05e4247`). Não integrado, não publicado.

## 1. Prova de laboratório NOMAD-01-E (consolidada)

**Não é execução governada**: sem banco, identidade, aprovação humana, attempt ou ledger. Driver fora do repositório (`C:\dev\lab\nomad-01-e\lab-claude-harness-proof.ts`, SHA-256 `8d692c4c…b9bb`) que só instancia componentes de produção: `ClaudeCodeCoderBackend` → `WorktreeExecutorAdapter` → `verifyWorkResult`. Evidência: `C:\dev\lab\nomad-01-e\evidence-20261110-173319.json`.

- Host Nomad (win32, Node 24.17.0), ANIMA em `05e4247`. Claude Code 2.1.322, sessão de assinatura Pro.
- Backend invocado: `claude-code:default`; executável `claude`, cwd = worktree descartável em `%TEMP%\anima-wt-*\tree`, timeout 599 874 ms (deadline global de 10 min).
- Argumentos: `-p --output-format json --no-session-persistence --restricted --tools Read,Edit,Write,Glob,Grep,Bash --allowedTools "Bash(npm test:*),Bash(npm run typecheck:*),Bash(git status:*),Bash(git diff:*)" --permission-mode acceptEdits --permission-prompts none <instrução>`; instrução registrada só por tamanho (1830) e SHA-256.
- Ambiente: allowlist (19 chaves de sistema/perfil Windows + `DISABLE_AUTOUPDATER`, `NO_COLOR`); sem chaves de provedor.
- Resultado: exit 0 em 9,2 s; tentativa total 11 s; terminal `result`. Diff independente (git): só `src/slug.js`, 1+/1−, comentário preservado. Gate do host `npm.cmd test`: base exit 1 → worktree exit 0. Verifier `verified` (6 checagens, 0 violações; 2 independentes: correlação e gates; 4 atestadas; parecer advisory). Repositório de laboratório original limpo; repositório ANIMA intocado.
- Sensível: nenhum token, senha ou chave; o único dado pessoal é o nome do usuário Windows nos caminhos.

### Contenção real no Windows

Não há sandbox do sistema operacional. A contenção é do próprio Claude Code e do host: `--restricted` (documentação oficial: remove ferramentas de comando não nomeadas em `--tools`, **confina as ferramentas de arquivo aos diretórios de trabalho**, ignora settings de usuário/projeto, recusa `bypassPermissions`), Bash limitado a quatro padrões, prompts negados (`--permission-prompts none`), worktree descartável, e o host recusa por git qualquer arquivo fora do escopo antes dos gates.

## 2. Pontos de política que impediam o Claude Code no fluxo externo governado

Não bastava a lista. Admitir o Claude Code exigiu os pontos abaixo, todos preservando o envelope do Codex:

| Ponto | Antes | Agora |
| --- | --- | --- |
| `EXTERNAL_WORK_BACKENDS` (core) | `ollama`, `codex-cli` | + `claude-code`; modelo omitido ou `default` (`model_invalid_for_claude_code`); contrato idêntico ao do Codex exceto o backend |
| `singleItemContractRefusal` (core) | `claude-code` ⇒ `single_item_compute_not_allowed` | `claude-code` com `executor: worktree` e `model: default` (`single_item_claude_contract_invalid` fora disso) |
| Readiness do Single-Item (`single-item-codex-readiness.ts`) | só Codex/WSL | + Claude nativo: executável não-wrapper e sessão `authMethod: claude.ai` (`single_item_claude_authentication_unproved`; `single_item_claude_executable_invalid`). Codex continua `single_item_codex_wsl_required` |
| `probeClaudeSubscriptionReadiness` (novo, `executor-readiness.ts`) | — | `claude auth status` → `authMethod` documentado; `api_key`, `api_key_helper`, `oauth_token`, `third_party`, desconhecido ⇒ `claude_login_not_subscription`. A readiness geral (`executors check`, `work executors`) não mudou |
| Seleção (`executor-selection.ts`) | Claude sem restrição de Single-Item | com a flag estrita do Single-Item: só `default` e sem ai-memory |
| Backlog/Single-Item (`autonomous-backlog-deps.ts`) | lista `ollama`/`codex-cli`; placement Ollama pulado só para Codex | + `claude-code`; placement pulado para os dois executores nativos; rota tem de ser `claude-code:default` |
| Supervisor | conferência de rota só para Codex | `codex-cli` e `claude-code`: `modelRef` `<backend>:default` e adaptador `worktree-v1` |
| Finalização (`post-turn-observation.ts`) | observação divergente só para Codex | idem para `claude-code` (`single_item_executor_mismatch`) |
| CLI | `--backend ollama|codex-cli` | `--backend ollama|codex-cli|claude-code` |

Sem mudança, por já serem compatíveis ou fora do escopo: aprovação, classificação externa e revisão humanas; Acceptance Contract V2 e `verifier_requirement: required_fail_closed`; gates allowlistados; RPC `acquire_single_item_work_claim` (não filtra backend); custo `work_item_cost_class` (`claude-code` conta como externo, como `codex-cli`). **Permanece recusado**: o mandato de aceite antecipado (`acceptance_mandate_grant_blockers` só admite `codex-cli`/`ollama`); mudá-lo exige migration e decisão humana. Chat Dev não foi tocado.

## Provas

- Testes novos ou ajustados: proposta externa (aceite, modelo, valores inválidos, paridade com Codex, Ollama preservado, contrato passa o Single-Item), Single-Item core (envelope, retomada, nenhuma execução sem `approved`), readiness estrita (assinatura, cada `authMethod`, readiness geral inalterada, falhas fechadas, Git Bash), gate do Single-Item (nativo sem WSL, sessões não comprovadas, wrapper, contrato antes do probe, Codex ainda exige WSL), seleção (ai-memory e modelo no Single-Item), preflight do backlog, supervisor, finalização e CLI. O teste antigo que fixava `claude-code ⇒ single_item_compute_not_allowed` foi trocado deliberadamente.
- Regressão Linux: `packages/core` 130 suítes / 3263 testes; `apps/web` 3677 testes, com as **mesmas 23 falhas** pré-existentes do NOMAD-01-A (dependentes de Windows ou já falhando na base), zero novas. `tsc --noEmit` limpo nos dois.

## Limitações

- Não executado no Windows nesta rodada (os testes novos usam deps injetadas; o Nomad deve rodá-los).
- A prova governada completa (banco, aprovação humana, ledger) ainda não existe.

## Efeitos externos

Nenhum push, merge, migration, banco, Docker, Supabase ou custo de API.

## Próximo ponto exato de retomada

Validar os testes no Nomad e preparar o Supabase local descartável para a prova governada (`propose` → aprovação → classificação → `execute-one` com `claude-code` → Verifier/ledger → revisão → aceite).

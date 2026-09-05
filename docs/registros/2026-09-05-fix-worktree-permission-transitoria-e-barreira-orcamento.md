# 2026-09-05 — Correção da barreira de criação de worktree (permissão transitória) + barreira de orçamento no re-attempt

**Tipo:** investigação + correção estrutural + tentativa de re-attempt governado. **Branch:** `dev`.
**HEAD inicial:** `255a98f`. **HEAD final:** `8dc2228` (+ este registro). **`origin/main`:** `99bec54`
— **INTACTA** (sem push). Sem `db reset`.

## Objetivo

Investigar e corrigir APENAS a barreira de permissão Git que impediu o executor de criar
branch/worktree no attempt `a719efd0` do item `ce90eb14`; validar; e só então consumir +1
recuperação humana e rodar novo attempt (OpenAI coder → gate → Verifier → review). NÃO recriar,
NÃO replanejar, NÃO tocar `origin/main`.

## Investigação (evidência do attempt a719efd0)

- `execution_failed` (seq 51162, ~88 ms após `execution_started`): "Falha ao criar a worktree
  isolada: Falha ao criar worktree: Preparing worktree (new branch '…')\nfatal: cannot…" — mensagem
  truncada em 120 chars por `clip()` (worktree-executor.ts:201); o stderr real seguia após "fatal:
  cannot ".
- Executor = `paid-openai-proof-1fec42a3` (o script `prove-openai-paid-coder.ts`), MESMO host/usuário
  (GeanTeco), MESMO TEMP das provas que criaram worktrees com sucesso nesta sessão.
- Descartado como causa PERSISTENTE: reprodução do comando exato (`git -C /g/anima worktree add -b …`)
  **sucede** (exit 0), sequencial (12×) e paralela (6×); sem `.lock` órfão em `.git`; `prune` nada a
  limpar; a mensagem é "cannot create directory"-class, NÃO "detected dubious ownership" (⇒ não é
  `safe.directory`). git 2.54.0.windows.1.
- Diagnóstico: falha de filesystem **TRANSITÓRIA** no Windows — o AV/indexador segura o diretório
  TEMP recém-criado (`mkdtemp` em `%LOCALAPPDATA%\Temp\anima-wt-*`) por instantes e o `git worktree
  add` falha fechado com "cannot create directory: Permission denied". Some numa nova tentativa;
  por isso o mesmo host criou worktrees antes e falhou nesse instante.

## Correção (commit `8dc2228`, mínima, sem ampliar permissão)

`GitWorktree.create` (apps/web/lib/work-orchestration/worktree.ts) agora RE-TENTA um número BOUNDED
(3) SOMENTE em erro transitório (`isTransientWorktreeError`, puro/exportado), sempre com diretório
TEMP NOVO e após limpar estado parcial (`worktree prune` + `branch -D`), com backoff curto e
cancelável. Caminho de SUCESSO idêntico. Regressão em worktree.test.ts: padrões transitórios
retentam × determinísticos (SHA inválido) não. Validação: typecheck web 5/5; `worktree.test.ts`
**42/42** (inclui criação real via git); prova ao vivo `GitWorktree.create` contra o repo real
`G:/anima` (cria, lê arquivo, dispõe, sem sobra).

## Re-attempt governado — barreira objetiva (fronteira humana)

Estado de partida: `ce90eb14` `failed`, RETRY_READY (2 restantes), mas o attempt-budget do USUÁRIO
está esgotado (janela móvel 24h; 9 tentativas, 0 restante) — consequência de ~13 attempts desta
sessão. Passos executados e o que travou:

- `select_autonomous_work` NÃO seleciona item `failed` ⇒ pedi retry governado canônico
  (`anima work retry ce90eb14` → `request_work_retry`): item reaberto `approved` (2 restantes).
- Volta do supervisor (T1): selecionou o item → orçamento negou → `work_blocked`
  (`user_attempt_budget_exhausted`, `resolution: awaits_budget_window`). Item agora `blocked`.
- Recuperação +1 (`authorize_work_resume`, budget_blocked_attempt_v1): **RECUSADA**
  `authorization_conflict`. Causa: `work_budget_resume_authorizations` tem UNIQUE(work_item_id) e a
  autorização deste item **já foi consumida** pelo attempt `a719efd0` (`consumed_attempt_id`
  set) — a recuperação humana pré-attempt é **single-use por item** (anti-loop). Não há +1 novo a
  conceder; NÃO fabriquei autorização.

**Resolução:** o item fica `blocked`/`awaits_budget_window` — será **readmitido automaticamente**
quando a janela de 24h rolar (uma volta do supervisor/resident host chama `readmit_budget_blocked_work`),
e então o attempt roda com a criação de worktree JÁ RESILIENTE, do base `a55e316` (que contém o
teste jest pré-semeado `prove-openai-strong-e2e.test.ts`, tornando o gate provável de passar).
Alternativa que NÃO adotei: recuperação por SUCESSOR (`readHumanResumeAuthorization`) cria um novo
work item — proibido pelo recorte.

## Custo e segredos

O attempt NÃO rodou (bloqueado pré-attempt) ⇒ **zero** chamada OpenAI, zero reserva paga nesta
frente. Chave nunca logada. `origin/main` intacta; nenhuma integração/merge/publicação.

## Estado para retomada

- `dev`@`8dc2228` (local; correção de worktree + este registro). Item `ce90eb14` `blocked`
  (`awaits_budget_window`), retry já solicitado, base `a55e316`.
- **Próximo passo (tempo/humano):** quando a janela de attempts de 24h rolar (tentativas antigas
  saírem da janela), rodar uma volta do supervisor/`npm run local-host` — o item é readmitido e o
  attempt roda sozinho com a worktree resiliente. Não há mais +1 manual disponível (anti-loop);
  não fabricar successor.

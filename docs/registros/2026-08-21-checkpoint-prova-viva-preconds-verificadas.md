# Checkpoint da prova viva: commit do Codex publicado e pré-condições verificadas

Data: 2026-08-21
Tipo: governança + verificação (sem desenvolvimento novo)

## Contexto

Continuação direta do checkpoint deixado pelo Codex em
[`2026-08-21-prova-viva-pendente-janela-orcamento.md`](2026-08-21-prova-viva-pendente-janela-orcamento.md).
O Codex verificou que a prova viva de superfície segue legitimamente bloqueada
pelo orçamento e registrou o commit local `4de7bb3` **sem publicá-lo** (recusa da
sua própria proteção de egress). Esta sessão fechou esse estado e confirmou as
pré-condições não-orçamentárias.

## Reconciliação Git (real)

- Branch: `dev`.
- HEAD inicial: `4de7bb3` (commit do Codex, 1 à frente de `origin/dev`).
- `origin/dev` inicial: `5896862`.
- `origin/main`: `99bec54`, **intacta**.
- Working tree: limpa exceto `.worktrees/` (preservado); `.claude/settings.local.json`
  e `apps/web/.env.local` preservados.

## Revisão e publicação de `4de7bb3`

Revisão forense do commit `4de7bb3` (docs-only, +97/-0 em 3 arquivos:
`anima-prd.md`, `docs/planos/002-modo-autonomo-v0.md`, e o registro do Codex):

- Conteúdo = documentação operacional (estado vivo + registro append-only).
- Varredura por segredos/PII (jwt `eyJ…`, `sb_secret`, `-----BEGIN`, senha,
  api-key, token, cookie, `postgres:postgres`, e-mail, UUID): **nenhum achado**.
- `git diff --check`: PASS. Sem `.env`, caches, `.next`, `node_modules` ou artefatos.
- `origin` = `https://github.com/GeanPfefer/anima.git` — remoto normal do projeto
  (mesmo destino de todos os pushes anteriores desta linha).

Conclusão: documentação legítima do projeto, sem material sensível. A hesitação do
Codex era guarda genérica de egress, não barreira de projeto. **Push realizado:**
`5896862..4de7bb3 dev -> dev`. Agora `dev == origin/dev == 4de7bb3`; `origin/main`
segue `99bec54`. (Isto corrige o estado "ainda NÃO foi enviado ao remoto" do
registro anterior.)

## Verificação do orçamento (fonte de verdade canônica)

Reconstruída a decisão pela RPC canônica do domínio
`private.autonomous_work_budget_decision` (leitura, sem criar sessão/proposta/
tentativa), às `2026-08-21 20:06 -03:00`:

- `admitted=false`; `reason=user_attempt_budget_exhausted`;
- `userAttempts24Hours=6`; `remainingUserAttempts=0`; limite do item `3`;
- `userRuntimeSeconds24Hours=354` (teto 7200); `autonomousRuntimeSeconds60Minutes=0`
  (reserva 2700); política `autonomous-work-budget-v1`.

A prova viva permanece legitimamente bloqueada. **Nada foi contornado**: nenhum
teto alterado, nenhum timestamp/dado real editado, nenhuma proposta/tentativa
criada, nenhum usuário alternativo. A janela do teto de 6/24h libera após a
primeira `execution_started` sair das 24h (projeção `~2026-08-22 10:25 -03:00`);
a retomada deve reconsultar a RPC canônica, não o relógio.

## Pré-condições NÃO-orçamentárias (verificadas prontas)

- **Coder backend:** `qwen3-coder:latest` presente no Ollama local (`/api/tags`).
- **Código:** a correção da resolução do Next/typegen em worktree já está no HEAD
  (ancestral `3d6fb9d`/`6bef210`), então `Next typegen → typecheck web` no worktree
  está coberto por prova viva anterior.
- **base_sha:** o HEAD autorizado (`4de7bb3`) é docs-only sobre o código de
  `5896862`; serve de `base_sha` da prova sem regressão de código.

Ou seja: **o único impedimento é a janela do orçamento.** Nenhuma outra
pré-condição bloqueia a prova.

## Busca por gaps adjacentes (resultado: nenhum implementável agora)

Investigados, sem encontrar recorte concreto/causal/comprovável independente da
prova bloqueada:

- **Gatilho de roteamento na retomada por orçamento:** `enforce_autonomous_
  routing_on_attempt` é agnóstico ao `reason` (só correlaciona attempt_id,
  classificação e executor). O `execution_started` `budget_resumed` passa nas
  mesmas condições dos resumes humano/abandono ratificados — coberto por analogia
  estrutural + teste de integração do Supervisor (que grava roteamento antes do
  begin). Não é gap.
- **Posição na fila após re-admissão:** `autonomous_work_queue` usa o `work_approved`
  vigente (maior seq) como `approval_seq`. A re-admissão por orçamento emite
  `work_approved` e reseta a posição — **idêntico** ao resume humano
  (`respond_to_work_decision` também reemite `work_approved`). Comportamento
  consistente e ratificado; alterá-lo para preservar prioridade seria decisão
  arquitetônica de fairness, sem evidência para abrir agora.

Nenhuma feature nova foi criada para consumir limite (o mandato proíbe gold-plating).

## Próximo ponto exato de retomada (quando `admitted=true`)

1. Reconsultar `autonomous_work_budget_status` para o usuário real; só prosseguir se
   `admitted=true`.
2. `/api/ai/chat` cria proposta com **exatamente um arquivo descartável** em
   `apps/web`; conferir fail-closed todo o contrato persistido antes de aprovar
   (state proposed; target `project:anima`; executor `worktree`; coder_backend
   `ollama`; model `qwen3-coder:latest`; base_sha = HEAD autorizado; permissions
   `workspace_read`+`workspace_write_isolated`; included_scope exatamente esse
   arquivo; validationCriteria alcança `apps/web`; nenhum outro arquivo).
3. Uma volta real até `review`; sucesso ≠ HTTP 200. Fechar só com evidência
   persistida: `execution_started`, `checkpoint_recorded`, coder observed
   `succeeded`, gate `exitCode 0`, exatamente um arquivo alterado, result terminal,
   `verifier_opinion_recorded` `verified`, state `review`, workspace principal intacto.
4. Não versionar no `dev` o arquivo produzido pela branch do executor.

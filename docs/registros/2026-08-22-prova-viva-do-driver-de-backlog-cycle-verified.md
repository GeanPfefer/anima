# Prova viva do driver de backlog — ciclo real chat-less até `review`/`verified`

Data: 2026-08-22
Tipo: prova viva (end-to-end, local real)

## O que foi provado

UMA invocação HTTP explícita do driver de backlog atravessou, sozinha e sem
scheduler humano, o ciclo inteiro sobre trabalho REAL: leu o backlog do banco,
escolheu o item pronto, executou uma volta do Supervisor no executor de worktree
com `qwen3-coder:latest`, passou o gate, chegou a `review`, teve evidência
host-observed persistida e parecer do Verifier **`verified`**, e então parou com
razão tipada. É a demonstração viva da capacidade construída neste ciclo
(`7af0735` driver V1 + `e339136` fiação viva).

- Branch: `dev`. HEAD: `e3391369341c5c1bee80899b2fe252cd56634b4b` (inalterado). `origin/main`: `99bec54`, intacta.
- Stack local: Next dev (porta 3000), Supabase local (54321/54322), Ollama (`qwen3-coder:latest`).

## Pré-condições verificadas (pela RPC canônica, sem bypass)

- Item de fixture (usuário descartável `@test.invalid`, allowlisted): `d048e1c4-6ff9-4b05-9f8b-61e43cfcb67b`.
  Criado (`create_work_proposal`) → aprovado (`resolve_approval`) → classificado
  (`record_work_intelligence_classification`), com `execution_spec` de worktree
  (`executor=worktree`, `coder_backend=ollama`, `model=qwen3-coder:latest`,
  `base_sha=HEAD`, gate `npm run typecheck --workspace=@anima/web`).
- `autonomous_work_queue` (como o usuário): item em `queue_position 1`, `target_occupied=false` → PRONTO e livre.
- `autonomous_work_budget_status`: **`admitted=true`, `costClass="local"`**,
  `policyVersion=autonomous-work-budget-v2-local-external`, `remainingUserAttempts=6`
  — a decisão de orçamento consciente de custo (`cf8c354`) admitindo LOCAL, ao vivo.

## A invocação e o resultado tipado

`POST /api/work-orchestration/backlog-cycle` (Bearer do usuário), `{"maxTurns":1}` → **HTTP 200 em ~60s**:

```json
{"ok":true,"value":{
  "turnsExecuted":1,"itemsTouched":1,"stopReason":"max_turns_reached",
  "pending":{"readyOccupied":0,"running":0,"awaitingHuman":0,"blocked":0},
  "lastOutcome":"execution_completed",
  "turns":[{"workItemId":"d048e1c4-...","outcome":"execution_completed"}]}}
```

Leitura humana: "Executei 1 item (chegou a review) e parei porque atingi o limite
estrutural desta invocação (`maxTurns=1`)." O limite ESTRUTURAL do driver parou o
laço após uma volta completa — anti-spin ao vivo, não quota.

## Cadeia de eventos persistida (correlacionada, um por intenção)

`work_proposed → context_attached → work_approved → work_intelligence_classified →
work_routing_adjusted → work_routing_decided → work_claimed → work_started →
execution_started → checkpoint_recorded → result_submitted → work_claim_released →
host_observed_gate_evidence_recorded → host_observed_coder_evidence_recorded →
host_observed_evidence_recorded → verifier_opinion_recorded`.

- **Item final: `state=review`** (o desfecho máximo autônomo — fronteira humana). Nada aceito/autorizado/integrado/aplicado.
- **Observação host-side compartilhada** (`persistPostTurnHostObservations`, a MESMA da rota supervisor-turn) persistiu gate + coder + git + parecer, dirigida pelo ciclo.
- **Evidência de GIT observada pelo host**: `filesChanged: 1, insertions: 1` — o coder criou exatamente o arquivo do escopo, observado independentemente na branch descartável `anima-work/25bea16b-0832-4864-bf6b-99a6b2819de4`.
- **Parecer do Verifier: `verdict=verified`** — 7 checks, 0 gaps, 0 violations (3 attested + 4 independent): `correlation_verified`, `branch_ownership_verified`, `scope_independently_observed`, `scope_respected`, `status_coherent`, …

## Segurança / integridade

- Repositório real **byte-intacto**: `HEAD=e339136`, árvore limpa exceto `.worktrees/`. A worktree de execução foi descartada (não aparece em `git worktree list`).
- `origin/main` intacta; sem PR/merge/deploy/push de código pela prova. Seleção e exclusão mútua permaneceram server-side.
- Fixture descartável PRESERVADA como evidência auditável (padrão do repo; usuário `@test.invalid`, item em `review`, claim liberado — não ocupa alvo).

## Capacidade demonstrada (antes → depois)

- **Antes:** o Anima escolhia o próximo item (política pura), mas dependia de um
  agente externo (Claude/Codex/Gean) para efetivar e continuar o ciclo.
- **Depois:** UMA chamada explícita faz o Anima `ler backlog → escolher → executar →
  verificar → re-planejar → parar tipado` sozinho, com limite estrutural, fronteira
  humana (`review`) e evidência independente (`verified`). O scheduler humano por-volta
  foi eliminado dentro de uma invocação; falta apenas o gatilho de CONTINUIDADE
  (re-invocar quando há mais trabalho) — próxima fronteira, deliberadamente não-daemon.

## Próximo ponto de retomada

1. Gatilho de continuidade (host-turn/`requiresAnotherTurn` consumindo a decisão de
   backlog; ou re-invocação com `maxTurns>1` sob governança) — a última milha do laço.
2. Gate real do Resource Governor no porto `hostPermitsAutonomousWork` (hoje advisory).
3. UI "Anima está trabalhando no backlog" + razão de parada.

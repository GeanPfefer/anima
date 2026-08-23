# Resident Local Host — AUTO_EVENT_WAKE (Realtime de work_events) + prova viva

Data: 2026-08-23
Tipo: desenvolvimento + prova viva (end-to-end, local real)

`AUTO_EVENT_WAKE = PASS`

## Objetivo

Eliminar o polling como mecanismo PRIMÁRIO de wake do resident host. Antes: o runner só
acordava por timer lento (poll) ou stdin explícito. Agora: um sinal EVENT-DRIVEN (Realtime
de `work_events`) acorda o runner quando algo muda; o poll vira apenas SAFETY NET.

- Branch: `dev`. HEAD inicial: `7178780`. HEAD final: commit deste registro.
- `origin/main`: `99bec54`, intacta.

## Princípio (fonte do wake ≠ fonte da decisão)

O evento só diz "acorde". Após acordar, o runner **reconcilia** e a política pura
(`planAutonomousBacklogTurn`) + o Governor + os claims server-side decidem o que fazer. Por
isso evento **perdido** (fallback de poll reconcilia depois) ou **duplicado** (coalescido) é
SEGURO — o DB/domínio continua a autoridade.

## Mudança (`0b24573`)

- **Migration `20260823000000_work_events_realtime`**: adiciona `public.work_events` à
  publicação `supabase_realtime` (aditivo, idempotente, INSERT-only → sem `REPLICA IDENTITY
  FULL`). A **RLS de `work_events` é a autoridade**: o Realtime aplica a política SELECT por
  assinante usando o JWT do usuário — o resident host (Bearer do usuário) só recebe os
  eventos DAQUELE usuário. **Sem service_role.** (Estado prévio investigado: container
  Realtime rodando, publicação existia VAZIA, nenhum uso de Realtime/LISTEN-NOTIFY no
  código — não havia caminho a reutilizar.)
- **`lib/resident-host/wake.ts` — `WakeCoordinator`**: une as fontes atrás do porto
  `waitForWake`. COALESCE (sinais durante o running viram UM wake pendente → 20 eventos = 1
  reconcile; sinais durante a espera resolvem-na), fallback de poll (safety net), dispose no
  shutdown. Puro-ish, timer injetável. **9/9.**
- **`lib/resident-host/realtime-wake.ts` — `subscribeWorkEventsWake`**: assina INSERT em
  `work_events` (canal autenticado com o Bearer do usuário via `realtime.setAuth`); `onWake`
  a cada evento; `dispose()` remove o canal. Best-effort: falha de assinatura não derruba o
  runner (poll cobre). **4/4.**
- **engine**: `WakeReason` ganha `'event'`. **entry**: coordenador + assinatura Realtime
  (best-effort, com identidade inicial) + stdin explícito + telemetria `wakeSource`; dispõe
  a assinatura + o coordenador no shutdown.

## Provas

- resident-host **76/76** (engine 26 + ports 31 + in-process 6 + wake 9 + realtime 4);
  typecheck **5 workspaces** PASS; `git diff --check` limpo.

### Prova viva — o EVENTO (não o timer) causa a execução

Stack: Supabase + Ollama up, **Next dev DERRUBADO** (porta 3000=000). Runner (transport
`in_process`, autonomy=enabled, `idleMs=600000` → poll efetivamente DESLIGADO por 10min,
`maxIterations=2`) iniciado com o usuário `8d5b2f7b` (que já tinha um item em `review`).

Cronologia (telemetria real):
```
02:56:00 waiting_human_or_recovery (iter0: item existente em review; nada elegível)
02:56:01 realtime status=SUBSCRIBED
02:56:31 [PROCESSO SEPARADO cria+aprova+classifica o item d4f8b6ac]
02:56:32 wake wakeSource=event   ← 31s depois; o poll (600s) NÃO podia ter disparado
02:56:32 reconcile → running (executa IN-PROCESS)
02:57:15 idle (host-turn ok, cyclesExecuted=1)
02:57:15 wake wakeSource=event   ← pendente coalescido dos próprios eventos da execução
02:57:15 stopping → stopped (max_iterations); realtime status=CLOSED (assinatura disposta)
```

**A linha `wakeSource=event` aos 31s, com o poll em 600s, é a prova central:** foi o
EVENTO Realtime — disparado por um PROCESSO SEPARADO criando o item — que acordou o runner,
não o timer. Nenhum `wakeSource=poll` ocorreu.

Desfecho persistido (item `d4f8b6ac`, `state=review`): **Verifier `verdict=verified`** — 7
checks, 0 gaps, 0 violations. Gate `typecheck @anima/web` PASS; coder `qwen3-coder`; worktree
descartada. Repo byte-intacto (`HEAD=7178780`), `origin/main` intacta, arquivo de rascunho
ausente do repo principal. Fixture PRESERVADA.

Cobertura dos cenários exigidos: (1) idle+evento→wake→execute ✓ (vivo); (2) eventos
duplicados coalescidos ✓ (wake.test + os múltiplos INSERTs da criação viraram 1 wake); (3)
evento durante running→pendente, sem run paralelo ✓ (o 2º `wakeSource=event` veio dos
eventos da própria execução, sem 2ª execução concorrente); (4) evento perdido→poll fallback
✓ (coordenador); (5) human-only→wait/idle ✓ (iter0 waiting_human_or_recovery); (6/7)
resource pressure/recovery ✓ (engine); (8) kill-switch disabled→não executa ✓ (engine); (9)
auth ausente→fail-closed ✓ (engine/ports); (10) shutdown→assinatura disposta ✓ (realtime
CLOSED).

## Invariantes

Desfecho máximo `review`. Identidade user-scoped Bearer/RLS — **sem service_role** (a
assinatura Realtime usa o JWT do usuário). Governor por-ciclo. SELEÇÃO/EXCLUSÃO server-side.

## Próximo ponto de retomada

1. **Telemetria durável mínima** (Prioridade 3): por que acordou (wakeSource), que item,
   por que parou, enabled/disabled — sem construir observability platform. Investigar se
   pertence a `work_events` (talvez NÃO: eventos do host não são de um work_item) → log
   estruturado / append-only host log / outra projeção.
2. Backlog canônico/documental: descoberta read-only → candidato tipado → materialização.
3. Refinos: re-subscrição do Realtime no refresh de token (hoje token inicial + poll cobre);
   derivar o conjunto MÍNIMO de eventos que devem acordar (hoje qualquer INSERT acorda — é
   barato, o reconcile decide).

# Prova viva do host-turn — continuação entre ciclos (2 itens, 2 ciclos, `verified`)

Data: 2026-08-22
Tipo: prova viva (end-to-end, local real)

## O que foi provado

UMA invocação HTTP do host-turn, com bounds pequenos (`maxTurnsPerCycle=1,
maxCycles=2`), rodou DOIS ciclos bounded SOZINHA: executou o item A, percebeu que
havia mais trabalho, CONTINUOU por conta própria, executou o item B, respeitou o
bound de host e parou com veredito TIPADO — sem nenhum humano entre os ciclos. É a
demonstração viva do gatilho de continuidade (`b8cac08`).

- Branch: `dev`. HEAD: `b8cac08` (inalterado). `origin/main`: `99bec54`, intacta.
- Stack local: Next dev (3000), Supabase local, Ollama `qwen3-coder:latest`.

## Resultado tipado (HTTP 200, ~70s para os dois ciclos)

`POST /api/work-orchestration/backlog-host-turn` `{"maxTurnsPerCycle":1,"maxCycles":2}`:

```json
{"cyclesExecuted":2,"turnsExecuted":2,"itemsTouched":2,
 "stopReason":"max_cycles_reached","continuation":"stop","moreWorkAvailable":false,
 "lastOutcome":"execution_completed",
 "cycles":[
   {"turnsExecuted":1,"stopReason":"max_turns_reached","turns":[{"workItemId":"bd3d397a…","outcome":"execution_completed"}]},
   {"turnsExecuted":1,"stopReason":"max_turns_reached","pending":{"awaitingHuman":1},"turns":[{"workItemId":"9e8f2456…","outcome":"execution_completed"}]}]}
```

Leitura humana: "Executei 2 itens em 2 ciclos e parei porque atingi meu limite de
ciclos e não sobrou trabalho elegível." O host continuou SÓ porque o ciclo 1 terminou
em `max_turns_reached` (bound atingido, pode haver mais); parou no bound de host com
`peekMoreWork=false` (fila drenada) → `continuation=stop`, `moreWorkAvailable=false`.

## Invariante crítico provado AO VIVO: um item em review NÃO congela o backlog

No **ciclo 2**, `pending.awaitingHuman:1` = o item A já estava em `review` (fronteira
humana) e, ainda assim, o item B (independente, pronto, mesmo alvo já liberado) foi
executado. A → review não congelou a fila; B seguiu. Exatamente o teste #3 do handoff,
agora em execução real, não só por doubles.

## Evidência persistida por item (ambos idênticos)

Item A `bd3d397a-1d73-44b2-b26a-4b76f6804584` e item B `9e8f2456-00b1-4a4d-8360-dae1a46148f6`:

- **`state=review`** (desfecho máximo autônomo — fronteira humana).
- Cadeia host-observed completa: `host_observed_gate_evidence_recorded` +
  `host_observed_coder_evidence_recorded` + `host_observed_evidence_recorded` (git) +
  `verifier_opinion_recorded`.
- **Verifier `verdict=verified`** (7 checks, 0 gaps, 0 violations) para AMBOS.

Cada ciclo usou a MESMA maquinaria já provada (`buildProjectBacklogCycleDeps`:
worktree/qwen3-coder + observação host-side compartilhada). Itens no MESMO alvo
`project:anima` rodaram SEQUENCIALMENTE (exclusividade de alvo do SUP-05): um por ciclo.

## Segurança / integridade

- Repositório real **byte-intacto**: `HEAD=b8cac08`, árvore limpa exceto `.worktrees/`.
  As duas worktrees de execução foram descartadas.
- `origin/main` intacta; sem PR/merge/deploy. SELEÇÃO e EXCLUSÃO permaneceram server-side
  (dois ciclos, dois claims sequenciais; nada duplicado). Dois bounds estruturais
  (`maxTurns × maxCycles`) tetaram a invocação. Nada aceito/integrado/aplicado.
- Fixtures descartáveis (`@test.invalid`, itens em `review`) PRESERVADAS como evidência.

## Capacidade demonstrada (antes → depois)

- **Antes deste ciclo:** 1 chamada externa → 1 backlog cycle bounded; um humano
  precisava iniciar a PRÓXIMA invocação.
- **Depois:** 1 chamada externa → o host roda VÁRIOS ciclos, continuando sozinho
  enquanto há trabalho e é permitido, com veredito tipado (continue|wait|stop) +
  `moreWorkAvailable`. O scheduler humano ENTRE CICLOS foi eliminado. O objetivo
  declarado do handoff — "Anima roda ciclo → percebe mais trabalho → decide continuar
  → continua sozinho → respeita bounds/human frontiers → para tipado" — está ATINGIDO.

## FRONTEIRA ARQUITETÔNICA (parada deliberada — decisão humana/ADR necessária)

Resta UMA dependência humana: **alguém ainda dispara a invocação do host-turn.**
Eliminá-la exige que ALGO reinvoque automaticamente — cron, hook pós-terminal, ou um
serviço always-on. Isso é, por construção, a "camada 3" do handoff (serviço persistente/
always-on) e tem CONSEQUÊNCIAS ARQUITETÔNICAS que pedem decisão humana/ADR — não um
daemon improvisado. Por isso PARO aqui e documento a decisão.

**O que um runner always-on precisaria decidir/garantir (a dívida de evidência):**
1. **Natureza do disparo.** Cron periódico (simples, previsível, mas "polling") vs
   event-driven pós-terminal (reativo, mas exige um watcher persistente) vs um único
   processo residente com backoff. Cada um introduz um PROCESSO com lifetime próprio.
2. **Autoridade/credencial.** As RPCs resolvem `auth.uid()` via RLS; um processo
   residente precisa de credencial de serviço/identidade própria — hoje só existe a
   sessão autenticada por requisição. Definir isso é decisão de segurança.
3. **Gate REAL do Resource Governor.** O porto `hostPermitsAutonomousWork` é hoje
   advisory (→ sempre `true`). Um always-on que inicia trabalho sem humano DEVE
   consultar um gate real (pressão de host/concorrência) antes de cada host-turn —
   promover o Governor de advisory a gate é pré-requisito, não opcional.
4. **Backoff/quiescência.** Com `continuation=wait`, quando reinvocar? Com `stop`,
   ficar quiescente até um evento? Precisa de política de espera para não virar polling
   frenético nem dormir sobre trabalho pronto.
5. **Observabilidade/parada de emergência.** Um laço autônomo persistente precisa de
   telemetria durável (persistir o resultado do host-turn) e de um kill-switch humano.
6. **Idempotência sob concorrência de hosts.** Dois runners não podem duplicar; as
   guardas de claim do banco já protegem, mas o desenho do runner deve assumir corridas.

Nada disso é código de uma sessão de fim de ciclo: é um ADR. O host-turn deste recorte
é a peça bounded, testável e provada que esse runner futuro chamará — sem reescrever
nada. As invariantes (bounds, server-side authority, human frontiers, review como teto)
já estão prontas para ele.

## Próximo ponto de retomada

1. **DECISÃO HUMANA/ADR:** desenhar o runner always-on (itens 1–6 acima). Antes dele,
   o passo de maturidade mais barato e seguro é **promover o Resource Governor a gate
   real** no porto `hostPermitsAutonomousWork` (item 3) — desbloqueia o always-on com
   segurança e é implementável sem daemon.
2. Persistência/telemetria durável do resultado do host-turn (item 5) — seam de
   observabilidade, também sem daemon.
3. UI "Anima está trabalhando no backlog" + razão tipada de parada.

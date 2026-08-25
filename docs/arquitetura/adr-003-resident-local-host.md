# ADR-003 — Resident Local Host (V0)

> Estado: **decisão de arquitetura persistida.** Este ADR resolve a última fronteira
> de scheduler humano do laço autônomo: hoje um humano ainda precisa **disparar** a
> invocação do host-turn. A prova viva de 2026-08-22 (`af240cb`) mostrou que UMA
> invocação de `POST /api/work-orchestration/backlog-host-turn` roda vários ciclos
> bounded sozinha, respeitando bounds, fronteiras humanas e — desde `8d78d90` — o
> **gate real do Resource Governor** por ciclo. Falta um **processo residente** que
> reconcilie, consulte o kill-switch, adquira identidade user-scoped, respeite o
> Governor, invoque o host-turn bounded, classifique o desfecho, entre em quiescência
> e acorde quando houver trabalho — sem cron, sem recursão pós-terminal, sem
> `service_role`, sem daemon gigante de uma vez. Este documento é a **Prioridade 1**
> do recorte; a engine V0 é implementada incrementalmente sobre ele.

Base: [ADR-001](adr-001-execucao-local-de-codigo.md) (execução local isolada por
worktree), [ADR-002](adr-002-integracao-aplicacao-publicacao.md) (fronteira de
integração fail-closed), [Marco 003](../marcos/003-trabalho-autonomo-seguro.md),
[Marco 005](../marcos/005-autonomia-progressiva-e-identidade-una.md) (autonomia como
maturidade, não teto) e o [Plano 002](../planos/002-modo-autonomo-v0.md).

## Contexto: o que já existe (e por que falta só o processo)

O laço autônomo já está **construído e provado ao vivo**, camada por camada, e nada
disto se reescreve:

1. **Política pura** `planAutonomousBacklogTurn` ([core](../../packages/core/src/work-orchestration/autonomous-backlog.ts)):
   sobre o backlog, decide `execute_next | stop{reason,pending}`. Item bloqueado nunca
   congela a fila.
2. **Driver de UMA volta bounded** `runAutonomousBacklogCycle`
   ([apps/web](../../apps/web/lib/work-orchestration/autonomous-backlog-driver.ts)):
   consome a política, roda uma volta do Supervisor por iteração, classifica, para sem
   spin, limitado por `maxTurns`, cancelável.
3. **Continuação ENTRE ciclos** `runAutonomousBacklogHostTurn`
   ([apps/web](../../apps/web/lib/work-orchestration/autonomous-backlog-host-turn.ts)):
   roda até `maxCycles` ciclos bounded, continuando sozinho enquanto um ciclo termina
   em `max_turns_reached`, parando com veredito TIPADO `continue|wait|stop` +
   `moreWorkAvailable`. **Dois bounds estruturais** (`maxTurns × maxCycles`) = teto
   absoluto de execuções por invocação.
4. **Gate real do Resource Governor** por ciclo (`8d78d90`): o porto
   `hostPermitsAutonomousWork` deixou de ser constante — `readResourceAdmission`
   ([apps/web](../../apps/web/lib/work-orchestration/resource-governor.ts)) amostra o
   host antes de cada nova volta e `decideResourceAdmission` (core) decide
   `permit | defer | fail_closed`. Pressão `moderate/high` ⇒ `resource_pressure`;
   telemetria `unknown`/erro ⇒ **fail-closed**.
5. **Fronteira de autenticação** `authenticateRequest`
   ([apps/web](../../apps/web/lib/supabase/request-auth.ts)): identidade SEMPRE de
   `auth.uid()` resolvido pelo GoTrue, via cookie web **ou** `Authorization: Bearer
   <access token>` (paridade mobile). **Nenhuma `service_role` em lugar algum** do
   `apps/web` (verificado por `grep`).
6. **Rota de transporte** `POST /api/work-orchestration/backlog-host-turn`
   ([apps/web](../../apps/web/app/api/work-orchestration/backlog-host-turn/route.ts)):
   autenticada, bounds `{maxTurnsPerCycle (default 1, teto 10), maxCycles (default 2,
   teto 10)}`, resultado tipado. É a peça bounded, testável e **provada ao vivo** que
   um runner residente chamará sem reescrever nada.

**A única dependência humana restante é o DISPARO.** Este ADR desenha o processo que
o elimina, incrementalmente, sem afrouxar nenhuma proteção.

## As 16 decisões

### 1. Onde o processo reside

Um **processo Node residente**, iniciado explicitamente por Gean (`anima local-host
start`), que permanece vivo, quiescente por padrão, e acorda para invocar o host-turn
bounded. Não é serviço do Windows, não tem auto-start no boot (recortes posteriores).

O **engine** (o laço e a classificação de desfecho) é **agnóstico de transporte**: ele
recebe as capacidades como **portos injetados**. Isso permite testá-lo por doubles (as
15 regressões exigidas) sem rede nem banco, e trocar o transporte no futuro sem tocar o
laço. Home do código: `apps/web/lib/resident-host/` (engine + portos, ao lado da
maquinaria que compõe) e `apps/web/scripts/resident-host.ts` (a superfície `start`).
Node 24 roda TypeScript nativamente, então a superfície é `node apps/web/scripts/resident-host.ts`
— sem bundler, sem novo runtime pesado. Os `import type` do vocabulário compartilhado
(`BacklogContinuation`, `BacklogHostTurnResult`) são apagados em runtime.

### 2. Relação com `anima-local-agent-poc` / `tools/local-agent`

**Não é a casa correta, e documenta-se por quê.** `tools/local-agent` (o
`anima-local-agent-poc` vendorado como subtree) é um **executor de código Python
isolado em contêiner** — um *CoderBackend* candidato (harness DeepSeek), invocado
**por** o worktree executor como uma das opções de backend. É uma camada de
**execução isolada**, não de **orquestração**.

Todo o orquestrador — política de backlog, driver, continuação de ciclo, Supervisor,
Verifier, Resource Governor, evidência host-observed — é **TypeScript** em
`@anima/core` + `apps/web`. Reimplementar o laço em Python duplicaria toda essa pilha
e criaria um segundo runtime paralelo, exatamente o que o norte proíbe. Portanto:

- O **resident host é um processo Node** que reusa o runtime TS existente.
- O **`tools/local-agent` permanece** o executor isolado que o caminho de worktree
  **pode** chamar. Camadas diferentes, sem runtime paralelo novo.

### 3. Ownership do processo

O processo é de **Gean** (o criador da instância). Ele o inicia; ele o para (kill-switch
ou sinal). O processo **age como o usuário** (decisão 11), nunca como um serviço
privilegiado. Nenhuma outra entidade o possui.

### 4. Lifecycle

Estados observáveis (vocabulário reusado do domínio quando possível):

```
starting → idle ⇄ running
                    │ (por desfecho do host-turn)
   waiting_resource | waiting_human_or_recovery | backoff | disabled
                    ↓ (sinal de parada / cancelamento)
              stopping → stopped
```

- `starting`: reconciliação de arranque (decisão 10) antes de qualquer execução nova.
- `idle`: quiescente; fila drenada; aguarda wake.
- `running`: invocando um host-turn bounded.
- `waiting_resource`: o Governor adiou (pressão); backoff antes de reamostrar.
- `waiting_human_or_recovery`: só fronteira humana / alvo ocupado / tentativa aberta /
  janela de orçamento — nada executável agora; **sem spin**, aguarda wake.
- `backoff`: erro do host-turn; espera crescente, **não** tight retry.
- `disabled`: kill-switch desligado; nenhum trabalho novo; aguarda wake.
- `stopping`/`stopped`: encerramento determinístico por cancelamento.

**Nenhum estado efêmero novo é persistido.** O DB/event log continua a autoridade do
estado de trabalho (decisão 10). Os estados de lifecycle são só telemetria in-memory +
log estruturado (decisão 14).

### 5. Startup

`anima local-host start`:
1. Carrega config (URLs, credencial de identidade, kill-switch, bounds, intervalo de
   wake) — tudo por env/arquivo local, nada no Git.
2. Emite `starting`; executa **reconciliação de arranque** (decisão 10).
3. Entra no laço: começa quiescente (`idle`) e só age quando há trabalho elegível e é
   permitido.

### 6. Quiescência

Por padrão o processo **dorme** (`idle`). Ele **não** faz polling frenético: o timer de
wake é lento e configurável (decisão 7), e serve só como "olhe de novo". A elegibilidade
vem do **domínio** (o backlog projetado pela rota), nunca do relógio. Sem trabalho ⇒
volta a `idle` sem consumir CPU em laço apertado.

### 7. Wake model

Um host acorda por uma de quatro condições (a que ocorrer primeiro):

1. **Reconciliação de arranque** (uma vez, no start/restart).
2. **Wake explícito** (sinal do SO / arquivo de wake / linha em stdin) — para provas e
   controle manual.
3. **Trabalho elegível novo/alterado** — o ideal event-driven.
4. **Condição de recuperação** (backoff vencido, janela de recurso/ orçamento reaberta).

**V0:** não há hoje um barramento de eventos confiável para (3). O V0 usa **poll lento,
cancelável e configurável** como wake PROVISÓRIO, combinado com (2) wake explícito. O
registro deixa claro: **o wake automático event-driven é a próxima fronteira**; a
elegibilidade continua vindo do domínio, e o poll é só o nudge de "reavaliar".

### 8. Backoff

- Após `resource_pressure`: espera antes de reamostrar o Governor (evita marteladas sob
  pressão). Crescente até um teto, com reset ao voltar a executar.
- Após erro do host-turn: backoff exponencial com teto e jitter — **nunca** tight retry.
- Após `wait` de fronteira humana: **não** é erro; entra em quiescência e aguarda wake
  (o estado muda por ação humana/recuperação, não por retry).
- Após `continue`+`moreWorkAvailable`: **sem** espera — reavalia imediatamente (o topo
  do laço re-checa kill-switch e Governor). É o único caminho "rodar de novo já".

Backoff é uma **função pura** injetável, provável isoladamente.

### 9. Kill-switch (AUTONOMY ENABLED / DISABLED)

Controle explícito, consultado **antes de cada novo trabalho**, **fail-closed**:

- V0 = **control-plane local**: um arquivo (`ANIMA_AUTONOMY_FILE`) e/ou env
  (`ANIMA_AUTONOMY_ENABLED`). Ausente/ilegível/valor ≠ habilitado ⇒ **desabilitado**.
- Habilitado ⇒ o laço pode iniciar um host-turn. Desabilitado ⇒ estado `disabled`,
  **zero** nova execução, aguarda wake (não mata execução já iniciada — decisão 4).
- É **observável** (log estruturado de cada transição para/de `disabled`).
- Sem UI neste recorte (recorte posterior).

### 10. Crash recovery

Ao iniciar **ou reiniciar**, antes de qualquer trabalho novo, o runner **reconcilia o
estado persistido**: as tentativas abertas/claims expirados são resolvidos pelos
**contratos de recuperação já existentes** (SUP-04: `reconcile_supervised_work` por
limite persistido; SUP-05: exclusividade de alvo). No V0 isso ocorre porque o próprio
host-turn, na sua primeira volta, atravessa a reconciliação do Supervisor. O runner
**não** usa a memória do processo como fonte da verdade e **não** cria
`runner_state.json` como autoridade do backlog. O DB/event log é a autoridade; o runner
só orquestra invocações bounded sobre ele.

### 11. Identidade user-scoped (regra canônica)

**O Anima local age COMO o usuário.** Identidade padrão user-scoped, `auth.uid()`, RLS
normal, mesmas fronteiras de autorização. **Nunca** `service_role`, **nunca** UUID
hardcoded, **nunca** token no repo, **nunca** senha plaintext.

O mecanismo é o caminho **Bearer** já provado (paridade mobile,
[`request-auth.ts`](../../apps/web/lib/supabase/request-auth.ts) +
[`server.ts`](../../apps/web/lib/supabase/server.ts) `createBearerClient`): o processo
detém um **access token** de usuário (e um refresh token para renová-lo), obtido por
sign-in do próprio usuário contra o GoTrue local (`grant_type=password` com a anon key +
credenciais do usuário; renovação por `grant_type=refresh_token`). Toda chamada carrega
`Authorization: Bearer <token>`; a rota valida com `getUser(token)` antes de qualquer
efeito. RLS e `auth.uid()` são a autoridade.

Como o mecanismo de sessão local persistente completo ainda **não** existe, o V0 **separa**:

- **runner engine** (o laço, agnóstico de identidade); e
- **auth/session provider port** — `acquireIdentity(): Promise<Identity | null>`.

O engine é **fail-closed sem identidade**: `null` ⇒ nenhuma execução, estado de espera,
aguarda wake. O provider é **injetável** (testado por doubles). Em V0 o provider real
lê a credencial de um **local seguro** (env/arquivo ignorado pelo Git, como o
`apps/web/.env.local` já usado nas provas vivas) e a troca por um access token via
GoTrue; a evolução para um cofre de sessão local persistente e refresh contínuo é a
próxima fronteira de identidade, **sem** mudar o contrato do porto.

### 12. Concorrência / idempotência

A proteção autoritativa contra dois hosts é o **banco**: claims exclusivos, exclusividade
de alvo (SUP-05), seleção server-side. Um segundo resident host iniciado por engano **não
duplica execução** — ele perde a corrida do claim e o host-turn devolve `wait`/`stop`. O
runner **não** é um mutex de segurança; um lock local é, no máximo, otimização, nunca
fonte da verdade. O engine assume corridas: perder o claim é um desfecho normal, não erro.

### 13. Integração com o Resource Governor

O gate real vive **dentro** do host-turn (decisão do `8d78d90`): `hostPermitsAutonomousWork`
consulta `readResourceAdmission()` por ciclo. O resident host tem **uma única autoridade
de Governor** (`decideResourceAdmission`/`classifyMachinePressure`), consultada em dois
sítios fail-closed como defesa em profundidade:

- **Pré-gate do engine** (opcional, mesmo `readResourceAdmission`): antes de invocar o
  host-turn, se a admissão não for `permit`, o engine vai a `waiting_resource` sem
  invocar — "gate reavaliado antes de cada novo trabalho" (regra do norte).
- **Por ciclo dentro do host-turn**: o gate que Codex construiu, inalterado.

Ambos usam a MESMA política pura; não há segunda implementação. Um resultado de host-turn
`resource_pressure`/`wait` também leva o engine a `waiting_resource` + backoff. Execução
já iniciada **não** é morta por pressão (só admissão é bloqueada).

### 14. Telemetria

O runner **expõe/loga** estado humano-legível: `idle`, `running`, `waiting_resource`,
`waiting_human_or_recovery`, `backoff`, `disabled`, `stopped`, além do resultado tipado
de cada host-turn (`cyclesExecuted`, `continuation`, `moreWorkAvailable`, `stopReason`).
V0 = **log/eventos estruturados** (sem UI). Persistência durável do resultado do
host-turn (seam de observabilidade sem daemon) é um recorte adjacente, também sem daemon.

### 15. Restart / reboot

Reinício = novo `start` explícito (sem auto-start no boot em V0). Cada start executa a
reconciliação de arranque (decisão 10) antes de trabalho novo. O estado durável do
trabalho está no banco, então um reinício **retoma pela reconciliação**, nunca por
memória de processo.

### 16. Relação futura com Computer / Local Interaction

O resident host é o **substrato natural** para as capacidades locais futuras
(Marco 007 — interação com computador/apps sob mandato; Ollama; filesystem/shell;
browser/apps). O V0 é deliberadamente mínimo — só orquestra o host-turn — mas o desenho
por **portos injetados** deixa o caminho aberto: novas capacidades entram como novos
portos governados pelo mesmo lifecycle (kill-switch, identidade, cancelamento, backoff,
telemetria), sem reescrever o laço. Nenhuma capacidade de interação com computador é
adicionada neste recorte.

## Transporte do V0: HTTP para a rota provada

O porto `runHostTurn` do engine é, no V0, um **POST autenticado à rota
`/api/work-orchestration/backlog-host-turn`** do stack local (Bearer), porque:

- reusa **100%** da maquinaria provada (Governor gate, host-turn, driver, Supervisor,
  worktree/qwen3-coder, Verifier) **sem reescrever nada**, atrás da fronteira de auth real;
- é executável por `node` puro (fetch nativo), sem imports profundos de workspace —
  coerente com a metodologia das provas vivas anteriores (atingir a rota contra o stack
  local rodando);
- é **live-provável** neste recorte.

Como o engine é agnóstico de transporte, um recorte futuro pode trocar `runHostTurn` para
composição **in-process** (`buildProjectBacklogCycleDeps` + `runAutonomousBacklogHostTurn`
atrás de um `createBearerClient`) — movendo a maquinaria para dentro do processo residente
— **sem tocar o laço**. É a rota de evolução para o "substrato local" pleno (decisão 16).

## Invariantes de segurança (herdados, não afrouxados)

- **Desfecho máximo `review`** — nada aceito/autorizado/integrado/aplicado; sem
  merge/push/deploy/PR.
- **SELEÇÃO/EXCLUSÃO server-side** — o banco é a autoridade; o host pode perder corrida.
- **Fail-closed** em identidade ausente, kill-switch desligado, Governor não-`permit`,
  telemetria `unknown`.
- **Bounds estruturais** (`maxTurns × maxCycles`) tetam cada invocação; o resident host
  adiciona **quiescência + backoff**, nunca um `while(true)` ingovernável.
- **Cancelamento** atravessa runner → host-turn → ciclo → supervisor → executor.
- **Sem `service_role`, sem segredo no Git, sem daemon gigante**; incremental.

## O que este ADR NÃO autoriza

- Auto-start no boot / serviço do Windows.
- Wake automático event-driven (poll lento é o stopgap declarado do V0).
- Qualquer efeito externo novo (integração, merge, deploy).
- Qualquer capacidade de interação com computador/apps.
- Cofre de sessão local persistente com refresh contínuo (o porto está pronto; a
  implementação plena é a próxima fronteira de identidade).

## Próximo ponto exato de retomada

Implementar a **engine V0** sobre este ADR: engine agnóstica de transporte + portos
(identidade Bearer fail-closed, kill-switch de control-plane local, Governor pré-gate,
`runHostTurn` HTTP, wake por poll+explícito, backoff puro) + a superfície `anima
local-host start` + as 15 regressões por doubles. Depois, a prova viva V0 (runner idle →
wake → um item descartável → governor permite → qwen3-coder → gate → evidência
host-observed → Verifier `verified` → item em `review` → runner volta a idle).

## Adendo 2026-08-24 — autoridade de execução e retry governado

A rota web de uma volta havia permanecido como seam legado e aceitava um item
explícito; por isso a primeira execução do backlog conversacional tentou `git
worktree add` dentro do processo `next dev`. Esse caminho foi fechado: a UI grava
somente um sinal autenticado/idempotente e a rota explícita recusa com
`resident_host_required`. A composição efetiva de worktree, coder, gates e
observações permanece em `runProjectBacklogHostTurn`, chamada pelo adapter
**in-process** do Resident Host com cliente Bearer user-scoped e Governor por ciclo.

Falhas técnicas `retryable` não são apagadas nem editadas. `RETRY_READY` é uma
projeção fail-closed; o ato humano usa o evento existente `work_approved` com
`authority=retry_authorization`, distinguindo retry de aprovação de escopo e de
autorização financeira. Esse evento apenas reabre a elegibilidade; claim e attempt
novos continuam pertencendo ao Resident Host e recebem identidades novas.

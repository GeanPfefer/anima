# Fiação viva do driver de backlog — projeção real, rota explícita e observação compartilhada

Data: 2026-08-22
Tipo: desenvolvimento (fiação viva) + prova por doubles + refatoração segura

## Objetivo

Dar ao driver do backlog (recorte anterior, `7af0735`) uma superfície de invocação
REAL: uma projeção do backlog a partir do banco, uma rota explícita que roda o ciclo
pela MESMA maquinaria do turno único (worktree/qwen3-coder + observação host-side), e
o compartilhamento dessa observação com a rota `supervisor-turn` (sem duplicar/derivar).

- Branch: `dev`. HEAD inicial: `7af0735`. `origin/main`: `99bec54`, intacta.

## Mudanças

1. **Driver consome a ENTRADA escolhida.** `runTurn(entry, signal)`: a política
   escolhe o item e o driver o passa ao Supervisor como `requestedWork` — apenas uma
   DICA, porque `select_autonomous_work` revalida server-side (elegibilidade/versão/
   alvo) e devolve vazio se a corrida foi perdida. Isso habilita o caminho de worktree
   por item no ciclo (o único com evidência host-observed). 33/33 do driver seguem verdes.

2. **Observação host-side pós-volta EXTRAÍDA e COMPARTILHADA**
   (`post-turn-observation.ts`): `persistPostTurnHostObservations` — evidência de gate/
   coder/git observada pelo host + parecer do Verifier sobre o estado fresco, tudo
   fail-open. A rota `supervisor-turn` foi **refatorada** para consumi-la (removendo o
   bloco inline duplicado); a rota do ciclo usa a MESMA função → zero divergência. As
   **11/11** provas da rota `supervisor-turn` permanecem verdes (comportamento idêntico).

3. **Projeção real do backlog** (`autonomous-backlog-read.ts`):
   `readAutonomousBacklogCandidates(client)` monta `AutonomousQueueCandidate[]` do banco
   — itens não-terminais (RLS escopa ao dono) + aprovação vigente (maior `seq` de
   `work_approved`) + claim em aberto (`released_at IS NULL`) + classificação vigente
   (RPC canônica). **Não é autoridade** de seleção/exclusão (o banco é); alimenta só a
   POLÍTICA. Fail-closed por item (linha inválida sai do backlog; falha de leitura ⇒
   `[]` ⇒ driver para em `no_eligible_work`). Divergência com o SQL é SEGURA: no pior
   caso o driver tenta uma volta que o servidor recusa, ou para uma invocação cedo.

4. **Rota explícita** `POST /api/work-orchestration/backlog-cycle`: autentica, valida/
   limita `maxTurns` (padrão 3, teto 10 — limite ESTRUTURAL por invocação, não quota),
   e roda `runAutonomousBacklogCycle` com `readBacklog` real, `hostPermitsAutonomousWork:
   () => true` (Resource Governor ainda advisory; porto pronto para o gate), e um
   `runTurn` que resolve o executor de worktree pelo contrato do item, chama
   `runSupervisorTurn` e observa a volta. Execução DESACOPLADA do transporte HTTP (sinal
   próprio nunca abortado; `maxTurns` + fronteiras humanas são as paradas). Desfecho
   máximo continua `review`.

## Provas (Jest, por doubles)

- `autonomous-backlog-driver.test` **33/33** (assinatura `runTurn(entry, signal)`).
- `post-turn-observation` compartilhada; `supervisor-turn/route.test` **11/11** (ref
  comportamento idêntico após a extração).
- `autonomous-backlog-read.test` **4/4** (aprovação de maior seq, claim aberto,
  classificação inválida→null, linha inválida descartada, falha→[]).
- `backlog-cycle/route.test` **6/6** (401 sem auth; 400 maxTurns inválido; portos
  passados; teto de maxTurns; `runTurn` resolve worktree+Supervisor+observação;
  executor não-resolvível→`selection_not_executable` sem Supervisor).
- apps/web `tsc --noEmit` PASS. Suíte `lib/work-orchestration` verde.
- Flake NÃO relacionado registrado: `lib/ai/project-tools.test.ts` (`project_search`
  subprocess) falha só sob carga paralela da suíte inteira; passa isolado **4/4**.

## Deliberadamente NÃO feito (próximo)

- **Prova viva REAL** da rota do ciclo contra o banco/coder locais (validação das
  QUERIES reais de `readBacklog` e do end-to-end) — registro próprio.
- Gate real do Resource Governor (hoje advisory); classificação-sob-demanda no ciclo
  (itens não classificados simplesmente não ficam prontos — a rota explícita
  `supervisor-turn` mantém a ponte de classificação). UI "Anima trabalhando no backlog".
- DRY total: a rota `supervisor-turn` ainda tem seu próprio pré-turno (seleção de
  executor + ponte de classificação); só a OBSERVAÇÃO foi unificada.

## Invariantes de segurança

Sem tabela nova, sem daemon. Seleção/exclusão server-side; desfecho máximo `review`;
sem aceitar/autorizar/integrar/aplicar. `origin/main` intacta; sem PR/merge/deploy.

## Próximo ponto de retomada

1. Prova viva da rota `backlog-cycle` (dev server + item pronto worktree + `maxTurns=1`,
   coder `qwen3-coder:latest`), verificando o `BacklogCycleResult` tipado e a evidência
   host-observed persistida.

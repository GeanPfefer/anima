# A2-0 / Recorte 1 — fatos auditáveis de execução (`execution_mode`, `actor_kind`) — 2026-10-16

Append-only. Tipo: desenvolvimento supervisionado, **sem aplicação no residente**. Branch isolada
`claude/a2-0-r1-execution-facts` (worktree `C:\Users\GeanTeco\anima-work-a2-0-r1`), base `7d3cf0ee`.
Nada commitado, publicado, aceito ou integrado. `dev`/`origin/dev` = `7d3cf0ee`, `origin/main` = `99bec54e` intactas.

## Objetivo

Registrar, por attempt, um **fato positivo e correlacionado** sobre COMO e POR QUEM a execução ocorreu,
em vez de inferir autonomia pela ausência de eventos humanos (limitação de `A1_PASSED`).

## Modelo de confiança

| Papel | Quem | Como é estabelecido |
|---|---|---|
| Autoridade que concede | humano (pré-mandato) ou `autonomous_policy` | **Derivada pelo banco** do ledger: último `work_approved` e `work_intelligence_classified` da versão, anteriores à attempt. O cliente não a declara; campo `authority` na evidência é recusado (chaves fechadas). |
| Runner autenticado | processo que executou | Host declara `runner.authenticatedUserId`; o host o **lê via RLS** (dono visível ao próprio token), não do ambiente. O banco confere contra o dono do item (`42501` se diverge). |
| Gravador do fato | Trusted System Writer | RPC só com `EXECUTE` para `anima_system_writer` e `trusted_system_writer_owner()`; humano, anon, service_role e runner comum são recusados. |
| Modo de execução | declarado pelo host (`ANIMA_EXECUTION_MODE`), **validado pelo ledger** | `unattended` exige claim na attempt, zero `work_supervision_leases` do item (inclusive revogadas) e zero atos humanos após o mandato. `supervised`/`manual` são rebaixamentos seguros. |

Proveniência gravada no evento: `author=system`, `origin=host`, `recorded_by=trusted_system_writer`,
`execution_mode`/`actor_kind` no topo (coerentes com a evidência assinada), `attempt_id`,
`approved_proposal_version`, `authority{approval_author, approval_authority, approved_seq, classified_seq,
leases_observed, human_acts_after_mandate}` e a evidência declarada.

## Arquivos

Novos: `packages/core/src/work-orchestration/host-observed-execution-context{,.test}.ts`;
`apps/web/lib/work-orchestration/execution-context-evidence{,.test}.ts`;
`apps/web/lib/work-orchestration/post-turn-observation.execution-context.test.ts`;
`supabase/migrations/20261016000000_host_observed_execution_context_vocabulary_candidate.sql`;
`supabase/migrations/20261016000001_host_observed_execution_context_candidate.sql`;
`supabase/tests/host_observed_execution_context.test.sql`.
Alterados: `work-orchestration/index.ts` (export), `packages/types/src/database.ts` (enum + assinatura da RPC),
`trusted-system-writer{,.test}.ts` (sink `executionContext`), `post-turn-observation.ts` (passo fail-open
`(-1)`), `native-cli-coder.observation.test.ts` (mock), `autonomy-evidence{,.test}.ts` (leitor estrito).

## Decisões

- **Evento novo, aditivo** (`host_observed_execution_context_recorded`), em vez de campos extras nos eventos de
  evidência existentes, para não tocar contratos canônicos nem o Verifier. Migrations em dois arquivos
  (`ALTER TYPE ADD VALUE` separado) e com sufixo `_candidate`.
- **Idempotência por attempt** (índice único + RPC): reobservação idêntica (sem `observedAt`) replaya **sem
  reavaliar o ledger**; divergente ⇒ `55000`.
- **Fail-open no host**: falhar em registrar nunca retém/libera candidato nem altera o Verifier; a métrica
  apenas permanece `unknown`/`human_observed`.
- **Leitor estrito** (`readPersistedExecutionContext`): só vale fato com autor `system`, origem host,
  `recorded_by`, topo igual à evidência assinada, modo×ator coerente, versão e attempt correlacionadas.
  Eventos históricos (sem os campos) e `execution_mode` solto em eventos host legados **nunca** viram prova
  (contam como `rejectedExecutionModeFacts`).

## Achado (não corrigido nesta fatia)

`start_claimed_work_attempt` grava `work_started` com `reason='supervised_execution'` e **author `user`** para
TODA attempt reivindicada (inclusive a do A1-v2: seq 86809). `computeAutonomyEvidence` desqualifica
`unattended_verified` por ambos. Logo, **mesmo com o novo fato, a métrica continua classificando attempts
reivindicadas como `human_observed`** — mantido de propósito (conservador). Reclassificar exige decisão sobre a
semântica do `work_started` emitido pelo fluxo (Recorte posterior); esta fatia não o altera.

## Provas

Ambiente descartável: container novo `anima-a2-0-r1-proof-*` (imagem Postgres 15.8.1.085 pinada
`sha256:af083ef6…`), `--network none`, sem portas/volumes/binds, tmpfs, cap-drop ALL (+4 caps de init),
1 CPU, 1 GiB. Schema restaurado por `pg_dump --schema-only` **do residente (somente leitura)** + as 27 linhas de
`work_state_transitions` e o singleton de guarda; **sem dados de usuário**. Paridade antes de aplicar: 275
funções `public`/`private` com hash idêntico, enum com 39 valores. Após aplicar as duas candidatas: **somente 2
funções novas** (`private.is_valid_host_execution_context`, `public.record_host_observed_execution_context`),
nenhum corpo existente alterado.

- pgTAP novo: **59/59** ok. Mutações detectadas (6/6): sem checagem de lease, de ato humano, de identidade do
  runner, de claim, de replay, e autor `user`.
- Regressão pgTAP no mesmo banco, depois da migration (todas verdes): coder 20, trusted_system_writer 33,
  autonomous_authorization 17, host_observed_evidence 23, gate 16, evidence_boundary 24, work_claim 31,
  single_item_work_claim 55, canonical_stamp 6, mandated_verifier_review_gate 29, human_supervised_work 12.
- Core: 124 suítes / 2938 testes (antes 123 / 2911). `tsc` core e web limpos. `git diff --check` limpo.
- Web (`lib/work-orchestration`, `cli`, `evolution`): 129/130 suítes na rodada ampla; as falhas observadas foram (a) timeouts de 30 s em
  testes de git/worktree sob carga (passam isoladas com `--testTimeout=120000`) e (b) `cli/app.test.ts` (6 testes), causada pelo
  AMBIENTE do worktree: `node_modules/@anima/core` apontava para o checkout principal, que não tem os novos exports. Com os
  workspaces religados ao worktree (`node_modules` local com junctions; `@anima/*` → worktree), `cli/app.test.ts` passa 56/56 e a
  CLI nativa (`anima help`) executa. Não é defeito de código; em um checkout normal o workspace aponta para si mesmo.

## Efeitos externos

Realizados: criação e parada do container descartável (mantido parado, sem remoção). **Não realizados:**
migration no residente, escrita no ledger residente (seq 86820 inalterado, enum 39), commit, push, aceite,
integração, attempt, lease, API paga, mexer em WIPs/worktrees existentes.

## Próximo ponto de retomada

Decisão humana de aplicar (ou não) as duas migrations candidatas no residente, depois `supabase migration up`
e verificação de catálogo. Depois: Recorte 2 (mandato por item). Para ativar a emissão: definir
`ANIMA_EXECUTION_MODE` (+ opcionais `ANIMA_EXECUTION_ACTOR`, `ANIMA_EXECUTION_RUNNER_KIND`,
`ANIMA_EXECUTION_RUNNER_INSTANCE`) no launcher; sem `ANIMA_EXECUTION_MODE` nenhum fato é registrado.

---

## Adendo (2026-10-17) — aplicação no residente, revisão final e três correções

Append-only. Os fatos abaixo posteriores ao texto acima. Onde o texto diz "NÃO aplicadas", leia-se "não aplicadas até este adendo".

### Aplicação no residente (atos humanos autorizados, um por migration)
- Backup: snapshot restic `e2503ad9c7a6fd9f2705b87199a09e05b94abd57bca2d846ba4b99d55cb1a18f` (repositório E0; o snapshot
  anterior `77b180ce` preservado), `check --read-data` PASS, restore com SHA-256 idêntico dos 5 dumps; restauração isolada
  5/5 == PRE. Pacote congelado fora do Git: `C:\Users\GeanTeco\anima-recovery\a2-0-r1-20261016` (223 arquivos, `verify.sh`).
- `20261016000000` (vocabulário) via pacote `a2-0-r1-step1`: ledger 156→157, enum 39→40, catálogo/índices idênticos.
- `20261016000001` (validador + índice único + RPC) via `promotion-package`: ledger 157→158; catálogo 275→277 funções,
  nenhuma existente alterada; índice `work_events_host_execution_context_attempt_idx`; EXECUTE só `anima_system_writer`.
  `work_events` 3291 / seq 86820 inalterados; fatos de contexto gravados: 0; órfãs de FK 9/5 preservadas (aceite por operação).
- Os arquivos desta fatia em `supabase/migrations/` são byte-a-byte os aplicados: todas as `statements` do ledger residente
  foram encontradas nos arquivos (1/1 e 7/7) e os hashes das funções coincidem com o ensaio.
  Os nomes mantêm o sufixo `_candidate` para coincidir com a coluna `name` do ledger.

### Revisão final do código (read-only) — três achados e correções
1. **Risco médio — rota HTTP herdava a declaração do ambiente.** Causa: `persistPostTurnHostObservations` resolve a
   declaração de `ANIMA_EXECUTION_MODE` quando `executionContext` é `undefined`; `app/api/work-orchestration/supervisor-turn/route.ts`
   não o informava. Com a variável definida no processo do servidor web, turnos disparados por clientes HTTP herdariam o modo.
   Correção: a rota passa `executionContext: null` (HTTP nunca declara). Teste novo
   `route.execution-context.test.ts` (integração rota→post-turn; modos unattended/supervised/manual/ausente e corpo hostil);
   sem a correção, os 5 testes falham (mutação verificada).
2. **Menor — constante morta** `MAX_ENVELOPE_DRIFT_FIELDS = 0` em `host-observed-execution-context.ts`; substituída pelo literal `3`.
3. **Menor — documentação desatualizada**: este registro dizia "candidatas/não aplicadas" e continha uma frase solta sobre `.env`;
   corrigida a frase e acrescentado este adendo.

### Verificações da revisão
- Payload REAL gravado pela RPC (banco descartável com o schema residente 158) lido por `readPersistedExecutionContext` e por
  `computeAutonomyEvidence`: válido nos dois casos (mandato humano e `autonomous_policy`); cobertura 1 válido / 0 rejeitado.
- Limitação mantida: attempts reivindicadas continuam `human_observed` na métrica (`work_started` autor `user` + `supervised_execution`).
- Orientação operacional: `ANIMA_EXECUTION_MODE` só deve existir no ambiente do launcher/Host dedicado, nunca no servidor Next.

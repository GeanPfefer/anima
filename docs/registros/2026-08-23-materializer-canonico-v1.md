# Materializer canônico V1 — candidato → work_item `proposed` (Level 6)

Data: 2026-08-23
Tipo: desenvolvimento (core + driver + rota) + prova viva por fixture controlada

`CANONICAL_MATERIALIZATION = PASS`

## Objetivo

Eliminar a camada humana do MATERIALIZER: transformar um candidato canônico já escolhido
pelo domínio em UM work_item `proposed` executável — sem que Gean/Claude/Codex traduzam
"essa linha do roadmap" → tarefa. Materialização ≠ aprovação.

- Branch: `dev`. HEAD inicial: `266c68c`. `origin/main`: `99bec54`, intacta.
- Commits: `17d55f4` (mecanismo puro + driver) + `a28dbab` (portos reais + rota + `**Status:**`)
  + este registro.

## Arquitetura (decisão ratificada aplicada)

`BACKLOG ITEM ≠ EXECUTION_SPEC`. Um item canônico é um OBJETIVO (fase). O fluxo:

```
allCandidates → SELEÇÃO determinística (correlação REAL) → PLANNING BOUNDARY (UM slice)
→ proposta validada → proveniência durável no intent → work_item `proposed`
→ Supervisor/Executor/Verifier existentes
```

- **Camada determinística** (core `canonical-backlog.ts`): fonte/ID/status/dependências/
  elegibilidade/ordem/já-materializado. O LLM NÃO decide existência nem elegibilidade.
- **PLANNING BOUNDARY** = `planExecutableProjectWork` (reuso, NÃO um planner paralelo): o
  planner produz argumentos brutos; o HOST valida escopo/paths e monta o `execution_spec`
  (target/executor/coder_backend/base_sha/permissions/validation_criteria/limits). Saída
  passa pelos MESMOS validadores existentes.

## Proveniência DURÁVEL + correlação estável (Prioridade 2)

Sem tabela/coluna nova. A proveniência vive em `intent.canonical_provenance`
(`CanonicalMaterializationProvenance`: kind, **sourceId**, document, heading,
canonicalObjective, planningGeneration, materializationReason, parentWorkItemId?). A
correlação docs↔work_items é por **sourceId** (ID ESTÁVEL, nunca por título):
`readMaterializedSourceIds` lê `intent.canonical_provenance.sourceId` de TODOS os work_items
do usuário (RLS). A guarda de proveniência ratificada (`presentation.ts`) NÃO foi tocada: o
work_item nasce por `create_work_proposal` com uma MENSAGEM DE ORIGEM legítima (o pedido de
materialização, sob a identidade do usuário) — não uma mensagem falsa; sem `source_message_id`
nullable, sem schema change.

## Machine-explicit (Prioridade 1, parcial)

O parser passou a reconhecer um campo EXPLÍCITO `**Status:**` (done|not_started|
awaiting_review|unknown, ou keyword pt), PREFERIDO sobre a heurística de prosa. Torna o
backlog human-readable + machine-deterministic. (A reconciliação item-a-item dos 13 `unknown`
do backlog real é recorte seguinte.)

## Provas

- core `canonical-materialization` **8/8**; `canonical-backlog` **27/27** (inclui `**Status:**`);
  driver `canonical-materializer` **16/16** (as 15 regressões: seleção gate o planner;
  fail-closed sem escrita parcial; idempotência; proveniência estável; desfecho `proposed`).
  typecheck **5 workspaces** PASS.

### Prova viva por FIXTURE controlada (Next dev + Supabase + planner LOCAL qwen2.5:14b)

Fixture `docs/registros/_fixtures/canonical-materialization-fixture.md` (1 candidato `FIX-01`,
`not_started`, sem deps, objetivo seguro). `POST /api/work-orchestration/canonical-materialize`
(Bearer do usuário descartável allowlisted) apontando o fixture:

- Resultado: `{ok:true, workItemId:a265db7e-…, sourceId:FIX-01, provenance:{…}}`.
- **work_item `a265db7e`**: `state=proposed`, `capability=programming`,
  `intent.canonical_provenance.sourceId=FIX-01`, `execution_spec` (executor=worktree,
  coder=ollama, validado pelo host), proposta com `included_scope=["docs/registros/
  _scratch-fixture-materializer.md"]` — o planner LOCAL produziu um slice VÁLIDO.
- **Cadeia de eventos: `work_proposed, context_attached`** — SÓ proposto, NENHUMA execução.
- **Idempotência (replay):** POST de novo → `{ok:false, reason:no_candidate:all_settled}`;
  contagem de work_items com `sourceId=FIX-01` = **exatamente 1**. Não duplicou.
- **Backlog REAL (28 candidatos):** `{ok:false, reason:no_candidate:status_unresolved}` —
  fail-closed HONESTO (os 13 `unknown` bloqueiam; nada fabricado).
- **Integridade:** repo byte-intacto (`HEAD=a28dbab`), `origin/main` intacta, **nenhum**
  scratch file (materialização NÃO executa — desfecho `proposed`). Fixture (doc + work_item
  descartável) preservada como evidência.

## Invariantes / segurança

Materialização ≠ aprovação (desfecho máximo `proposed`, sob fronteira humana). Identidade
user-scoped (Bearer/RLS) — **sem service_role**. O LLM recebe candidato já escolhido; sua
saída passa pelos validadores. Correlação estável por ID; não duplica; sem escrita parcial;
sem tabela/coluna/RPC nova; guarda de proveniência ratificada intacta.

## Fronteiras (próximos recortes diretamente causais)

1. **Reconciliar os 13 `unknown` do backlog real** com evidência (Plano/registros) + campos
   `**Status:**` explícitos — para que a descoberta real deixe de ser `status_unresolved` por
   ambiguidade (Prioridade 1). Precedência: estrutura explícita do backlog = estado
   operacional; registros/commits = evidência para atualizá-la; Plano/PRD = contexto.
2. **Projeção operacional do estado canônico** (source status + linked work_items + event
   state → effective canonical state) — sem reescrever o Markdown a cada execução.
3. **Resident host consome o item materializado** (descobre→materializa quando a fila
   operacional esvazia) + investigar política de **auto-approval** madura para slices locais
   (não bypass manual). Se não existir, modelar a próxima fronteira.
4. **Avaliação de conclusão de objetivo** por slice (`objective_complete` | `more_work_required`
   | `blocked` | `human_decision_required`) → próximo slice/próximo objetivo.

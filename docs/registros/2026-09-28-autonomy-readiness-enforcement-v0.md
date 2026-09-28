# 2026-09-28 — Autonomy Readiness Enforcement V0: auto-aprovação limitada pela readiness

- **Tipo:** desenvolvimento (core puro + seam web). US$ 0, sem provider, sem authority paga, sem
  migração (extensão compatível do jsonb do envelope).
- **Branch:** `dev`. **HEAD inicial:** `b1390e6` (Autonomy Readiness V0). `main`/`origin/main`
  intactas (`99bec54`).
- **Registry e regras de prova não alterados.** `agency.produce-change` segue `proven`.
- **Antecedentes:** [Autonomy Readiness V0](2026-09-28-autonomy-readiness-v0.md) (que reportou o
  achado), auditoria independente read-only do Codex (confirmou o conflito), Envelope V1
  (`packages/core/src/work-orchestration/autonomous-authorization.ts`, migration
  `20260823000001_autonomous_authorization.sql`).

## Conflito encontrado

Entre `2026-08-23` e este commit, o **Envelope de auto-aprovação V1** gravava `work_approved`
`author=system`/`authority=autonomous_policy` para uma classe estreita de `programming` (proveniência
canônica, impacto `low`, `project:anima`, worktree, Ollama, permissões isoladas, `included_scope`
seguro, gates, limites, Governor `permit`), **sem consultar a Autonomy Readiness**. Esse histórico é
preservado: as aprovações já gravadas continuam válidas como fato; nada foi reescrito.

## Semântica real do Envelope V1

Aprovar sem humano por item uma classe previamente autorizada é, por comportamento, delegação
**`mandated`** (Marco 005 §8: mandato). O executor continua limitado a `review` (sem integração),
mas a DECISÃO de iniciar o trabalho sai do humano.

## Supervised vs mandated

- `supervised`: o Anima executa uma ação que o humano aprovou item a item.
- `mandated`: o Anima decide/executa dentro de um mandato prévio (o que o V1 faz).

`agency.produce-change` hoje: declarado `proven`, derivado `proven` (Proof Evaluation V0.1: reprodução
observada em 8 ocasiões, critério operacional pendente) ⇒ readiness **`supervised`**. O envelope
concedia `mandated` ⇒ **authority > readiness**.

## Escolha: opção B — authority não excede readiness

```
effective delegation ≤ autonomy readiness ≤ capability evidence
authority existente não amplia o teto da readiness
```

Não se promoveu `produce-change` e não se implementou a opção C (critérios operacionais).

## Ponto de enforcement (único)

`apps/web/lib/work-orchestration/auto-approval.ts` → `autoApproveAutonomousWork`, **depois** do envelope
V1 autorizar e **imediatamente antes** da RPC `auto_approve_autonomous_work`. Núcleo puro:
`packages/core/src/autonomy-readiness-enforcement.ts` (`enforceAutonomyReadinessForAutoApproval`).

1. carrega o histórico canônico (`readCanonicalWorkHistory`) → **Proof Evaluation V0.1**
   (`evaluateCapabilityProofsFromHistory`) — nunca a projeção V1 crua;
2. mapeia `programming` → `agency.produce-change`;
3. deriva o contexto da ação do **item real** (`impact_level`, `execution_spec`, `included_scope`);
4. avalia a readiness e exige `≥ mandated`.

Materializer, planner, fila, executor e Resident Host **não** foram alterados (o host só passou a
logar o `detail`). Um teste estrutural garante que só o seam referencia o enforcement.

### Contexto derivado (sem ação idealizada)

| Salvaguarda | Fato do item |
|---|---|
| isolated_worktree, no_network | `executor=worktree` + permissões ⊆ {workspace_read, workspace_write_isolated} |
| allowed_paths | `included_scope` não-vazio |
| gates | `validation_criteria` com `command` |
| max_attempts / timeout | `limits.max_attempts` / `limits.max_duration_minutes` positivos |
| no_paid_compute | `coder_backend` na lista local (default `ollama`) |
| human_acceptance, no_auto_integration, verifier, recovery_path, checkpoint | garantias estruturais do executor `worktree` ratificado (teto `review`) |
| budget_cap | orçamento aplicado pela fila autônoma |
| fail_closed | o envelope V1 já autorizou |
| **command_allowlist** | **não declarada** — o envelope não restringe o comando dos gates |

Reversibilidade: pré-aprovação não existe classificação (INTEL-01 grava depois); derivada `reversible`
das mesmas garantias estruturais (mutação só na worktree descartável, sem integração).

## Fail-closed (nega e deixa o item `proposed`)

| Razão | Quando |
|---|---|
| `autonomy_readiness_history_unavailable` | histórico ilegível ou loader lançou |
| `autonomy_readiness_capability_unmapped` | `capability` sem capacidade de registry |
| `autonomy_readiness_context_incomplete` | execution_spec/executor/permissões/limits/impacto ausentes ou fora da classe |
| `autonomy_readiness_evaluation_invalid` | avaliação ausente, status ≠ `aligned` (divergência/insuficiente), regra ausente, avaliação inconsistente com a regra canônica |
| `autonomy_readiness_insufficient` | readiness < `mandated` (inclui salvaguarda exigida ausente, compute pago, impacto ≠ low) |

Nunca cai para o comportamento antigo. Retorno: `{ action: 'human_required', reason, detail }`.

## Comportamento atual de produce-change (histórico real, read-only, sem RPC)

```
materialize: sim · propose: sim · auto-approve: NÃO · execute: NÃO
reason: autonomy_readiness_insufficient
detail: agency.produce-change: readiness supervised < mandated (operational_criteria_pending).
```

Sem `work_approved`, sem classificação, sem claim/attempt/execução. O humano aprova normalmente pelo
caminho próprio (`resolveApproval` / CLI `anima approve` / UI), que **não** consulta a readiness.

## Evidência persistida (TOCTOU/auditoria)

Quando permitido, o envelope gravado no payload de `work_approved` (jsonb, validado pela RPC só em
`authority`/`envelope_version`/`source_id` — extensão compatível, sem migração) ganha:

```json
"checks": [..., "autonomy_readiness_mandated"],
"autonomy_readiness": {
  "schema_version": 1, "capability_id": "agency.produce-change",
  "readiness_rule_version": "autonomy-readiness-v0",
  "observed_level": "mandated", "required_level": "mandated",
  "capability_maturity": "operational", "proof_status": "aligned",
  "contributing_evidence": 3, "contradicting_evidence": 0
}
```

Sem histórico, prompts, PII nem blobs de evidência.

## Authority

Nenhuma segunda autoridade. Paid authority, recovery authority, aceite/integração e revisão humana
inalterados. Só se impede `system/autonomous_policy → work_approved` quando readiness < mandated.

## Testes

- Core `autonomy-readiness-enforcement.test.ts` (21): estado real negado; sintético operacional
  permitido com auditoria; contexto do item real; salvaguardas/risco ausentes negam mesmo com readiness
  sintética; histórico indisponível; avaliação ausente/inconsistente; divergência; manual; contexto
  incompleto; capacidade sem mapeamento; **invariante de regressão** (varredura maturidade × evidência
  × regras × fatos: allowed ⇔ readiness ≥ mandated; só 1 combinação libera); regras canônicas intactas.
- Web `auto-approval.test.ts` (19): suíte antiga preservada (caminhos felizes agora com fixture
  sintética mandated; negações do envelope V1 continuam antes e nem carregam histórico); 1–5 estado
  real negado sem nenhuma RPC; 6 sintético permitido; 7 limite ausente; 8 histórico indisponível /
  loader lança / vazio; 9 inconsistente; 10 manual; 11/13 invariante sobre as chamadas RPC; 12–15 ponto
  único (só o seam referencia o enforcement).
- Core 2221/2221; typecheck 4 workspaces OK. Web: 4 suítes (`worktree-executor`,
  `node-harness-runtime`, `project-tools`, `project-context-builder`) falharam só sob carga ampla e
  passam isoladas; nenhuma importa o seam — flake de carga conhecido, sem relação.

## Reativação futura (opção C — não implementada)

A auto-aprovação volta a conceder `mandated` **automaticamente** quando `agency.produce-change` tiver
readiness ≥ `mandated`, o que exige maturidade `operational` derivada — trabalho separado
("Produce-change Operational Criteria"). Nenhuma regra foi afrouxada para isso.

Backlog da opção C (gaps da auditoria, **não** tratados aqui):

- Verifier fail-open;
- comando de gate sem allowlist no envelope (`command_allowlist` ausente);
- sem cap explícito de resource units;
- boundary de rede só aplicacional (não kernel);
- falhas de produce-change não calibram maturidade;
- `changes_requested` não calibra o verifier;
- frescor da evidência;
- taxa de sucesso.

## Próximo ponto de retomada

Decisão humana sobre a opção C. Enquanto isso, itens canônicos materializados pelo Resident Host
param em `proposed` com `authorizationDetail=autonomy_readiness_insufficient:…` e seguem o caminho
humano de aprovação.

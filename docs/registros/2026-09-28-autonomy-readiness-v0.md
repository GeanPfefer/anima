# 2026-09-28 — Autonomy Readiness Engine V0: prontidão para delegação progressiva

- **Tipo:** desenvolvimento (core puro + read-model + UI mínima). US$ 0, sem provider, sem authority
  paga, sem migração.
- **Branch:** `dev`. **HEAD inicial:** `1ca824e` (Capability Proof Evaluation V0.1). `main`/`origin/main`
  intactas (`99bec54`).
- **Capability Registry não alterado** (nenhuma das 63 capacidades mudou de maturidade).
- **Código:** `packages/core/src/autonomy-readiness.ts` (+ testes), `apps/web/lib/evolution/capability-assessment-read.ts`,
  `/evolution` (`EvolutionClient.tsx`, bloco `data-testid=autonomy-readiness`).
- **Referências:** Marco 005 §8 (aprovação é mandato), §11 (níveis de confiança — taxonomia não
  ratificada); [Proof Evaluation V0/V0.1](2026-09-28-capability-proof-engine-v0.md);
  [`capability-proof-engine.md`](../arquitetura/capability-proof-engine.md).

## Princípio

```
Capability maturity  ≠  Autonomy readiness  ≠  Authority
"consegue fazer?"       "há evidência para      "o humano/governança
                         delegar neste escopo?"  autorizou de fato?"
```

Nenhuma camada implica a seguinte. O engine só decide **readiness**: não executa, não cria nem
altera authority, não muta flag de autonomia (`ANIMA_AUTONOMY_ENABLED`) nem o registry.

## Fase 0 — primitivas existentes reutilizadas (sem modelo paralelo)

| Conceito | Primitiva que já existia |
|---|---|
| Maturidade | Capability Proof Evaluation V0.1 (`evaluateCapabilityProofs…`) |
| Autorização autônoma estreita | `evaluateAutonomousApprovalEnvelope` (envelope V1, `author=system`, só Ollama/worktree/impacto `low`) |
| Autorização paga | `paid-compute-authorization.ts` (humana, por item, com validade) |
| Recovery humana | `authorize_work_resume`, `release_manual_work`, `withdraw_approved_work` |
| Risco/impacto | `work_items.impact_level` (low…external) + Work Intelligence Classification (risk, reversibility, planClarity…) |
| Supervisão | review request + `accept`/`request_changes`; integração INT-05 humana |
| Retry/limites | `execution_spec.limits` (max_attempts, max_duration_minutes); recovery-decision |
| Rollback | descarte da worktree + recovery successor governado |
| Kill switch | `createKillSwitch` (`ANIMA_AUTONOMY_ENABLED`/`ANIMA_AUTONOMY_FILE`) no Resident Host |
| Readiness shadow | `readiness-calibration.ts` (por-gate, só calibração — conceito diferente, não reutilizado como nível) |

## Autonomy model (níveis de delegação)

Vocabulário do Marco 005 §8 ("mandato"), não da escada de maturidade:

| Nível | Semântica |
|---|---|
| `manual` | humano executa/decide tudo |
| `supervised` | Anima executa UMA ação aprovada pelo humano, sob supervisão; resultado volta ao humano |
| `mandated` | Anima decide/executa dentro de um mandato (envelope) previamente autorizado |
| `autonomous` | Anima opera sozinho dentro de um envelope estável (não é autoridade ilimitada) |

Mapeamento de maturidade (teto): `<proven`/`degraded` → manual · `proven` → supervised ·
`operational` → mandated · `autonomous` → autonomous. **Operacional nunca implica autônomo.**

## Inputs (`AUTONOMY_READINESS_INPUTS_V0`)

- **AVAILABLE:** derived/declared maturity, divergence status, reprodução, evidência negativa e
  inconclusiva (todos da Evaluation V0.1); impacto, reversibilidade, efeito (read_only/ephemeral/
  isolated_mutation/shared_mutation/external_effect), rede, compute pago e salvaguardas (contexto
  da ação).
- **DERIVABLE:** authority vigente (envelopes/authorities persistidos — V0 aceita só observação
  passada pelo chamador); frescor (`observedAt`, sem política).
- **NOT YET AVAILABLE:** taxa de sucesso (falhas não geram evidência negativa), calibração do
  verifier contra a revisão humana, sensibilidade de dados, sinal `autonomous_operation`.

## Rules (V0, sem score)

1. Maturidade efetiva = **menor** entre declarado e derivado (divergência nunca promove). Sem
   derivado ⇒ `manual` (`capability_not_proven`).
2. Evidência negativa: `degraded` ⇒ manual; negativa com < 2 ocasiões positivas depois dela ⇒ nada
   acima de `supervised` (`negative_evidence_recent`). Positivas voltam a ampliar.
3. Teto estrutural por regra (`levelCeiling` + `ceilingBlockers`).
4. Risco (desconhecido = pior caso): impacto ≠ `low`, reversibilidade irreversível/desconhecida,
   efeito externo, mutação fora da worktree, compute pago, rede, efeito fora da classe delegável ⇒
   no máximo `supervised`. Ação mutável sem `recovery_path` ⇒ no máximo `supervised`, mesmo se a
   regra esquecer de exigir.
5. Salvaguardas cumulativas por nível: o nível só é elegível com todas presentes.
6. Coerência da entrada: a avaliação precisa carregar a regra canônica V0.1 e respeitar o teto;
   caso contrário `proof_evaluation_inconsistent` (fail-closed). Capacidade desconhecida ⇒
   `capability_unknown`; fora do recorte ⇒ `readiness_rule_missing`.

## Capabilities evaluated (ação de referência = uso governado atual)

| Capacidade | Teto | Efeitos delegáveis | Salvaguardas (supervised → +mandated) |
|---|---|---|---|
| `agency.run-tests` | mandated | read_only, ephemeral | command_allowlist, timeout → +isolated_worktree, no_network, no_paid_compute, fail_closed |
| `agency.edit-file` | mandated | isolated_mutation | isolated_worktree, allowed_paths → +recovery_path, max_attempts, timeout, no_paid_compute, no_auto_integration, fail_closed |
| `agency.produce-change` | mandated | isolated_mutation | worktree, allowed_paths, gates, verifier, human_acceptance, no_auto_integration, max_attempts, recovery_path → +timeout, budget_cap, no_paid_compute, checkpoint, fail_closed |
| `agency.verify-change` | supervised (nunca autoridade única de aceite) | read_only, ephemeral | gates, human_acceptance, fail_closed |
| `governance.verifier` | supervised (advisory) | read_only | human_acceptance, fail_closed |
| `agency.supervised-self-development` | supervised (por definição) | isolated_mutation | ciclo governado completo |

Provider/cloud/compute pago ficaram fora do V0.

## Readiness results — histórico real (1343 eventos, read-only, US$0)

| Capacidade | Maturidade | Readiness | Authority (lida) | Bloqueios do próximo nível |
|---|---|---|---|---|
| run-tests | operational | **mandated** | manual (não lida) | autonomous: `autonomous_operation_evidence_unavailable`, `network_boundary_unproven` |
| edit-file | operational | **mandated** | manual | autonomous: `autonomous_operation_evidence_unavailable` |
| produce-change | proven | **supervised** | manual | mandated: `operational_criteria_pending` |
| verify-change | proven | **supervised** | manual | mandated: `operational_criteria_pending`, `human_acceptance_required` |
| governance.verifier | proven | **supervised** | manual | mandated: `operational_criteria_pending`, `human_acceptance_required` |
| supervised-self-development | proven | **supervised** | manual | mandated: `operational_criteria_pending`, `negative_evidence_recent` (5 negativas, 1 recuperação), `supervised_by_definition` |

## Authority separation

- `grantsAuthority: false` é literal no tipo do resultado.
- Sem authority observada ⇒ `authorizedLevel: manual`, `source: none_observed`, mesmo com
  readiness `mandated`.
- Authority informada é só lida; acima da readiness ⇒ `exceedsReadiness: true` (reportado, nunca
  corrigido).
- **Achado para decisão humana:** o envelope de auto-aprovação V1 (`autonomous-authorization.ts`,
  ativo só quando o Resident Host roda com `ANIMA_RESIDENT_MATERIALIZE_DOCUMENT`) é, na prática, uma
  authority de nível `mandated` para uma classe estreita de `produce-change` (local, worktree,
  impacto `low`), enquanto a readiness derivada de `produce-change` é `supervised`. O V0 **não**
  revoga nem altera o envelope; o teste 8 cobre o reporte `exceedsReadiness`. A leitura de authority
  vigente na UI ficou fora (ampliaria o escopo): o `/evolution` diz "não lida nesta visão".

## Feedback loop

```
execute → observe (work_events) → verify → record evidence
  → re-evaluate capability (Proof Evaluation V0.1)
  → re-evaluate readiness (evaluateAutonomyReadiness[FromHistory])
```

Cada leitura recomputa do log; negativa reduz, positiva reamplia (teste 3). Nenhuma mutação de
authority.

## UI

`/evolution`, detalhe da capacidade coberta: seção "Prontidão para autonomia" com o nível, a
authority ("não lida nesta visão (tratada como Manual) — readiness não concede authority"), a
explicação e os bloqueios por nível. Capacidades fora do recorte não exibem o bloco. Evolution não
foi redesenhado. Não houve verificação no browser (exige login humano no app); cobertura por testes
de componente.

## Tests

`autonomy-readiness.test.ts` (18): os 10 exigidos + divergência não promove, evidência
insuficiente, contexto desconhecido = pior caso, pago/externo, tetos estruturais, determinismo, caminho
de histórico sem log, inventário de inputs. UI: 3 testes em `EvolutionClient.test.tsx`; read-model:
asserção fail-closed em `capability-assessment-read.test.ts`. Core 2200/2200; web 1931/1932 com
`worktree-executor.test.ts` falhando só sob carga (passa 56/56 isolado — flake de carga, não
tocado).

## Limitações

- Salvaguardas são DECLARADAS pelo contexto; o engine não verifica que o executor as garante.
- Sem taxa de sucesso, frescor, calibração do verifier nem sensibilidade de dados.
- Authority vigente não é lida da persistência; só por parâmetro.
- `mandated` para run-tests/edit-file é readiness, não mandato: nenhum envelope novo foi criado.
- Nenhum sinal permite derivar `autonomous`.

## Próximo ponto de retomada

Decisão humana: (a) reconciliar o envelope de auto-aprovação V1 com a readiness `supervised` de
`produce-change` (manter como exceção explícita, restringir, ou definir critério operacional); (b)
se desejado, leitura read-only da authority vigente (envelopes/authorities) para a UI.

# 2026-09-28 — Mandated Envelope Hardening V0: salvaguarda declarada = salvaguarda aplicada

- **Tipo:** desenvolvimento (core puro + seam web + Envelope V1). US$ 0, sem provider, sem authority,
  sem migração.
- **Branch:** `dev`. **HEAD inicial:** `ead1934` (Autonomy Readiness Enforcement V0). `main`/`origin/main`
  intactas (`99bec54`).
- **Registry, regras de prova e regras de readiness não alterados.** `agency.produce-change` segue
  `proven`; nada foi promovido; opção C não implementada; self-dev não executado.
- **Antecedentes:** [Enforcement V0](2026-09-28-autonomy-readiness-enforcement-v0.md) (preservado como
  está — ele declarava `verifier`, `checkpoint`, `budget_cap` e `fail_closed` por suposição estrutural);
  auditoria independente do Envelope V1 (Codex).

## Princípio

`present` ≠ "existe em algum lugar do código". `present` = **garantida para ESTE caminho de execução**
(lane de auto-aprovação: item `programming`, executor `worktree`, coder local). O contexto da ação é
derivado só de: item persistido, `execution_spec`, policy versionada (allowlist de gate) e o **perfil
versionado de garantias do runtime** `MANDATED_LANE_RUNTIME_GUARANTEES_V0` (`mandated-worktree-lane-v0`),
amarrado ao runtime por teste de contrato. O chamador não passa booleans nem perfil.

## Safeguard truth table

Legenda do "antes": **E** = enforced e derivado de fato; **S** = declarado por suposição; **P** = parcial.

| Salvaguarda | Exigida (produce-change) | Fonte / ponto de enforcement | Antes | Depois |
|---|---|---|---|---|
| isolated_worktree | supervised | `executor=worktree` + permissões ⊆ {workspace_read, workspace_write_isolated}; `resolveExecutorRoute` → `WorktreeExecutorAdapter` | E | **presente** |
| allowed_paths | supervised | `included_scope` não-vazio; host reforça escrita (contract_violation) | E | **presente** |
| command_allowlist | — (run-tests) | gates: `gate-command-allowlist-v1` no executor **e agora no Envelope V1**; laço do coder: CommandExecutionPolicy | ausente (gap) | **presente** só se TODOS os gates estão na allowlist |
| timeout | mandated | `limits.max_duration_minutes` inteiro positivo; executor/lease aplicam | E | **presente** |
| max_attempts | supervised | `limits.max_attempts` inteiro positivo; orçamento aplica min(3, declarado)/24h | E | **presente** |
| gates | supervised | `validation_criteria` com comando **allowlisted**; host roda os gates | P (só "comando não-vazio") | **presente** só com allowlist |
| verifier | supervised | parecer `computeAndPersistVerifierOpinion` — **advisory/fail-open** | **S** | **AUSENTE** |
| human_acceptance | supervised | executor termina em `review`; aceite é RPC humana | E (estrutural) | **presente** (perfil) |
| no_auto_integration | supervised | INT-05: integração exige decisão humana | E (estrutural) | **presente** (perfil) |
| no_network | — | nenhuma permissão de rede — **permissão negada** (aplicacional) | P | **presente** com essa semântica |
| network_isolation *(novo)* | — (autônomo) | isolamento de kernel/contêiner | — | **AUSENTE** (nenhum caminho garante) |
| no_paid_compute | mandated | `coder_backend` ∈ backends locais do perfil (= default do envelope, `ollama`) | E | **presente** |
| budget_cap | mandated | `autonomous-work-budget-v1`: anti-loop por item + reserva interativa (attempts e tempo) | S (semântica vaga) | **presente** com semântica exata: attempts+tempo, NÃO custo/resource units |
| recovery_path | supervised | mutação só na worktree descartável; recovery governado (humano) | E (estrutural) | **presente** (perfil) |
| checkpoint | mandated | `resolveExecutorRoute(worktree)` constrói o adapter com `emitCheckpoint: true` | S (capacidade do executor) | **presente**, amarrado por teste de contrato |
| fail_closed | mandated | TODAS as precondições obrigatórias negam ao falhar | **S** (só o envelope) | **AUSENTE** enquanto o Verifier for fail-open |

## Assumptions removed

- `verifier` (advisory/fail-open não é salvaguarda) — **opção B** do pedido: não declarar; nenhuma
  mudança global no Verifier.
- `fail_closed` (derivado: só com Verifier `required_fail_closed` + gates allowlisted + escopo + limites
  + backend local).
- `gates` sem allowlist; `checkpoint` e `budget_cap` passaram de suposição a perfil explícito e testado;
  `allowedLocalCoderBackends` deixou de ser parâmetro do chamador (vem do perfil).
- Reversibilidade só é `reversible` quando o perfil garante descarte da worktree e ausência de integração.

## Enforced agora

- **Envelope V1** recusa `validation_command_not_allowlisted` (mesma allowlist do executor; predicado
  único `isAllowedGateCommand` no core, usado também por `worktree.ts`). Check persistido
  `validation_commands_allowlisted`. Aperto sem mudar `envelope_version` (a RPC exige `1`).
- Auditoria do envelope ganha `autonomy_readiness.lane_guarantees_version`.
- Readiness: blockers distintos `network_permission_not_denied` (permissão) × `network_boundary_unproven`
  (isolamento).

## Semântica precisa

- **budget_cap:** teto de attempts e tempo de execução aplicado pela política de orçamento autônomo. Não é
  teto financeiro nem de resource units; `max_resource_units` não é exigido nem inferido.
- **network:** `no_network` = permissão de rede negada (policy-level; um teste pode fazer rede).
  `network_isolation` = isolamento provado; ausente em todos os caminhos.
- **fail_closed:** presente só se cada precondição obrigatória nega ao falhar. Envelope, histórico,
  avaliação, contexto, escopo, limites e classe de provider já são fail-closed; o Verifier não é ⇒ ausente.

## Resultado do lane real (histórico real, read-only, sem RPC)

```
reason: autonomy_readiness_insufficient
detail: agency.produce-change: readiness manual < mandated (verifier_required, operational_criteria_pending).
```

Antes do hardening a readiness do lane era `supervised`; agora é `manual`, porque o Verifier (exigido
já no supervisionado pela regra de produce-change) não é garantido fail-closed. Continua negado — por
dois motivos independentes. A aprovação humana (`resolveApproval`/CLI/UI) não mudou.

Reativar `mandated` exigirá, além da opção C (critérios operacionais de produce-change), um Verifier
obrigatório e fail-closed no lane (e com ele `fail_closed`).

## Testes

- Core `autonomy-readiness-enforcement.test.ts` (30): tabela de verdade exata; Verifier fail-open não
  declarado; checkpoint ausente ⇒ mandato negado; 4 gates fora da policy; timeout ausente; max_attempts
  0/-1/1.5/'3'; semântica de budget; permissão ≠ isolamento (blockers por nível); fail_closed só com toda
  precondição; contexto não-forjável (campos extras do chamador ignorados); lane real negado (`manual`);
  sintético operacional só passa sob perfil com todas as garantias; fail-closed V0; invariante (0
  liberações com regras canônicas); regras intactas.
- Core `autonomous-authorization.test.ts` (+4): gate fora da allowlist ⇒ `validation_command_not_allowlisted`.
  `gate-command-policy.test.ts` (15).
- Web `auto-approval.test.ts` (24): estado real negado sem RPC; sintético com regras canônicas negado por
  `verifier_required`; caminho da RPC só com regra HIPOTÉTICA explícita (sem verifier/fail_closed); gate
  fora da allowlist negado no envelope; invariante; ponto único (aprovação humana intacta); contrato do
  perfil: executor do lane com `emitCheckpoint: true`, backends locais = default do envelope, semântica de
  Verifier/rede/budget.
- Core 2249/2249; typecheck OK; `git diff --check` OK. Web 1941/1945: `worktree.test.ts` e
  `worktree-executor.test.ts` falharam só sob a carga total; isolados 53/53 e 56/56, e o diretório
  `lib/work-orchestration` inteiro 1251/1251. O predicado de gate é a mesma regex (movida para o core).

## Gaps que continuam (opção C / futuro — não tratados)

Verifier obrigatório fail-closed no lane; calibração do Verifier contra a revisão humana; isolamento de
rede de kernel; teto de resource units/custo; taxa de sucesso; frescor; falhas de produce-change
calibrando maturidade. Ações de referência da UI (`AUTONOMY_READINESS_RULES_V0.referenceAction`) seguem
declarativas (marcadas como tal) e não decidem delegação.

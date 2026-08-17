# 2026-08-17 — Resource Governor V0 (sensor + histórico + classificação + advisory)

**Tipo:** implementação + provas determinísticas.

**Objetivo:** implementar o **Resource Governor V0** autorizado — um substrato **estreito,
observacional e advisory** para o Anima: (1) observar o custo real de workloads; (2) registrar
esse custo de forma estruturada; (3) classificar a pressão/custo de uma execução; (4) produzir
advisory sobre a adequação de rodar um workload naquele momento; (5) acumular evidência histórica
para previsões melhores no futuro. **Sem autoridade nova** — não mata processo, não para Docker/
Supabase, não descarrega modelo, não agenda, nenhum efeito externo. Continuação da direção documentada
em [2026-08-16-modo-convivencia-resource-governor](2026-08-16-modo-convivencia-resource-governor.md).

**Branch:** `claude/integration-application-layer`.
**HEAD inicial:** `0c63185`. **HEAD final:** este registro (após os commits abaixo).
**origin/main:** `973ef465acaa3955f8e176c72903975cf3912ac6` — **intacta, SEM push.**

## Princípio realizado

`observação real → evidência durável → classificação/advisory → histórico` **antes** de
`previsão → controle automático`. Preserva a separação canônica do Verifier:

> **EVIDÊNCIA** (custo/telemetria observados) ≠ **CLASSIFICAÇÃO** (low/medium/high/unknown) ≠
> **ADVISORY/DECISÃO** (rodar agora, adiar, exigir máquina exclusiva).

O V0 aprende com fatos: não trata thresholds como verdade universal (as faixas emergem dos próprios
percentis dos dados; a reserva interativa é injetada, não embutida) e responde `unknown`/
`insufficient_evidence` quando não há evidência bastante — honestidade em vez de faixa inventada.

## O que foi implementado (2 commits de produção)

Detalhe arquitetural em `docs/arquitetura/orquestracao-de-trabalho.md`
§"Governança de recursos da máquina — Resource Governor" → "Resource Governor V0 implementado".

**Commit 1 — substrato puro (`packages/core/src/work-orchestration/`):**

- `resource-observation.ts` — `WorkloadCostObservationV1` + `MachineSnapshotV1` (campos de recurso
  **opcionais e honestos**). **Semente real:** `deriveWorkloadCostObservationsFromEvents` percorre o
  log append-only já persistido (`host_observed_gate_evidence_recorded`) e reaproveita o `durationMs`
  real por gate — **custo zero de schema**. Idempotente; histórico não é apagado nem colapsado;
  envelope incoerente com a evidência é descartado (não confia cegamente no persistido).
- `resource-classification.ts` — custo classificado **relativo à distribuição observada** (p50/p90
  dos dados); poucas amostras ou sem espalhamento → `unknown`. Pressão da máquina relativa à
  **`InteractiveReserve` injetada** (`DEFAULT_INTERACTIVE_RESERVE` é só ponto de partida provisório).
- `resource-history.ts` — perfil `(tipo, comando, repo) → distribuição` com estatísticas simples e
  determinísticas; **isolamento por chave** (um workload não contamina o perfil de outro); classe
  predominante como campo à parte (não mistura camadas).
- `resource-advisory.ts` — `adviseWorkloadExecution` puro → `safe_to_run | prefer_defer |
  machine_exclusive_recommended | insufficient_evidence`, decidindo **quando/como** e nunca **se
  pode**; `composeResourceGovernorView` como read-model recomputável. Nenhuma ação externa.

**Commit 2 — lado host-side (`apps/web/lib/work-orchestration/`):**

- `machine-telemetry.ts` — leitor via `node:os` (sem dependência nova), amostra barata e pontual
  (sem polling). **Honesto por plataforma:** OMITE `loadAvg1` no Windows (`os.loadavg()` é sempre 0);
  leitura ausente/que lança → campo ausente, nunca zero falso nem erro propagado.
- `resource-governor.ts` — `composeHostResourceGovernorView`: **seam central de leitura** que deriva
  o histórico dos eventos, lê o snapshot vivo e compõe a visão — em vez de espalhar telemetria por
  cada executor.

## Provas (determinísticas, sem LLM, sem Supabase)

- **core:** 847/847 (39 suítes), incluindo **57 testes** novos do governor. typecheck 0.
- **web:** **11 testes** novos (telemetria + seam ponta a ponta com eventos de gate reais). typecheck 0.
- Casos adversariais cobertos: pouca evidência → `insufficient`; barato → `safe_to_run`; caro+usuário
  ativo → `machine_exclusive_recommended`; caro+pressão moderada → `prefer_defer`; duração alta →
  `high`; memória baixa antes → pressão alta; telemetria parcialmente ausente mantida honesta;
  evidência de outro workload não contamina; derivação idempotente; conflito preservado sem apagar
  histórico; classificação/advisory nunca executam ação externa.

## Decisões de recorte (fronteiras honestas)

- **Sem persistência nova nesta fase.** O V0 DERIVA o histórico do log append-only já existente
  (evidência de gate, com `durationMs` real). Isso mantém o núcleo **determinístico e provável só com
  Jest** (sem Docker/Supabase/migration), respeita o pedido "reaproveite sinais existentes" e evita
  tocar num contrato de evidência já fechado. A telemetria de máquina é lida **ao vivo** no momento
  do advisory (uma amostra barata), não persistida — coerente com "uma amostra antes/depois pode ser
  suficiente para V0". `build/parse` de observação e snapshot existem, prontos para uma persistência
  futura (append-only/idempotente/proveniência) quando houver recorte próprio.
- **Sem fiação no caminho quente do Supervisor.** O seam de leitura está pronto e provado, mas NÃO foi
  ligado a `/supervisor-turn` — não há consumidor do advisory ainda, e evitar tocar o caminho ratificado
  sem consumidor é o menor movimento correto. Fica como próximo recorte elegível.

## Invariantes de segurança preservadas

- origin/main intacta; **sem push, PR, merge, deploy, force, efeito externo, credencial real**.
- `.worktrees/`, worktrees, `.claude/settings.local.json`, `apps/web/.env.local` preservados;
  nenhum `git clean`/reset destrutivo; nenhuma evidência apagada.
- **Nenhuma autoridade nova concedida.** O V0 é sensor + histórico + classificação + advisory. O
  episódio anterior de `supabase stop` foi ação de sessão sob mandato explícito, e **não** virou
  autoridade permanente do Anima. Nenhum gate foi afrouxado; classificação/advisory não atuam.

## Próximo ponto de retomada

Recortes elegíveis (locais, reversíveis, sem efeito externo, prováveis):
1. **Fiar o advisory como leitura viva** no caminho worktree do Supervisor (fail-open, read-only,
   surfando o parecer do governor junto às evidências observadas — nunca adiando/bloqueando sozinho).
2. **Persistência própria** de observações de custo/telemetria de máquina (evento append-only +
   RPC + proveniência host), abrindo o histórico cross-item além do que o log de gate já oferece.
3. **Surfar o governor na presentation** (read-model machine-scoped) para auditoria humana.
Qualquer automação de **controle** (matar/parar/descarregar/agendar/prioridade) permanece FORA do V0
e exige recorte próprio + autorização humana.

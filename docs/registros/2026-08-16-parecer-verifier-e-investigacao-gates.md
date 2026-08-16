# 2026-08-16 — Parecer do Verifier persistido (append-only, versionado) + investigação de independência dos gates

**Tipo:** desenvolvimento + investigação.

**Objetivo:** (1) implementar a persistência append-only do **parecer** do Verifier,
preservando a distinção EVIDÊNCIA ≠ PARECER ≠ DECISÃO; (2) investigar a independência
dos **gates** e decidir, pelo código, se há recorte pequeno ou se é documentação.
Continuação de [2026-08-15-host-observed-evidence-e-auto-mode](2026-08-15-host-observed-evidence-e-auto-mode.md).

**Branch:** `claude/integration-application-layer`.
**HEAD inicial:** `6146af4`. **HEAD final:** este commit documental.
**origin/main:** `973ef465acaa3955f8e176c72903975cf3912ac6` — **intacta, SEM push.**

## Commits (técnico antes de documentação)

| Hash | Assunto | Camada |
|---|---|---|
| `0ffa1c7` | Adicione o contrato puro do parecer versionado do Verifier | core |
| `175d459` | Persista o parecer do Verifier append-only e versionado | migration + pgTAP + tipos |
| `ec1c67f` | Fie o parecer do Verifier ao caminho vivo (fail-open) | web (composição + rota) |
| _este_ | Documente o parecer do Verifier e a investigação dos gates | doc |

## (1) PARECER DO VERIFIER — IMPLEMENTADO

Distinção canônica preservada: **EVIDÊNCIA** (histórico observado/atestado) ≠
**PARECER** (interpretação versionada da evidência) ≠ **DECISÃO** (autorização
humana/política).

- **Contrato puro** (`packages/core/.../verifier-opinion.ts`): `VerifierOpinionV1`
  (correlação + `verifierVersion` + `verdict`/`summary`/`findings` compactos +
  `evidenceBasis` = identidade dos eventos de evidência considerados + cobertura).
  `computeVerifierOpinion(item, events)` puro/determinístico (null sem handoff durável).
  `parseVerifierOpinion` (fail-closed) e `projectVerifierOpinionHistory` (auditoria).
- **Persistência** (`20260816000000/01`): evento `verifier_opinion_recorded` +
  RPC `record_verifier_opinion`, `author=system`/`origin=verifier` — proveniência que o
  sinal do executor não forja. Exige tentativa real, correlação e base de evidência
  apontando eventos **desta** tentativa.
- **Histórico versionado, não verdade única**: identidade `(attempt, verifier_version,
  result_event_id, observed_event_id)`. Idêntico replaya; conteúdo divergente na mesma
  base é conflito `55000` (Verifier é determinístico); **base ou versão diferente
  acrescenta** sem apagar. Cobre o exemplo do mandato: V1 sobre atestado → V1 sobre
  atestado+observado → V2, tudo append-only.
- **Recomputável = auditoria**: `computeVerifierOpinion` é puro sobre o log, então um
  crash entre computar e persistir não perde nada (recomputa no próximo seam). Sem efeito
  irreversível → wiring **fail-open**.
- **Wiring vivo** (`apps/web/.../verifier-opinion.ts` + `/supervisor-turn`): após um
  terminal `result`, lê o estado fresco (inclui a evidência observada recém-persistida) e
  registra o parecer via porta injetada. Fail-open (skipped sem handoff; erro/exceção
  capturados).
- **Separação rígida vs `integration_decision` (ADR-002)**: um `VERIFIED` persistido
  **não** aceita resultado, **não** cria/decide integração (`integration_decided` é
  `author=user`, pós-aceite, item `completed`), não publica/mergeia/deploya, não aumenta
  maturidade, não remove o humano. Provado: registrar parecer mantém o item em `review`;
  nenhum parecer tem `author=user`.

### Gates

- **core (jest):** 34 suites / **757 PASS** (+14 do parecer).
- **web (jest):** verifier-opinion 6/6; supervisor-turn route + worktree-supervisor 7/7.
- **pgTAP:** verifier_opinion 20/20; suíte completa PASS.
- **typecheck:** 5 workspaces limpos. Tipos regenerados **cirurgicamente** (enum + RPC).

## (2) INDEPENDÊNCIA DOS GATES — INVESTIGADO (não implementado)

Achado comprovado no código (`apps/web/lib/work-orchestration/worktree.ts`): os gate
commands rodam **em processo** no host (`runGate` → `runProcess` → `child_process.spawn`);
o host observa diretamente `command`/`exitCode`/`durationMs`/`timedOut`/`cancelled`.
**Porém** quem chama `runGate` é o `WorktreeExecutorAdapter` (o papel **executor** do
INT-01), e o desfecho é empacotado no handoff **atestado** (`worktreeHandoff.gates`). O
Verifier é provider-neutral e não distingue o adaptador confiável in-process de um executor
futuro não-confiável → trata como atestado.

Nuance: no caminho worktree, o **autor do código** (`CoderBackend`/LLM) é não-confiável,
mas o **executor do gate** (`runGate`, TS de host) é confiável — o desfecho é independente
do autor do código, porém capturado pelo papel executor. Diferente do git (reinspeção de um
artefato persistido depois do fato), o desfecho do gate é fato de **runtime**: não há
artefato a reinspecionar. Logo, independência ao nível do Verifier exige uma de duas
mudanças, **nenhuma trivial**:

1. **Reexecução pelo host** contra a branch persistida (independência real, provider-agnóstica;
   custo: trabalho duplicado, latência, checkout extra, gate roda duas vezes) — a única via
   que generaliza para executores não-confiáveis; o mandato pediu para não reexecutar sem
   necessidade;
2. **Mover a execução de gate para um passo do host** fora do `WorkExecutorAdapter` (sem
   reexecução, mas altera o contrato INT-01 e a propriedade da worktree; não generaliza
   sozinha para executores remotos).

**Decisão:** documentar (arquitetura viva + PRD) e **não** forçar implementação — nenhuma
opção é "capturar o que o host já observa" sem uma decisão de fronteira/custo. Próximo
recorte candidato aguarda decisão humana. `coverage.gates=false` permanece a leitura honesta.

## Invariantes de segurança preservadas

- origin/main intacta; **sem push, PR, merge, deploy, efeito externo, credencial real**.
- `.worktrees/`, worktrees existentes, `.claude/settings.local.json` e `apps/web/.env.local`
  preservados; nenhum `git clean`/reset destrutivo; nenhuma evidência apagada; `supabase db
  reset` **não** executado (só `migration up`).
- Nada de política automática de maturidade, autoelevação ou remoção de gate humano. O
  parecer é advisory e não vira decisão.

## Fronteiras humanas / não implementado

- **Independência de gate** (reexecução ou refatoração de fronteira) — aguarda decisão humana.
- **Política de maturidade** que pondere pareceres/atestação — BLOQUEADA.
- **Superfície de leitura do histórico de pareceres na UI** — `projectVerifierOpinionHistory`
  existe no core, mas não foi fiado a nenhuma tela (fora do escopo deste recorte).

## Próximo ponto exato de retomada

Parecer do Verifier fechado (contrato + persistência + wiring + adversarial + docs). O
próximo eixo de maior valor em independência de evidência é a **independência dos gates**,
cuja investigação (acima) concluiu exigir decisão humana entre reexecução (opção 1) e
refatoração de fronteira (opção 2). Não iniciar sem essa decisão. Política automática de
maturidade permanece BLOQUEADA.

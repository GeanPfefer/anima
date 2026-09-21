# 2026-09-21 — Materialização autônoma de auto-melhoria + Readiness Calibration

- **Data/tipo:** 2026-09-21; desenvolvimento + prova viva (read-only).
- **Objetivo:** avançar o self-development autônomo end-to-end a partir do estado
  REAL do repositório, removendo barreiras estruturais que exigiam intervenção
  manual desnecessária — SEM cruzar as fronteiras humanas ratificadas.
- **Branch:** `dev`. **HEAD inicial:** `aabe73a`. **HEAD final:** `93104d0`.
- **Executor:** Claude (Opus 4.8). Frente concorrente do Codex correu em paralelo
  (ver abaixo) — sem colisão de arquivos.

## Contexto e reconstrução do estado

Auditoria READ-ONLY do estado real (git, worktrees, código, testes, PRD, plano
002, doc de orquestração). A cadeia shadow de governança (Differential Evidence →
Policy V0 → Enforcement Readiness V0 → Change Authorization Evidence) estava
COMPLETA e íntegra. A doc de orquestração (`docs/arquitetura/orquestracao-de-trabalho.md`,
seção "Benchmark do Claude Auto Mode e autonomia progressiva") é EXPLÍCITA: a
**política automática de promoção permanece bloqueada** ("O componente não concede
poder a si próprio"). Portanto, remover o gate humano de review (Enforcement V1 no
sentido de auto-aceite) VIOLARIA a arquitetura ratificada — e não foi feito.

Duas lacunas SEGURAS e desbloqueadas foram identificadas e implementadas.

## Mudanças e commits (5, meus)

1. `bfdf1fa` — **Materialize a auto-melhoria quando o host residente fica idle.**
   O detector de deficiência e o formulador de proposta já existiam no core, mas o
   Resident Host só materializava do backlog CANÔNICO escrito por humano. Agora,
   ao ficar idle (`no_eligible_work`), o host também converte a deficiência própria
   mais forte em UM work_item `proposed`. Desfecho MÁXIMO `proposed`; a proposta é
   sempre `structural` ⇒ aprovação humana obrigatória (o envelope de autorização
   autônoma a recusa por `impact_not_low`); NUNCA auto-aprova/autoriza/reserva/executa.
   - `apps/web/lib/work-orchestration/self-improvement-materializer-deps.ts` (novo);
   - `apps/web/lib/work-orchestration/self-improvement-materialize.ts` (novo):
     orquestração idle com portos injetáveis + combinador `runMaterializersInOrder`
     (canônico preferido, auto-melhoria como fallback);
   - `apps/web/scripts/resident-host.ts`: compõe as duas fontes, gated por
     `ANIMA_RESIDENT_MATERIALIZE_SELF_IMPROVEMENT` (ausente ⇒ inalterado).
2. `9389a58` — **Alinhe a fixture web do Verifier à semântica de claim_kind.**
   Correção de regressão PRÉ-EXISTENTE (não causada por mim): `verifier-opinion.test.ts`
   estava vermelho no HEAD porque sua fixture não declarava `claim_kind`; após
   `e9a3932` (suficiência semântica) o parecer virou `inconclusive` e a expectativa
   seguia `verified`. O teste-espelho no core já fora atualizado; o web não. Fix =
   declarar `claim_kind: 'gate_assertion'` na fixture. Sem tocar produção.
3. `30cd600` — **Readiness Calibration V0** (`readiness-calibration.ts`, core puro
   versionado): o consumidor que faltava da readiness shadow. A doc de orquestração
   diz que as decisões de readiness são persistidas "para permitir a comparação
   posterior entre o outcome operacional real e o que a policy decidiria" — nada as
   lia. `rollupAttemptReadiness` (conservador, por-tentativa) + `classifyReadinessCalibration`
   (confirmed_eligible | optimistic_miss | conservative_confirmed | conservative_overruled
   | no_signal) + `summarizeReadinessCalibration` (precisão de `eligible`).
4. `1a4c861` — **Correlacione readiness×revisão sobre o log** (`correlateReadinessCalibration`):
   mesma cadeia de correlação já validada (capability-proof): `result_accepted`/
   `changes_requested` → `result_submitted` (`attempt_id`) → evidência de gate
   (readiness recomputada pelo parser). Decisão terminal mais recente vence.
5. `93104d0` — **Dry-run read-only da calibração** (`apps/web/scripts/readiness-calibration-readonly.ts`):
   superfície operacional US$0, sob identidade residente (GoTrue Bearer + RLS,
   nunca service_role).

## Prova viva (read-only, US$0)

`readiness-calibration-readonly.ts` rodado contra o Supabase LOCAL real (up; auth
health 200), identidade residente, 1168 eventos. **Achado empírico honesto:** das
9 tentativas revisadas no histórico, **ZERO chegaram a readiness `eligible`** —
todas `insufficient_evidence` (6 `conservative_confirmed`, 3 `conservative_overruled`;
`eligiblePrecision=null`). Confirma que o pipeline de evidência diferencial ainda
não PRODUZ evidência de grau `eligible` em produção (baseline diferencial + `claim_kind`
por-gate ainda não presentes nas tentativas históricas). A readiness reteve
corretamente inclusive no falso-positivo conhecido `3fff6373` (seq4→seq5).

## Gates / provas

- Core: 97 suítes / **1988** testes verdes; typecheck limpo.
- Web: 135 suítes / **1684** testes verdes; typecheck limpo.
- Testes novos meus: 10 (self-improvement-materialize) + 18 (readiness-calibration).
- Flake conhecido (`WorkProposalCard.test.tsx`, `lib/ai/project-tools.test`) NÃO
  disparou nesta sessão.

## Bugs

- **Encontrado + corrigido (pré-existente):** `verifier-opinion.test.ts` vermelho no
  HEAD por fixture desatualizada (não regressão minha) — `9389a58`.

## Frente concorrente (Codex) — preservada, sem colisão

Codex commitou 4 mudanças no MESMO domínio (hardening do lifecycle de deficiência)
durante a sessão: `ab47402`, `2562c09`, `ffacab8`, `5ac99d3` (+ registro
`docs/registros/2026-09-21-hardening-lifecycle-self-development.md`, PRD e plano 002).
**Zero sobreposição de arquivos** com os meus (verificado por `comm`): Codex mexeu na
LÓGICA de cobertura/resolução (`self-deficiency.ts`, `self-improvement.ts`,
`self-deficiency-read.ts`); eu adicionei a FIAÇÃO residente + a calibração (arquivos
novos). Minhas suítes exercitam o core JÁ endurecido pelo Codex (verde no tree
combinado). As frentes são complementares.

## Invariantes de segurança preservadas

- `origin/main` intacta (`99bec54`); SEM merge em main; SEM push; SEM compute pago;
  SEM recurso cloud; SEM service_role; SEM `db reset`.
- Desfecho máximo da materialização = `proposed`; auto-modificação = `structural` ⇒
  fronteira humana. AUTO-APPROVAL de estrutural continua inexistente.
- `Calibration != Enforcement`; a política automática de promoção permanece bloqueada.

## Fronteiras humanas restantes (BLOCKED_BY_HUMAN_DECISION)

- Aprovação humana de proposta `structural` (inclui toda auto-melhoria).
- Review humano de resultado (`review → accept/request_changes`).
- Ciclo manual/supervisionado (`start_work`/`submit_work_result`) — ato humano via UI.
- Promoção de maturidade / enforcement automático — explicitamente bloqueado (Marco 005).

## Próximo ponto exato de retomada

O achado da calibração aponta o gargalo real para `eligible`: o EXECUTOR ainda não
PRODUZ o baseline diferencial nas execuções reais (`contrato✓ → planner emite →
executor produz` — só a 3ª fatia falta), e o `claim_kind` do planner (`b4791d9`)
ainda não foi exercitado ao vivo. A próxima fatia natural é a produção host-side do
baseline diferencial no `worktree-executor` (custo: rodar o gate no base_sha ~dobra a
suíte; CUIDADO com o footgun CRLF e com possível concorrência do Codex nesse arquivo).
Enquanto isso NÃO muda comportamento (enforcement bloqueado), só enriquece o sinal de
calibração para uma futura decisão HUMANA de maturidade.

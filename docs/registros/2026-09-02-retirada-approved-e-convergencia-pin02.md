# 2026-09-02 — Retirada canônica de plano aprovado obsoleto + convergência do PIN-02

**Tipo:** desenvolvimento + prova. **Branch:** `dev`. **HEAD inicial:** `824c714`.
**HEAD final:** commit que contém este registro. Continua
[2026-09-02-verifier-v2-cobertura-heterogenea.md](2026-09-02-verifier-v2-cobertura-heterogenea.md).

## Semântica de lifecycle nova (menor delta)

Um sistema autônomo precisa reconhecer: "eu estava autorizado a executar este plano, mas
antes de começar descobri que ele ficou obsoleto". A resposta correta não é executá-lo,
editar sua história, apagá-lo, nem fabricar falha — é registrar que a AUTORIZAÇÃO foi
RETIRADA antes da execução, preservando a evidência.

**Estado/transição:** reusa o terminal `cancelled` e a transição JÁ normativa
`('approved','work_cancelled','cancelled')` de `private.work_state_transitions` — nenhum
estado novo. `cancelled` já significa "não será executado". Distingue-se de:
`rejected` (proposta recusada, nunca aprovada), `changes_requested` (correção pedida),
`failed` (execução começou e falhou).

**RPC `public.withdraw_approved_work(work_item_id, expected_proposal_version, reason)`**
([migration](../../supabase/migrations/20260902000000_withdraw_approved_work.sql)),
SECURITY DEFINER, espelhando `resolve_approval`:
- **Preconditions (fail-closed):** `state='approved'` + versão vigente (`approved` só é
  alcançado de `proposed` via `work_approved` e nunca reentra após executar, então já
  garante "nunca iniciado"; defesa em profundidade confere ausência de
  `execution_started`/`work_started`/`result_submitted`).
- **Autoridade:** ato do DONO (`author='user'`), allowlist + RLS (`auth.uid`), nunca service_role.
- **Idempotência:** repetir devolve o item sem novo evento.
- **Dependências:** `cancelled ≠ completed` → NÃO satisfaz dependência nem desbloqueia
  quem exigia a CONCLUSÃO deste. Lineage/append-only preservado; nada apagado/resetado.
- **Fila autônoma:** `cancelled` é terminal → excluído da elegibilidade (`work_already_closed`).

**Camadas:** `WithdrawApprovedWorkCommand` + `service.withdrawApprovedWork` (valida versão+motivo)
+ `repository.withdrawApprovedWork` (RPC via `mutate`) + tipos regenerados. Exposto por
`anima work withdraw <id> --reason "..."` E pela rota `POST /api/work-orchestration/withdrawals`
(mesma capability; a regra vive no serviço/RPC, não no adapter).

## Provas / gates

- pgTAP `supabase/tests/withdraw_approved_work.test.sql`: **14/14** — CASO A (approved retirável→
  cancelled + evento + reason + estado anterior), H (aprovação intacta), E (replay idempotente
  sem duplicar), B (in_progress negado 55000), C (proposed negado), versão divergente/motivo vazio
  negados, F (sem allowlist negado 42501).
- typecheck core+supabase+web LIMPOS; core 66/1389; supabase 10; CLI 33.

## PIN-02 — retirada + re-derivação + convergência (tudo pela CLI, Next parado)

1. **Sucessor obsoleto `330e55e2`** (approved, pré-fix, `[prova: —]`): confirmado approved sem
   attempt → `anima work withdraw 330e55e2 --reason "...spec obsoleta antes da execução após o
   Verifier evoluir para prova heterogênea gate/escopo; substituto re-derivado do mesmo intent..."`
   → **`cancelled`**. História append-only intacta.
2. **Re-derivação canônica** `anima work correct 8e9fd82b` → sucessor FRESCO
   **`5b8e371d-6ca9-453c-bbfe-693ae3266468`** (lineage `60eb5b84`, recoverySequence **2**, replayed
   false). Escopo idêntico (só `packages/core/src/project-intake.test.ts`; impl excluída). AGORA
   com requisitos de prova: gates cobrem o critério FUNCIONAL (`[prova: gate]`); "Contenção de
   escopo da correção" (`proof:scope`) cobre os dois invariantes (`[prova: escopo]`).
3. **Convergência provada (§16, sem coder)** sobre o contrato REAL persistido de `5b8e371d`:
   handoff/observado sintéticos (só o test file muda + gates verdes) → Verifier v2 **verified,
   0 violações, 0 gaps, 3/3 critérios cobertos**.
4. **Aprovação humana** (autorizada §17, condições satisfeitas) `anima work approve 5b8e371d`
   → **`approved`**.

PIN-02 original (`8e9fd82b`) permanece `changes_requested`; histórico (attempt/result/branch/
Verifier v1/request_changes) intacto.

## Self-dev — NÃO executado (barreira concreta)

Ollama estava DESLIGADO (porta 11434 ausente) e a máquina é compartilhada (§19). O coder não
pode rodar; a prova viva self-dev fica **pendente**, com o sucessor `5b8e371d` `approved` e
convergência já provada deterministicamente. Nenhum app do usuário foi encerrado.

## Segurança e efeitos externos

Sem service_role no fluxo normal. Migration aplicada SÓ localmente (não-destrutiva; nunca
`db reset`; remoto/cloud não tocado). Sem publish externo/PR/merge/deploy; `origin/main`=`99bec54`
intacta. Efeitos persistidos (autorizados): retirada de `330e55e2` (`cancelled`) e materialização+
aprovação de `5b8e371d` (`approved`). `.worktrees/`, `watch4-sensors.txt`, `.env.local`,
`.claude/settings.local.json` preservados.

## Próximo ponto de retomada

Com Ollama no ar e headroom: `ANIMA_AUTONOMY_ENABLED=1 npm run local-host` → supervisor
seleciona `5b8e371d` → attempt → worktree → qwen3-coder edita SÓ `project-intake.test.ts` →
gates (focado+typecheck) + evidência de escopo observada → Verifier v2 → `review` (esperado
VERIFIED, 3/3). Ao chegar a `review`, PARAR: a decisão (aceitar / pedir novas correções) volta
ao humano. PIN-03 permanece adiado.

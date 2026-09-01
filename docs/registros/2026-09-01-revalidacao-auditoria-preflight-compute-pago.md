# 2026-09-01 — Revalidação de autoridade, auditoria fail-closed e preflight do compute pago

**Tipo:** desenvolvimento + auditoria pré-microprova paga. **Branch:** `dev`.
**HEAD inicial:** `f390a46`. **HEAD final funcional:** `1c2fa3b`; o commit posterior contém este
registro. `origin/main` observado em `99bec54` e **não alterado**. `origin/dev` avançado
`f390a46 → 1c2fa3b` por fast-forward.

Continua o recorte de [2026-09-01 — Observabilidade e crash do compute pago](2026-09-01-observabilidade-e-crash-compute-pago.md).
Fontes canônicas (referenciadas, não duplicadas): [arquitetura da lease/segurança](../arquitetura/provisionamento-lease-seguranca.md),
[adapter RunPod](../arquitetura/provisionamento-runpod-adapter.md), [Plano 005](../planos/005-provisionamento-on-demand-v1.md).

## Objetivo e resultado

Fechar o working tree legítimo de uma auditoria pré-microprova paga (6 arquivos), validá-lo e
endurecer três lacunas remanescentes de segurança/recovery do compute pago — **sem cloud, sem
credencial real, sem gasto**. Resultado: cadeia autorização→reconciliação coerente e fail-closed
ponta a ponta; nenhum bloqueador técnico obrigatório restante no código.

## Mudanças relevantes (commits)

- `3eb7a38` **Derrube recurso pago em estado de falha na reconciliação** — `decidePaidLeaseReconciliation`
  passa a `stop` em `provision_failed`/`health_failed`/`shutdown_failed` com recurso ainda de pé,
  ANTES do teste de autoridade (falha nunca sustenta gasto). Flui pelo reconciler vivo
  (`decision === 'stop'` → teardown). Higiene: a chave do Map de projeção usava separador de byte
  **NUL cru** (fonte tratado como BINÁRIO pelo Git) → `JSON.stringify([...])` (bijeção livre de
  colisão, chave efêmera; fonte volta a ser texto, zero efeito observável).
- `d407e19` **Revalide a autoridade paga antes de entregar o runtime** — node pago relê a autorização
  persistida após o health externo e ANTES de `health_confirmed`, exigindo o MESMO `authorizationRef`;
  se sumiu/revogada → `health_lost` + `shutdown_requested` + teardown bounded +
  `shutdown_confirmed/failed`, retorno `waiting_authorization / authority_unavailable_before_runtime`.
  Fecha a janela entre avaliação pré-provision e entrega do runtime.
- `43e9de4` **Prove o create ambíguo do RunPod** — POST cria o pod, resposta se perde; replay acha por
  nome determinístico, observer recebe `providerRef`, nenhum 2º POST (`posts === 1`).
- `40b869e` **Prove convergência e idempotência do reconciler pago** — provider indisponível →
  `retry_later` → ciclo seguinte `torn_down`; replay após crash entre destroy e `shutdown_confirmed`
  não ressuscita (`results` vazio).
- `8950c6d` **Não oculte falhas da auditoria de compute pago** — `readPaidComputeAudit` passa a
  resultado discriminado `{ ok:true, records } | { ok:false, reason:'paid_compute_audit_unavailable' }`;
  a rota `GET /api/work-orchestration/paid-compute-audit` propaga 503 (como `budgets`). Erro de leitura
  nunca vira "nenhum compute pago"; log vazio observado segue `ok:true`/zero. Complementa `64ca767`
  (que já separara o gate de concorrência).
- `1c2fa3b` **Corrija o comentário do preflight sobre teto de custo** — o comentário afirmava que
  autorização só-temporal (sem teto) seguia válida; a regra real (`evaluatePaidComputeAuthorization`)
  EXIGE `maxCostEstimate` explícito (nega `aggregate_cost_ceiling_required`). Só o comentário mudou;
  a regra é a fonte de verdade e não foi relaxada.

## Bugs corrigidos (auditoria)

- Fonte `.ts` tratado como binário pelo Git por separador NUL desde a criação (`dfd2e02`).
- Auditoria humana de compute pago mentia por omissão em erro de leitura (`[]` silencioso).
- Comentário do preflight desatualizado frente à política de teto de custo obrigatório.
- Janela de exposição: autorização revogada/expirada entre health externo e entrega do runtime.

## Provas / gates

- Focados: core `paid-compute-lease-reconciliation`+`node-lifecycle` `56/56`; web
  `resident-on-demand-node`/`runpod-node-provisioner`/`paid-compute-lease-reconciler(-deps)`/
  `paid-compute-audit`/`paid-compute-preflight` `83/83`.
- Completos: **core `1349/1349`**, **web `1173/1173`** (subiram por novos testes; baseline 1348/1168).
- typecheck **5 workspaces** (mobile/web/core/supabase/types) PASS; **Next build** PASS;
  `git diff --check` limpo; **NUL=0** em todos os arquivos tocados.
- pgTAP **não impactado** (nenhuma migration/SQL neste recorte).
- Flake conhecido preexistente (não regressão): `WorkProposalCard.test.tsx` + `lib/ai/project-tools.test`
  sob carga ampla — verdes isolados.

## Invariantes de segurança preservadas

`necessidade ≠ gasto`; autoridade paga é TETO DURO e BOUNDED; decisões fail-closed (inalcançável →
`retry_later` nunca abandona; autoridade indisponível → teardown); reserva NUNCA voidada após chamada
ambígua ao provider; credencial só por env (`ANIMA_RUNPOD_API_KEY`), nunca em banco/log/commit;
auditoria/UI não são write gates. Revalidação em erro de DB → fail-closed (teardown), e teardown
falho aqui permanece reconciliável pelo reconciler durável.

## Efeitos externos

ZERO chamada RunPod real, ZERO compute pago, ZERO gasto, ZERO credencial real. Nenhum deploy, nenhum
PR, nenhum merge. `push` para `origin/dev` realizado (fast-forward, autorizado após gates verdes);
`origin/main` intacta. Locais preservados e NÃO commitados: `.worktrees/`, `watch4-sensors.txt`,
`.claude/settings.local.json`.

## Prontidão para a 1ª microprova paga

**READY (código)** — nenhum bloqueador técnico obrigatório restante. Faltam apenas os inputs do
envelope humano/operacional, deliberadamente NÃO executados aqui: API key real do RunPod, imagem +
classe de GPU do catálogo, e uma **autorização paga humana bounded**. Aberto (decisão humana, não
bug): teto de custo agregado por-autorização vs. por-request. A microprova real exige uma **nova
autorização humana explícita e específica**.

## Próximo ponto de retomada

Com o envelope humano acima, executar a 1ª microprova paga bounded seguindo os critérios do
[Plano 005](../planos/005-provisionamento-on-demand-v1.md): confirmação prévia de zero recursos vivos
(via auditoria fail-closed + contagem viva), execução bounded (duração/teto/concorrência), teardown,
reconciliação e confirmação posterior de zero recursos, com auditoria do ledger.

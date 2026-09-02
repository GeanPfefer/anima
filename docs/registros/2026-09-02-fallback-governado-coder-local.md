# 2026-09-02 — Fallback governado de coder local por capacidade

**Tipo:** desenvolvimento. **Branch:** `dev`. **HEAD inicial:** `0af490f`. **HEAD final:** `fbf0baa`.
Continua [2026-09-02-prova-viva-successor-pin02-barreira-ram.md](2026-09-02-prova-viva-successor-pin02-barreira-ram.md).

## Objetivo

Permitir que o Anima escolha, de forma GOVERNADA, um coder local alternativo compatível
com o hardware quando o modelo preferido não cabe — sem esconder o downgrade e sem alterar
silenciosamente a intenção aprovada. Motivação: o attempt `2685b72b` falhou com
`ollama 500` porque qwen3-coder:latest (30B/18GB) não cabe em 16GB de VRAM.

## Política de fallback (o menor mecanismo geral)

- **Núcleo puro** `selectGovernedCoderModel(preferred, {capacityGb, allowlist})`
  ([coder-model-selection.ts](../../packages/core/src/work-orchestration/coder-model-selection.ts)):
  preferido PRECISA estar na allowlist (senão fail-closed — não se roda modelo não permitido);
  se cabe (`requiresGb ≤ capacityGb`) → usa o preferido; senão → o MAIOR allowlistado que cabe;
  se nenhum cabe → fail-closed. Determinístico; empate desempata por ordem de declaração.
- **Evidência observável** `CoderModelSelectionEvidenceV1` (preferred/selected/downgraded/reason/
  capacityGb/requiresGb) anexada à `HostObservedCoderEvidenceV1` (campo `modelSelection`). O
  downgrade NUNCA é silencioso. A RPC `record_host_observed_coder_evidence` é required-fields
  (não whitelist) → aceita o campo **sem migration**.
- **Config** `resolveCoderCapacityPolicy` ([coder-model-policy.ts](../../apps/web/lib/work-orchestration/coder-model-policy.ts)):
  `ANIMA_CODER_VRAM_GB` + `ANIMA_CODER_MODEL_ALLOWLIST` (JSON `[{model,requiresGb}]`). AUSENTE ⇒
  política DESLIGADA (usa o preferido como hoje; backward-compatible). É config do operador
  (capacidade declarada), não observação de GPU ao vivo (refinamento futuro).
- **Wiring** `backendFor` (executor-selection): resolve o modelo PREFERIDO do contrato aprovado
  (intent intacto), aplica a seleção se a política existir, cria o `OllamaCoderBackend` com o
  SELECIONADO e expõe a seleção na `observation` → flui à evidência via `onCoderObserved`.
  Sem hardcode de PIN-02 nem de qualquer modelo.

## Prova (determinística) e demonstração viva

- core 67/1397 (novos: política — preferido cabe / não cabe+fallback / sem compatível⇒fail-closed /
  preferido fora da allowlist⇒fail-closed / vazia/inválida⇒fail-closed / downgrade observável na
  evidência / evidência malformada recusada). Resolver de config 3 testes. Web coder/executor 79
  sem regressão. typecheck core+web limpo; `git diff --check` limpo.
- Demonstração live (read-only, política de exemplo VRAM 16 + allowlist): preferido REAL de
  `5b8e371d` `qwen3-coder:latest` (18GB > 16) → **downgrade para `qwen2.5-coder:14b`** (10GB),
  `downgraded:true`, `reason:preferred_exceeds_capacity`, `capacityGb:16`, `requiresGb:10`.

## Retry — FRONTEIRA HUMANA (§11, PARE)

O retry continua sendo ato HUMANO e **não existe capability CLI canônica de retry** (a CLI não
tem `work retry`). Por §11, NÃO fabrico retry e PARO aqui, informando os comandos exatos abaixo.
O sucessor `5b8e371d` segue `failed`, RETRY_READY (failureEventId `ed4941e4`, 2 tentativas
restantes). Nenhum efeito de execução nesta sessão; `dev` limpo; `origin/main` intacta.

## Próximos comandos exatos (para o usuário completar a prova)

1. Governed retry (HUMANO) do `5b8e371d` pela via canônica (RPC `request_work_retry` sob a
   identidade do usuário, ou o botão de retry do cartão na web) — reabre `failed → approved`.
2. Rodar o Resident Host com a política de fallback CONFIGURADA (para o coder cair em
   qwen2.5-coder:14b), a partir de `apps/web`:

   ```
   ANIMA_AUTONOMY_ENABLED=1 \
   ANIMA_CODER_VRAM_GB=16 \
   ANIMA_CODER_MODEL_ALLOWLIST='[{"model":"qwen3-coder:latest","requiresGb":18},{"model":"qwen2.5-coder:14b","requiresGb":10}]' \
   npm run local-host
   ```

O supervisor seleciona naturalmente `5b8e371d`; o host baixa o modelo para qwen2.5-coder:14b
(downgrade registrado em `modelSelection`); coder edita SÓ `project-intake.test.ts` → gates +
scope evidence → Verifier v2 → `review` (esperado VERIFIED 3/3). Ao chegar a `review`, PARAR:
a decisão volta ao humano. PIN-03 permanece adiado.

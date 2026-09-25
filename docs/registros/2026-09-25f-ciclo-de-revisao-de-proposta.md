# 2026-09-25f — Ciclo proposta → correção → revisão (item 2c7afe1d)

## Barreira

Após `e02cf7f`, o chat criou `2c7afe1d` (pedido `GET /api/dev-readiness`, mensagem `ec1d4901`,
18:31:37Z) com v1 incoerente (escopo `identity/status/route.ts` + `cli/identity.ts`, sem rota nem
teste, gate `npm run build`, max_attempts 3, impacto structural). O humano pediu correção pela UI;
a UI continuou em "proposed · v1".

## Evidência (read-only)

- Banco: `proposal_version = 2`. Eventos: `work_proposed` v1 (54536), `context_attached`,
  `proposal_changes_requested` (54538, autor user, `reviewed_proposal_version: 1`, feedback
  íntegro) e `proposal_revised` v2 (54539) — mesmo instante 18:34:23.310177 (transação única do
  RPC `request_work_proposal_revision`). v1 preservada; sem duplicação.
- `POST /api/work-orchestration/proposal-corrections 200` em 54 s; planner gpt-5.6-terra, 8 voltas
  (submits recusados por ancoragem; volta 7 `incomplete/max_messages` sem tool call recebeu a
  continuação de `e02cf7f`; volta 8 submit aceito). Chamada ao provider: sim (admissão interativa).
- Depois do POST não há `GET /api/work-orchestration/items/<id>` (o `reload()` do card), e sim
  `GET /chat` + `by-source`: a resposta foi perdida no cliente (recarga da página durante o
  planejamento) e o card não tinha revalidação ⇒ UI presa em v1. `work show` e `by-source`
  projetam v2.
- v2 não é revisão real: escopo `apps/web/app/api/work-orchestration/items/route.ts`, gate
  typecheck, max_attempts 3, impacto structural; o próprio risco declarado: "A topologia recusou
  os paths novos necessários para a rota e seu teste."

## Classificação

B (v2 persistida, UI projetando v1) + E (defeitos do planner): ancoragem recusava arquivo novo em
pasta nova; `max_attempts` fixo no host; revisão sem a proposta vigente como referência.

## Correção (`ea2576f`)

Ancoragem aceita uma pasta nova sob diretório existente (não na raiz; nunca >1 nível);
`max_attempts` 1–3 estrutural; revisão recebe v1 como referência não autoritativa e recusa
proposta idêntica; card revalida no foco/visibilidade e reconcilia resposta perdida. Contrato de
revisão reusado (RPC atômico, stale ⇒ 55000). Impacto não é alterável por revisão (RPC não o
atualiza) — decisão de governança pendente.

## Provas

web 141 suítes / 1775 PASS; pgTAP `work_remediation.test.sql` 32/32; tsc PASS; diff --check PASS.

## Efeitos externos

Nenhuma chamada nova ao provider nesta investigação/correção. Item 2c7afe1d intocado (v2, 4
eventos). 0 authority, 0 preference, 0 attempt. Sem push.

## Retomada

Humano foca/recarrega o chat ⇒ card mostra v2 ⇒ "Pedir correção" sobre v2 com o mesmo feedback
⇒ v3 pelo fluxo normal. Não aprovar v2.

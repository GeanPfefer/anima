# 2026-09-25e — Planner OpenAI: volta sem tool call (barreira real do chat)

## Barreira

Chat (GPT, modo desenvolvimento), 2026-09-25 17:57:24Z, mensagem `be284bf1` pedindo
`GET /api/dev-readiness`. Resposta 17:59:09Z (`aed324b8`): "Não consegui preparar uma
proposta executável: O GPT não produziu uma proposta estruturada." (`POST /api/ai/chat` 106 s).

## Evidência

- Planner: `OpenAIProjectWorkPlanner` (Responses API), modelo `gpt-5.6-terra` (`OPENAI_MODEL`),
  admissão interativa (sem authority/reserva paga).
- Rejeição: `project-work-planner-openai.ts` — HTTP ok, `output` sem nenhum `function_call`.
- Resposta bruta, status, `incomplete_details`, usage: **não observáveis** — o harness os
  descartava e nada era logado/persistido.
- Nenhum work item/evento criado (sem entidade parcial, sem duplicação).

## Causa (harness/protocolo)

`tool_choice: 'auto'` permitia ao modelo encerrar a volta em texto/raciocínio; o host tratava
esse desfecho legítimo da API como terminal na primeira ocorrência e sem diagnóstico.

## Correção (`e02cf7f`)

`tool_choice: 'required'` enquanto investiga (reuso do mecanismo do provider; submit já é
`strict`); uma continuação corretiva para volta sem tool call; falha final com a forma da
resposta; log por volta só de forma/tokens; motivo real na recusa do submit. Regressão
`project-work-planner-openai-no-call.test.ts`. Web 140 suítes / 1761 PASS.

## Efeitos externos

Nenhuma chamada paga nova. Sem push.

## Retomada

Humano reenvia EXATAMENTE a mesma mensagem pelo chat (GPT, modo desenvolvimento). Depois:
revisar plano → approve → `work set-compute … provider_api/openai/gpt-5.6-sol` →
`prepare-autonomous` → prova pré-authority → `authorize-compute` (US$3/30 min/2 h).

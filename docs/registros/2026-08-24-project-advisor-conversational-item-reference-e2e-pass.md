# Referências conversacionais do Project Advisor — prova E2E

- **Data / tipo:** 2026-08-24 — prova viva pela UI real.
- **Branch / HEAD de prova:** `dev` / `83983393e977acae09e21cd266b85dedc03b9565`.
- **Resultado:** `PROJECT_ADVISOR_CONVERSATIONAL_ITEM_REFERENCE_V0_E2E = PASS`.
- **Provider/model:** OpenAI / `gpt-5.6-terra`.

## Conversa comprovada

T1, “Como está o projeto?”, entrou no Project Advisor depois da correção de
roteamento. O snapshot vivo de `2026-08-24T20:44:24.165Z` continha 24 itens e
200 eventos bounded. A resposta apresentou seis UUIDs reais. As duas primeiras
referências estruturadas foram:

1. `58159655-0213-41e0-bb5a-735f79a81bf6`, papel `active_item`, observado
   `in_progress`;
2. `418b7a23-f019-47b4-aa8b-5973a997fcb5`, papel `active_item`, observado
   `approved`.

T2, “Me fale mais sobre o primeiro.”, resolveu a primeira referência sem UUID
digitado. Uma nova leitura sob RLS projetou o item 1 em
`2026-08-24T20:45:51.647Z`: proposta 1, estado `in_progress`, quatro eventos com
cobertura integral até `work_started`, sem tentativa, resultado, coder, gates,
Git ou Verifier do item.

T3, “E o segundo?”, preservou o conjunto original e resolveu a segunda
referência. A nova leitura sob RLS projetou proposta 1, estado `approved` e três
eventos com cobertura integral até `work_approved`, sem tentativa, falha,
resultado ou Verifier. As ressalvas textuais do modelo sobre “primeiro/segundo”
não mudaram a resolução do host: em ambos os turnos o UUID já estava resolvido e
somente a projeção fresh do item correto atravessou para o provider.

T4, “E esse?”, encontrou naturalmente seis referências plausíveis. O host
devolveu esclarecimento com os seis ordinais/UUIDs/estados em 104 ms, não escolheu
item e não chamou provider.

## Auditoria

- T1: uma chamada; 6.247 caracteres; 17 claims; schema/parser/semântica PASS.
- T2: uma chamada; 5.239 caracteres; 13 claims; schema/parser/semântica PASS.
- T3: uma chamada; 3.606 caracteres; 10 claims; schema/parser/semântica PASS.
- T4: zero chamadas; resolução local ambígua e fail-closed.
- Total externo: três chamadas, sem retry.
- Banco antes/depois: `work_items=60`, `work_events=601`, `work_focus=2`,
  `ai_conversations=191`.
- Git antes/depois da conversa: HEAD/origens e diff rastreado idênticos;
  `origin/main=99bec54e3ab42bfe882a8686cd1385d8058b916e`.
- Nenhum backlog, foco, item, evento, approval, coder, retry, resume ou workflow
  foi criado/acionado. Nenhum payload bruto, segredo, arquivo ou diff foi enviado.

## Limites

O modelo verbalizou em T2/T3 que o ordinal seria ambíguo sem o trecho anterior,
porque o contexto do provider contém deliberadamente somente o item já resolvido,
e não a conversa inteira. Isso é uma limitação de apresentação, não de resolução,
RLS ou freshness, todos comprovados no host. Melhorar essa formulação pode ser um
recorte futuro de UX, sem ampliar o contexto externo nem criar memória nova.

## Próximo ponto exato

O recorte conversacional read-only está provado. Qualquer evolução para decisão,
ratificação ou escrita é uma fronteira distinta e exige mandato próprio; não foi
iniciada nesta sessão.

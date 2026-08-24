# Project Advisor — estado operacional fresco V1

**Data:** 2026-08-24

**Tipo:** desenvolvimento + prova determinística local

**Branch:** `dev`

**HEAD inicial:** `9b90da27f95d106595a6d74ebc2ca25412584c8a`

**HEAD final:** commit que contém este registro

## Objetivo

Fazer o Project Advisor já provado compreender o presente operacional do Anima
a partir das fontes vivas existentes, sem transformar registros históricos em
banco operacional e sem conceder qualquer autoridade de escrita.

## Implementação

- `OperationalProjectSnapshot` projeta somente metadados de `work_items`,
  `work_events` e `work_focus`, sob RLS e queries read-only.
- A projeção agrupa trabalho ativo, falha não superada, review, bloqueio, foco e
  eventos tipados de evidência/Verifier. Payloads dos eventos não são lidos.
- “Atual” é a projeção de `work_items` no instante `generatedAt`; “recente” é o
  último evento ainda não superado na sequência bounded, sem TTL de relógio;
  história substituída permanece apenas trajetória.
- Fontes declaram `canonical`, `current_projection`, `event_sequence`,
  `historical_snapshot` ou `undated`. Afirmação presente apoiada apenas em
  histórico recebe `current_claim_without_live_source` e falha fechada.
- O contexto consolida uma triagem advisory por item, mantém timestamps e
  cobertura, declara truncamento/incerteza e permanece JSON válido dentro do
  orçamento de 2.400 caracteres por fonte viva.

## Prova local

A fixture inclui item ativo, falha de execução não superada, item em review,
bloqueio, evidência host-observed, foco e falha histórica seguida por resultado.
Ela prova que a falha superada não é apresentada como atual, o histórico segue
disponível como trajetória e a recomendação não vira ação. Casos adversariais
cobrem ausência de eventos, truncamento, claim presente apoiado só em histórico,
timestamp ausente e payloads sensíveis deliberadamente omitidos.

## Segurança e efeitos externos

- Nenhuma migration, escrita no banco, backlog, work item, evento, foco, coder,
  workflow, decisão ou ratificação foi criada.
- Nenhuma chamada OpenAI/Ollama e nenhum outro egress de modelo ocorreu.
- Não foram lidos `original_request`, `proposal`, `intent` ou `work_events.payload`.
- `.worktrees/`, `.claude/settings.local.json`, `apps/web/.env.local` e secrets
  locais foram preservados.
- `origin/main` permaneceu intocada; sem PR, merge ou deploy.

## Fontes deliberadamente não integradas

Routing, resource advisory e detalhes do Verifier continuam representados apenas
quando há evento tipado seguro. Seus payloads não entram no snapshot. Não existe
neste schema uma projeção read-only mínima que justifique expor esses detalhes;
criá-la seria outro recorte, não requisito para a triagem atual.

## Gates e retomada

Gates do fechamento: core 47 suítes/1.033 testes; mobile 5/51; Supabase 1 suíte/8
testes (1 suíte/2 testes já skipados); Advisor focado core 23/23 e web 11/11;
typecheck dos cinco workspaces; build web de 56 páginas com `next dev` parado; e
`git diff --check`. A suíte web completa passou 71/72 suítes e 895/896 testes na
primeira execução por um flake concorrente preexistente de `WorkProposalCard`
(mock recebeu três chamadas em vez de duas); repetido isoladamente, passou 47/47.
Warnings `act(...)` preexistentes permaneceram. A única etapa não provada é a
apresentação E2E pela UI com provider real, que requer autorização nova de egress.

Pergunta recomendada para essa futura prova:

> Como está o desenvolvimento do Anima agora? O que está em andamento, falhou,
> está bloqueado ou aguardando review, e o que você recomenda investigar em
> seguida — distinguindo estado atual, evidência e histórico?

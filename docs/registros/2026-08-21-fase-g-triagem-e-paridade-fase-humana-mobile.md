# Fase G — segunda triagem, matriz de cobertura e paridade da fase humana no mobile

Data: 2026-08-21
Tipo: triagem + desenvolvimento (paridade) + prova local

## Objetivo

Triagem estreita da **Fase G** (Chat UX / apresentação do trabalho autônomo) do
[Plano 002](../planos/002-modo-autonomo-v0.md) para determinar o que ainda é
implementável/testável por software agora — sem depender da prova viva bloqueada
pelo orçamento, de device físico, nem de nova decisão humana.

- Branch: `dev`. HEAD inicial: `d5bfb4d`. `origin/main`: `99bec54`, intacta.
- Working tree limpa exceto `.worktrees/` preservado.

## Critérios de conclusão da Fase G (do documento, não de memória)

Do Plano 002 §"Fase G": "o usuário acompanha e decide **tudo pela conversa**; cada
cartão é **projeção do estado persistido** (nunca estado próprio); decisões apontam
a versão exata; histórico permite retomar pelo chat." Entregáveis UX-01..04.
Evidências: testes de componente + ciclo ao vivo pelo chat. UX-01..04 ratificados
(web); paridade mobile "pronto para revisão", **prova física Expo Go pendente**.

## Matriz de cobertura (core → web → mobile → status)

Comparação campo a campo de `WorkPresentation` contra o que web (`WorkProposalCard`
+ subcartões) e mobile (`MobileWorkCard` + presenters) renderizam:

| Critério / projeção | core projeta | web | mobile | status |
|---|---|---|---|---|
| Fase humana (`progress` / deriveWorkProgressPhase) | sim | **sim** | **NÃO → sim (este recorte)** | **A → fechado** |
| Estado do item (proposed/approved/in_progress/blocked/review/completed/changes_requested/cancelled) | sim | sim (header+fase) | sim (header+fase) | paridade |
| Execução em andamento vs checkpoint (`execution`) | sim | sim | sim | paridade |
| Espera temporal de orçamento (`pendingBudgetWait`) | sim | sim | sim | paridade |
| Interrupção EM tentativa recuperável (`budgetBlock.recoverable`) | sim | sim | sim | paridade |
| Decisão humana necessária (`pendingDecision`) | sim | sim | sim | paridade |
| Resultado aguardando revisão (`latestResult`/`acceptedResult`) | sim | sim | sim | paridade |
| Parecer do Verifier advisory (`verification`) | sim | sim | sim | paridade |
| Integração disponível pós-aceite (`integration`) | sim | sim | sim | paridade |
| Custo de recursos observado (`resourceCost`) | sim | sim | sim | paridade |
| Histórico de pareceres (`opinionHistory`) | sim | não | não | omissão consistente (auditoria; não é assimetria) |
| Evidência bruta observada (`observedEvidence`) | sim | não | não | omissão consistente (auditoria; não é assimetria) |
| Guarda de proveniência/integridade (`provenance`) | via `reconstructWorkPresentation` | **sim** (bloqueia ações + alerta) | **NÃO** (usa `presentWorkItem`) | **A — documentado, adiado (risco de regressão)** |
| Erro/falha sem detalhes técnicos indevidos | projeções só têm rótulos/razões tipados (sem stderr/stack) | ok | ok | satisfeito |

## Recorte fechado — fase humana no mobile (categoria A)

`presentation.progress` (Analisando→Implementando→Testando→Revisando→Pronto para
integrar→… / terminais) era mostrado no cartão web mas **não** no mobile. Fechado:
`presentMobileWorkProgress` (presenter puro, mesma projeção do core) + render no
`MobileWorkCard` após o header (rótulo + ponto `●` quando ativo). Read-only,
tolerante a projeção antiga (null). Commit `fbf1e87`. Provas: mobile-work-result
21/21 (5 novos), mobile suite 51/51, typecheck mobile PASS.

## Assimetria real, deliberadamente NÃO fechada agora — guarda de proveniência (G-2)

O web serializa presentations por `reconstructWorkPresentation` em **todas** as
rotas `items*` (guarda de integridade: `provenance` incompleta ⇒ ações bloqueadas
+ alerta). O mobile usa `presentWorkItem` direto (sem a guarda). Trocar o mobile
para `reconstructWorkPresentation` **não é um menor-recorte seguro**: `reconstruct`
é estrito (exige histórico completo — proposta original, decisão versionada,
referência da mensagem-fonte via `listContexts`), e as cargas/fixtures atuais do
mobile usam eventos mínimos → **risco confirmado de falso-positivo** que bloquearia
ações em itens válidos (regressão pior que o gap). Além disso a Fase G mobile foi
**ratificada** com `presentWorkItem`. Fica registrado como assimetria de categoria
A cuja correção exige decisão deliberada (carregar histórico completo + contextos
no mobile e atualizar fixtures, ou uma guarda de integridade mobile que só bloqueie
inconsistências inequívocas) — **fail-closed: não introduzir uma mudança que possa
bloquear trabalho legítimo sem prova de segurança.**

## Classificação dos itens restantes da Fase G

- **A (software, agora):** fase humana no mobile — **FECHADO** (`fbf1e87`).
- **A (software, adiado por segurança):** guarda de proveniência no mobile (acima).
- **B (implementado, não refletido no plano):** as projeções pós-plano — fase
  humana, `pendingBudgetWait`, `budgetBlock.recoverable`, `verification`,
  `integration`, `resourceCost` — já existem em web e (com G-1) em mobile; este
  registro e a atualização do plano passam a refleti-las.
- **C (device físico):** prova em Expo Go da paridade mobile (depende do Gean).
- **D (prova viva bloqueada pelo orçamento):** ciclo `chat → … → review` pela
  superfície — `autonomous_work_budget_status.admitted=false`.
- **E (decisão humana nova):** fase pós-review (`decide_integration`) e primeira
  criação real de PR — fronteiras humanas.

## Conclusão

A Fase G está **software-complete no web** e, no mobile, a paridade de apresentação
avançou (fase humana fechada); a única assimetria de software remanescente (guarda
de proveniência) é adiada por risco de regressão e requer decisão. Os demais
blockers são **device físico**, **prova viva bloqueada por orçamento** e **decisão
humana de integração** — nenhum contornável autonomamente agora.

## Invariantes

`origin/main` intacta; sem PR/merge/deploy; sem bypass de gate/orçamento; sem
segredos; sem falsa evidência. Supervisor→Executor→Reviewer preservado.

## Próximo ponto de retomada

- Decisão sobre a guarda de proveniência no mobile (adotar `reconstruct` com
  carregamento de histórico completo + contextos, com fixtures atualizadas).
- Prova física Expo Go da paridade mobile (checklist já registrado no Plano 002).
- Prova viva de superfície quando `admitted=true`.

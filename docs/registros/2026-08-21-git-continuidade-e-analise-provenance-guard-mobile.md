# Continuidade Git comprovada e análise arquitetônica do provenance guard mobile

Data: 2026-08-21
Tipo: reconciliação Git (read-only) + investigação arquitetônica (sem implementação)

## 1. Continuidade Git — COMPROVADA (Caso A)

Reconciliação read-only confirmou que `d5bfb4d` (fix de `needsAnimaWebTypegen`) e os
três commits da Fase G estão contidos na linha atual, em histórico **linear**, sem
divergência nem linha perdida:

```
… 4de7bb3 → 0c82712 → d5bfb4d → fbf1e87 → 732da60 → 589cde5 (HEAD = dev = origin/dev)
```

- `git merge-base --is-ancestor d5bfb4d HEAD` → **exit 0**;
  `… d5bfb4d origin/dev` → **exit 0**.
- `git branch --contains d5bfb4d` → `dev`; `git branch -r --contains d5bfb4d` → `origin/dev`.
- `git log HEAD..d5bfb4d` → **vazio** (nada em d5bfb4d falta em HEAD).
- `d5bfb4d`, `fbf1e87`, `732da60`, `589cde5` estão em **dev e origin/dev** (todos is-ancestor exit 0).
- `origin/main` = `99bec54` intacta. Working tree limpa exceto `.worktrees/`.

O "HEAD = 0c82712" reportado no início do ciclo anterior era o HEAD **de partida**
daquele ciclo; `d5bfb4d` foi criado sobre ele e os commits da Fase G sobre
`d5bfb4d`. **Não houve rewind, reset, force-push nem perda de linha.** Nenhuma ação
corretiva necessária; nenhum commit criado só para isto.

## 2. Provenance guard no mobile — investigação arquitetônica (sem implementação)

### Requisitos de `reconstructWorkPresentation(item, events, contextReferences)`
Log de eventos **completo** (um `work_proposed` v1; `proposal_revised` por versão
2..N; `work_approved` da versão vigente quando não proposed/terminal;
`result_accepted`/`result_submitted` em completed/review; `execution_started`
correlacionado a cada `result_submitted`) **mais** `contextReferences` contendo
`{kind:'message', id:item.sourceMessageId}`. Com qualquer issue: zera
`availableActions` e `integration.availableDecisions` e marca `provenance:incomplete`.

### O que o mobile carrega hoje
`mobile-work.ts::presentation(item)` = `listEvents(item.id)` (log **completo**, igual
ao web) → `presentWorkItem` (sem guarda). **Não** busca contextos; o mock do serviço
mobile nem expõe `listContexts`. Web serializa por `reconstructWorkPresentation` em
todas as rotas `items*`.

### A ausência da guarda é insegura ou só apresentação? → **só apresentação (b)**
As ações do cartão passam por RPCs **versionadas, guardadas por estado, RLS e
idempotentes** (`resolve_approval`, `startWork`, `reviewResult`,
`respond_to_work_decision`, `decideIntegration`) que revalidam contra o estado real
persistido no servidor, **independente do que o cliente oferece**. Logo a guarda é
uma camada **client-side de defesa em profundidade/UX** (explica "proveniência
incompleta → ações bloqueadas" em vez de mostrar um botão que o servidor recusaria).
A ausência no mobile **não permite ação insegura real** — o pior caso é uma ação
recusada com erro, nunca um efeito inseguro. **Severidade: baixa (paridade de UX/
defesa em profundidade, não segurança).** Isto corrige o enquadramento do registro
anterior, que a tratava só como "risco de regressão".

### Dá para obter a garantia com os dados já carregados?
Parcialmente: o mobile já tem `events` completos. **Todas** as checagens **exceto**
`missing_source_message_reference` rodam só sobre `events`. Só essa uma exige
`contextReferences` — e é o **maior risco de falso-positivo** (exigiria o
`listContexts` do mobile devolver a referência da mensagem para todo item, o que não
é provável sem dados vivos entre tipos de item).

### Menor recorte seguro e decisão
- **Opção A (reconstruct mecânico no mobile):** buscar contextos + usar reconstruct.
  Custo: fetch por item + churn de fixtures; **risco real de falso-positivo** na
  checagem de contexto (bloquearia ações válidas). Rejeitada.
- **Opção B (projeção de integridade compartilhada, events-only):** extrair de
  `reconstructWorkPresentation` as checagens que não dependem de contexto para uma
  função pura compartilhada; o mobile a aplica sobre os `events` que já carrega (sem
  fetch extra, sem a checagem de contexto arriscada) + alerta. É o caminho
  "compartilhável e claramente seguro" — **porém refatora o caminho autoritativo do
  web** (`reconstructWorkPresentation`), com risco de enfraquecer uma camada de
  segurança-UX ratificada, para um ganho de **baixa severidade**.
- **Decisão: DEFERIR.** Dado que (i) a ausência **não é insegura** (RPCs são a
  autoridade fail-closed), (ii) a Opção A tem risco de regressão, e (iii) a Opção B
  toca o caminho autoritativo por ganho baixo, não há recorte **pequeno E sem tocar
  o caminho autoritativo E claramente seguro** que justifique implementar agora.
  Gatilho objetivo para retomar: quando a Opção B for feita, deve (a) manter os
  testes de `reconstructWorkPresentation` do web **idênticos** (issues iguais), (b)
  compartilhar a função pura (sem duplicar a régua — AGENTS.md), (c) mobile aplicar
  só a variante events-only + alerta, (d) provar que não há falso-positivo em itens
  válidos reais.

## 3. Invariantes

`origin/main` intacta; sem PR/merge/deploy; sem reset/force-push/rebase/cleanup;
sem bypass de gate/orçamento; sem segredos; `.worktrees/`,
`.claude/settings.local.json`, `apps/web/.env.local` preservados.

## 4. Fora deste recorte (barreiras externas, inalteradas)

- Prova física Expo Go da Fase G — depende do device/Gean (checklist no Plano 002).
- Prova viva de superfície `chat → review` — `autonomous_work_budget_status.admitted=false`.

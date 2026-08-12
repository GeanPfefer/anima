# 2026-08-12 — Retomada de sessão: transporte, proveniência e prompt do coder

Registro-diário da sessão que retomou o trabalho da camada de integração/
autodesenvolvimento a partir de `3c9ac70`. Amarra três recortes; os detalhes de
cada um estão nos registros e no Plano 002 referenciados, sem duplicação.

- **Tipo:** desenvolvimento e prova.
- **Branch:** `claude/integration-application-layer`.
- **HEAD inicial (herdado):** `3c9ac70`. **HEAD ao final deste registro:** `e004b2a`
  (este registro + PRD/Plano no commit de docs seguinte).
- **`origin/main`:** `973ef465acaa3955f8e176c72903975cf3912ac6` — **intacta**, sem push.
- **Working tree ao final:** limpa exceto o não rastreado preservado `.worktrees/`.
  `.env.local` e `.claude/settings.local.json` são gitignored e nunca entraram em
  commit.

## Reconstrução forense inicial

O commit de código do agente anterior (`3c9ac70`, desacoplamento do transporte)
já estava no HEAD, não pendente — o relato de "6 arquivos +170/-9 no workspace"
resolveu-se assim: a correção de rota (route.ts +8/-1, route.test.ts +20) estava
commitada; o `.env.local` é gitignored (setup local da prova, corretamente fora);
restava apenas a documentação (PRD + Plano 002 + registro do transporte).

## Commits desta sessão (após o herdado `3c9ac70`)

1. `1a17f83` — Registre a investigação do cancelamento por transporte
   (documentação append-only do recorte de `3c9ac70`).
2. `e3ef7aa` — Atribua ao executor a autoria do cancelamento do executor
   (migration + pgTAP).
3. `c3ab998` — Registre a correção de proveniência do cancelamento do executor
   (PRD + Plano 002 + registro dedicado).
4. `e004b2a` — Exija edição do coder na volta final sem oferecer leitura
   (clareza de prompt + teste).

## Recorte 1 — Fechamento do desacoplamento de transporte (`3c9ac70` + `1a17f83`)

`/supervisor-turn` repassava `request.signal` ao executor, transformando o
abandono da conexão HTTP em terminal `cancelled` atribuído a `user`. A menor
correção (`3c9ac70`, herdada) passa um `AbortController().signal` fresco e nunca
abortado à execução: perder a conexão não é decisão humana de cancelar.
Durabilidade contra queda de processo segue por lease/checkpoint/reconciliação,
não pela conexão. Gates: rota supervisor-turn **6/6**, typecheck **5**. Ver
[registro do transporte](2026-08-11-investigacao-cancelamento-transporte.md).

## Recorte 2 — Proveniência do cancelamento do executor (`e3ef7aa` + `c3ab998`)

Fio deixado aberto pelo recorte 1. `record_commanded_work_terminal` e
`finish_work_execution` gravavam `author=user` no `work_cancelled` do executor.
Como todo terminal dessas RPCs é `origin=executor` e o `cancelled` nasce só de
`signal.aborted`, a autoria correta é `executor` — o cancelamento humano tem
caminho próprio (`request_work_control` → `apply_work_control_at_checkpoint`,
`author=user`/`reason=cancelled_by_user`). Migration incremental
`20260812000000` corrige apenas a autoria; `reason=execution_cancelled` já era
gravada. **Bug corrigido no próprio recorte:** a 1ª versão da migration
reverteu sem querer a lógica de sequência-pós-checkpoint (reproduziu a definição
original em vez da vigente `20260726000003`); a suíte pgTAP acusou e a migration
foi rebaseada na definição vigente. Detalhe em
[registro de proveniência](2026-08-12-proveniencia-cancelamento-executor.md).

## Recorte 3 — Clareza de prompt do coder na volta final (`e004b2a`)

Primeiro passo determinístico da investigação do `ollama_read_round_limit`.
Contrato do protocolo limitado correto; defeito de **prompt**: com `roundsLeft=0`
o coder ainda oferecia `read`, embora ali só seja recusado — o modelo gastava a
última chance lendo. A volta final passa a exigir `edit` e não repetir a oferta
de leitura; a penúltima avisa ser a última. Sem mudança de contrato/orçamento/
terminal; não força verde (edição inválida segue fail-closed).

## Gates e provas (números exatos desta sessão)

- **pgTAP** (`supabase test db`): **29 arquivos / 730 testes PASS** — inclui o novo
  `executor_cancelled_provenance` (5/5) e `work_execution` estendido para 24.
- **typecheck:** 5 workspaces PASS (rodado após cada recorte).
- **core (Jest):** 31 suites / 687 testes PASS.
- **apps/web focado:** supervisor-turn **6/6**; ollama-coder **11/11** (com o novo
  caso da volta final).
- **Flakes:** nenhum observado nas suítes rodadas (pgTAP e Jest serial). O flake
  conhecido é do run web paralelo completo (registrado antes), não reproduzido aqui.

## Provas vivas

Nenhuma nova prova viva por UI/modelo nesta sessão — deliberado. A prova viva
válida da sessão anterior (item `b6ab5eeb`, attempt `e6a828fe`, terminal
`execution_failed` por `ollama_read_round_limit`) permanece a evidência de
referência. Não se repetiu tentativa só para obter verde; a melhoria de prompt do
recorte 3 é provada deterministicamente por teste unitário, não por execução
estocástica do modelo local.

## Invariantes de segurança preservadas

Aprovação humana antes de execução; execução separada de integração; sem push/
force/merge em `main`; eventos append-only; retomada/reconciliação idempotentes;
**proveniência correta** (cancelamento humano vs. do executor agora distintos no
log); disconnect HTTP ≠ intenção humana de cancelar; recuperação de queda por
mecanismos duráveis. Nenhum `supabase db reset`.

## Efeitos externos — explicitamente não realizados

Nenhum push, PR, merge, alteração de `main`, deploy, publicação de branch, aceite
de resultado, `integrated` ou `db reset`. Apenas commits locais e migration local
(`migration up` + `CREATE OR REPLACE` idempotente para sincronizar a definição
corrigida no banco local).

## Serviços e ambiente locais

- **Docker Desktop:** iniciado nesta sessão (estava desligado) para rodar pgTAP.
- **Supabase local:** iniciado; migration `20260812000000` aplicada; **deixado
  ligado** ao final. Container `supabase_db_anima`.
- **Ollama / web dev server:** não iniciados nesta sessão.
- **Arquivos locais não versionados (intencional):** `apps/web/.env.local`,
  `.claude/settings.local.json` (gitignored); `.worktrees/` preservado.

## Limitações e observações para o próximo agente

- `finish_work_execution` (fronteira F8) continua sem chamador em código de
  aplicação — corrigida por consistência, mas dormante.
- `ollama-coder.callProtocol`: o `assertPromptWithinBudget` do caminho de reparo
  (só-de-schema) reavalia o prompt **original**, não as mensagens de reparo
  (echo do assistente + instrução). Segue fail-closed (um reparo truncado cai em
  `ollama_invalid_response_schema`), mas o código de erro seria menos preciso que
  `ollama_context_budget_exceeded`. Observação, não corrigido — trigger é estreito
  e testá-lo deterministicamente é fiddly.

## Fronteiras humanas / próximo ponto exato de retomada

- **Ratificação humana pendente (não executável por agente):** UX-00 e UX-03
  seguem "prontos para revisão, não ratificados" no backlog.
- **Investigação aberta (sensível a contrato, estocástica):** fatores restantes do
  `ollama_read_round_limit` — número de rodadas, estratégia de leitura, capacidade
  do modelo. Tocá-los altera contrato/comportamento do coder e exige investigação
  com o modelo local + provável ratificação; **não** iniciado, coerente com "antes
  de alterar qualquer contrato".
- **Próximo recorte determinístico candidato:** endurecer o `assertPromptWithinBudget`
  do caminho de reparo do coder (ver Limitações) — pequeno, testável, sem contrato.

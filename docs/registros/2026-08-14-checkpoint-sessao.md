# 2026-08-14 — Checkpoint consolidado da sessão (handoff de retomada)

Amarra os quatro eixos desta sessão a um único ponto de retomada verificável.
**Não duplica** os registros por eixo — referencia-os. Estado recuperável só pelo
repositório.

## Estado Git (reconciliado, não de memória)

- **Branch:** `claude/integration-application-layer`
- **HEAD final:** `a677a2e`
- **origin/main:** `973ef465acaa3955f8e176c72903975cf3912ac6` — **intacta**
- **Ahead/behind:** 250 à frente de origin/main; **sem upstream, NUNCA pushada**
- **Working tree:** limpa (só `.worktrees/` não rastreado, preservado)
- **Último commit funcional:** `ab267e9` (fix do taskFor). Os dois commits
  seguintes (`616d901`, `a677a2e`) são **documentais** — não alteram código.

## Commits desta sessão (14, `8007560..a677a2e`), por eixo

### Fase 3 — Review Request → congelada em `READY_FOR_HUMAN_EXTERNAL_PROOF`
Registro: [fase3-review-request-fiada](2026-08-14-fase3-review-request-fiada.md).
- `137976f` — rota `POST /review-requests` (duplo gate fail-closed)
- `8276540` — **bugfix** liveness/remote-drift (divergência de identidade → 409)
- `43aa07d` — E2E composto com transportes reais locais (bare Git + HTTP local)
- `358a572` — **bugfix** desacoplamento das rotas mutativas de `request.signal`
- `fc17cae` — apresentação `review_request_created` (web+mobile)
- `6eae676` — timeout server-side por chamada no provider GitHub
- `226e00f` + `e448fea` — docs vivos (ADR-002/PRD) + registro/adendo

### Mobile — paridade UX-01/UX-03 → pronto p/ revisão, prova física pendente
Registro: [paridade-mobile-ux01](2026-08-14-paridade-mobile-ux01.md).
- `31ae416` — cartão de execução autônoma (UX-01) + pausar/cancelar cooperativos
  (`requestWorkControl` via RPC `request_work_control`)
- `53c045c` — `handoffReference` no cartão de resultado mobile (UX-03)
- `e1eae47` — estado vivo (backlog UX-01) + registro do eixo

### LocalRunnerAdapter / INT-04 — bug taskFor() → CORRIGIDO dentro do contrato
Registro: [taskfor-escopo-excluido](2026-08-14-taskfor-escopo-excluido.md).
- `ab267e9` — reprodução primeiro (task nomeava o excluído) → correção mínima: a
  task comunica a allow-list do includedScope e NÃO nomeia o excluído. Contrato
  INT-04 (sinais/idempotência/enforcement) byte-estável; a string da task é
  detalhe interno (nenhum teste a fixa).
- `616d901` — registro + nota no backlog INT-04

### Ollama coder — hipótese excludedScope → investigada, NEUTRA, sem código
Registro: [ollama-coder-escopo-excluido-neutro](2026-08-14-ollama-coder-escopo-excluido-neutro.md).
- Prova estrutural (enforcement só por allow-list do includedScope; manifesto só
  do includedScope) + experimento A/B controlado (Ollama local, 12 execuções,
  qwen2.5-coder 7b/14b × nomeado/vazio × 3 reps): **efeito zero**. Determinação
  **(B) neutro** — a analogia com o taskFor não transfere (protocolo diferente).
  **Nenhuma alteração de código** (`a677a2e` é só o registro).

## Gates finais conhecidos (números reais, com o estado a que correspondem)

- **pgTAP:** 30 arquivos / **747** — rodado no meio da sessão; SQL **inalterado**
  desde então (reconfirmação de autoridade, não regressão).
- **web `work-orchestration`:** 29 suítes / **353** — rodado **após** o último
  commit funcional `ab267e9` (estado atual do código).
- **local-runner (focado):** **13/13**; área local-runner/execution/worktree-executor
  **46/46** — após `ab267e9`.
- **mobile:** 5 suítes / **39** — no estado do eixo mobile (`53c045c`); mobile
  inalterado desde então.
- **core:** 31 suítes / **689** — rodado no estado da liveness (`8276540`). A
  mudança de core posterior (`fc17cae`, projeção `review_request_created`) foi
  coberta por **presentation 51/51** + typecheck; a suíte **completa** do core
  **não** foi re-rodada após `fc17cae` (mudança aditiva pura, sem tocar código
  existente).
- **typecheck:** 5 workspaces limpos — full após `fc17cae`; **web** re-confirmado
  após `ab267e9`. Núcleos não-web inalterados desde o full.
- **Ollama A/B:** 12 execuções, resultado neutro (evidência da investigação;
  script em scratchpad, não versionado — metodologia/dados no registro do eixo).

Nenhum gate foi re-rodado após os dois commits documentais (`616d901`, `a677a2e`)
— desnecessário, pois não tocam código.

## READY_FOR_HUMAN_EXTERNAL_PROOF (pronto, bloqueado por efeito/decisão humana)

- **Fase 3 — primeira criação real de PR no GitHub.** NÃO executar. Menor ação
  humana em [ADR-002 §Fase 3](../arquitetura/adr-002-integracao-aplicacao-publicacao.md):
  configurar alvo `ANIMA_INTEGRATION_*` + `ANIMA_INTEGRATION_GITHUB_TOKEN` e
  chamar a rota com `{ workItemId }` sobre item com `branch_published`.

## Decisões humanas ainda abertas (NÃO são autorização)

- Ratificação da **Fase 3** (substrato pronto p/ revisão, não ratificado).
- **`merged`/`integrated`** — sem caminho alcançável; nova decisão humana.
- **Superfície de UI de auto-desenvolvimento** — decisão de produto.
- **Prova física mobile (Expo Go) + ratificação** da paridade UX-01/UX-03.
- **Persistência de `WorkHandoffV1`** — risco sobrevivente registrado, não item
  ratificado (a retomada AUTO-05 já funciona por checkpoints).
- **UX-00 / UX-03** seguem prontos-para-revisão, não ratificados.

## Próxima retomada (não especular agora)

1. Reconstruir o estado a partir de `a677a2e`; ler AGENTS.md, PRD, backlog e estes
   registros.
2. Receber decisão humana sobre qual fronteira liberar, OU procurar recorte já
   ratificado surgido desde então.
3. **Não reabrir** o que está fechado: `taskFor()` = bug corrigido;
   `ollama-coder excludedScope` = investigado e neutro (não repetir o A/B sem
   evidência nova); Fase 3 = congelada em READY_FOR_HUMAN_EXTERNAL_PROOF.

## Preservação (confirmada)

`.claude/settings.local.json` ✓ · `apps/web/.env.local` ✓ · `.worktrees/` ✓ ·
origin/main intacta ✓ · **zero** push/PR/merge/deploy/token real/efeito externo ✓
(todas as provas usaram bare Git, HTTP e Ollama **locais**).

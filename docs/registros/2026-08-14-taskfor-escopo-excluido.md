# 2026-08-14 — Correção do taskFor: escopo excluído fora do prompt (INT-04)

**Tipo:** desenvolvimento (bug determinístico). **Objetivo:** tratar como item
próprio o defeito conhecido e antes deferido do `taskFor()` do
`LocalRunnerAdapter` (INT-04), sob autorização humana explícita que **não**
autoriza alterar o contrato ratificado do INT-04.

## Estado do Git

- **Branch:** `claude/integration-application-layer`.
- **HEAD ao iniciar:** `e1eae47` · **HEAD final:** `ab267e9`.
- **`origin/main`:** `973ef46` — intacta, sem push. Working tree limpa fora
  deste item e do `.worktrees/` preservado.

## Caracterização do defeito (demonstrada antes de alterar código)

`taskFor()` ([`local-runner.ts`](../../apps/web/lib/work-orchestration/local-runner.ts))
costurava `Fora do escopo: <lista de caminhos excluídos>` na string da task
enviada ao runner. Nomear um arquivo REAL na lista "fora do escopo" fazia o
modelo local fraco tratá-lo como **alvo** e planejar editá-lo. Evidência já
registrada no [Plano 002](../planos/002-modo-autonomo-v0.md) (linha ~453): com o
texto exato do adaptador → `model_execution_iteration_limit` com plano "Atualizar
test_calculator.py"; com o objetivo isolado → `result_produced` de primeira.

Reprodução determinística nesta sessão (sem rodar modelo): teste que afirma que
a task **não** pode conter o nome de um arquivo do escopo excluído. Falhava (a
task continha `test_calculator.py`).

## Classificação: (A) bug de implementação, NÃO limitação do contrato

- A **segurança do escopo é estrutural**: o host valida
  `producedPaths ⊆ includedScope` (allow-list), já provado por testes de
  `contract_violation`. O prompt nunca foi o mecanismo de segurança; o escopo
  excluído nomeado ali era apenas *advisory* e ativamente contraproducente.
- A **string da task é detalhe interno** do adaptador: nenhum teste a fixa e ela
  não é payload de sinal. A byte-estabilidade ratificada do INT-04 (sinais/
  terminal, idempotência, enforcement) permanece intacta.
- Logo, remover o escopo excluído do prompt é correção de implementação; o
  contrato externo não muda.

## Correção aplicada (`ab267e9`)

A task passa a comunicar o limite pela **allow-list do escopo incluído**, alinhada
ao que o host enforça, e **nunca nomeia o escopo excluído**:

```
<objetivo>
Edite somente arquivos deste escopo: <includedScope>.
Não crie nem edite nenhum arquivo fora desse escopo.
Critérios: <labels>.
```

## Casos adjacentes investigados (mesmo adaptador) — sem novo defeito

- **Outros canais de info excluída ao runner:** `processInput` = workspace(dir)/
  task/model/testCommand/timeoutMs/carriedContext. `carriedContext.touchedResources`
  é validado ⊆ escopo aprovado; nenhum campo do adaptador nomeia o escopo excluído
  deterministicamente.
- **Serialização/escaping:** `spawn` usa `shell:false` — args passam sem
  interpretação de shell; a task não injeta.
- **Escopo incluído vazio:** já fail-closed (qualquer `producedPath` →
  `contract_violation`); elegibilidade (AUTO-01) exige escopo não-vazio.

## Achado fora do escopo autorizado (NÃO alterado) — candidato a item próprio

O **mesmo anti-padrão** existe em
[`ollama-coder.ts`](../../apps/web/lib/work-orchestration/ollama-coder.ts) (~linha
108): o header do protocolo nomeia `Fora do escopo (não toque): <excludedScope>`.
Isso é o caminho **worktree-executor (ADR-001)**, NÃO o LocalRunnerAdapter/INT-04
autorizado aqui; o mandato restringe o escopo e proíbe busca global. Além disso,
o protocolo do coder é diferente (manifesto só do escopo incluído), então **não há
evidência** de que o defeito se manifeste igual ali — é um candidato a
investigação/correção sob autorização própria, não um bug confirmado. Registrado
para decisão humana.

## Provas / gates

- **local-runner:** 13/13 (nova reprodução verde).
- **web `work-orchestration`:** 29 suítes / **353** testes (+1).
- **typecheck web:** limpo. **Flakes:** nenhum.

## Invariantes de segurança preservadas

- Contrato INT-04 (request/sinais/idempotência/enforcement) **byte-estável**; só a
  string interna da task mudou.
- Enforcement de escopo por allow-list intacto; nenhuma redução de segurança.

## Efeitos externos

**Explicitamente ZERO.** Nenhum push/PR/merge/deploy; `origin/main` intacta.

## Próximo ponto exato de retomada

Defeito do `taskFor()` **fechado dentro do contrato**. Candidato aberto (fora
desta autorização): o mesmo anti-padrão em `ollama-coder.ts` (worktree/ADR-001) —
exige nova autorização e evidência própria antes de qualquer alteração.

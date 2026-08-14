# 2026-08-14 — Escopo excluído no prompt do ollama-coder: NEUTRO (sem correção)

**Tipo:** investigação (prova controlada local). **Objetivo:** sob autorização
humana explícita, determinar se nomear arquivos/caminhos do `excludedScope` no
prompt do `ollama-coder` (~`ollama-coder.ts:108`) reproduz o mesmo defeito
corrigido no `taskFor()` do `LocalRunnerAdapter`
([registro](2026-08-14-taskfor-escopo-excluido.md)) — sem presumir que sim.

## Estado do Git

- **Branch:** `claude/integration-application-layer`. **HEAD:** `616d901`
  (inalterado por esta investigação — **nenhuma mudança de código**).
- **`origin/main`:** `973ef46` — intacta, sem push. Working tree limpa (só
  `.worktrees/` e este registro).

## Hipótese

Nomear `Fora do escopo (não toque): <excludedScope>` no prompt induziria o modelo
local fraco a ler/editar/planejar o arquivo excluído (padrão observado no runner
Python), causando falha (`ollama_read_round_limit` / `ollama_edit_outside_scope`)
ou desperdício de rodadas onde o mesmo caso, sem nomear o excluído, funciona.

## Análise estrutural (determinística, sem modelo)

- O enforcement de escopo é **exclusivamente pela allow-list do includedScope**:
  `allowed = new Set(request.includedScope)` (`ollama-coder.ts:91-92`); manifesto,
  cache, `parseReadRequests` e `parseEditOperations` validam **tudo** contra
  `allowed`. `excludedScope` aparece **apenas** na linha advisory do header
  (`ollama-coder.ts:108`) e tem **zero** papel no enforcement.
- O **manifesto só contém o includedScope** (`scope.map(...)`), que é o universo
  acionável do modelo. Um read/edit fora dele é rejeitado (`ollama_edit_outside_scope`,
  já provado em `ollama-coder.test.ts`).
- Logo o modelo **não precisa** do `excludedScope` para cumprir o protocolo — a
  allow-list positiva ("Escopo permitido (só estes caminhos): …") já o restringe
  por completo. A linha do excluído é **redundante**, mas redundância sozinha não
  justifica mudança sem evidência de dano.

## Experimento controlado (prova de causação com Ollama local)

Prova A/B com o `OllamaCoderBackend` **real** (defaults de produção:
maxReadRounds=3, num_ctx=8192, temperature=0), observador tee do fetch,
variando **somente** o dado `excludedScope`. Caso: corrigir `add()` em
`calculator.py` (includedScope), com `test_calculator.py` como o arquivo tentador
(o mesmo padrão "atualize o teste" do defeito do runner).

- **Condição A:** `excludedScope = ['test_calculator.py']` (nomeado no prompt).
- **Condição B:** `excludedScope = []` (não nomeado).
- Modelos `qwen2.5-coder:7b` e `qwen2.5-coder:14b`, 3 reps cada → **12 execuções**.

**Resultado (inequívoco):**

| Modelo | Condição | citou-excluído | falhou | add-corrigido |
|---|---|---|---|---|
| qwen2.5-coder:7b | A (nomeado) | 0/3 | 0/3 | 3/3 |
| qwen2.5-coder:7b | B (vazio) | 0/3 | 0/3 | 3/3 |
| qwen2.5-coder:14b | A (nomeado) | 0/3 | 0/3 | 3/3 |
| qwen2.5-coder:14b | B (vazio) | 0/3 | 0/3 | 3/3 |

Em **nenhuma** das 12 execuções o modelo referenciou `test_calculator.py` (em
read ou edit); ambas as condições tiveram desfecho **idêntico** (12/12 aceitas,
add corrigido). Sanidade do prompt 12/12 (A nomeou o excluído; B não) — o único
fator que variou foi o alvo do experimento.

## Determinação: (B) NEUTRO — a analogia com o `taskFor` NÃO se sustenta

Nomear o `excludedScope` no prompt do `ollama-coder` **não** produz comportamento
incorreto reproduzível. Motivo estrutural (model-agnóstico): no `ollama-coder` o
manifesto expõe só o includedScope, então o modelo **não tem alça** para agir
sobre o arquivo excluído mesmo quando citado. No runner Python (`taskFor`), o loop
agêntico tinha o workspace inteiro e nomear o arquivo dava um **alvo concreto** —
protocolos diferentes, comportamentos diferentes.

**Nenhuma mudança de código.** Conforme o mandato, não se faz "melhoria
preventiva": a redundância da linha do excluído é real, mas sem dano comprovado
não justifica alterar o prompt de um caminho ratificado (ADR-001).

## Fronteiras / invariantes

- Contrato/protocolo/`maxReadRounds`/modelo/temperatura/schema/routing/gates
  **intocados**. Nenhuma mudança de código.
- **Efeitos externos: ZERO.** Ollama **local** apenas; sem rede externa,
  push/PR/merge/deploy. `origin/main` intacta.
- Artefato do experimento: script standalone em scratchpad (não versionado),
  reusa o resolve-hook de `tools/coder-evidence/`; metodologia e dados brutos
  agregados ficam acima, recomputáveis a partir desta descrição.

## Próximo ponto de retomada

Questão **fechada**: o escopo excluído no prompt do `ollama-coder` é neutro; não
há item de correção pendente aqui. Se no futuro surgir evidência de dano (ex.: um
protocolo que passe a expor arquivos fora do includedScope ao modelo), reabrir com
nova prova A/B antes de qualquer alteração.

# 2026-08-21 — Loop local: captura de turno, protocolo do coder e Verifier fim a fim

- **Tipo:** desenvolvimento + prova (viva).
- **Branch:** `claude/integration-application-layer`.
- **HEAD inicial:** `2b109e3`. **HEAD final:** `9d36f2a` (52 à frente de `origin/main` = `99bec54`, intacta).

## Objetivo
Fechar a infraestrutura para o coder LOCAL executar trabalho de desenvolvimento ponta a ponta e atravessar o **Verifier** no caminho real: `approved work → planner → WorktreeExecutorAdapter → OllamaCoderBackend → edit → gates → resultado durável → Verifier → apresentação`.

## Commits (hash curto + assunto)
- `c09aa01` — Delimite e mitigue o stall de tool-calls do coder local (streamIdleTimeoutMs + retryPolicy sem TIMEOUT na rota pi-ai; protocolo de tool-call em `composeHarnessTask`; `ERROR_LINE` reconhece timeout).
- `7600f36` — Torne determinístico o gate-fixture do retry (emite diagnóstico na falha) — corrige falha PRÉ-EXISTENTE de `worktree-executor.test.ts`.
- `9d36f2a` — Adicione operação `append` ao protocolo do OllamaCoder (fecha gap de eval; fail-closed via `expected_file_sha256`).

## Causa raiz comprovada (não hipótese)
- **Stall do coder harness (dsh):** o endpoint `/v1/chat/completions` do Ollama, para gerações com tool-calls PARALELAS, envia os chunks com `finish_reason:null` e NUNCA envia o terminador (`finish_reason:"tool_calls"`/`[DONE]`) — provado por captura de fio (proxy dsh↔Ollama). O `idleWatchdog` do pi-ai só aborta em 300s e o `dsh-llm-retry` retenta TIMEOUT. O `exitCode:null/180028ms` do "C3" era o `spawnSync timeout:180000` do próprio script; o diff "+35 linhas" era a semente RED do script (mtime pré-dsh), não trabalho do coder; o reader multi-frame zstd está CORRETO. Ref.: `deepseek-harness-runtime.ts`, `harness-invocation.ts`.
- **Por que o coder local falha em ARQUIVO GRANDE (eval focal, temp 0, `project-work-planner.ts`, mesmo modelo `qwen2.5:14b`):** o harness (dsh dirige as próprias tools) tem gradiente de tamanho — K5 1/2, K30 1/2, K100 0/2, K195 0/2 — porque o tool `read` do dsh devolve o ARQUIVO INTEIRO e o modelo derrapa para "explique este código" (só `read`, nunca edita), inclusive na classe de âncora única. O `OllamaCoderBackend` (host-mediado: manifesto + trechos, NUNCA arquivo inteiro; edit exige `before` ÚNICO) faz o MESMO modelo/arquivo editar 2/2. **Conclusão: A (tamanho/formato) + B (protocolo) ambos necessários; o substrato que compensa JÁ EXISTE (OllamaCoder, default de produção `backendFor → 'ollama'`); o harness é o elo fraco, não "modelo fraco demais".**

## Mudanças relevantes
- `harness-invocation.ts` / `deepseek-harness-runtime.ts` / `node-harness-runtime.ts`: `streamIdleTimeoutMs` (default 180000) + `llmRetryableCodes` (sem TIMEOUT) na rota pi-ai; protocolo de tool-call no `composeHarnessTask`; overrides por deploy. Configuráveis, fail-closed, nada afrouxado.
- `worktree-executor.test.ts`: gate-fixture `retry-gate.js` agora emite stderr determinístico na falha (gates reais emitem saída).
- `ollama-protocol.ts` / `ollama-coder.ts`: operação `append` (`{kind:'append',path,expected_file_sha256,content}`), aplicada após replaces do mesmo arquivo numa única mudança, fail-closed (escopo + sha do arquivo como lido); SYSTEM documenta a op.

## Provas / gates (números)
- Determinísticos: `ollama-protocol` 41/41; `harness` 52/52; `work-orchestration` **506/506**; `typecheck apps/web` limpo.
- **Prova viva read→edit→terminal (harness, arquivo pequeno):** 4/4 (read→write→`turn/end completed`, edit host-observed, exit 0).
- **Prova viva do stall delimitado:** `dsh` sai código 1 em ~idle com stderr `TIMEOUT: pi-ai stream idle timeout`, SEM retry — falha terminal LIMPA (antes: pendura/retry inútil).
- **Eval OllamaCoder (arquivo grande, `qwen2.5:14b`):** targeted anchor 2/2; append 0/2 → **2/2 após a op `append`**.
- **Prova viva FLUXO COMPLETO (executor real → OllamaCoder → arquivo grande → gate npm REAL → `result`):** VERDE (gate exit 0, `worktree-changed:1`, validations `passed`).
- **Prova viva ATÉ O VERIFIER (caminho real, sem nova semântica persistente):** `computeVerifierOpinion(item, events)` sobre evidência REAL (handoff do executor + git host-observed independente + gate host-observed) ⇒ **verdict `verified`**, `restsOnAttestedEvidence:true`, `coverage {git:true,gates:true}`; findings coerentes incluindo `scope_independently_observed`/`gates_independently_observed` (provenance `independent`). `presentWorkItem(...).opinionHistory = ['verified']` — a apresentação mostra o parecer. Confirmado que o **supervisor-turn de produção já fia** esse fluxo: `persistHostObservedGateEvidence` → `observeAndPersistHostGitEvidence` (inspeciona a branch `anima-work/<attempt>` vs baseSha, independente da atestação) → `computeAndPersistVerifierOpinion` (fail-open, advisory).
- **Caracterização do modelo default de produção do ollama (`qwen3-coder:latest`) pelo MESMO caminho estruturado até o Verifier:** 2/2 `verified` (14–42s). Medição, NÃO ratificação de piso/default.

## Decisões
- Via principal do coder local = **OllamaCoderBackend** (host-mediado). O DeepSeek Harness (dsh) permanece candidato/experimental; NÃO investir agora nem depreciá-lo sem decisão específica.
- Verifier permanece **ADVISORY**: parecer não aceita/publica/integra; revisão humana segue sendo o gate final para efeitos externos. EVIDÊNCIA ≠ CLASSIFICAÇÃO ≠ ADVISORY ≠ DECISÃO ≠ AÇÃO preservado.

## Bugs
- **Encontrado + corrigido:** falha pré-existente de `worktree-executor.test.ts` ("gate FAIL realimentado") — gate-fixture mudo ⇒ diagnóstico ausente (categoria fixture/expectativa, não bug de código); corrigido em `7600f36`.
- **Encontrado + corrigido:** gap do protocolo OllamaCoder sem operação de append ⇒ `append` em `9d36f2a`.

## Limitações / não feito
- O harness (dsh) não foi tornado competitivo (fora de escopo do ciclo); precisaria da disciplina de trechos/âncora do OllamaCoder.
- O fluxo PERSISTIDO fim a fim (via Supabase real) não foi executado ao vivo (exige Docker + Supabase local); a COMPOSIÇÃO do Verifier foi provada com as mesmas funções que o `supervisor-turn` usa.
- Prompt tuning ad hoc do modelo foi evitado; modelo tratado como variável MEDIDA.

## Invariantes de segurança / efeitos externos
- SEM push, PR, merge, deploy, `integrated`, reset/limpeza destrutiva. `origin/main` = `99bec54` intacta.
- Preservados: `.worktrees/`, `.claude/settings.local.json`, `apps/web/.env.local`.
- Instrumentos de eval/prova viva (dependentes de Ollama ao vivo) foram removidos do repo; raw preservado em `%TEMP%/anima-eval-*`. Ollama reiniciado uma vez para limpar slot travado por streams-zumbi (efeito colateral do stall).

## Próximo ponto de retomada
1. Rodar o `supervisor-turn` real contra Supabase local para provar o fluxo PERSISTIDO fim a fim (evidência git+gate persistida → `verifier_opinion_recorded` → apresentação) — exige ambiente.
2. Opcional: trazer a disciplina de trechos/âncora ao harness OU decidir seu papel.
3. Fases: o substrato (`deriveWorkProgressPhase`) já sustenta a progressão desejada (Implementando→Testando→Revisando→Pronto para integrar) e o parecer é projetado ao lado (`opinionHistory`); sem gap de estado a fechar.

# 2026-08-18 (4ª) — Harness: pwsh provado, seleção por deploy e fase humana do trabalho

**Tipo:** desenvolvimento + prova.

**Objetivo:** transformar a capacidade técnica do DeepSeek Harness (já funcional como CoderBackend real) em capacidade de PRODUTO: (1) fechar a borda real do `pwsh`; (2) tornar o backend selecionável coerentemente no fluxo real; (3) representar o progresso HUMANO do trabalho autônomo. Continua [2026-08-18 retry+Verifier](2026-08-18-deepseek-harness-retry-interno-e-verifier-terminal.md).

**Branch:** `claude/integration-application-layer`. **HEAD inicial:** `57fdee7`. **HEAD final:** `af678fd` (3 commits de código; este registro é doc). **`main`:** `99bec54` = `origin/main`, **intacta, sem push**.

## Commits

- `7a25b4f` — backend de código selecionável por config de DEPLOY (Harness não default).
- `89d3806` — projeção pura da fase humana do trabalho (`deriveWorkProgressPhase`).
- `af678fd` — cartão web exibe a fase humana (read-only).

## 1. Borda `pwsh` — PROVADA sob o env mínimo (sem mudança de código)

Investigação determinística refutou a suspeita anterior de que o `pwsh` precisaria de `PATH`/`SystemRoot` no env do filho. Fatos:

- O `dsh-pwsh-local` resolve o executável por **caminho absoluto** (`env.SystemRoot ?? "C:\\Windows"` → `...\System32\WindowsPowerShell\v1.0\powershell.exe`), então o PowerShell é encontrado sem `PATH`/`SystemRoot`.
- O env do filho PowerShell é `{...ENV_OVERRIDES, ...spec.env, ...spec.dshEnv}` (não reinjeta o OS env); e o próprio processo DSH roda com o env mínimo (4 vars) do spawner do Anima.
- Prova direta: `powershell.exe -Command "Get-Location"` com env = só os 4 vars → **exit 0**, saída correta.
- Prova viva do caminho REAL: `dsh` headless spawnado EXATAMENTE como o spawner do Anima (env = 4 vars do planejador, `shell:false`, patch gerado pelo planejador versionado) com tarefa que força a ferramenta `pwsh` → o modelo chamou `pwsh`, o PowerShell rodou `Get-Location` e devolveu o cwd real, **exit 0**.

**Conclusão:** o `pwsh` funciona para operações NATIVAS do PowerShell sob o env atual; **nenhuma mudança de env foi feita** (mandato: se funcionar, registre e não mexa). Resíduo honesto: um comando `pwsh` que invoque EXECUTÁVEIS EXTERNOS (git/npm/node) via `PATH` falharia — mas o coder não deve rodar gates (o host roda). Design note atualizada.

## 2. Backend selecionável por config de DEPLOY

`resolveConfiguredCoderBackend()` (em `coder-backend.ts`) lê `ANIMA_WORKTREE_CODER_BACKEND` (dev/admin), valida contra `WORKTREE_CODER_BACKENDS` (`ollama`/`openai`/`deepseek-harness`, espelha `backendFor`), default **`ollama`** (Harness NÃO é default), valor inválido → default seguro. O planejador (`project-work-planner.ts`) passa a usá-la em vez do `'ollama'` fixo. **Abstração correta para a UX:** qual coder roda é detalhe de INFRAESTRUTURA (como o modelo, já resolvido por env), não microgerência do usuário — sem dropdown cru de infra no chat. Coerência: `declaredCoderBackendId` (advisory pré-execução) passa a prever `deepseek-harness` também.

## 3. Fase humana do trabalho — PROJEÇÃO pura

`deriveWorkProgressPhase` (em `presentation.ts`) deriva a fase — Proposta → Aprovado → Implementando → Testando → Revisando → Pronto para integrar → Integrando → Concluído (+ Pausado/Bloqueado/Falhou/Rejeitado/Cancelado) — SOMENTE de fatos já projetados (estado do item, execução + checkpoint, integração), **nunca** da narrativa do LLM. **Sem schema novo nem estado persistido** — os `work_events` atuais já representam a semântica. Honestidade: analisar e implementar não têm fronteira de evento (o coder edita numa chamada opaca) → ambos caem em `implementing`; `testing` é distinguido pelo checkpoint de pós-edição do worktree. `WorkPresentation.progress` expõe a fase (read-only); o serializer já a propaga (spread). O `WorkProposalCard` exibe a fase como indicador **read-only** (ponto pulsante quando ativo), defensivo a projeções antigas sem `progress`.

## Provas / gates

- `packages/core` Jest **921** (+6 `deriveWorkProgressPhase`).
- `apps/web` Jest **592/592** (+6: coder-backend 6, resource-governor +1, WorkProposalCard +2; ChatClient corrigido). `typecheck` **5/5**.
- Prova viva `pwsh` (scratch isolado, sem efeito externo). UI verificada por React Testing Library (sem navegador, conforme mandato).

## Invariantes / efeitos externos

Harness continua **só CoderBackend**, **não default**, sucesso host-authoritative. Nenhuma permissão ampliada; nenhuma mudança no env do subprocesso; `gateRetryLimit` inalterado (1 só p/ harness). **Nenhum** push/PR/merge/deploy/`origin/main`. Prova viva em scratch descartável (limpo). `.worktrees/`, `.claude/settings.local.json`, `apps/web/.env.local` preservados.

## Limitações (não escondidas)

- `pwsh` com executáveis externos (git/npm) falharia sob o env mínimo — não necessário para o coder.
- Fase `Analisando` colapsa em `Implementando` (sem fronteira de evento) — honesto, não inventado.
- Accounting do coder multi-turn (soma/último turn) permanece — não bloqueia; documentado.

## Próximo ponto exato

Priority 4 (mandato): mapear a lacuna WEB entre resultado executado → Verifier → "Pronto para integrar" → decisão humana → publicação protegida (sem efeito GitHub externo). Priority 5 (accounting) só se bloquear decisão concreta. Sem ratificar Harness default nem afrouxar gates.

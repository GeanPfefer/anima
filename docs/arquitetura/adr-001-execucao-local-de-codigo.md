# ADR-001: Execução local de código no repositório real

**Status:** Aceito — Opção A ratificada por Gean (2026-08-04)
**Data:** 2026-08-04
**Decisores:** Gean (ratificado)

## Contexto

O objetivo de longo prazo do Anima (ver [manifesto](../../anima-manifesto.md), camada "Depois") é **codar localmente**: a partir do chat, o Anima planeja, executa e propõe mudanças no próprio código, sob aprovação e **sem merge automático**.

Estado atual:

- **Runner local** (`tools/local-agent`, ratificado no INT-04/Fase D) é um **POC de contrato de segurança**: prova plano-aprovado, execução isolada, **gate factual** (testes verdes antes de aplicar), nenhuma aplicação automática e revisão humana. Substrato: contêiner `python:3.11-slim`, `network none`, cópia sanitizada só de `.py/.json/.md/...`, sem `node_modules`.
- **Consequência dura:** esse substrato **não consegue construir o monorepo TypeScript do Anima** — não tem Node, não recebe os `.ts/.tsx` e não tem `node_modules` (e `network none` impede instalar). O planejador GPT já fixa alvo `project:anima` com gate `npm`, escrito **otimista**, assumindo um executor que ainda não existe.
- **Reutilizável, agnóstico de linguagem:** toda a orquestração (propostas, elegibilidade, claims, supervisor, checkpoints, revisão) e o *desenho* do envelope de segurança. O que falta é o **substrato de execução** que dirige o toolchain real.

Forças em jogo: fidelidade ao projeto real (o gate só vale se rodar de verdade), contenção/segurança, esforço de construção **e de manutenção**, qualidade do modelo que edita, e o contexto **uso pessoal, single-user, humano no loop, sem auto-merge**.

## Decisão (proposta)

Adotar a **Opção A — agente em git worktree com toolchain real** como executor de autodesenvolvimento, com **modelo coder selecionável (Ollama local + GPT nuvem)**, realocando a segurança do contêiner para: **allowlist de comandos + denylist de segredos + isolamento por worktree/branch + gate obrigatório + revisão humana + sem auto-merge**. Manter a Opção B como **endurecimento futuro** caso surja execução multiusuário ou não confiável.

## Ratificação (Gean, 2026-08-04)

Gean **escolheu e ratificou a Opção A**: execução em git worktree isolada usando o toolchain real do Anima no host. Objetivo canônico: tornar real o fluxo **"Anima desenvolve o próprio Anima"**, mantendo invioláveis:

- execução **sempre** em branch/worktree isolada;
- **nenhuma** alteração direta no workspace original;
- **nenhuma** aplicação ou merge automático;
- **allowlist explícita** de comandos;
- **bloqueio** de segredos e caminhos sensíveis;
- **gates obrigatórios**;
- **checkpoints e recuperação**;
- resultado **sempre** enviado para revisão humana;
- **inteligência selecionável por adaptadores**, inicialmente entre local e nuvem.

O **runner Python existente (`tools/local-agent`) não deve ser apagado**: seus contratos e componentes reutilizáveis são preservados, mas ele **deixa de ser o executor principal** para tarefas no monorepo TypeScript.

## Opções consideradas

### Opção A — Agente em git worktree (toolchain real)

O executor cria um `git worktree`/branch do repo real (com `node_modules` e toolchain de verdade); o modelo edita os `.ts`; o gate `npm` real roda; a saída é um **branch/diff para revisão**. Sem merge automático.

| Dimensão | Avaliação |
|---|---|
| Complexidade | Média |
| Custo (infra) | Baixo |
| Fidelidade ao repo real | **Alta** |
| Contenção/isolamento | **Média** (roda no host) |
| Manutenção | Baixa |
| Reuso dos contratos ratificados | Alto |

**Prós:** roda o toolchain real, então o gate é significativo; reaproveita o planejador GPT (já mira `anima`/`npm`); baixo atrito; é como agentes de código práticos (e como o próprio Claude Code) operam.
**Contras:** contenção mais fraca que um contêiner — comandos rodam com o toolchain do host; exige **denylist de segredos** (`.env.local`, credenciais), usuário restrito e allowlist de comandos para ser seguro; risco de operações git destrutivas se não delimitado.

### Opção B — Contêiner Node endurecido (network-none)

Estender a imagem com Node, copiar `.ts/.tsx`, e resolver `node_modules` (pré-instalar na imagem ou montar read-only), mantendo `network none`.

| Dimensão | Avaliação |
|---|---|
| Complexidade | **Alta** |
| Custo | Médio |
| Fidelidade ao repo real | Condicional (depende de provisionar deps certas) |
| Contenção/isolamento | **Alta** |
| Manutenção | **Alta** (imagem sincronizada com as deps a cada mudança) |
| Reuso dos contratos ratificados | Alto |

**Prós:** melhor contenção (network-none, não-root, raiz read-only, sem host).
**Contras:** `node_modules` é grande e versionado; `network none` impede `npm ci` dentro → deps têm de ser pré-providas; montar deps do host esbarra em módulos nativos/paths/plataforma; workspaces npm complicam a cópia; **imposto de manutenção recorrente**.

### Eixo ortogonal — quem escreve o código (decisão do Gean: selecionável)

O executor deve aceitar **provedor selecionável**, no mesmo padrão de [`chat-provider.ts`](../../apps/web/lib/ai/chat-provider.ts): **Ollama local** (tudo na máquina, sem custo, mais fraco/estocástico — visto no INT-04) e **GPT nuvem** (muito mais capaz, API paga, conteúdo sai da máquina dentro das fronteiras já ratificadas). Vale avaliar um terceiro backend pragmático: **invocar um agente de código existente** (Claude Code / Codex) como executor sobre o worktree — menor esforço e maior qualidade que um laço de edição próprio. Selecionável por tarefa entrega o melhor dos dois.

## Análise de trade-off

A tensão central é **contenção (B) × fidelidade + baixo atrito (A)**. Para o monorepo TS real, o modelo network-none-Python-container **briga de frente** com o npm (deps grandes, rede para instalar), e o custo de manter a imagem em dia com as deps é recorrente. A Opção A entrega a visão **hoje**, reaproveitando os contratos ratificados; a segurança migra do contêiner para **branch + gate + revisão + sem-merge + allowlist/denylist** — postura defensável para uso pessoal single-user com humano no loop. A Opção B só se paga se o requisito virar execução de código **não confiável** ou **multiusuário** — que não é o caso agora.

## Consequências

- **Fica mais fácil:** o Anima realmente construir/testar TS; o gate passa a valer; reaproveitar o planejador GPT; a qualidade do resultado sobe com modelo selecionável.
- **Fica mais difícil / exige cuidado:** contenção mais fraca → depende de allowlist de comandos, denylist de segredos, usuário restrito, isolamento por worktree e revisão; nunca passar segredos ao modelo; evitar git destrutivo.
- **A revisitar:** se um dia houver multiusuário ou execução não confiável, reintroduzir o contêiner (B) **por cima** de A.
- **Ainda falta** a ponte de aplicação (INT-03): transformar o branch/resultado aceito em PR revisável — é etapa separada.

## Implementação e prova (2026-08-04)

Implementado sobre o contrato `WorkExecutorAdapter` **existente** (consumido pelo `runExecutorStreamed` atual) — sem caminho paralelo. Novos módulos em `apps/web/lib/work-orchestration/`:

- **`worktree.ts`** — `GitWorktree` (branch+worktree descartável de um SHA; diff; arquivos alterados; commit sem push; dispose que remove a *junction* de `node_modules` com `rmdir` **antes** do `git worktree remove`, para nunca apagar o `node_modules` real), `safeJoin` (guardas de raiz/traversal/segredos) e `runProcess`/`runGate` (execução sem shell com allowlist npm explícita, timeout, cancelamento, captura).
- **`coder-backend.ts`** — interface **selecionável** `CoderBackend` + `ScriptedCoderBackend` determinístico. O adaptador e o Supervisor nunca falam com um provedor direto.
- **`worktree-executor.ts`** — `WorktreeExecutorAdapter`: worktree → backend confinado → validação de escopo → checkpoint opcional → gates npm → `result` (para revisão) ou `error`; commit na branch descartável como referência, **nunca** push/merge/apply.
- **`ollama-coder.ts`** — `OllamaCoderBackend`, a primeira inteligência **local** selecionável (single-shot, confinada ao escopo).

Commits (branch `claude/ux-04-mobile-parity`, pushados; `origin/main` intacta): `3f70555` (ratificação), `ea7f40a` (primitivas), `bdad460` (adaptador + backend), `aa893fb` (correção do dispose), `4250f50` (regressões), `ba4c5a8` (backend Ollama).

**Provas automatizadas (verdes):** `worktree` 11, `worktree-executor` 11 (sucesso, gate falhando, fora de escopo, permissão, allowlist, cancelamento, original intacto mesmo sujo, caminho sensível, retomada/checkpoint, concorrência no mesmo alvo, idempotência), `ollama-coder` 4 (fetch mockado). Suíte web inteira **186** verdes; typecheck do monorepo limpo.

**Prova determinística no repositório Anima real** (harness descartável, não commitado): adicionou uma função pura + teste em `packages/core`; gates `npm test`/`npm run typecheck` **reais** verdes com `node_modules` religado; `result` (→ revisão); workspace original **byte-idêntico**; worktree e branch descartáveis limpos.

**Execução real com modelo LOCAL** (`qwen3-coder:latest` via Ollama, harness descartável): o modelo escreveu a mudança TypeScript no escopo; os gates reais passaram; `result` (→ revisão); original intacto; ~35 s. É o "Anima desenvolve o próprio Anima" com inteligência local, ao vivo.

**Invariantes do ADR confirmadas:** worktree sempre isolada do SHA; workspace original nunca tocado (mesmo sujo); `node_modules` real preservado no dispose; allowlist de comandos; guardas de path/segredo; gates obrigatórios; checkpoint; `result` sempre para revisão humana; sem merge/push/apply; inteligência selecionável por `CoderBackend`.

## Fiação da rota do Supervisor (2026-08-04)

O executor de worktree passou a ser alcançável pelo fluxo real, com **seleção explícita pelo contrato persistido** (não heurística). Novo `executor-selection.ts` (`resolveExecutorRoute`) lê `execution_spec.executor` do item e devolve exatamente um `WorkExecutorAdapter`; o Supervisor continua recebendo só rotas.

- **Contrato persistido (sem migration; `intent.execution_spec` é JSONB):** o planejador GPT passou a gravar `executor: 'worktree'`, `coder_backend: 'ollama'`, `model` (local) e **`base_sha` capturado do HEAD na proposta**. A worktree nasce **exatamente desse SHA**, nunca do HEAD posterior à aprovação.
- **Regras:** `project:anima` exige o worktree (nunca cai no runner Python); o runner Python legado segue disponível para os demais alvos e para a fila autônoma pura; configuração inválida (sem `base_sha`, SHA malformado, backend inválido, executor desconhecido) falha **explícita**, sem fallback silencioso.
- **Rota `supervisor-turn`:** no caminho explícito (botão "Executar autonomamente"), resolve o executor pelo contrato e passa a rota única; a ponte de admissão (classificação INTEL-01) permanece intacta.

**Provas (verdes):** `executor-selection` 12, `supervisor-turn/route` 5, e **integração determinística `Supervisor → worktree`** 1 — `runSupervisorTurn` real dirige o `WorktreeExecutorAdapter` real: seleção → worktree no SHA autorizado → edição TS → **gate `npm` real** → checkpoint persistido → terminal → item em **`review`**, workspace original **intacto**. Regressões: SHA autorizado vs HEAD posterior, SHA inalcançável recusado, backend inválido, executor incorreto, retomada, concorrência, idempotência, gate falhando, cancelamento. Suíte web inteira **202**; typecheck do monorepo limpo. Commits `ad9eaa7`, `738b582`, `1b9fee2`, `74d8f99`, `63ca2b2`.

**Pendência honesta:** a prova pela **stack HTTP viva com o modelo real** não foi executada — Docker, Supabase local e o dev server estavam **fora** nesta sessão. As duas metades já estão provadas isoladamente (o modelo local real `qwen3-coder` end-to-end no adaptador; a costura `Supervisor → worktree → review`); falta compô-las ao vivo pela rota autenticada. **Ratificação final do fluxo é do humano.**

## Prova ao vivo pela stack HTTP (2026-08-04)

Executado o fluxo **completo pela rota autenticada real**, com Docker + Supabase local + dev server (porta 3100) + Ollama (`qwen3-coder:latest`), usuário e dados **totalmente descartáveis** (`worktree-live-…@test.invalid`, allowlisted). Nenhuma conta pessoal, nenhum `db reset`, `main` intocada.

**Percurso e evidências objetivas (item `b9284af1…`, tentativa `adc5dc71…`):**

- **Contrato persistido** em `create_work_proposal`: `executor: worktree`, `coder_backend: ollama`, `model: qwen3-coder:latest`, `base_sha: 6551df2…`, `target: project:anima`, permissões isoladas, limites 3/30.
- **Aprovação** → `approved`; **`POST /api/work-orchestration/supervisor-turn`** autenticado por Bearer → **HTTP 200**; **`routingDecision.selected.executorId = worktree-v1`** (seleção explícita pela rota real).
- **Sequência de eventos:** `work_proposed → context_attached → work_approved → work_intelligence_classified → work_routing_adjusted → work_routing_decided → work_claimed → work_started → execution_started → checkpoint_recorded → result_submitted → work_claim_released` (**1 checkpoint persistido**).
- **Execução real:** `qwen3-coder:latest` editou 2 arquivos no escopo; **gates reais verdes** — `npm test --workspace=packages/core -- live-proof-add` (exit 0) e `npm run typecheck --workspace=packages/core` (exit 0).
- **Diff produzido** (na branch de execução, nunca merjado): `packages/core/src/work-orchestration/live-proof-add.ts` (`export function liveProofAdd(a, b): number { return a + b; }`) + `live-proof-add.test.ts`, 8 inserções.
- **Estado final: `review`.** **Workspace original byte-idêntico** (`git status` limpo; nenhum arquivo `live-proof-*` no repo real).
- **Limpeza:** branch descartável e usuário removidos (cascade); os fixtures `@test.invalid` preexistentes e a conta pessoal **preservados**; sem resíduo.

**Observações honestas:** a primeira invocação terminou em `execution_failed` — o modelo é estocástico e o gate **corretamente reprovou** uma saída ruim, deixando o original intacto; a invocação seguinte passou (não é defeito de produto). Achado de infra corrigido: os testes git-pesados de worktree ganharam `jest.setTimeout(30s)` para não flakar por contenção sob carga paralela.

## Ação

1. [x] **Gean decidiu**: Opção A ratificada, com modelo selecionável (local + nuvem).
2. [x] `WorktreeExecutorAdapter` de worktree — worktree/branch do SHA, edição, gate `npm` real, diff/branch, allowlist + guardas de segredo/escopo.
3. [x] Inteligência **selecionável** por `CoderBackend` (`ScriptedCoderBackend` + `OllamaCoderBackend` local).
4. [x] **Marco mínimo** provado ao vivo (determinístico + modelo local) no `packages/core`, com original intacto.
5. [~] `tools/local-agent` preservado e rebaixado a POC de contrato no ADR e no PRD (o código do runner permanece).
6. [x] **Rota do Supervisor fiada** à seleção explícita do executor pelo contrato persistido (worktree para `project:anima`, runner Python para o legado), com SHA-base persistido e provas de integração — ver *Fiação da rota do Supervisor* acima.
7. [x] **Prova ao vivo pela stack HTTP** (Docker + Supabase + dev server) com o modelo real `qwen3-coder` — ver *Prova ao vivo pela stack HTTP* acima; item em `review`, original intacto, descartáveis limpos.
8. [x] Backend **GPT/OpenAI selecionável** atrás de `CoderBackend` (`GptCoderBackend`, Responses API, chave só no servidor), escolhido por `execution_spec.coder_backend='openai'`; Ollama permanece a opção local; Supervisor não acoplado; parser `parseScopedFiles` compartilhado; 6 testes com fetch mockado (sem chamadas pagas). Falta uma prova ao vivo com a OpenAI real (paga, não executada).
9. [~] **Substrato de handoff durável de worktree** — contrato puro `worktree-handoff.ts` em `packages/core` (`buildWorktreeHandoff`/`parseWorktreeHandoff`/`projectWorktreeHandoff`), 17 testes, na branch `claude/worktree-durable-handoff`. Estrutura a evidência git que sobrevive à remoção da worktree (base/commit SHA, branch do namespace `anima-work/`, resumo do diff em contagens, gates e desfecho, erro seguro), com validação fail-closed (versão, correlação, SHA, namespace, status↔gates, limites de tamanho, segredos/caminhos absolutos). Lê de `data.executor_signal.worktreeHandoff` — a RPC de término já persiste o sinal inteiro como JSONB, então **sem migration**. Ainda **não fiado ao produtor vivo**: o adaptador emite o sinal `result` sem o campo `worktreeHandoff`, e adicioná-lo estenderia o contrato `WorkExecutorSignal` sem consumidor — pertence ao INT-03. Módulo puro: não aplica, não faz merge, não faz push.
10. [ ] **INT-03** — fronteira de integração/aplicação (`IntegrationHandoff` em `integration-boundary.ts`): transformar o resultado aceito em branch/PR revisável, sob segunda aprovação humana. O substrato de handoff durável do item 9 é o insumo que o INT-03 produz no sinal e consome na projeção.

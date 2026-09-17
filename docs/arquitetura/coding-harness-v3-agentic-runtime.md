# Coding Harness V3 — Agentic Workspace Runtime

Status: **fundação implementada** (2026-09-14). Evolução incremental do harness
existente (DeepSeek/shared), NÃO uma reescrita. Complementa o
[ADR-001](adr-001-execucao-local-de-codigo.md) e o
[ADR-004](adr-004-ancora-de-edicao-host-mediada.md).

## 1. Princípio arquitetural: quatro camadas separadas

O ANIMA deve ter capacidades comparáveis às de Claude Code/Codex quando opera num
computador autorizado. A inteligência (o modelo) é **intercambiável**; o
**runtime/agente pertence ao ANIMA**. Trocar o melhor LLM disponível no futuro NÃO
pode exigir reconstruir os braços.

```
ANIMA Brain (cognição persistente/event-driven, aciona inferência forte quando necessário)
  → Governor (decide as FRONTEIRAS: work item, autoridade, budgets, tempo, workspace,
              write scope, rede, integração, publish/deploy, human gates)
    → Coding Agent Runtime (decide OPERACIONALMENTE: o que ler/buscar, quais testes
              rodar, quando editar, quando inspecionar diff, quando repetir)
      → Model Backend (fornece inteligência/inferência — Ollama, OpenAI, self-hosted,
              Anthropic, futuros; INTERCAMBIÁVEL)
  Verification (independente do coder)
```

- **Brain** — HOJE o sistema permanece predominantemente *event-driven* (não se
  quer um LLM forte gerando compute continuamente sem necessidade). FUTURO: um
  cérebro persistente/continuamente disponível que **privilegia o MELHOR LLM
  disponível que possa ser efetivamente operado** — custo mínimo NÃO é o objetivo
  primário do cérebro principal; modelos menores servem como workers/filtros. O
  cérebro pode estar local, em servidor próprio/cloud ou em provider terceirizado.
  "Persistente" NÃO implica gerar tokens 24/7: significa **continuidade cognitiva
  event-driven** que aciona inferência forte quando necessário. Os braços continuam
  nos Resident Hosts / Coding Runtime do ANIMA.
- **Governor** — a governança existe nas FRONTEIRAS do agente, não microgerenciando
  o processo de programação. (Substratos já ratificados: budget, gate real, backlog
  autônomo, host-turn/worktree, autoridade paga, human gates.)
- **Coding Agent Runtime** — o laço iterativo. É o foco desta fatia.
- **Model Backend** — abstração intercambiável (ver §4).

## 2. Estado real do runtime (auditoria de código, 2026-09-14)

Existem HOJE dois paradigmas de `CoderBackend`
([`coder-backend.ts`](../../apps/web/lib/work-orchestration/coder-backend.ts)):

1. **Propõe-edições, host-mediado** — `OllamaCoderBackend`
   ([`ollama-coder.ts`](../../apps/web/lib/work-orchestration/ollama-coder.ts)) e
   `GptCoderBackend`
   ([`gpt-coder.ts`](../../apps/web/lib/work-orchestration/gpt-coder.ts)). Um
   **protocolo compartilhado** em JSON de duas ações (`read`/`edit`) — ver
   [`ollama-protocol.ts`](../../apps/web/lib/work-orchestration/ollama-protocol.ts).
   **Fato central:** o `GptCoderBackend` é um *wrapper fino* que **delega o laço
   inteiro** ao `OllamaCoderBackend`, trocando só o transporte (`protocolTransport`
   → OpenAI Responses API em vez do HTTP do Ollama). Ou seja: o "shared coder
   protocol" é literalmente o laço do Ollama, e o OpenAI o reusa por completo. O
   prefixo `ollama_*` (inclusive nos códigos de erro) é **histórico** — não indica
   acoplamento a Ollama. **Este é o runtime que já é model-agnostic e pertence ao
   ANIMA; é a base correta a evoluir para o V3.**

2. **Enraizado, laço próprio** — `DeepSeekHarnessCoderBackend`
   ([`deepseek-harness-coder.ts`](../../apps/web/lib/work-orchestration/deepseek-harness-coder.ts))
   + `DeepSeekHarnessRuntime`
   ([`harness/deepseek-harness-runtime.ts`](../../apps/web/lib/work-orchestration/harness/deepseek-harness-runtime.ts)).
   Roda o `dsh` (CLI do `@deepseek-ai/dsh`) como **processo filho confinado** na
   worktree (`workspace.rootPath`), com ferramentas reais (`read/glob/grep/pwsh`),
   `permissionMode: workspace-write`, rede off e step budget. É a prova viva de
   "braços com ferramentas reais", MAS o runtime pertence ao `dsh` (não ao ANIMA) e
   está acoplado ao endpoint OpenAI-compat do Ollama local. É **CANDIDATO**, não
   default, e **não deve ser descartado** — é a base dos braços com tools reais e a
   referência do que o runtime nativo do ANIMA precisa alcançar (shell/glob/grep).

### Capacidades vs Claude Code/Codex

| Capacidade | Propõe-edições (Ollama/OpenAI) | DeepSeek Harness | Claude Code/Codex |
|---|---|---|---|
| READ (múltiplos arquivos/rodadas) | Sim (1ª fatia corrigiu o teto; ver §3) | Sim (tool `read`) | Sim |
| READ scope amplo (todo o repo) ≠ WRITE scope | **Sim** (2ª fatia; ver §7) | Sim (mas escopo só textual) | Sim |
| SEARCH (grep/glob repo-wide) | **Sim, host-executado** (2ª fatia; ver §7) | Sim (`glob`/`grep`) | Sim |
| EXEC de comandos governados na worktree | **Sim** (3ª fatia; ver §8) | Sim (`pwsh` irrestrito) | Sim |
| TEST/typecheck pelo coder | **Sim** (via exec: npm test/run; §8) | Parcial (via `pwsh`) | Sim |
| EDIT incremental multi-turn | Sim (iterativo em modo exec; §8) | Sim | Sim |
| GIT status/diff/log/show pelo coder | **Sim, read-only** (3ª fatia; §8) | Não | Sim |
| GIT commit/push/reset pelo coder | **Não** (proibido; branch é do host) | Não | Sim |
| Loop iterativo real (edit→test→edit→submit) | **Sim** (3ª fatia; §8) | Sim (step budget) | Sim |
| Model backend intercambiável | **Sim** | Não (acoplado dsh+Ollama) | n/a |

**A: já existe** — READ/EDIT multi-turn, protocolo model-agnostic, write-scope
governado, evidência host-observed, retry interno de gate; SEARCH/GLOB host-executados e
READ scope amplo ≠ WRITE scope (§7); **agora também EXEC/TEST/GIT governados + loop
iterativo edit→test→edit→submit (§8)**. **B: existia, mas restrito** — o laço de leitura
(corrigido na 1ª fatia, §3). **C: gaps remanescentes** — shell IRRESTRITO (o EXEC é
governado por allowlist, não shell livre — por design), resolução robusta de binários
diretos (tsc/jest via .bin cross-platform, hoje via `npm run`), e sandbox de rede de
kernel (a rede é negada por policy/allowlist, não por sandbox — ver §8). O DeepSeek
Harness (`pwsh` irrestrito) permanece como referência comportamental.

## 3. O gargalo real e sua correção (V3, esta fatia)

**Origem histórica do read-round-limit.** O protocolo host-mediado substituiu o
round-trip de conteúdo integral (inviável: um prompt com 4 docs ~73k tokens foi
truncado para ~4k por `num_ctx=8192`). Para manter o prompt pequeno numa janela
LOCAL apertada, o parser impôs `MAX_READS_PER_ROUND = 8` **e** `maxReadRounds`
pequeno (default 3, teto 6). A ameaça mitigada era real: **estourar a janela de
contexto do modelo LOCAL** (defesa de prompt/latência), não abuso de disco.

**Por que virou gargalo.** `parseReadRequests` lançava
`ollama_invalid_response_schema` quando `reads.length > 8`, **fora** do caminho de
reparo de `callProtocol` — logo **terminal e não recuperável**, ANTES de qualquer
edit. O limite é **compartilhado** por Ollama e OpenAI (o OpenAI delega ao mesmo
laço). Um modelo FORTE de janela grande (`gpt-5.6-terra`) que investiga amplamente
(o comportamento agêntico desejado) reprovava a tentativa inteira só por pedir >8
leituras numa rodada. Foi exatamente a causa da última correction paga
(`571d29be…` / attempt `77ca3038…`): o provider respondeu, o coder investigava, o
ANIMA recusou a resposta antes dos edits. O harness/protocolo virou o gargalo do
self-development.

**Correção arquitetural (não `8 → 16`).** O número por rodada deixa de ser um teto
de schema terminal e passa a ser um **ORÇAMENTO** com **deferência graciosa**:

- **Política pura no core** —
  [`agentic-runtime-policy.ts`](../../packages/core/src/work-orchestration/agentic-runtime-policy.ts)
  (`AgenticRuntimePolicyV1`): `readServingBudgetPerRound`, `maxReadRounds`,
  `maxTotalServedReads`, `mode: supervised|autonomous`. `resolveAgenticRuntimePolicy`
  clampa fail-closed (como `resolveHarnessStepBudget`). Perfis: LOCAL conservador
  (8/3/40 — preserva o comportamento numérico local) e REMOTO FORTE (24/10/200).
- **Deferência, não recusa** — `parseReadRequests(reads, allowed, servingBudget)`
  serve as primeiras `servingBudget` leituras VÁLIDAS e **DEFERE** o excedente
  (descrito ao modelo para re-solicitação numa próxima rodada); o laço continua. A
  guarda de **abuso** (`MAX_READS_REQUESTED_PER_ROUND = 64`, muito acima de qualquer
  orçamento) continua `ollama_invalid_response_schema` — só barra payload patológico.
- **Fronteiras substituem o anti-loop por rodada** — a segurança agora é: rodadas
  (`maxReadRounds`), teto de leituras da SESSÃO (`maxTotalServedReads`, terminal
  quando esgotado sem editar) e, na camada do Governor, tempo/custo/escopo/rede/
  autoridade. O orçamento por rodada continua existindo apenas como limite de
  prompt/latência da janela — e é maior para backends de janela grande.
- **Backend forte recebe o perfil forte** — `GptCoderBackend` injeta o perfil
  REMOTO FORTE no laço compartilhado: a correção direta do gargalo pago. O Ollama
  local mantém o perfil conservador (protege a RAM/janela da Goma).

**Escopos de leitura vs escrita.** Resolvido na 2ª fatia — ver §7.

## 4. Abstração de model backend

O mesmo runtime funciona com Ollama e OpenAI HOJE pelo contrato `CoderBackend`
(`edit(request, workspace, signal)`), com o laço compartilhado e o transporte
injetável. Backends futuros (remoto self-hosted, Anthropic, outros) implementam o
mesmo contrato: o laço, os orçamentos e a política do V3 não mudam. O DeepSeek
Harness é o caso "enraizado" (roda o próprio laço) e permanece atrás do mesmo
contrato — a evolução do runtime nativo do ANIMA não o descarta.

## 5. Roadmap imediato

1. ~~**SEARCH host-executado**~~ — FEITO (2ª fatia, §7).
2. ~~**READ scope amplo × WRITE scope estreito**~~ — FEITO (2ª fatia, §7).
3. ~~**SHELL/TEST/GIT governados pelo coder**~~ — FEITO (3ª fatia, §8): EXEC por command
   policy (dev + git read-only), loop iterativo edit→test→edit→submit, rede negada por
   policy.
4. **Perfis supervised × autonomous vivos** — o Governor injeta o `mode` conforme a
   origem (chat supervisionado vs backlog autônomo). Hoje o `worktree-executor` injeta os
   perfis SUPERVISIONADOS (WorkspaceAccessPolicy READ workspace / WRITE Work Item +
   CommandExecutionPolicy dev/git-read) como wiring vivo mínimo; perfis autônomos mais
   restritos (`AUTONOMOUS_*`) já existem no core e são injetáveis sem mudar os braços.
5. **Equivalência prática com Claude Code/Codex (gaps restantes)** — resolução robusta de
   binários diretos (tsc/jest/vitest cross-platform, hoje via `npm run`); sandbox de rede
   de KERNEL (hoje a rede é negada por allowlist/policy, não bloqueada por sandbox — um
   `npm test` cujo código faça rede não é impedido, mesmo risco do gate do host); e,
   futuramente, uma "brain" persistente que orquestre múltiplas sessões (ver §1).

## 6. Settlement congelado como benchmark

A correction de settlement B1/B2/B3 (actual-cost) fica **temporariamente congelada**
como benchmark, para comparar, sem mudar o problema, o **harness restrito antigo** vs
o **Agentic Harness V3** com o MESMO modelo forte:

- base: `ccb7dcc`; tarefa: B1/B2/B3 actual-cost settlement; referência técnica:
  `0bea4c8`; strong host harness com resultado conhecido (`61eb2eb` FAIL, `5fad667`
  FAIL, referência correta PASS).
- Reexecução futura: mesma tarefa, mesmo modelo forte, com o coder usando o perfil
  REMOTO FORTE do V3 (orçamento de leitura amplo), para isolar o efeito do harness.

## 7. READ e WRITE como autoridades distintas + SEARCH host-executado (2ª fatia)

Princípio ratificado: **um coding agent investiga amplamente sem receber autoridade
ampla de escrita.** READ e WRITE são autoridades SEPARADAS; ler um arquivo NÃO
concede escrevê-lo.

- **`WorkspaceAccessPolicyV1`** (pura, model-agnostic,
  [`workspace-access-policy.ts`](../../packages/core/src/work-orchestration/workspace-access-policy.ts)):
  `writeScope` (allowlist exata, fail-closed, = Work Item), `readScope`
  (`{kind:'workspace'}` amplo, ou `{kind:'paths'}` explícito, sempre ⊇ writeScope) e
  `excluded`. `isPathReadable`/`isPathWritable`/`isPathExcluded` são as autoridades
  lógicas host-side. Invariantes: WRITE nunca > Work Item; READ ≥ WRITE; excluído e
  traversal/absoluto nunca legíveis nem graváveis; write sempre legível.
- **SEARCH/GLOB host-executados.** O protocolo ganhou as ações `{"action":"search",…}`
  e `{"action":"glob",…}` (parseadas/clampadas em
  [`ollama-protocol.ts`](../../apps/web/lib/work-orchestration/ollama-protocol.ts)).
  O HOST executa a busca — o modelo **NUNCA** roda shell. A implementação real usa
  `git grep` / `git ls-files` na worktree
  ([`GitWorktree.searchText`/`listFiles`](../../apps/web/lib/work-orchestration/worktree.ts)),
  confinada por construção a arquivos RASTREADOS sob a raiz (node_modules/.git/segredos
  nunca aparecem), com cap de volume (compactação) e cancelamento. Testável por
  injeção (`CoderWorkspace.search`/`list` opcionais); backend sem essa capacidade
  simplesmente não anuncia a ação (retrocompat).
- **Confinamento em duas camadas.** (1) A execução (git grep) só vê arquivos
  rastreados sob a raiz; (2) o laço filtra CADA resultado por `isPathReadable`
  (exclui traversal/absoluto/excluído). READ de um caminho amplo é servido via
  `readFile` lazy, cujo `safeJoin` é a fronteira de FS dura. EDIT continua validado
  contra o `writeScope` exato — fora dele é `ollama_edit_outside_scope`, e o host
  reainda reforça pós-edição via git observado (`contract_violation`).
- **Model-agnostic.** Tudo vive no laço compartilhado; o `GptCoderBackend` herda
  SEARCH/GLOB e a separação read/write sem código próprio (delega ao mesmo laço).
- **Fronteiras, não micro-limites.** Investigação (read/search/glob) consome rodadas
  do orçamento de sessão (`maxReadRounds`); resultados têm cap de VOLUME
  (`MAX_SEARCH_RESULTS`/`MAX_GLOB_RESULTS`) que TRUNCA com aviso, nunca derruba a
  sessão. Sem repetir o erro do "8 reads".
- **Wiring vivo do Governor (mínimo).** O
  [`worktree-executor.ts`](../../apps/web/lib/work-orchestration/worktree-executor.ts)
  injeta `supervisedWorkspaceAccessPolicy(includedScope, excludedScope)` — READ =
  workspace, WRITE = Work Item — e liga `workspace.search`/`list` à worktree. Um
  readScope mais conservador para modo autônomo é injetável depois sem mudar os braços.

O que falta para o loop completo: SHELL/TEST/GIT governados — FEITO na 3ª fatia (§8).

## 8. EXEC/TEST/GIT governados + loop iterativo (3ª fatia)

Princípio ratificado: **três autoridades DISTINTAS** — READ, WRITE e EXEC — nenhuma
implicando a outra. Poder ler não concede escrever; poder escrever não concede executar;
poder rodar testes não concede rede nem comandos destrutivos. O modelo NUNCA recebe
shell: pede uma ação ESTRUTURADA; o host valida, executa confinado e devolve a observação.

- **`CommandExecutionPolicyV1`** (pura, model-agnostic,
  [`command-execution-policy.ts`](../../packages/core/src/work-orchestration/command-execution-policy.ts)):
  allowlist de programas, `network` (default `denied`), timeouts, cap de saída.
  `resolveCommandExecution` valida fail-closed e devolve o comando normalizado ou uma
  recusa legível. Perfis `SUPERVISED_*` (npm/pnpm/npx/node/tsc/jest/vitest/git) e
  `AUTONOMOUS_*` (mais restrito). **Enforcement FORTE:** allowlist de programa; **git
  READ-ONLY** por subcomando (status/diff/log/show — commit/reset/push/fetch/pull/merge/
  rebase/checkout/clean/add/tag/branch RECUSADOS); npm/pnpm só `run`/`test` (sem
  install/ci/publish/exec); args sem metacaractere de shell nem `..`; cwd confinado à
  worktree (não é sequer exposto ao modelo — `runCommand` roda sempre em `root`).
- **Ações do protocolo**: `{"action":"exec","program","args","timeoutMs?"}` (dev + git
  read-only) e `{"action":"submit"}` (encerra o turno iterativo). Parseadas em
  [`ollama-protocol.ts`](../../apps/web/lib/work-orchestration/ollama-protocol.ts)
  (`parseExecRequest`); a AUTORIDADE é da command policy, não do parser.
- **Execução real**: `GitWorktree.runCommand`
  ([`worktree.ts`](../../apps/web/lib/work-orchestration/worktree.ts)) via `runProcess`
  (sem shell, exceto os shims `.cmd` do Windows — e mesmo aí os args já passaram pelo
  charset seguro), cwd = raiz da worktree, `node_modules/.bin` no PATH (binários locais
  sem instalar nada), stdout/stderr/exit/timeout capturados e canceláveis.
- **Loop ITERATIVO** (só em modo exec, i.e. command policy + `workspace.exec`
  presentes): `edit` APLICA e CONTINUA (atualiza o cache; leituras/testes seguintes veem
  o novo conteúdo); o coder pode edit→test→diff→edit; encerra com `submit`. `exitCode≠0`
  (teste falhando) é OBSERVAÇÃO recuperável — o coder lê o erro e edita, não morre a
  sessão. Erros de edição recuperáveis (escopo/stale/ambígua/no-op/schema) viram
  observação bounded (`MAX_EDIT_FEEDBACKS`). Qualquer condição terminal DEPOIS de edições
  válidas entrega o acumulado (submit implícito) — nunca descarta trabalho bom.
- **Retrocompat**: sem command policy / sem `workspace.exec`, o modo exec fica DESLIGADO
  e o `edit` permanece TERMINAL (comportamento histórico; todos os testes anteriores
  intactos). O `worktree-executor` liga o modo exec (perfil supervisionado) como wiring
  vivo mínimo.
- **Gates finais do host permanecem autoritativos e independentes.** O teste que o coder
  roda é OBSERVAÇÃO para ele iterar mais cedo; o veredito continua sendo dos gates do host
  + Verifier, DEPOIS do submit. Coder tests ≠ verificação final.

**Honestidade de enforcement (forte vs policy-level).** FORTE/determinístico: allowlist
de programa; git read-only por subcomando; npm sem install; args sem metacaractere/`..`;
cwd confinado (não exposto); write-scope reforçado pós-edição por git observado. POLICY-
LEVEL/best-effort (NÃO sandbox de kernel): `network: denied` bloqueia os vetores óbvios
(curl/wget fora da allowlist, git fetch/pull/push por subcomando, npm install), mas um
`npm test` cujo CÓDIGO de teste faça rede não é impedido por sandbox — é o MESMO risco
que o host já aceita ao rodar gates na worktree. Documentado, não prometido como forte.

**Não implementado nesta fatia (por design):** shell irrestrito, `npm install`/rede,
git mutável, e sandbox de rede de kernel. O DeepSeek Harness (`pwsh` irrestrito) segue
como referência comportamental, não como alvo.

## 9. Tool-use e validate-before-submit (4ª fatia)

**Endurecimento estrutural (2026-09-15).** O validate-before-submit passou a ser
uma máquina de estados explícita (`exploring`, `dirty_unvalidated`,
`dirty_validated`, `ready_to_submit`). TEST verde e revisão de diff são provas da
`editRevision` corrente; novo EDIT invalida ambas, TEST vermelho não avança e
`SUBMIT` só é anunciado/aceito no estado final. Esgotamentos pós-edit não convertem
ausência de prova em sucesso. Criações untracked continuam válidas mesmo quando
`git diff` é vazio, sem permitir que um workspace sem mudança satisfaça o gate.

O benchmark `3a367223` revelou uma lacuna diferente de capability: SEARCH/GLOB/EXEC/GIT
estavam disponíveis e anunciados, mas os comandos concretos de `validation_criteria`
não chegavam ao `CoderEditRequest`, e o mesmo contador encerrava investigação e
validação. Um edit na última rodada podia, portanto, virar submit implícito sem TEST.

A correção mantém decisão operacional livre, mas endurece a fronteira de conclusão:

- o host parseia os gates já autorizados e injeta `validationCommands` estruturados;
- o prompt lista label/program/args concretos e orienta descoberta geral de contratos
  por SEARCH→READ, sem hardcode de enums/valores da tarefa;
- tarefas com validation command e edits exigem ao menos uma validação focal verde na
  revisão atual e `git diff` read-only após o último edit;
- exit não zero é observação recuperável e bloqueia submit; novo edit invalida teste e
  diff anteriores;
- submit prematuro recebe feedback bounded; esgotar READ não conclui implicitamente,
  pois existe budget pós-edit separado para EDIT/EXEC/submit;
- tarefas sem validation command preservam o submit retrocompatível.

Os gates do host continuam autoritativos e independentes. A validação do coder é
self-check obrigatório quando há prova executável, não substituto do Verifier.

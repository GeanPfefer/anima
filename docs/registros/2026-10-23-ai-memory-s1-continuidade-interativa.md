# ai-memory S1 — continuidade interativa Claude ↔ Codex e investigação do Project Builder V0 — 2026-10-23

Append-only. Tipo: **prova** (laboratório, sintética e uma investigação real read-only) e **registro de decisão do operador**. Segue o formato de [`README.md`](README.md). A evidência bruta fica no laboratório do operador, **fora do Git** (`G:\anima-labs\ai-memory-s1\evidence\`); este registro contém só identificadores, hashes, contagens e resultados sanitizados. **Não contém** prompts brutos, transcrições, valores dos canários sintéticos, marcadores de handoff, credenciais nem conteúdo de ledger.

Procedimento operacional correspondente: [`../operacao/ai-memory-s1-continuidade-claude-codex.md`](../operacao/ai-memory-s1-continuidade-claude-codex.md). Antecede: [`2026-10-21-evolution-reconciliation-v6.md`](2026-10-21-evolution-reconciliation-v6.md) (prova de laboratório de 2026-10-03, ai-memory 2.4.1).

## Estatuto (leia primeiro)

- O S1 é uma **ferramenta do operador para sessões interativas supervisionadas**. Não é executor governado, não é fonte de autoridade do ANIMA e **não promove a maturidade de nenhuma capacidade** do Capability Registry (`memory.cross-harness` segue como declarado na V6: laboratório).
- **Memória interativa ≠ ledger governado.** O ledger do ai-memory (conteúdo em texto claro, sem Verifier) não substitui o `work_events`/ledger do ANIMA, o Verifier, os gates do host nem a aprovação humana. O histórico do ANIMA (Git, ledger, registros) continua a fonte de verdade.
- **Nenhuma autonomia adicional foi comprovada.** Single-Item, L1/E2 e o Codex WSL ficam fora do escopo; no código atual o wrap do ai-memory é recusado no transporte WSL e no Single-Item de assinatura.

## Dados do registro

- Branch: `claude/s1-ai-memory-registro` (worktree isolada). Base: `dev` = `origin/dev` = `b40354fe66b4e534041418eb4ffa38debf20abb2`. `origin/main` = `99bec54e3ab42bfe882a8686cd1385d8058b916e`, intacta. HEAD final: o commit desta branch (um commit só de documentação).
- Escopo desta branch: apenas este registro e o runbook de `docs/operacao/`. Nenhum código, migration ou script. O script de operação (`s1.ps1`) **não** entra no repositório nesta etapa; permanece no laboratório, onde foi testado.

## Versões e configuração

- ai-memory **2.4.1** pinado (exe sha256 `143ee3779828017de8b5f698e9269d3c61db7cd08902890ee60fb31f12312537`, o mesmo da V6). Nenhuma versão 3.x foi instalada ou testada; o upstream estava na 3.2.2 em 2026-10-23 e a compatibilidade do wrapper com 3.x **não** foi avaliada.
- Claude Code **2.1.308**, login `claude.ai`, `apiProvider=firstParty`, plano `pro`.
- Codex **0.163.0-alpha.10.2** (pré-lançamento), login ChatGPT, `CODEX_HOME` **exclusivo do S1**, autenticado pelo operador (nenhuma credencial lida ou copiada). O contrato de hooks do ai-memory 2.4.1 está documentado até o Codex 0.154.0; a faixa 0.155–0.163 não é coberta pela documentação.
- Shim do Codex (`codex-no-daemon.exe`) sha256 `0F7C289CB65E30A96E56C7EE9C7DA6C14EB07BDE20B733E5FD07BA12A32CEBCA`, apontando para o `codex.exe` 0.163 instalado.
- Servidor em loopback `127.0.0.1:49394`, `embedding_provider="none"`, sem LLM, sem webhook, sem `server_url` remoto, sem serviço permanente. Nenhuma variável de API (Process/User/Machine); `ANTHROPIC_BASE_URL` aponta para `api.anthropic.com` e não é repassada aos filhos. Nenhuma API paga.
- `hooks.json` do Codex do S1: sha256 `3c34c2ce3f557a93c239a21ea98914eeefb8c8d5d62de711e8b00cbf62edb6a0`.

## Hooks do Codex: seis confiados, Stop sem confiança

O `hooks.json` do S1 define **sete** eventos (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PreCompact, Stop, SessionEnd), todos apontando só para o `ai-memory.exe` 2.4.1, para `--data-dir` do S1 e para a porta 49394 (nenhuma referência ao laboratório anterior nem a configurações globais). O operador revisou e confiou, pela interface nativa do Codex (sem `--dangerously-bypass-hook-trust`), **seis**: `session_start`, `user_prompt_submit`, `pre_tool_use`, `post_tool_use`, `pre_compact`, `session_end`.

**`Stop` está definido e não está confiado.** A interface do Codex 0.163 não o exibiu; o binário contém o evento Stop, mas **a causa da ausência não foi determinada** (é uma lacuna, não uma conclusão). Consequência observada: o ledger tem observações do Codex para os seis eventos confiados e **nenhuma** `stop`; o fim de turno do Codex não é capturado. O handoff Claude → Codex funcionou assim (a entrega usa SessionStart/UserPromptSubmit).

## Prova 1 — sintética, hooks do Codex desligados: FAIL (preservada)

Workstream `s1-handoff-20261023`. Fixture Git descartável. O leg 1 (Claude) criou o arquivo e emitiu o canário A. O leg 2 (Codex, com `features.hooks=false`, para não usar os hooks do laboratório anterior) terminou com exit 0, mas **não recebeu A** (`context_delivered=0`) e não criou o arquivo pedido. O leg 3 não foi executado. Atribuição de causa: a desativação dos hooks do Codex naquela execução (consistente com a prova 2, mas inferida).

## Prova 2 — sintética, hooks do Codex do S1 confiados: PASS

Workstream `s1-handoff-p2-20261023` (id `01a168ec699f7e12a600d7a8fef48092`), fixture Git `c127d5da0703442b6603d26a7b87fbdf03ff2072` (branch `s1`), sequência única, uma tentativa por leg, sem retry.

| Leg | Harness | Exit | `context_delivered` | sync | Resultado |
|---|---|---|---|---|---|
| 1 | Claude | 0 | 1 | 0→0 | criou `a.js`; emitiu o canário A (não gravado em arquivo) |
| 2 | Codex | 0 | 1 | 9→9 | criou `b.js` com o valor de A, recebido **só** pelo ai-memory; emitiu B |
| 3 | Claude | 0 | 1 | 15→15 | criou `c.js` com o valor de B |

Os prompts dos legs 2 e 3 coincidem com os hashes congelados (`4095fa02…`, `fde3f685…`) e não contêm A nem B. Observações de hooks do Codex no ledger: session-start 1, user-prompt 1, pre-tool-use 2, post-tool-use 2, session-end 1.

## Investigação real — Project Builder V0 (read-only)

Workstream `s1-pbv0-investigation-20261023` (id `01a16900d75078d0a68f2827dfd94876`, 108 eventos). Os agentes rodaram sobre um **snapshot** do commit `b40354f` mais documentos de trabalho selecionados (não o checkout vivo, que contém `apps/web/.env.local` e trabalho em andamento). Claude com apenas `Read`, `Glob` e `Grep`; Codex com `sandbox_mode=read-only`. Snapshot e ANIMA permaneceram sem alteração.

| Execução | Harness | `context_delivered` | Resultado |
|---|---|---|---|
| leg 1 | Claude | 1 | relatório de 10,8 KB, com o bloco de handoff no final |
| leg 2 | Codex | 1 | **falhou:** respondeu que não recebeu o handoff |
| leg 1b | Claude | 1 | reemitiu um handoff **compacto** (2,1 KB) |
| leg 2b | Codex | 1 | **sucesso:** devolveu o marcador novo na primeira linha (o prompt não o continha) e verificou as afirmações de forma independente |

### Sincronização ≠ entrega integral

`context_delivered=1` e o avanço de `sync` indicam que o ledger **sincronizou** eventos para o run, não que o conteúdo chegou inteiro ao modelo. O contexto injetado no início da sessão tem um orçamento de cerca de **9 KB** (o próprio bloco injetado avisa que eventos antigos "não cabem no orçamento de inicialização" e remete à busca no ledger). No leg 2, o relatório longo foi truncado no meio e o bloco de handoff, que estava no fim, não chegou; confirmado inspecionando o rollout do Codex (o marcador do leg 1 estava ausente da entrada do modelo). A correção foi **formato**, não infraestrutura: handoff compacto (≤ 3 KB) como **última mensagem**, com marcador de confirmação devolvido pelo agente seguinte.

### Contrato preliminar do primeiro target externo — INVESTIGAÇÃO, NÃO IMPLEMENTAÇÃO

"Project Builder V0" **não está definido** em nenhum documento deste repositório. A investigação usou uma definição de trabalho, que é **hipótese**: o ANIMA admite, governa e executa **um** work item contra um repositório-alvo externo isolado, pelo caminho Single-Item existente, sem tocar o repositório do ANIMA. Nada abaixo foi implementado nem decide arquitetura.

**A. Observado diretamente** (lido por este registro no commit `b40354f`; caminhos relativos a `apps/web/lib/` e `packages/core/src/work-orchestration/`):

1. A admissão pelo planner fixa o alvo: `target: { kind: 'project', reference: 'anima' }` (`ai/project-work-planner.ts:168`).
2. A seleção de executor trata `anima` como caso especial: `isAnima` (`work-orchestration/executor-selection.ts:374`); o alvo `project:anima` exige worktree (`:425`); o preparo de validação específico do ANIMA só roda para `isAnima` (`:415`).
3. A rota de worktree exige que a raiz seja uma raiz do ANIMA: `isAnimaProjectRoot` exige `.git`, `package.json` e `apps/web/package.json` (`:65-70`) e é aplicada em `:402`; um repositório externo comum falharia aí com `project_root_invalid`.
4. A raiz padrão é do processo: `projectRoot()` usa `ANIMA_PROJECT_ROOT` ou descobre pelo cwd (`:82-86`); o resolver de targets da rota só conhece a referência do contrato associada ao `repoRoot` da rota (`:411`). `readAuthorizedBaseSha` aceita `repoRoot` como parâmetro (`:90`).
5. A evidência de git do host usa `repoRoot: projectRoot()` (`work-orchestration/post-turn-observation.ts:103`) e, no modo estrito, a falha em persisti-la retém o resultado (`:111`).
6. O Verifier de investigação assume `anima` com `projectRoot()` **por padrão**, mas aceita um `resolveTarget` injetado (`work-orchestration/verifier-opinion.ts:74-75`).
7. A restrição `target_not_project_anima` pertence à **auto-aprovação** (`packages/core/src/work-orchestration/autonomous-authorization.ts:149`), não ao Single-Item (aprovação humana).
8. Existem mecanismos reutilizáveis: mapa referência→caminho absoluto validado (`ANIMA_LOCAL_TARGETS_JSON`, `work-orchestration/execution.ts:56-66`, hoje consumido pelo runner) e raiz de publicação separada (`ANIMA_INTEGRATION_REPO_ROOT`, `work-orchestration/integration-target.ts:45`).
9. A criação da worktree executa `git worktree add -b` **no repositório-alvo** (`work-orchestration/worktree.ts:360`) e a branch `anima-work/<attempt>` é preservada após remover a worktree (`work-orchestration/worktree-executor.ts:1013-1017`): a execução deixa metadados Git no alvo.
10. A RPC `create_work_proposal` valida `intent` como objeto JSON e o envelope da proposta, sem exigir `anima` (`supabase/migrations/20260714000001_protect_work_orchestration.sql:119-124`); isso mostra que a criação de um item é possível, não que a execução externa funcione.

**B. Confirmações parciais e refinamentos do Codex** (segundo agente, leitura estática; não reverificados além dos itens da seção A):

- Pressuposto "o alvo `anima` é fixo": **parcial.** A rota de worktree aceita qualquer referência de projeto não vazia (`executor-selection.ts:399`) e a liga ao `repoRoot` da rota; o risco é uma referência externa acabar executada no repositório do ANIMA se a raiz não for resolvida por target.
- Pressuposto "o SQL é agnóstico de target": **parcial.** Claim e ocupação tratam a referência como texto opaco (`supabase/migrations/20261008000000_single_item_work_claim.sql:37-48`; `autonomous-queue.ts`), o que sustenta reutilizar o SQL, mas **não prova** que nenhuma migration será necessária.
- Gaps adicionais apontados: referências diferentes podem apontar para o mesmo repositório físico e escapar da exclusividade por texto; o contexto e o SHA-base do planner são orientados ao ANIMA; a validação depende de scripts npm da allowlist e de dependências já presentes; o confinamento da worktree não é absoluto (scripts npm executam código do projeto).
- A readiness do Codex no Single-Item é condicional e exige transporte WSL (`work-orchestration/single-item-codex-readiness.ts:11-24`); o S1 não usa esse caminho.

**C. Hipóteses ainda não demonstradas:**

- A definição de trabalho acima (o termo não existe no repositório).
- Que o primeiro incremento caiba sem schema novo e sem executor novo.
- Equivalência de caminhos entre Windows e WSL para o alvo externo.
- Proteção contra remapeamento do target depois da aprovação.
- Que um repositório externo "confiável, já inicializado e com dependências" seja suficiente como primeiro alvo.

**Contrato preliminar do primeiro incremento (a validar antes de qualquer implementação):**

1. **Referência externa autorizada:** uma única referência de target explícita e previamente registrada; referência desconhecida é recusada **antes** do claim.
2. **Identidade física e caminho canônico:** a referência resolve para um caminho absoluto canônico; a identidade física do repositório (não apenas o texto da referência) é a chave de exclusividade.
3. **Aliases e remapeamento:** duas referências para o mesmo repositório físico são recusadas; mudar o caminho resolvido depois da aprovação invalida o item.
4. **Consistência de ponta a ponta:** o mesmo repositório resolvido serve ao SHA-base da proposta, à worktree, à execução, à evidência de git do host e ao Verifier.
5. **Falha antecipada** para target inválido, sem efeitos.
6. **Preservar** gates, allowlist de comandos, `safeJoin`, aprovação humana, Verifier obrigatório e fail-closed; nada de auto-aprovação externa, ampliação de comandos, instalação automática de dependências, roteador universal, provider real, publicação ou alteração de SQL neste incremento.

Critério de aceite proposto (também **a validar**): testes com **dois repositórios descartáveis** comprovando que SHA, branch e evidência ficam só no alvo correto, que referência inválida falha antes do claim, que gate/Verifier falho impede sucesso e que o workspace original permanece intacto.

## Limitações

- Prova de **continuidade de contexto**; não mede qualidade de código nem passa por Verifier, gates, claim ou ledger do ANIMA.
- O ledger do ai-memory guarda mensagens e argumentos de ferramentas **em texto claro**; o sanitizador é parcial. Nunca enviar segredos reais ao S1.
- A leitura dos agentes não é confinada por sandbox de escrita; por isso a investigação usou um snapshot sem `.env*`.
- Versões do Codex (alpha) e do Claude diferentes das da prova de 2026-10-03; contrato de hooks documentado só até o Codex 0.154.0.
- Consumo de cota de assinatura não mensurável; foram 9 execuções de modelo no S1 (2 na prova 1, 3 na prova 2, 4 na investigação).
- A causa de `Stop` não aparecer na interface do Codex é desconhecida.

## Invariantes e efeitos externos

- Preservados: aprovação humana, `authorized ≠ reserved ≠ settled`, `reachedReview ≠ verified`, ledger do ANIMA como fonte de verdade, nenhuma API paga, nenhuma credencial lida ou copiada.
- Estado ao final das provas: `dev` = `b40354f`, UX I2 (`34ccf85`) isolado e não integrado, `git status` do checkout principal idêntico ao inicial, configurações globais de Claude e Codex sem alteração (o `~/.claude.json` é regravado pelo próprio app em execução), laboratório do operador de 2026-10-03 intacto, servidor do S1 encerrado.
- **Não realizados:** instalação ou atualização de software, hooks ou MCP globais, alteração do Codex WSL/L1, attempts, work items, migrations, compute pago, integração e push.

## Fronteiras humanas e próximo ponto de retomada

- Revisão humana e integração governada (`ff_only`) deste registro: ato humano separado.
- Decisão humana ainda aberta: se e quando abrir um incremento do primeiro target externo (seção "Contrato preliminar"), cujo contrato acima é preliminar.
- Pendente no S1: determinar por que `Stop` não é exibido pelo Codex 0.163 e, se for útil, repetir um handoff em sessão real.

# Coding Harness V3 — SEARCH host-side + READ amplo / WRITE estreito (2ª fatia)

Data: 2026-09-14
Objetivo: dar ao runtime NATIVO (Ollama/OpenAI) a capacidade de INVESTIGAR amplamente
(search/glob/read em todo o workspace) sem receber autoridade ampla de ESCRITA, provando
"o agente explora livre, mas só escreve onde foi autorizado". Sem compute pago, sem RunPod,
sem settlement, sem shell/git/test pelo coder (próximo marco).

## Estado reconciliado

- Branch `dev`; HEAD `b14a32c` (inalterado, nenhum commit); `origin/main` `99bec54` INTACTA.
- Continua sobre o WIP amplo preexistente + a 1ª fatia V3 (ambos preservados, não commitados).
- Achado-chave (código real): `readWorkspaceFile` já lê QUALQUER caminho safeJoin-válido sob a
  raiz — só o `allowed` set do protocolo (derivado de `includedScope`) restringia leitura. Logo
  a separação READ/WRITE é limpa: manter validação de ESCRITA exata e ampliar a de LEITURA.

## Mudança implementada (evolução incremental)

- **Core puro** `workspace-access-policy.ts` (`WorkspaceAccessPolicyV1`: writeScope exato,
  readScope workspace|paths sempre ⊇ write, excluded; `isPathReadable/Writable/Excluded`;
  `resolveWorkspaceAccessPolicy`, `supervisedWorkspaceAccessPolicy`,
  `workspaceAccessPolicyFromIncludedScope`). Exportado do índice do core.
- **Protocolo** (`ollama-protocol.ts`): `resolveScopedPath`/`parseReadRequests` passam a
  aceitar um `PathMembership` (Set OU predicado da política); novas ações `search`/`glob`
  em `parseProtocolResponse`; `parseSearchRequest`/`parseGlobRequest` com clamps
  (`MAX_SEARCH_RESULTS=50`, `MAX_GLOB_RESULTS=100`) — cap de VOLUME, não terminal.
- **Laço** (`ollama-coder.ts`): resolve `WorkspaceAccessPolicy` (política explícita ou
  fallback includedScope); ESCRITA = Set(writeScope), LEITURA = membership da política;
  READ carrega conteúdo SOB DEMANDA (lazy) para caminhos fora do write scope; trata
  `search`/`glob` chamando `workspace.search`/`list`, filtrando cada resultado por
  `isPathReadable` (nunca vaza excluído/traversal/fora); `SEARCH_SYSTEM` anexado ao system
  só quando o workspace oferece busca (retrocompat); header distingue escopo de ESCRITA e
  de LEITURA; budget line vira "rodadas de investigação".
- **Contrato** (`coder-backend.ts`): `CoderWorkspace.search?`/`list?` opcionais;
  `CoderEditRequest.workspaceAccessPolicy?`; tipos de busca/listagem.
- **Worktree** (`worktree.ts`): `GitWorktree.searchText` (git grep) e `listFiles`
  (git ls-files), host-executados, confinados a arquivos rastreados sob a raiz, bounded,
  canceláveis, pathspec `:(glob)`.
- **Executor** (`worktree-executor.ts`): liga `workspace.search`/`list` à worktree e injeta
  `supervisedWorkspaceAccessPolicy(includedScope, excludedScope)` (READ workspace / WRITE
  Work Item) — wiring vivo mínimo do Governor. Enforcement de escrita pós-edição via git
  observado permanece = includedScope.
- **OpenAI** herda tudo (delega ao laço compartilhado) — model-agnostic por construção.

## Provas locais (determinístico, zero gasto)

- `packages/core`: 82 suites / 1671 testes PASS (inclui `workspace-access-policy` 6 e
  `agentic-runtime-policy` 5). `tsc --noEmit` do core: limpo.
- `apps/web` coder trio (`ollama-protocol`+`ollama-coder`+`gpt-coder`): 149 PASS. Novos casos
  agênticos: SEARCH fora do write scope → READ do achado → EDIT nele RECUSADO
  (`ollama_edit_outside_scope`); SEARCH→READ→EDIT no write scope; filtro de resultados ao
  read scope (excluído nunca vira match); traversal filtrado; SEARCH→GLOB→READ→READ→EDIT;
  truncamento explícito sem derrubar sessão; retrocompat sem capacidade de busca; paridade
  OpenAI (search host-side pelo transporte pago mockado).
- `apps/web` `worktree.test`: 50 PASS (novos: git grep acha símbolo com path/linha; sem
  ocorrência = vazio; glob lista rastreados; nunca retorna caminho fora da raiz; truncamento).
- Adjacentes: `worktree-executor`+`coder-backend`+`deepseek-harness*`: 5 suites / 91 PASS.

## Falhas de infra (separadas de falhas de código, per AGENTS.md)

- `tsc --noEmit` do `apps/web`: 15 erros, TODOS em 3 scripts one-off UNTRACKED do arco
  congelado (`scripts/confirm-correction-prepaid-readonly.ts`,
  `create-seq5-recovery-successor.ts`, `revoke-d05bcab0-authority.ts`) — WIP preexistente
  não tocado. Zero erros em qualquer arquivo desta fatia (verificado por filtro).

## Invariantes de segurança

- READ ≥ WRITE; ler não concede escrever; write fora do escopo = recusa
  (`ollama_edit_outside_scope`) + `contract_violation` pós-edição via git observado.
- Confinamento em 2 camadas: git grep/ls-files só veem rastreados sob a raiz; o laço filtra
  cada resultado por `isPathReadable` (traversal/absoluto/excluído fail-closed); `safeJoin`
  é a fronteira de FS dura na leitura lazy. Sensíveis (.env/.git/node_modules/keys) nunca
  aparecem. Sem shell do modelo. Sem RunPod/OpenAI paga/autoridade paga/merge/push/deploy.

## Docs

- `docs/arquitetura/coding-harness-v3-agentic-runtime.md`: tabela de capacidades atualizada,
  roadmap marcado (SEARCH + read/write DONE), nova §7 (READ/WRITE distintas + SEARCH host-side).

## Próximo ponto de retomada

- Próximo marco: SHELL/TEST/GIT governados pelo coder (comandos host-executados sob
  command/network policy — npm test/typecheck, git status/diff, allowlist), com o DeepSeek
  Harness (`pwsh`) como referência comportamental. Perfis supervised×autonomous vivos no
  Governor. Settlement B1/B2/B3 segue CONGELADO como benchmark (base `ccb7dcc`, ref `0bea4c8`).

# 060 — Integridade de evidência: vínculo por árvore Git (tree binding) e `outputTail` sanitizado (PROPOSTA; nada executado)

Status: planejamento (2026-10-14). Base real: `dev` = `origin/dev` = `64270c81` (Verifier `work-verifier-v5`; prova E2E de `test_binding` `42053b69` publicada). Sequência do [plano 058](058-verifier-v4-i2-test-binding.md). Somente leitura + proposta `PROPOSED`.

## 1. Lacunas atuais (fatos inspecionados)
1. **Vínculo teste↔revisão fraco.** `evaluateBinding` (Core) compara o CONJUNTO de caminhos de `changeAuthorization.changedFiles` (gate) com os arquivos do git observado. Dois conteúdos diferentes nos mesmos arquivos passam. O diff completo existe (`GitWorktree.diff()` = `git diff --cached --no-color <base>`), mas o executor só hasha o diff no caminho de reparo (`diffSha256`, `worktree-executor.ts` ~l.594/902) e nunca o persiste na evidência.
2. **Momento do gate.** Os gates rodam no estado STAGED mas AINDA NÃO COMMITADO (`stageAll` → `changedFiles…` → `runGate`); o commit final (`worktree.commit` = `add -A` + `commit`) vem DEPOIS de todos os gates. Logo, qualquer arquivo criado/alterado pelo próprio teste (ex.: snapshot, artefato não ignorado) entra no commit e nenhuma evidência detecta.
3. **Causa de falha de gate não persistida.** `runGate` devolve stdout/stderr (capturados até `MAX_CAPTURE`), mas só o `summarizeGateFailureForRetry` (700 chars, 8 linhas) vai ao prompt de reparo; a evidência persiste só `exitCode/duration/timedOut/cancelled` (caso `582b1f22` e o I2b `d50d8744`: causa só reconstruída por reprodução manual).
4. **Git observado independente** (`observeHostGitEvidence`, `host-evidence.ts`) lê a branch DEPOIS (`rev-parse`, `diff --name-only/--numstat`), sem escrever. Não registra a árvore.
5. **SQL**: `private.is_valid_host_gate_evidence/outcomes` e `is_valid_host_observed_evidence` validam só campos conhecidos e TOLERAM chaves extras; não há limite de bytes na RPC além do tipo jsonb. **Nenhuma migration é necessária** para campos aditivos opcionais (parser do Core é a autoridade de leitura; `guardCanonicalResidentWrite` reprojeta via `projectHostObserved*Evidence`).

## 2. Desenho da cadeia de evidência
### 2.1 Vínculo por árvore Git (substitui “nomes de arquivos” como prova de revisão)
- **Primitiva**: `git write-tree` do índice (após `add -A`) = SHA da ÁRVORE do estado exato. Determinística, cobre conteúdo/modo/caminhos, independe do texto do diff; escreve só objetos (sem ref/commit). O commit candidato tem `commit^{tree}` observável sem escrita (`git rev-parse <branch>^{tree}`).
- **Quando coletar (executor, por gate de TODO tipo, não só `test_binding`)**: `treeBefore` = write-tree logo ANTES de `runGate` (após `stageAll`); `treeAfter` = write-tree logo DEPOIS (após `stageAll`). Persistir `gate.worktreeTree = { before, after }` (40 hex minúsculos; omitidos se `git` falhar).
- **Git observado**: acrescentar `observedTreeSha` (= `rev-parse <branch>^{tree}`) a `HostObservedGitEvidenceV1` (aditivo, opcional, 40 hex).
- **Regras do Verifier (v6)**, aplicadas ao critério `test_binding` (condição (b) “vínculo com a revisão”), após as verificações de correlação já existentes:
  1. `before !== after` ⇒ **lacuna** `test_report_tree_mutated` (o próprio gate alterou a árvore; fail-closed, nunca verified; não é violação porque pode ser snapshot legítimo).
  2. `after !== observedTreeSha` ⇒ **violação** `test_report_revision_mismatch` (o relatório é de OUTRO conteúdo que o commit; contradição de fato independente).
  3. Campos `worktreeTree` OU `observedTreeSha` ausentes ⇒ **caminho legado** (igualdade de conjuntos de arquivos, comportamento v5 intacto). Isso preserva o replay histórico (inclusive o `42053b69`, que segue `verified`). O endurecimento (tree obrigatório) fica para uma versão futura do contrato (`acceptance_contract:3`), com mandato próprio.
  4. Adulteração: se `worktreeTree`/`observedTreeSha` forem inválidos o parser os OMITE (cai no legado) — por isso o Verifier só aceita o legado quando AMBOS estão ausentes na evidência persistida; um dos dois presente e o outro ausente ⇒ lacuna `test_report_tree_unbound`.
- **Detecção de alteração entre teste e checkpoint**: `after !== observedTreeSha` cobre qualquer mudança entre o fim do gate e o commit (inclui reparo posterior, formatação, artefato). Gates terminais por rótulo seguem `terminalObservedGates` (a última execução do gate).
- **Baseline** (item posterior): `baseline.worktreeTree` = write-tree do estado restaurado ao `base_sha`; Verifier compara com `baseSha^{tree}` (git observado, `rev-parse baseSha^{tree}`) para provar que o baseline rodou sobre a base.

### 2.2 `outputTail` sanitizado
- **Campo**: `gate.outputTail?: { text: string; truncated: boolean }` (aditivo; sem `outputTail` = evidência idêntica).
- **Quando**: SEMPRE para gate `failed`, `timedOut` ou `cancelled`; NUNCA para gate `passed` (retenção mínima).
- **Produção (Host)**: `sanitizeStream(stdout+'\n'+stderr, 4096, 60)` + `redactSecrets` com `redactPaths=true` (régua única existente em `output-sanitization.ts`), tail (últimas linhas), sem ANSI. O Host decide o que persiste; o Core nunca vê stdout bruto.
- **Validação (Core, defesa em profundidade)**: `text` string, ≤ 4096 chars, ≤ 60 linhas, sem caracteres de controle exceto `\n`/`\t`, sem padrões de credencial (`sk-…`, `Bearer …`, JWT `eyJ…`, `-----BEGIN`, `(password|secret|token|api[_-]?key)\s*[:=]`) ⇒ se qualquer regra falha, o `outputTail` INTEIRO é omitido (nunca parcial). Teto de bytes por evidência (todos os `outputTail` somados ≤ 32 KB); excedente é omitido do fim (gates posteriores).
- **Retenção**: o ledger é append-only; a retenção é a da própria evidência de gate. Mitigação: só falhas, 4 KB/gate, 32 KB/evidência, caminhos redigidos. Não há stdout bruto em nenhum lugar. Sem migration, sem expurgo (ver §5 alternativa).
- **Consumo**: apenas diagnóstico humano (CLI `work evidence`/`work show`, item posterior) — NUNCA entra em decisão do Verifier (não é prova).

### 2.3 Fail-closed e legado
Ausente/truncado/inválido ⇒ omitido ⇒ a regra de prova que dependeria dele cai em lacuna (tree) ou simplesmente falta diagnóstico (outputTail). Nenhum campo novo é obrigatório; nenhum parecer histórico muda (replay 0 deriva esperado; `VERIFIER_VERSION` → `work-verifier-v6` porque o veredito de evidência NOVA pode mudar; parser aceita v1..v6).

## 3. Decomposição (um por vez; Core nunca junto de consumidor nativo)
| Item | Escopo | Dep. |
|---|---|---|
| **I3a Core** | `host-observed-evidence.ts` (`observedTreeSha`), `host-observed-gate-evidence.ts` (`worktreeTree`, `outputTail` + limites/validação/parse), `work-verification.ts` (regras tree), `verifier-opinion.ts` (v6) + testes + teste NOVO `evidence-tree-binding.test.ts` (**segundo `test_binding` real**) | — |
| I3b Host | `worktree.ts` (`stagedTreeSha()`), `worktree-executor.ts` (tree before/after por gate; `outputTail` de gate falho/timeout via `sanitizeStream`), `host-evidence.ts` (`observedTreeSha`) + testes | I3a integrado e sincronizado |
| I3c CLI | `cli/{app,render}.ts`: exibir `outputTail`, tree e novos códigos em `work evidence` | I3a/I3b |
| I3d (futuro) | `baseline.worktreeTree` vs `baseSha^{tree}`; `acceptance_contract:3` (tree obrigatório) | I3b + 1 prova real |
Prova E2E posterior: item pequeno com `test_binding` e evidência com tree; negativos: teste altera a árvore (lacuna), arquivo muda após o gate (violação), tail com falha real.

## 4. Testes necessários (I3a)
Parser/builder: `observedTreeSha` válido/ inválido(omitido)/ausente idêntico; `worktreeTree` idem; `outputTail` válido, >4096, >60 linhas, controle, cada padrão de credencial, soma >32 KB, gate passed com tail (omitido), round-trip `build→parse→guard`. Verifier: tree igual ⇒ segue como hoje; `before≠after` ⇒ `test_report_tree_mutated`; `after≠observed` ⇒ violação `test_report_revision_mismatch`; só um dos lados ⇒ `test_report_tree_unbound`; ambos ausentes ⇒ legado (idêntico a v5); `human_review`/`gate_assertion` inalterados; `outputTail` nunca altera veredito. Replay: 158+ itens, 0 deriva.

## 5. Migration? — Não necessária
Justificativa: SQL tolera chaves extras e a autoridade de leitura/validação é o parser do Core (já usado pelo guard canônico). Alternativa **com** migration (NÃO recomendada agora): endurecer `is_valid_host_gate_outcomes` para validar formato de `worktreeTree`/limites de `outputTail` no servidor (defesa adicional contra escritor host comprometido) — exige migration + typegen + checkpoint humano; adiável para o endurecimento E1/E2 do plano 059.

## 6. Riscos
`git write-tree` por gate: custo pequeno (índice já staged), mas escreve objetos soltos (gc normal). Gates cujo comando altera legitimamente a árvore (snapshots) viram lacuna, não violação. `host-observed-gate-evidence.ts` tem 1 NUL preexistente e fim de linha misto: editar por patches pontuais (como no I2a/I2c). Tail pode conter trechos de código/mensagens de teste: aceito com limites e redaction. O vínculo por árvore prova “mesmo conteúdo do commit”, não “código correto”: a adequação semântica continua com `test_binding`/`human_review`.

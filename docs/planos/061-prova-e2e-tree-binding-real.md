# 061 — Primeira prova E2E de tree-binding com árvores reais (PROPOSTA; nada executado)

Status: planejamento (2026-10-14). Base: `dev` = `origin/dev` = `4060390b` (I3a Core + I3b Host integrados e publicados; Verifier `work-verifier-v6`). Sequência do [plano 060](060-integridade-de-evidencia-tree-binding-e-output-tail.md).

## 1. Objetivo
Produzir, por uma attempt governada real, evidência persistida com `gate.worktreeTree {before, after}` (host), `observedTreeSha` (git observado independente) e `testReport` do mesmo gate, e obter parecer `verified` do Verifier v6 usando a regra de árvore (e não o caminho legado). Todas as evidências anteriores (42053b69, I3a, I3b) têm árvore ausente (caminho legado).

## 2. Verificações de viabilidade (código real em `dev`)
1. **Quem produz o quê, quando.** O executor roda os gates com o índice staged e NÃO commitado: `stagedTreeSha()` (stageAll + `write-tree`) imediatamente antes e depois de `runGate`/captura Jest, e passa `worktreeTree` em `onGateObserved` junto de `testReport`/`outputTail`. O commit candidato é feito DEPOIS de todos os gates (`worktree.commit` = `add -A` + `commit`). O git observado (`observeHostGitEvidence`, pós-fato, somente leitura) grava `observedTreeSha = rev-parse <branch>^{tree}`. O Verifier compara `gate.worktreeTree.after` (gate terminal do critério `test_binding`, por rótulo) com `observedTreeSha`.
2. **Correlação ao gate certo.** `terminalGates` é por rótulo; o relatório, as árvores e o exit code vêm do MESMO objeto de gate (`onGateObserved` → `buildHostObservedGateEvidence`), portanto a associação teste↔árvore não depende de nome de arquivo. O vínculo com o commit é `after == observedTreeSha`.
3. **Fragilidade de ordem (verificada).** A árvore é medida por gate. Se um gate POSTERIOR ao `test_binding` deixasse arquivos não ignorados, o commit teria árvore diferente do `after` do gate de testes e o Verifier acusaria `test_report_revision_mismatch` (violação). Nos gates do repositório isso não ocorre: `.gitignore` cobre `node_modules/`, `.next/`, `dist/`, `out/`, `build/`, `*.tsbuildinfo`, `*.log`; em todas as attempts V1 anteriores `observedChangedFiles` == arquivos do contrato. Regra de contrato para a prova: o gate `test_binding` deve ser o ÚLTIMO gate que escreve em disco (ou todos os gates posteriores devem ser somente-leitura/ignorados). Na prova, os gates seguintes são typecheck e a suíte core (somente leitura).
4. **Jest/relatório.** `--outputFile` vai a tmp do host (fora da worktree), logo não polui a árvore. Nomes de teste devem ser únicos e sem termos sensíveis (senão o relatório é omitido pelo Core).
5. **Sem migration.** SQL tolera os campos; `guardCanonicalResidentWrite` os preserva (testado no I3a).
6. **Replay.** Itens históricos sem árvore seguem o caminho legado; 0 deriva (medido em 162 itens).

## 3. Escolha do objetivo
Menor trabalho real e pendente no HEAD, Core puro, com teste novo de nomes únicos: em `evaluateBinding` (`work-verification.ts`) o acesso `files.find(file => file!.path === bound.file)!.tests` lança `TypeError` se um critério montado à mão tiver `boundTests[].file` fora de `binding.testFiles` (o parser nunca produz isso, mas a função é exportada via `verifyWorkResult`). Correção: busca segura que resolve para `test_binding_unmet` (lacuna, fail-closed). Comportamento para specs vindos do parser: inalterado (replay 0 deriva; sem bump de versão).

## 4. Contrato (item PROPOSED `E2E-1`)
Escopo: `packages/core/src/work-orchestration/work-verification.ts` + arquivo NOVO `evaluate-binding-spec-guard.test.ts`. Gates na ordem: (1) `test_binding` com `target_paths`=`binding.test_files`=[arquivo novo], `min_new_tests 4`; (2) focados do Core `work-orchestration/work-verification`; (3) typecheck do Core; (4) suíte core; (5) escopo. Todos os gates após (1) são somente-leitura.

## 5. Resultado esperado e negativos
Positivo: evidência 86xxx com `worktreeTree.before == after`, `observedTreeSha == after`, `testReport` 4+ testes passed e parecer `verified` (v6) com `test_binding_satisfied` independent e, pela primeira vez, caminho de árvore exercitado.
Negativos, sobre a evidência REAL persistida, em memória (sem nova attempt): `after` adulterado ⇒ violação `test_report_revision_mismatch`; `before != after` ⇒ lacuna `test_report_tree_mutated`; só um lado ⇒ lacuna `test_report_tree_unbound`; relatório removido ⇒ `test_report_missing`. Negativo REAL opcional (item posterior): contrato cujo teste escreve um arquivo não ignorado na raiz ⇒ `before != after` real.
Falha real de gate (para `outputTail` real) NÃO é provocada de propósito; se ocorrer, o tail é inspecionado.

## 6. Riscos
Uma attempt, sem retry; lease E0 (cota 24 h); flake de carga nos gates; 11+ attempts nas últimas 24 h; o terminal de typecheck core é rápido, mas a suíte core roda ~28 s. Se `observedTreeSha` não for persistido (git falhar) a prova cai no caminho legado: registrar como impedimento, não forçar.

# 2026-10-13 — Verifier v4 I1: recuperação governada e decomposição Core → CLI

Branch dev, HEAD `1a18fc8e` inicial e final. Sem aprovação, classificação, execução, commit, push, migration, Host, integração ou alteração de itens existentes.

## Diagnóstico de recovery para o caso (item `bc27103e` FAILED, candidato correto, falha de ambiente)
- `work recover-candidate` (`candidate-recovery.ts`): só para `production_candidate_incorrect` (defeito real do código; exige gate/local/erro observado) e o successor RETOMA o checkpoint
  (`resume_from_checkpoint`, ver `apps/web/lib/work-orchestration/candidate-recovery.ts`) ⇒ recusado pelo Single-Item V1 (`single_item_resumption_unproved`). Além disso o candidato NÃO tem defeito: usá-lo exigiria diagnóstico falso.
- `authorize_harness_fix_recovery` (`harness-recovery.ts`): successor com a MESMA proposta e `max_attempts=1` após defeito de harness JÁ CORRIGIDO (exige `fixCommits`); aqui o harness não foi corrigido e a mesma proposta (core+CLI) falharia de novo.
- `recovery-decision`: falha `[gate_failed]` não retryable ⇒ `human_required`/`failure_not_classified`. `authorize-resume`: +1 tentativa do mesmo item, que o V1 recusa (`execution_started` no histórico).
- Conclusão: NÃO existe caminho oficial suportado para reaproveitar o checkpoint como BASE em Single-Item V1. Reaproveitável apenas como EVIDÊNCIA e referência de leitura. Escolha: decomposição independente sobre HEAD.

## Independência Core→CLI provada (worktree temporária minha, removida; junções desfeitas antes; node_modules principal 742 intacto; 46 worktrees)
HEAD `1a18fc8e` + SOMENTE os 9 arquivos core do checkpoint: core `tsc` limpo; core jest 119 suítes/2648 PASS; web `tsc` 0 erros; web jest `cli` + `lib/work-orchestration`: 118 suítes OK;
5 suítes falharam sob carga (timeouts/git real) e passaram isoladas (23/23 e 164/164; as duas de provisionamento/preparação também passam na base) ⇒ flakes de carga conhecidos, não regressão.
Logo o I1a (core) é entregável sem o CLI e sem quebrar o web.

## Itens
- **I1a** `8e24f4a8-b715-44cd-a9f0-e712c3f938b2` v1, **proposed** (`work_proposed` via mesma via do precedente), base `1a18fc8e95bb3327252bb0861e701081ddd693cd`, `acceptance_contract:2`,
  9 arquivos core (2 novos), 1 tentativa/40 min, codex-cli/default via WSL, sem `resume_from_checkpoint`; `historical_references` (reference_only, `checkpoint_reused:false`) para `bc27103e`/`410523ee`/`84b34ece`.
  Gates: testes focados do core, typecheck do core, suíte completa do core (todos `gate_assertion` com texto canônico) + scope. Lint existente: 0 lacunas; `singleItemContractRefusal`=null; Codex WSL readiness=null.
  Restrição de harness no objetivo: nenhum teste com processo filho, nenhum arquivo de apps/web. Checkpoint só leitura (proibido cherry-pick/apply/checkout).
- **I1b**: NÃO criado (depende de I1a integrado e sincronizado em dev). Especificação: `docs/planos/057-verifier-v4-i1b-apresentacao-cli-especificacao.md`.

## Próximo mandato
Classificar (humana) e aprovar `8e24f4a8`, preflight, UMA attempt; revisão independente + replay (script `scratchpad/i1/replay.mjs`) + aceite humano; integração em clone dedicado + sync; só então criar/aprovar/executar I1b.

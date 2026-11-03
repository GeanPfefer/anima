# 2026-10-13 — Verifier v4 I1a (Core): attempt `345dc9a4` do item `8e24f4a8` — verified, em review

Branch dev, HEAD `1a18fc8e` inicial e final. Sem commit, push, migration, Host contínuo, retry, recovery, integração ou API paga. Continua [bc27103e](2026-10-13-verifier-v4-i1-attempt-bc27103e.md) e [a decomposição](2026-10-13-verifier-v4-i1-recuperacao-decomposicao.md).

## Retomada e preflight
Primeira consulta (17:40 local) `readResourceAdmission()` = `defer`/`resource_pressure` (RAM 2–3,7 GB): nada feito. Após liberar RAM (4,9 GB, 31%): `permit`/`host_ready`.
Revalidado: HEAD==origin/dev==base; 9 arquivos do escopo limpos; item `proposed` v1 sem attempts; ledger 156; 0 claims válidas; sem codex/node; orçamento admitido (item 0/1; autônomo 60 min = 2700 s); contrato persistido == `command_a.json` (semântico), sem `resume_from_checkpoint`, elegibilidade sem lacunas, `singleItemContractRefusal`/readiness Codex WSL = null.
Governança: `work_approved` 86415; classificação humana 86416 (bounded/low/reversible/clear/normal, RPC; a RPC exige aprovação antes).

## Attempt única `345dc9a4-1a45-451d-b360-1a6d91b8f4a9`
21:03:54Z–21:10:06Z (6 min 12 s; Codex WSL 315 s), `execution_completed`. Eventos 86417–86428. Claim `739a9bc7` liberada `attempt_finished`. Item **`review` v1**.
Gates do host (todos passed): testes focados do core 15,1 s; typecheck core 4,8 s; suíte completa do core 29,4 s. Verifier (host, código de HEAD = v3): **verified**, 14 checagens, 0 lacunas, 0 violações, 5 independentes; 4 aceites cobertos (3 gate_assertion + escopo).
Checkpoint `1f4b052eee6db8eaef2cff11a2b5566a01e5182c` (filho único de `1a18fc8e`, ff) na branch `anima-work/345dc9a4-1a45-451d-b360-1a6d91b8f4a9`: 9 arquivos core, +252/−10, exatamente o escopo (2 novos). NÃO integrado.

## Revisão independente (worktree temporária minha no checkpoint, `@anima/*` apontando para ela; removida, 746 junções desfeitas por Directory.Delete, node_modules principal 742 intacto, 46 worktrees)
- core `tsc` limpo; core jest 119 suítes/**2643** PASS; web `tsc` 0 erros; web jest `cli` 15 suítes/294 PASS (inclui processos filhos nativos, agora com o novo core resolvido).
- **Replay histórico** (código base v3 × candidato v4 sobre 154 itens, 48 pareceres recomputáveis): **0 deriva** em veredito/achados/contagens; `humanReview` vazio em todos; `d795e414` segue `rejected`; histórico v3 persistido legível; o parecer do próprio I1a recomputa `verified` em v4.
- Diff revisado: lint com 7 códigos; `human_review` nunca vira covered; `no_automated_acceptance_proof` só com `human_review` declarado e nenhum aceite automático (também sem handoff); marcador só `2` (outro valor => spec inválido); covers repetido só tolerado no parser com marcador 2; `VERIFIER_VERSION=work-verifier-v4`; `humanReview` opcional fail-closed; legado idêntico.
- Sonda: o contrato REAL do `d795e414` sob o lint acusa `covers_unknown_acceptance`, 3× `acceptance_without_possible_proof` e `no_automated_proof` (com marcador 2 seria inelegível: 5 lacunas `acceptance_contract_invalid`); legado continua elegível; o contrato do I1a é v2 sem achados; fixture {gate_assertion + human_review} sem achados; só human_review => `no_automated_proof`.
- Observações: `human_review_pending` usa a proveniência padrão do helper `ok` (attested, conferido no código); a gap explanation cita código e subject; duplicatas em acceptanceCriteria geram achados repetidos mas `pending` é deduplicado.

## Estado final
Item `review`; claim liberada; 0 claims válidas; max seq 86428; ledger 156; HEAD/status Git inalterados (+4 docs untracked); sem codex/node. Próximo (ato humano): `work accept 8e24f4a8` (decisão {type:'accept'}, justificativa só em registro) → integração governada em clone dedicado (ff_only) → sync local → só então criar/aprovar/executar I1b (plano 057).

# Evolution pós-Akita — Codex governado

- Data: 2026-10-03. Tipo: desenvolvimento / reconciliação de prova relatada pelo humano.
- Branch: `codex/evolution-ux-v2`; worktree `G:/anima/.worktrees/evolution-ux-v2`.
- HEAD inicial: `81872b9343d791d43f2ca431c88685c1f36ddcef` (igual ao remoto inicial).
- Base remota inicial após fetch: `f518d0d6bad60ebe8f301bfcfeca21b2ee42b2cb`.
- Base final confirmada por segundo fetch e `git ls-remote`: `83f7fd24c0c3d8a9ab4f9a3dd89b26d9b9c2edfd`.
- Reconciliações: `3640986` incorporou o fix CLI de dev; `f0b36d6` preservou AKT-03 já integrado por outro fluxo.
- HEAD final: commit desta entrega (localizável por `git log -- this-file`); nenhum commit final presume o próprio hash.
- Mandato: atualizar apenas Evolution; [Plano 009](../planos/009-evolution-ux-v2-akita-baseline.md), [PRD](../../anima-prd.md), [Proof Engine](../arquitetura/capability-proof-engine.md).

## Proveniência e estado confirmado

Provas técnicas Codex/Claude e cross-harness: registros históricos de 2026-10-02,
preservados. Mesmo workstream, sessões nativas distintas, delta incremental e sem
contexto manual são fatos do relato humano cross-harness; nenhum ledger/transcript
ou secret foi copiado. Não inferir modelo efetivo a partir do nome do executor.

AKT-03: work item `b00e6a38-18e3-4770-a2e5-553827d28b54`, attempt
`51eb070d-9880-493d-a7d4-b2fab28bd60b`, candidato
`83f7fd24c0c3d8a9ab4f9a3dd89b26d9b9c2edfd`. Fonte do lifecycle: relato explícito
humano nesta tarefa, não nova leitura do banco. Cadeia relatada: canonical backlog,
approval, classification canonical_backlog_v1, routing/claim, Codex CLI real, diff,
scope/gate, checkpoint/handoff, host_observed_coder_evidence_recorded, git/gate evidence,
Verifier verified, mandated release, review, HUMAN ACCEPTED, completed.

**Verifier machine-proven = scope + gate.** Human review confirmou **5=>Despertar,
30=>Expansão e preservação dos casos**. Sem atribuir ao Verifier essa validação de produto.

A primeira fotografia tinha dev em f518d0d e candidato fora de dev. Durante a sessão,
as referências compartilhadas avançaram; novo fetch e consulta direta do remoto
confirmaram dev no próprio candidato 83f7fd2. Estado final representado: **integrated**.
Esta sessão não integrou nem publicou o candidato em dev; apenas preservou a integração
remota já existente na reconciliação da Evolution. main permaneceu `99bec54e3ab42bfe882a8686cd1385d8058b916e`.

AKT-01 = FAIL pré-inferência, erro operacional no path, Codex não executou.
AKT-02 = executor/gate/scope PASS, Verifier verified, control-plane BLOCKED por falta
 de host_observed_coder_evidence_recorded; cancelamento humano só para liberar target.
Fix f518d0d: observation remote + nodeId null nos CLIs nativos removida, sem inventar nó.
Confirmação de código: commit de dev, incorporado intacto. AKT-01/02 aparecem como
história diagnóstica, nunca como sucesso governado.

## Mudanças e invariantes

`Capability.deliveryEvidence` é fotografia editorial tipada: technical, governed,
Verifier, human review e candidate integration separados de maturity/reuse/direction.
Referências duráveis record/work_item/attempt/commit; sem IDs de parecer/eventos inventados.
O motor não consome esses campos para promoção. Codex/Claude/ai-memory e baseline seguem
projected, sem regra específica (not_evaluated). Nenhuma authority nova.

Akita COMPLETE significa executores Codex/Claude + cross-harness; foco agora em usar
native coding agents no self-development governado. Claude governado e ai-memory
cross-attempt governado continuam NOT YET DEMONSTRATED. NEXT/LATER/experimental/parked
sob detalhes; histórico sob seleção. Badges distinguem prova, review e integração.

Sem edição própria de backend, governança, Supabase ou checkout principal. Sem migrations,
banco, providers, secrets, integração de candidato, merge/push dev, deploy ou PR.
`.tmp/` anterior e WIPs externos preservados; arquivos novos de preview com nomes próprios.
Nenhum conflito documental ou de código nas reconciliações.

## Gates e visual

- Core relevante (registry/map/proof evaluation/levels): 116/116 PASS, 4 suítes.
- Evolution UI: 41/41 PASS.
- Typecheck de todos os workspaces e build web: resultados finais registrados abaixo.
- diff --check: PASS.
- Expectativas antigas CURRENT FOCUS/NEXT foram ajustadas à nova direção; falhas intermediárias
  de expectativa resolvidas, sem flake observado.
- Build avisa múltiplos lockfiles/root inferido; não é falha de código.
- Preview SSR estático com CSS real, Chromium: 1440x1000 e 390x844, geral e Codex selecionado.
  `.tmp/evolution-post-akita-{desktop,mobile}.png` e
  `.tmp/evolution-post-akita-codex-{desktop,mobile}.png`.
  Sem login/dados vivos; interatividade coberta pelos testes React, não por esse preview.

## Retomada e efeitos externos

Push autorizado exclusivamente `origin/codex/evolution-ux-v2` após gates; status final abaixo.
Revisão/integração da Evolution em dev permanece decisão humana. Próximo ponto: revisar o
painel e planejar prova governada Claude em unidade separada; não reutilizar a prova Codex
para conceder governança ao Claude ou autonomia ao sistema. Revalidar candidato contra
remoto em uma próxima reconciliação, sem tratar a fotografia como monitoramento vivo.

Gates finais: typecheck completo PASS; typecheck web após ajuste de disclosure PASS; build final PASS (68 páginas); diff --check PASS. Screenshots finais regeneradas após recolher histórico; inspeção visual sem overflow de badges observado. Nenhum blocker.

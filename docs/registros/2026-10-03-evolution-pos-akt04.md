# Evolution — reconciliação final pós AKT-04

Data: 2026-10-03. Tipo: desenvolvimento e reconciliação factual.

## Objetivo e proveniência

Mandato humano: reconciliar `codex/evolution-ux-v2` com origin/dev c536eff,
registrar AKT-04 e publicar apenas a branch Evolution. HEAD inicial:
2af19a3. Merge de base: 16bc1a3 (somente packages/core/src/xp.test.ts).
HEAD final: commit que contém este registro, recuperável por `git log -- this-file`.
Plano: [009](../planos/009-evolution-ux-v2-akita-baseline.md); estado vivo: PRD.

AKT-04 relatado pelo humano: Claude Code real; primeira prova GOVERNADA no
control plane (já possuía technical live proof). Work item
4617e72c-a184-4bc4-b3c6-b01bb27fc54d; única attempt
3d054e1a-0524-4e74-b4e8-6968fbeb023b. Novo xp.test.ts, gate red→green,
coder evidence presente, git/gate evidence presentes, Verifier verified,
mandated release, HUMAN ACCEPTED e completed. Candidate/integrated commit:
c536efff3d4d214c289afa1c352464cfbc66f2c5. Fetch confirmou esse SHA em origin/dev;
o merge contém o teste. Não houve consulta ou alteração de Supabase nesta sessão.

## Mudanças e decisões

História recebe evento aditivo AKT-04; os 44 anteriores permanecem, total 45.
03 OUT destaca Claude AKT-04 e Codex AKT-03, mantendo ordem canônica e disclosure
“Estado naquele momento · relato e refs”. Claude recebe deliveryEvidence governada,
Verifier/aceite/candidate integrado; Projetada preservada e achievement em uso.
Foco: usar Codex e Claude como executores governados reais do self-development.
Lacuna: accepted result → integração Git governada. AKT-03/04 foram integrados
manualmente; ff_only/F0-F3 são proposta em auditoria, sem implementação.

## Gates e limites

Core completo inicial: 111 suítes verdes, duas expectativas desatualizadas em
capability-registry (Claude NEXT). Corrigidas; core focal registry/map/xp: 3 suítes,
76 testes PASS; demais 111 suítes já verdes, incluindo Proof Engine.
UI EvolutionClient: 44 testes; apresentação de história: 2 testes.
Expectativas antigas de NEXT/prova pendente e abertura do primeiro evento foram
atualizadas para AKT-04 e seleção explícita do evento Codex. Sem bug de produção.
Typecheck dos quatro workspaces, build (68 páginas) e diff-check PASS.
Build mantém aviso preexistente de múltiplos lockfiles na worktree.
Uma seleção inicial por “evolution” incluiu toda a web pelo nome da worktree;
interrompida e substituída pelas suítes focais. Não é gate completo web.

## Invariantes, efeitos e retomada

UX/layout/CSS, Proof Engine, maturity, authority, governança, backends e Supabase
intactos. Sem migrations, novas attempts, inferência ou compute pago.
WIPs do checkout principal dev e .tmp da Evolution preservados e não incluídos.
Push autorizado exclusivamente para origin/codex/evolution-ux-v2; nenhum merge
em dev/main, PR ou deploy. O fetch fixou dev em c536eff; nenhum WIP externo absorvido.
Próxima retomada: revisar a branch publicada; integração com dev depende de outro
mandato. Investigar a lacuna de integração governada em tarefa própria, sem tratar
ff_only/F0-F3 ou continuidade/recovery governados como implementados.

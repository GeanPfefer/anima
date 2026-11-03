# Evolution UX I1 — resgate histórico e direção atual — 2026-11-03

Append-only. Tipo: **implementação seletiva + decisão editorial** (docs, core e tela; sem schema; sem banco; sem Proof Engine). Formato de [`README.md`](README.md). Antecede: EVOLUTION-UX-R1 (relatório de chat de 2026-11-03).

## Decisão do operador (direção aprovada em 2026-11-03)

Esta é uma **decisão editorial de planejamento**, não evidência de execução, prontidão, maturidade ou autonomia.

- **Foco atual:** demonstrar produtividade real na VALUE-01, comparando o ANIMA com o Codex usado diretamente.
- **Próximo objetivo:** reduzir intervenções humanas repetitivas com base nas medições da VALUE-01.
- **Experimental:** A2-UAC (protótipo preservado em `claude/preserve-a2-uac-approver`, `0bb1cac`), isolamento da trilha WSL e governança avançada sob mandato.
- **Estacionado:** Ollama local, DSH e RunPod, até reavaliação orientada por necessidade, capacidade e custo.

A VALUE-01 ainda **não tem plano nem medição** no repositório em 2026-11-03: é um objetivo declarado, não um resultado.

## Resgate documental (etapa A)

Fonte: `codex/evolution-ux-v2` (13 commits de 2026-10-02/03, autor Git `GeanPfefer`, base `c536eff`). A branch **não** foi integrada. Foram trazidos, byte a byte, 11 arquivos novos (`docs/planos/009-evolution-ux-v2-akita-baseline.md` e dez registros) no commit `bd6ea30`.

Conferência feita antes de copiar:

- **Git:** cada arquivo tem 1–2 commits na branch, todos de 2026-10-02/03, coerentes com as datas dos nomes. Os 37 hashes de commit citados nos documentos resolvem no repositório. Os tokens hexadecimais que não resolvem como commit são fragmentos de UUID de work item/attempt, um digest de payload, um id de sessão do ai-memory e um diretório de versão do `codex.exe`: não são commits.
- **Caminhos:** todos os `docs/`, `apps/` e `packages/` citados existem em `dev` ou na branch de origem.
- **Ledger (leitura somente):** os work items AKT-03 (`b00e6a38`) e AKT-04 (`4617e72c`) existem, estão `completed`, com `verifier_opinion_recorded` e `result_accepted` de autor `user` em 2026-10-03. As demais afirmações dos registros (provas técnicas vivas do Codex CLI, do Claude Code e do ai-memory, relatadas pelo operador) **não foram reverificadas**: são declarações históricas.
- **Numeração:** `009-evolution-ux-v2-…` duplica o número de `009-akita-baseline-primeira-prova-governada-backlog.md`. O nome foi mantido porque seis registros o referenciam; a duplicidade é conhecida e registrada aqui.
- Nada nestes documentos promove maturidade nem altera o estado operacional; são fotos de 02–03/10 e podem divergir do estado atual (por exemplo, falam de nós `agency.codex-cli`, `agency.claude-code` e `agency.akita-baseline-v1` que o registry atual não tem, pois foram consolidados em `agency.external-harness`).

## Implementação da direção (etapa B)

A direção do produto **não** foi colocada no registry de capacidades: VALUE-01 e a redução de intervenções não são capacidades, e atribuí-las a capacidades existentes sugeriria maturidade. Ela vive em `packages/core/src/product-direction.ts` como estrutura separada:

- quatro estados permitidos (`current_focus`, `next`, `experimental`, `parked`), cada item com justificativa e ao menos uma referência a arquivo existente;
- vínculos opcionais a capacidades **apenas para navegação** (validados contra o registry), sem herdar maturidade;
- aviso fixo: direção não representa conclusão, prova, prontidão nem autonomia;
- exibida na `/evolution` em um painel próprio, sem alterar nós, cores, maturidades nem perfis de evidência.

Fora de escopo e não feitos: merge da branch antiga, `achievement`, `deliveryEvidence`, nós obsoletos, mudanças no Proof Engine, migrations e novas capacidades autônomas.

## Fronteiras

Nenhuma maturidade mudou. Autonomia desassistida continua não comprovada. Sem push; sem alteração de `origin/dev`/`main`.

## Validação (executada em 2026-11-03)

- `packages/core`: 131 suítes / 3.272 testes passando; `tsc --noEmit` limpo. Testes novos de direção: 7 (valores permitidos, referências existentes, ausência de afirmações de conclusão, vínculos só de navegação, registry sem campo `direction`).
- `apps/web`: suítes de `evolution`, `lib/evolution` e `auto-approval` (6 suítes / 125 testes) passando; `tsc --noEmit` limpo. Testes novos de tela: 4 (ordem dos grupos, aviso, referências, navegação sem alterar perfil de evidência, ausência da prop).
- Invariantes do registry (maturidades, 68 nós, nenhum `autonomous`, perfis de evidência da AUDIT-02): inalterados e verdes.
- **Não executados, por limite de ambiente**: `next build` (as worktrees usam junctions de `node_modules` e o Next não resolve fora da raiz do projeto; falha já observada nesta máquina em duas worktrees) e inspeção visual (a `/evolution` exige sessão autenticada, que o ANIMA não abre por Claude). A tela foi verificada por testes de DOM.

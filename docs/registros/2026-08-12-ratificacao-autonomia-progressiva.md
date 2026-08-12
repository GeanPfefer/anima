# Ratificação da autonomia progressiva e identidade una

**Data:** 2026-08-12
**Tipo:** documentação (perpetuação de ratificação humana)
**Branch:** `claude/integration-application-layer`
**HEAD inicial:** `efa1a86`
**HEAD final:** este commit (recorte documental próprio; ver "Commits")
**`origin/main`:** `973ef46` — **intacta, sem push**

## Objetivo

Perpetuar na documentação canônica uma ratificação humana de produto/arquitetura
(discutida diretamente com o usuário, **não** hipótese do agente): o **destino e
os princípios** da autonomia do Anima. Nenhuma mudança de código, schema, política
vigente ou efeito externo — apenas documentação.

## O que foi ratificado (resumo)

Autonomia sem teto filosófico (merge/deploy/main podem, com evidência, tornar-se
autônomos); autoridade **conquistada e revogável por evidência**; `local-first !=
local-only` com providers substituíveis; **uma única identidade** (Anima) com
capacidades internas; **proatividade cognitiva** pertencente ao Anima (não a uma
persona Prisma); **aprovação como mandato**, não micropermissão; papéis
**separáveis** Supervisor/Executor/Reviewer; segurança como **sistema evolutivo**
com níveis de maturidade (princípio, não taxonomia a implementar); e **governança
reforçada** para alterar a própria política — o ato mais protegido. Deliberadamente
**em aberto**: papel de XP/eras, UX da separação de contextos de chat e a
representação técnica dos níveis de maturidade.

## Documentos alterados e por quê

- **Novo [Marco 005](../marcos/005-autonomia-progressiva-e-identidade-una.md)** —
  âncora append-only dos princípios existenciais + arquitetura desejada + política.
  Marcos são o lugar canônico de mudanças de visão/identidade. Distingue as cinco
  categorias pedidas (princípio existencial · arquitetura desejada · política ·
  maturidade atual · restrição temporária) e **reinterpreta** (sem reescrever) os
  limites V0 do Marco 003 e a "autonomia por nível de impacto" do manifesto como
  **restrições de maturidade**.
- **[`docs/marcos/README.md`](../marcos/README.md)** — linha de índice do Marco 005.
- **[`anima-manifesto.md`](../../anima-manifesto.md)** — princípios permanentes
  refinados cirurgicamente: autonomia progressiva por evidência; aprovação como
  mandato; `local-first != local-only`; distinção identidade/persona/capacidade/
  provider; proatividade cognitiva na seção Prisma; e reenquadramento da seção
  "Autonomia por nível de impacto" como estado de maturidade, apontando ao Marco 005.
  Correção das formulações que podiam ser lidas como teto permanente.
- **[`anima-prd.md`](../../anima-prd.md)** — estado tático vivo: subseção
  "Proatividade cognitiva" em §1a; "Mapa de maturidade do ciclo de programação" +
  direção de separação de contextos de chat em §1f.1; nota "XP/eras deliberadamente
  em aberto" em §5; e cinco linhas na tabela de decisões §10 apontando ao Marco 005.
- **[`docs/planos/002-modo-autonomo-v0.md`](../planos/002-modo-autonomo-v0.md)** —
  seção de continuação (2026-08-12) reclassificando as fronteiras bloqueadas como
  maturidade vs fundamental e registrando a consequência operacional (promover por
  evidência, não afrouxar) e a aprovação-como-mandato.

## Decisões anteriores reinterpretadas (rastreabilidade)

- **Marco 003 — "Limites da V0" e "Execução separada de integração":** eram
  **restrição temporária/estado técnico**; permanecem vigentes, reclassificadas
  explicitamente como **restrição de maturidade** (não teto permanente). Não
  reescritas.
- **Manifesto — "Autonomia por nível de impacto":** era **princípio** redigido de
  forma que podia soar como teto eterno; passa a ser lido como **função da evidência
  demonstrada**, com a confirmação evoluindo para mandato. Ajuste cirúrgico + ponteiro.
- **Marco 003 — "Orquestração sustentável de inteligência":** visão reforçada
  (providers substituíveis, papéis separáveis, diversidade de provider p/ alto risco).

Permanecem **fundamentais** (não maturidade): alterar a própria política de
segurança (processo reforçado) e decisões intrinsecamente do criador da instância.

## Deixado deliberadamente em aberto

Papel definitivo de XP/níveis/eras; UX final da separação de contextos de chat;
representação técnica dos níveis de maturidade; e se/quando o Reviewer/Verifier
independente exige diversidade de provider. **Não** preenchidos por opinião do agente.

## Invariantes de segurança preservadas

Nenhuma proteção afrouxada. Nenhum efeito Git externo. Nenhum push/PR/merge/deploy.
`origin/main` intacta em `973ef46`. Nenhuma migration, RPC, enum ou tipo tocado.
Nenhum código funcional alterado — mudança 100% documental (`.md`).

## Gates

Não se aplica suíte de código a uma mudança só de documentação. Verificação feita:
`git diff --stat` confina as alterações a `*.md`; nenhum arquivo em
`apps/`, `packages/`, `supabase/`, `tools/` foi tocado. Consistência documental
revisada contra manifesto/PRD/Marcos 003–004/ADR-001–002/Plano 002.

## Arquivos locais preservados

`.worktrees/` (mobile-completed-result, roadmap-003-006), `.claude/settings.local.json`,
`.env.local` e demais não-versionados intactos. Nenhuma operação destrutiva.

## Próximo ponto exato de retomada

Ratificação perpetuada e commitada. Continuar autonomamente pelo trabalho
determinístico já ratificado (ordem de prioridade do Marco 005 / Plano 002):
invariantes de segurança/durabilidade, bugs determinísticos, itens incompletos já
ratificados, lacunas de integração, e **provas que aumentem evidência** para promover
uma capacidade de maturidade (a candidata natural é o coder local, que falha em
`ollama_read_round_limit` antes dos gates — ver
[registro de 2026-08-11](2026-08-11-investigacao-cancelamento-transporte.md) e
[`anima-prd.md`](../../anima-prd.md) §1f.1). Fronteiras que exigem decisão humana
(review request real, merge/integrated, deploy, UI de auto-desenvolvimento) seguem
`BLOCKED_BY_HUMAN_DECISION`.

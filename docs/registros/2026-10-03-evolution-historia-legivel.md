# Evolution — história recente legível

Data: 2026-10-03. Tipo: desenvolvimento e prova visual local.
Branch: codex/evolution-ux-v2. Worktree: G:/anima/.worktrees/evolution-ux-v2.
HEAD inicial local/publicado, confirmado por fetch exclusivo da branch:
fb002d2dedabfec2d0fbf327b52412057f1da5f1.
HEAD final = commit que cria este registro, recuperável por git log neste arquivo.
Commit: `Agrupe a história recente da evolução com marcos e contexto temporal`.

Mandato, escolhas e aceite: [Plano 009](../planos/009-evolution-ux-v2-akita-baseline.md),
seção História recente legível. Estado vivo atualizado no [PRD](../../anima-prd.md).
Contrato preservado: [Capability Proof Engine](../arquitetura/capability-proof-engine.md).

## Mudanças e prova de preservação

Somente apresentação de Evolução recente: oito grupos recolhíveis por data do fato,
44 eventos originais em ordem canônica. Destaques editoriais com identidade/data/ref
exatos para AKT-03 e Akita COMPLETE; quatro tipos existentes com símbolos/texto e
peso visual próprio. Relato e todos os refs expandem sob Estado naquele momento.
Registry, notas históricas, maturidade, achievement, Proof Engine, relações e
assessment não foram alterados. AKT-01/02/03 permanecem na entrada original.

Testes novos verificam quantidade, sequência e conteúdo de cada nota/ref; abrir e
recolher grupos/relatos; seleção da capacidade; texto histórico Codex anterior
preservado; destaque não nasce de palavras-chave ou do estado atual. Nenhum evento
inventado. Cabeçalhos genéricos resumem tipos presentes, não inferem marcos por data.

## Gates e QA

- Evolution UI/apresentação: 2 suítes, 46 testes PASS.
- Core relevante (registry/map/proof evaluation): 3 suítes, 105 testes PASS.
- Typecheck completo: PASS (5 workspaces atuais).
- Build: PASS, 68 páginas. Aviso preexistente Next de múltiplos lockfiles/root inferido;
  não é regressão e não foi alterado nesta tarefa.
- git diff --check e git diff --cached --check: PASS antes do commit.
- QA estático desktop 1440x1000 e mobile 390x844: grupos inicialmente recolhidos,
  marco expandido e relato/refs acessíveis, sem overflow horizontal observado.
  Capturas .tmp/evolution-history-{desktop,mobile,expanded}.png; render SSR local,
  sem login ou provider; rede do browser bloqueada exceto arquivo local.
- Flakes/falhas de código observadas: nenhum.

## Fronteiras e efeitos

.tmp/ e dependências/junctions locais preexistentes preservados; não adicionados ao
commit. Checkout principal, dev/main, origin/dev/main, Supabase/banco/migrations,
AKT-04, backends, governança e scopeVerification não receberam alterações.
Sem provider, execução governada, merge, deploy, PR, instalação ou integração.
Efeito externo autorizado: publicar somente o novo commit em
origin/codex/evolution-ux-v2 por push normal, após gates; confirmar SHA remoto no
encerramento. A confirmação é reproduzível por git ls-remote origin
refs/heads/codex/evolution-ux-v2. Nenhum force push autorizado/usado.

Próxima retomada: revisar apresentação Evolution; integração em dev exige unidade
separada. Esta sessão não autoriza execução, mudança factual ou promoção de capacidade.

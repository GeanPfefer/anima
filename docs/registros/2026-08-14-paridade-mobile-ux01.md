# 2026-08-14 — Paridade mobile do cartão de execução (UX-01) e handoff (UX-03)

**Tipo:** desenvolvimento. **Objetivo:** após a Fase 3 do review request chegar à
fronteira humana externa (congelada como `READY_FOR_HUMAN_EXTERNAL_PROOF`, ver
[registro da Fase 3](2026-08-14-fase3-review-request-fiada.md)), mudança de eixo
controlada para o próximo recorte local ratificado **fora** da Fase 3: fechar
lacunas de paridade mobile declaradas na UX-01/UX-03 do
[Plano 002](../planos/002-modo-autonomo-v0.md).

## Estado do Git

- **Branch:** `claude/integration-application-layer`.
- **HEAD ao iniciar este eixo:** `e448fea` · **HEAD final:** `53c045c` (+ commit
  de docs deste registro).
- **`origin/main`:** `973ef46` — **intacta, sem push**. Working tree limpa fora
  dos arquivos deste eixo e do `.worktrees/` preservado.

## Reconstrução do roadmap (autoridade = estado real)

Backlog do Plano 002 auditado: Fases A–F **concluídas/ratificadas**; UX-00/UX-03
prontos-para-revisão; UX-01 **ratificado (web)** com mobile em paridade nomeada
como escopo aberto; UX-02/UX-04 ratificados. Bloqueios NÃO escolhíveis
autonomamente: primeira criação real de PR (efeito externo); `merged`/`integrated`
e superfície de UI de auto-desenvolvimento (decisão de produto); coder
`ollama_read_round_limit` (capacidade de modelo — a memória/PRD já concluíram
"zero bug de produção", não é recorte local). Lacuna local ratificada e aberta
escolhida: **paridade mobile da UX-01** (e um detalhe da UX-03).

## Commits criados (neste eixo)

1. `31ae416` — Cartão de execução autônoma (UX-01) no mobile: helper puro
   `presentMobileWorkExecution` (espelha os rótulos do web), `requestWorkControl`
   (RPC `request_work_control`, RLS) e render no `MobileWorkCard` com pausar/
   cancelar cooperativos (cancelar em dois passos). Firulas web-only omitidas.
2. `53c045c` — Exibição da referência de handoff no cartão de resultado mobile
   (paridade UX-03): `presentMobileWorkResult` passa a expor `handoff` (com
   fallback declarado) e o cartão o mostra.

## Provas / gates

- **mobile:** 5 suítes / **39** testes (novos: `mobile-work-execution.test.ts` +
  asserção de handoff em `mobile-work-result.test.ts`).
- **typecheck:** 5 workspaces limpos (valida a assinatura real da RPC
  `request_work_control` no schema tipado do mobile e o TSX do cartão).
- **Flakes:** nenhum.

## Decisões

- Espelhar a **projeção pura** do web, não reimplementar domínio; o cartão nunca
  inventa estado (mesma disciplina do `presentAutonomousExecution`).
- Pausar/cancelar via RPC direta autenticada (padrão `set_work_focus`), não uma
  rota HTTP nova — mobile já fala com o Supabase diretamente para mutações.
- Omitir timer de decorrido e polling do runtime Ollama: são conveniências
  host-only, não essência da UX-01.

## Invariantes de segurança preservadas

- Sem ampliação de permissão: a RPC `request_work_control` segue RLS-gated; o
  mobile ganha só uma superfície de cliente para uma capacidade já ratificada.
- Sem efeito externo. Projeção read-only + pedido de intenção cooperativo
  (aplicado pelo laço num checkpoint seguro, não pelo cliente).

## Efeitos externos

**Explicitamente ZERO.** Nenhum push/PR/merge/deploy. `origin/main` intacta.

## Fronteira humana restante

**Prova física em dispositivo (Expo Go)** e ratificação da paridade mobile —
como nas demais entregas mobile (padrão UX-04). O código + testes de componente
locais estão prontos para revisão.

## Próximo ponto exato de retomada

Paridade mobile das cartas (UX-01 execução + UX-03 handoff) **pronta para
revisão, não ratificada**. Demais lacunas locais dentro do escopo ratificado
parecem esgotadas: os próximos passos de maior valor dependem de efeito externo,
de nova decisão de produto/política, ou de capacidade de modelo (coder) — ver a
seção de reconstrução do roadmap acima.

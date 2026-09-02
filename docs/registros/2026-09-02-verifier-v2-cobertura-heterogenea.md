# 2026-09-02 — Cobertura heterogênea no Verifier v2 (nem toda prova é um gate)

**Tipo:** desenvolvimento + prova (determinística). **Branch:** `dev`. **HEAD inicial:** `8003fa0`.
**HEAD final:** commit que contém este registro. Continua
[2026-09-02-cli-ciclo-correcao-sem-web.md](2026-09-02-cli-ciclo-correcao-sem-web.md).

## Gap de domínio fechado

O Verifier v2 (`33c88ea`) exigia prova para cada critério de aceite, mas a implementação
assumia uma única classe de prova: `acceptance criterion → validation_criterion.covers →
gate → evidência`. Critérios que são INVARIANTES DE ESCOPO — "cumprir a revisão tocando só
o test file", "manter a implementação intacta" — não são provados por um comando; são provados
por evidência ESTRUTURAL já observada pelo host (contenção de escopo no git). Eles caíam como
`acceptance_criterion_without_evidence` → `inconclusive` mesmo com evidência suficiente.

Generalização (sem afrouxar): cada critério de validação declara um REQUISITO DE PROVA e o
Verifier confere a evidência do TIPO CERTO:

```
acceptance criterion
→ proof requirement (gate | scope)      # declarado no execution_spec (validation_criteria[].proof)
→ evidence source
     gate  → gate host-observed que passou
     scope → contenção de escopo OBSERVADA independentemente pelo host (git)
→ coverage (só conta evidência do tipo do requisito)
→ verdict (verified | inconclusive | rejected)
```

Um gate é apenas UMA classe de prova. `scope` só é satisfeito por observação INDEPENDENTE
(atestação do executor não basta — § "não permita que o executor se autoateste como prova de
escopo"). Determinístico, sem LLM: o requisito chega explícito e o Verifier só correlaciona.

## Mudanças

- **`eligibility.ts`:** `AutonomousValidationCriterion` ganha `proof?: 'gate' | 'scope'`
  (`WorkProofKind`); `parseValidationCriteria` valida o campo. Ausente ⇒ inferido (`gate`
  quando há comando, senão declarado) — 100% backward-compatible.
- **`work-verification.ts`:** `proofKindOf` + `scopeIndependentlyClean` (escopo limpo E
  observado); o loop de critérios e o de cobertura de aceite passam a aceitar prova por escopo;
  novos achados `scope_criterion_covered`/`scope_criterion_uncovered`; a prova precisa
  CORRESPONDER ao requisito (evidência do tipo errado não conta).
- **`decomposition.ts` (`deriveResumeCorrectionSuccessor`):** para FUTUROS sucessores de
  correção, o aceite passa a carregar prova heterogênea — um critério FUNCIONAL (coberto pelos
  gates herdados, que ganham `covers`) + um critério `proof:'scope'` acrescentado cobrindo os
  invariantes de escopo. A decomposição por FALHA segue espelhando o spec verbatim (parâmetro
  `proof` opcional).
- **CLI:** `work show`/`work evidence` exibem, por critério de aceite, o requisito de prova
  (`[prova: gate|escopo|—]`) via `readAutonomousExecutionSpec`.

## Provas / gates (determinísticas, sem coder)

- typecheck `packages/core` + `apps/web`: LIMPOS.
- core: **66 suites / 1388** (era 1379): +5 casos do Verifier (§11) + 4 da derivação/convergência.
  * CASO 1 escopo respeitado+observado ⇒ critério de escopo PROVADO; CASO 2 arquivo excluído
    alterado ⇒ violação, nunca verified; CASO 3 gate ausente ⇒ gap/inconclusive; CASO 4 cobertura
    heterogênea completa ⇒ verified; CASO 5 escopo só atestado ⇒ não conta (inconclusive).
  * **Convergência (§13, sem coder):** um sucessor CORRETAMENTE derivado (só o test file muda +
    gate verde + escopo observado limpo) ⇒ **VERIFIED** com os 3 critérios cobertos. Prova
    NEGATIVA: tocar a implementação preservada ⇒ `change_in_excluded_scope`, nunca verified.
- web `work-orchestration` (unit): 70 suites / 855 verdes (inclui `review-correction-orchestration`).
- CLI: 30 verdes.

## PIN-02 / sucessor `330e55e2` (§13 — determinação ANTES do coder)

O sucessor existente `330e55e2` foi derivado ANTES desta evolução: `work show`/`work evidence`
o mostram com gates `covers: []`, sem critério `proof:'scope'`, e aceite `[prova: —]`. Logo,
sob o Verifier melhorado ele AINDA não convergiria (invariantes de escopo sem prova associada).
Isto é um **gap determinístico inevitável para ESSE sucessor** ⇒ **NÃO se rodou o qwen3-coder**
sobre ele (§13). `330e55e2` NÃO foi reescrito no banco (§10).

**Fronteira para convergir o PIN-02 ao vivo:** re-derivar um sucessor FRESCO com a derivação
corrigida (que emite os requisitos de prova). O caminho canônico exige tornar `330e55e2` terminal
primeiro — MAS o domínio hoje NÃO expõe cancelamento de item `approved` (só `reject` de `proposed`
e cancelamento de attempt ATIVO). Adicionar essa operação é decisão de domínio à parte (nova
operação + RPC + migration), fora do "menor seam" desta sessão. Além disso o **Ollama estava
desligado** e a máquina é compartilhada (§16). Por isso a prova viva self-dev fica **pendente**,
com a arquitetura fechada e a convergência provada deterministicamente.

## Segurança

`EVIDÊNCIA ≠ CLASSIFICAÇÃO ≠ DECISÃO` preservado: o host observa (git), o Verifier classifica
(prova por escopo exige observação independente; atestação não basta), o humano decide. Sem
service_role, sem migration, sem `db reset`, sem publish externo, `origin/main` intacta. Nenhum
efeito de banco novo (a materialização de FUTUROS sucessores é o comportamento da derivação;
nenhum item foi materializado/executado nesta sessão). Artefatos locais preservados.

## Próximo ponto de retomada

1. (domínio) expor cancelamento canônico de item `approved` OU rejeitar/abandonar `330e55e2`
   por mecanismo canônico → re-derivar sucessor fresco (agora com `proof:'scope'`) → `work approve`.
2. (compute) com Ollama no ar e headroom, rodar o self-dev (`ANIMA_AUTONOMY_ENABLED=1
   npm run local-host`): supervisor → attempt → worktree → qwen3-coder edita SÓ o test file →
   gates + evidência de escopo observada → Verifier v2 → `review` (esperado VERIFIED). Ao chegar
   a `review`, PARAR — a decisão volta ao humano. PIN-03 permanece adiado.

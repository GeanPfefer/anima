# Project Builder V0 — T3: Acceptance Contract V2 para trabalhos externos — 2026-10-25

Append-only. Tipo: **implementação** (código + testes; sem banco, sem attempt). Formato de [`README.md`](README.md). Antecede: [`2026-10-25-project-builder-v0-t2-external-materializer.md`](2026-10-25-project-builder-v0-t2-external-materializer.md). Motivo: a PROOF-EXT-01 (item `af70498b-5e78-47d1-8e2e-55b887cb9be1`, attempt `08ae49ac-06a8-4574-84c5-e8ed3c029a82`) executou e passou o gate, mas o Verifier ficou `inconclusive` com 3× `acceptance_criterion_without_evidence`: o T2 gravava os aceites em texto sem `covers`.

## Dados

- Branch `claude/t3-acceptance-v2`, base `dev` = `origin/dev` = `39849f760875301b32407f677b65c3948004d912`. `origin/main` = `99bec54e`, intacta. Não publicado, não integrado. Nenhuma migration/schema. O Verifier **não foi alterado**.
- A PROOF-EXT-01 permanece como evidência histórica: o item `af70498b…` (in_progress), sua attempt, classificação, parecer e a branch candidata `anima-work/08ae49ac-…` (commit `2e12825`) NÃO foram tocados; nenhum `resolve-pending`; só consultas read-only.

## Contrato v2 adotado (reaproveita o que já existe)

`execution_spec.acceptance_contract = 2`; cada aceite tem id estável (`A1`…`A99`) e é coberto **exatamente uma vez** (mesma regra do planner e do `lintAcceptanceContract`: `duplicate_cover`/`acceptance_without_possible_proof`), com ao menos uma prova automática. Mecanismos:

| Mecanismo | CLI | Critério gerado | O que o Verifier prova |
|---|---|---|---|
| gate_assertion | `--gate-covers "A3=npm test"` | `{proof:'gate', claim_kind:'gate_assertion', covers}` | só que o comando passou (a afirmação É o gate) |
| test_binding | `--bind '{"covers":["A1","A2"],"file":"src/x.test.js","bound_tests":["nome completo"],"min_new_tests":0}'` | `{claim_kind:'test_binding', command:'npm test -- <arquivo>', target_paths, binding}` | testes nomeados existem e passam (relatório Jest do host, árvore Git, baseline) |
| human_review | `--review A4` | `{proof:'human_review', covers}` | pendência humana registrada (`human_review_pending`), nunca prova automática |
| gate simples | `--gate "npm run typecheck"` | `{proof:'gate'}` sem covers | só exige que passe |

Recusas (antes de qualquer escrita): aceite sem id estável; critério sem cobertura (`acceptance_uncovered:A2`); cover de id desconhecido (`cover_unknown:A9`); cobertura dupla (`acceptance_covered_twice:A1`); sem prova automática (`no_automated_proof`); gate fora da allowlist/duplicado; binding vazio, de arquivo fora do escopo, duplicado ou que não é teste exato; contrato rejeitado pelo `lintAcceptanceContract` ou pela elegibilidade.

**Não fabricar cobertura** (verificado no SHA-base com Git confiável, sem executar o alvo): o arquivo de teste vinculado precisa existir em `base_sha` e cada `bound_test` precisa ser resolvível estaticamente (`listStaticJestTestNames`: `describe`/`test`/`it` aninhados, ignora comentários e títulos dinâmicos). Senão: `binding_file_missing_at_base` / `bound_test_not_found`.

## Exemplo (PROOF-EXT-01 / clamp, dry-run contra o laboratório real, persistência simulada)

- A1 `clamp(15, 0, 10) devolve 10` e A2 `Os demais comportamentos de clamp continuam corretos` → **test_binding** em `src/clamp.test.js` com os 4 testes reais vinculados (`clamp retorna min quando o valor está abaixo do mínimo`, `clamp mantém o valor quando está dentro do intervalo`, `clamp retorna max quando o valor excede o máximo` — o teste que falha no base e prova A1 —, `clamp aceita os limites exatos`). A cobertura é conjunta: o contrato permite um arquivo por binding e um aceite coberto uma vez.
- A3 `npm test passa` → **gate_assertion** `npm test` (prova exatamente isso e nada mais).
- A4 `Os testes existentes não foram removidos nem enfraquecidos` → **human_review**: a remoção dos 4 testes é barrada pelo binding (`bound_test_removed`/`test_binding_unmet`), mas "enfraquecimento" de asserções não é mensurável por execução; vira pendência humana.
- Lint do contrato: 0 achados; elegibilidade autônoma: elegível; `singleItemContractRefusal`: ok.

## Verifier (sem flexibilização) — provas nos testes do core

Com o contrato do clamp e evidência sintética coerente (relatório Jest com os 4 testes, baseline com o teste de A1 falhando, mesma árvore Git antes/depois): `verified`, 0 lacunas/violações, `test_binding_satisfied`, 3× `acceptance_criterion_covered` (A1, A2, A3) e `human_review_pending` (A4). Sem o relatório do vínculo: `inconclusive` (`test_report_missing`). Teste vinculado ausente: não `verified` (`test_binding_unmet`). Gate falhando: `rejected`. E o contrato antigo (v1, aceites sem `covers`) reproduz o resultado da PROOF-EXT-01: `inconclusive` com 3× `acceptance_criterion_without_evidence`.

## Limites

- O `--bind` usa JSON (campos `covers`, `file`, `min_new_tests`, `bound_tests`); um arquivo de teste por binding, no máximo 3 bindings, jest apenas (`npm test -- <arquivo>`).
- `gate_assertion` com `covers` é declaração do operador de que o resultado do comando é a prova daquele aceite; o sistema não julga a semântica do texto. Aceites comportamentais devem usar `--bind` ou `--review`.
- Aceite/integração/publicação/recuperação de externo continuam não suportados (recusa explícita).

## Preparação sugerida para a PROOF-EXT-02

Novo laboratório (ou novo commit no mesmo, com novo `base_sha`), novo work item com o contrato acima, mesma governança (approve humano → `work external classify` → `execute-one`), comparando o parecer com o da PROOF-EXT-01.

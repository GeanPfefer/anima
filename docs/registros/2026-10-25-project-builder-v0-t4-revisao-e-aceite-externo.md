# Project Builder V0 — T4: revisão humana e aceite de candidato externo — 2026-10-25

Append-only. Tipo: **implementação** (código + testes em repositórios descartáveis; sem schema, sem escrita nas duas provas reais). Formato de [`README.md`](README.md). Antecede: [`2026-10-25-project-builder-v0-t3-acceptance-contract-v2.md`](2026-10-25-project-builder-v0-t3-acceptance-contract-v2.md).

## Dados

- Branch `claude/t4-external-accept`, base `dev` = `origin/dev` = `c2911bdc15a596458039f70120f6893f467bd436`. `origin/main` = `99bec54e`, intacta. Não publicado, não integrado.
- Nenhuma migration/schema. Nenhum aceite, integração ou escrita nas provas reais: PROOF-EXT-02 (`2cf13fc8…`, `review`, 16 eventos) e PROOF-EXT-01 (`af70498b…`, `in_progress`, 16 eventos) seguem como estavam. Só leituras (inspeção e gate) foram executadas contra elas.

## O que foi implementado

1. **Revisão humana de critérios `human_review`** (`work external review`): sem decisão, só LÊ — reverifica a identidade do target (T1), exige parecer `verified` correlacionado, confere no Git confiável que a branch da attempt resolve para o commit candidato observado pelo host, que a base é ancestral e que o diff real `base..candidato` coincide com o handoff e fica dentro do escopo autorizado; imprime o diff e o digest sha256. Com `--criterion N --decision accept|reject --diff-digest <sha256>` registra a decisão de UM critério, ligada a: item, versão, attempt, evento de resultado, commit candidato, base, referência, critério (texto exato), digest do diff e operador.
2. **Gate do aceite** (`work accept` e `POST /api/work-orchestration/reviews`): para trabalho EXTERNO com critério `human_review`, o aceite do resultado exige revisão `accept` de cada critério para ESTE candidato; `reject` bloqueia; revisão de outro item/versão/attempt/resultado/commit/base/referência/critério é ignorada; mensagens de outro usuário ou com operador divergente são ignoradas. Itens internos do Anima e externos sem `human_review` passam intactos; `request_changes` nunca passa pelo gate.
3. **Exclusividade física detectada** (`findExternalPhysicalConflicts`): outros itens com a mesma raiz ou git-common-dir canônicos, sob QUALQUER referência. Claim aberto e vigente ⇒ a revisão é recusada (`external_physical_conflict_running`); item `in_progress` sem claim (candidato retido) ⇒ aviso.

## Contratos reutilizados (sem schema novo)

`work_items`/`work_events` (leitura), `evaluateVerifierRequirement`, `projectLatestWorkResult`, `projectWorktreeHandoff`, `readExternalTarget`/`verifyExternalTargetForContract` (T1), `trusted-git` (ambiente limpo, `--git-dir` verificado, hooks/fsmonitor desligados; o diff usa `--no-ext-diff --no-textconv`), `ai_conversations` (mensagem do operador com o registro) e `attach_work_context` (snapshot de contexto com as referências anteriores + a nova), `planResultReview`/`review_work_result_versioned` (o aceite continua sendo o ato existente).

## Fluxo operacional

`work external review <id> --version N` (lê) → conferir o diff → `work external review <id> --version N --criterion 4 --decision accept --diff-digest <sha256 exibido>` → `work accept <id>` (ato humano separado; o gate libera). Rejeição exige `--reason` e leva a `work request-changes`.

## Garantias e limites de exclusividade física

- Aplicada pelo HOST antes de revisar: identidade relida (T1) + varredura de itens/claims por identidade física. Não depende da referência textual.
- NÃO é garantia do banco: a exclusividade residente continua por referência (`work_claims` único por `target_reference`; bloqueio por item `in_progress` na mesma referência). A projeção é uma leitura no momento da revisão (corrida possível entre a leitura e uma execução iniciada logo depois). Não há lock de repositório.
- Como o aceite e a revisão NÃO escrevem no repositório externo, a corrida não corrompe o Git; ela só afetaria a leitura do diff.

## Integração Git do candidato: BLOQUEADA (precisa de schema)

O caminho existente de integração (`integration-effect`) não é reutilizável para externo sem migration:
- `authorize_integration_effect` (SQL, `20260928000002_integration_effect.sql`) recusa qualquer `target_ref` diferente de `refs/heads/dev` (linha 56) e amarra o efeito a `repository_id`/remote do Anima; o executor (`GitIntegrationEffectProvider`) exige `remote get-url` igual ao repositório confiável e opera em `refs/heads/dev`; o recibo é gravado por writer de sistema com `repositoryId`.
- O repositório externo do laboratório não tem remote e o destino seria `main`.
Necessário (incremento separado, com mandato de schema): parametrizar alvo/ref/identidade no RPC `authorize_integration_effect` e nos recibos (ou RPC equivalente para externo), com fast-forward no `refs/heads/<destino>` do repositório VERIFICADO, Git confiável, CAS do destino e a exclusividade física como pré-condição bloqueante (inclusive itens retidos). Enquanto isso, as recusas `external_target_not_supported_downstream` de integração/publicação/recuperação/aceite sob mandato permanecem.

## Provas

- core: 129 suítes / 3228 testes verdes (+35 do registro, vínculo, gate e conflito físico).
- web/CLI: 38 suítes / 664 testes verdes nas áreas tocadas (+16 com repositórios Git reais: inspeção, identidade alterada, base divergente, outro work item, branch movida, diff fora do escopo, mesma raiz sob outra referência, hooks/diff externo/textconv/fsmonitor hostis — com controle que prova que o Git comum os executaria —, revisão aceita/rejeitada/forjada/reutilizada, e `work accept`; +4 da rota; +CLI de parsing). `tsc` core e web limpos.
- Leituras reais (sem escrita): `work external review 2cf13fc8… --version 1` mostrou candidato `62a1d1e…`, digest `0468fbc2f66d3e14805c9135e3067fe7a5542e71642e784fea0e0438343c9512`, aviso do item retido da PROOF-EXT-01 e critério 4 `pending`; o gate recusa o aceite da PROOF-EXT-02 com `external_human_review_missing`.

# 062 — Planner com `test_binding` automático (PROPOSTA; nada executado)

Status: planejamento (2026-10-14). Base: `dev` = `origin/dev` = `a7d0ca4d` (Verifier `work-verifier-v6`, planos 058–061 concluídos). Somente leitura + proposta `PROPOSED`.

## 1. Mapa real de geração de contratos
- **Planner (modelo)**: `ProjectWorkPlanner.proposeArguments` (OpenAI `project-work-planner-openai.ts`, Ollama `project-work-planner-local.ts`) devolve só `PlannerArguments` (string JSON). Schema único e provider-agnóstico em `project-work-planner-shared.ts` (`SUBMIT_PARAMETERS`, `PLANNER_SYSTEM_INSTRUCTIONS`, `validatePlannerProposal`/`parseProposal`).
- **Autoridade do host**: `planExecutableProjectWork` (`project-work-planner.ts`) valida (paths seguros, comando na allowlist, `target_paths` exatos), captura `base_sha`, fixa executor/backend/permissões/limites e MONTA `execution_spec.validation_criteria` (hoje: sempre `proof:'gate'`, `claim_kind` ∈ {gate_assertion, substantive}, `command` escopado por `scopeTestCommandToWorkspace`). Revisão: `planExecutableProjectWorkRevision` reaplica o mesmo caminho.
- **Contrato v2 e verificação** (já completos no Core): `readAutonomousExecutionSpec` aceita `claim_kind:'test_binding'` + `binding{test_files,min_new_tests,bound_tests}` SÓ com `acceptance_contract:2`; `lintAcceptanceContract` (10 códigos) e a elegibilidade (`acceptance_contract_invalid`) rodam quando o marcador é 2; Verifier v6 prova `test_binding` (relatório Jest do host, baseline, árvore Git).
- **Propostas humanas** (create.mjs/CLI) escrevem `acceptance_contract:2` à mão; **nenhum produtor automático emite o marcador** (grep em packages/apps/cli/app: só leitura/lint).

## 2. Lacunas
1. O schema do planner não tem como declarar binding, arquivo de teste vinculado, `min_new_tests`, `bound_tests` nem efeitos que dependem de revisão humana.
2. O host nunca emite `acceptance_contract:2`; sem ele `test_binding` é inválido (fail-closed no parser).
3. `claim_kind:'substantive'` do planner (default conservador) NÃO é prova automática: em contrato v2 vira `acceptance_without_possible_proof` (lint). Hoje, no modo legacy, vira lacuna do Verifier (`acceptance_substantive_gate_insufficient`) ⇒ nenhum aceite substantivo do planner chega a `verified`.
4. O comando de gate vem do modelo (`validation_command`); para `test_binding` o gate precisa ser Jest path-restrito igual ao conjunto `binding.test_files` (senão `verifyGateTargetScope` fica `mismatch` — visto com `--workspace=@anima/web`; a forma por caminho `apps/web` fecha `verified`).
5. Nenhuma checagem pós-montagem aplica `lintAcceptanceContract`/elegibilidade no momento de planejar (só na aprovação/preparo).
6. Não há regra de quando o planner NÃO deve emitir `test_binding`.

## 3. Arquitetura recomendada (sem Core novo)
O Core já suporta integralmente o contrato ⇒ **não há P1-Core**. Tudo é autoridade do HOST em `apps/web/lib/ai` (planner shared + orquestrador), reaproveitando `evaluateAutonomousEligibility` e `lintAcceptanceContract` exportados.

### 3.1 Campos novos (opcionais) em `PlannerArguments`/`SUBMIT_PARAMETERS`
- `test_bindings: { label, covers[], test_files[], min_new_tests, bound_tests[{file, full_name}] }[]` (máx. 3; `[]` quando não aplicável — estrito no schema OpenAI).
- `human_review_effects: string[]` — itens de `expected_effects` que o planner declara NÃO demonstráveis por teste automatizado (prova humana explícita).
A emissão é uma ESCOLHA do planner por critério; nunca obrigatória.

### 3.2 Regras do host (fail-closed; nenhuma inferência por texto/nome)
1. `test_files`: caminhos exatos (sem `* ? [ ] { }`, sem `/` final), `safePath`, sufixo `.test|.spec.(ts|tsx|js|jsx)`, únicos (≤4), TODOS dentro de `included_scope` (escrita autorizada) e ancorados na topologia real (`unanchoredIncludedScopePaths`).
2. `bound_tests` só para arquivo de teste JÁ EXISTENTE no checkout (nunca inventa teste existente); `file ∈ test_files`; o nome é conferido pelo Verifier em runtime (lacuna se ausente). `min_new_tests ≥ 1` quando não houver `bound_tests`.
3. Comando CONSTRUÍDO pelo host (o modelo não escolhe): `npm test --workspace=<workspaceForScope(included_scope)> -- <test_files relativos ao workspace>` (forma por CAMINHO do workspace; exige workspace único). `target_paths` = `test_files` exatos.
4. Cada efeito de `expected_effects` coberto exatamente uma vez entre: critério `test_binding`, gate `gate_assertion`, ou `human_review_effects` (critério `proof:'human_review'`, sem `command`).
5. Marcador: `acceptance_contract:2` SOMENTE se houver `test_binding` ou `human_review`; senão a saída é BYTE-A-BYTE a de hoje (legado intacto, replay idêntico).
6. Em v2, um gate `claim_kind:'substantive'` sem binding nem revisão humana é RECUSADO com causa clara (`substantive_gate_without_proof`), em vez de ser reclassificado.
7. Pós-montagem: `evaluateAutonomousEligibility` + `lintAcceptanceContract` sobre o intent final; qualquer lacuna/achado ⇒ proposta rejeitada com a causa (nunca persistida).
8. Incerteza ⇒ o prompt instrui declarar o efeito em `human_review_effects` (lacuna honesta), nunca `test_binding`. Aprovação humana da proposta permanece obrigatória (sem auto-approval).
9. Nomes de teste: o prompt exige nomes ÚNICOS, ≥ `min_new_tests`, sem termos sensíveis; o Verifier trata relatório omitido como lacuna.

### 3.3 Quando NÃO emitir `test_binding`
Mudança sem alvo funcional testável por Jest (docs, config), alvo sem workspace único, teste que exigiria rede/DB/Docker, comportamento só observável por UI, ou quando o planner não leu o código-alvo.

## 4. Decomposição
| Item | Escopo | Dep. |
|---|---|---|
| **P1 (apps/web, shared+orquestrador)** | schema/validação/montagem/lint pós-montagem; marcador v2; prompt mínimo; testes (+ arquivo NOVO como `test_binding`) | — |
| P2 | adaptadores: coerção do Ollama para listas/objetos novos, `describeProposalForRevision` mostra binding, prompts afinados, testes selectable/local/revision | P1 integrado |
| P3 | prova real: pedido real → planner → `test_binding` → aprovação humana → attempt → Verifier v6 `verified` | P1+P2 |
CLI/web UI: exibir binding no card da proposta é item posterior (P4, opcional).

## 5. Testes necessários (P1)
Validação: cada regra 1–7 (aceita/rejeita), glob/diretório/path inseguro, test_file fora do `included_scope`, bound em arquivo inexistente, `min_new_tests 0` sem bound, workspace ambíguo, duplo cover, substantive em v2, `human_review_effects` fora de `expected_effects`. Montagem: comando construído exato e `verifyGateTargetScope === verified`; marcador só quando necessário; legado idêntico (snapshot dos testes existentes); lint/elegibilidade 0 achados no caso feliz; revisão preserva binding. Mutação fail-to-pass.

## 6. Riscos
Strict-schema OpenAI (todos os campos `required`; listas vazias); modelos locais emitem escalar onde se pede lista (`coercePlannerArrayFields` em P2); proposta mais restrita pode rejeitar planejamentos que hoje passam (rollout gradual: campos opcionais, v2 só quando usado); dependência de P2 para o Ollama; alvo `packages/core` vs `apps/web` (workspace por caminho); custo de tempo do gate Jest.

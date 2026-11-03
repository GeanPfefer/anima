# 056 — Verifier v4 e contratos de aceite verificáveis (proposta; nada implementado)

Status: PROPOSTA de análise (2026-10-13). Sem código, migration, item ou contrato persistido alterado. Caso de referência: item `d795e414`
(attempt `2893a772`): Verifier v3 `rejected` (3× `acceptance_substantive_gate_insufficient` + 1× `criterion_covers_unknown_acceptance`),
código correto (revisão independente), aceite humano em lane `advisory`, integração `integration_completed` seq 86397.

## 1. Diagnóstico do Verifier atual (`packages/core/src/work-orchestration/work-verification.ts`, `verifier-opinion.ts`)

- Função pura e determinística de (item, eventos); advisory; recomputável. Veredito: violação ⇒ `rejected`; senão lacuna ⇒ `inconclusive`; senão `verified`.
- **Aceite aprovado = `proposal.expected_effects`** (textos exatos). Critério (`validation_criteria[]`): `label`, `command?`, `covers?`, `proof?` (`gate`|`scope`),
  `claim_kind?` (`gate_assertion`|`substantive`), `target_paths?`. `proof` ausente ⇒ `gate` se há `command`, senão `declared`.
- Só duas provas fecham um aceite: (i) `gate` + `claim_kind:gate_assertion` + gate host-observado que passou; (ii) `scope` + contenção observada pelo host.
  `substantive` ou ausente ⇒ lacuna (default conservador). `declared` NÃO cobre aceite (cai em `acceptance_criterion_without_evidence`), logo não há como representar
  "decisão humana pendente" sem bloquear `verified`.
- `covers` fora do aceite aprovado ⇒ **violação** (`rejected`), inclusive no critério de escopo — foi o que transformou `inconclusive` em `rejected` no `d795e414`.
- Evidências: git do host (`host_observed_evidence_recorded`: commit, arquivos, diff), gates do host (`host_observed_gate_evidence_recorded`: label, command, exitCode,
  outcome, duração; `baseline` diferencial opcional só quando o critério declara `target_paths`), coder do host (backend, outcome, duração), `changeAuthorization`.
  Não há resultado por teste: o gate é um `exit code`. Proveniência `independent` (host/contrato/correlação) vs `attested` (executor).
- A política diferencial (`differential-evidence-policy`) e a prontidão de enforcement rodam em **shadow**; nunca promovem `substantive`.
- Lane: `verifier_requirement` ausente/`advisory` ⇒ aceite humano livre; qualquer outro valor ⇒ `required_fail_closed` (aceite exige `verified` correlacionado;
  espelhado no SQL `private.mandated_result_verdict`, que lê só o veredito, a base de evidência e a correspondência de commit — não a versão do Verifier).
  O V1 exige `verified` para a volta "completar" (`requireVerified`), independente da lane.
- **Lint**: o planner LLM já impõe `validation_covers ⊆ expected_effects` e cobertura total (`parseProposal`, `unknown_criterion`/`missing_coverage`); a proposta humana
  explícita (`createProposal`) e `evaluateAutonomousEligibility` NÃO — daí o `d795e414` passar com 0 lacunas de elegibilidade e falhar só na verificação.
- Dados: 66 pareceres no ledger (v1=16, v2=7, v3=36, investigation=7); 57 `verified`, 6 `rejected`, 3 `inconclusive`. Base para replay de não-regressão.
- Compatibilidade técnica: o SQL valida o parecer só por forma (`verdict`, `findings[].code` livre, severidade ∈ {ok,gap,violation}, proveniência ∈ {independent,attested},
  base de evidência); campos extras no parecer e por gate são tolerados (precedente: `baseline`, `shadowPolicyDecisions`). O parser TS reconstrói forma fixa e descartaria campos novos.

### Classificação do caso `d795e414`
Defeito real: nenhum. Evidência insuficiente: sim (gate sem relatório por teste; reuso é afirmação estrutural; "testes cobrem…" é meta-afirmação).
Erro de modelagem do contrato: sim (`covers` do escopo fora do aceite; aceites como comportamento sem prova possível). Limite do Verifier: sim (sem primitiva
funcional/estrutural/humana). Mutação (11 mutantes): 9 mortos; os 2 sobreviventes eram equivalentes (reuso) ⇒ prova estrutural é uma classe própria.

## 2. Arquitetura mínima proposta (cada tipo de afirmação com a prova proporcional)

| Afirmação | Prova | Evidência (produtor) | Proveniência |
|---|---|---|---|
| "O gate G passa" | `gate_assertion` | exit code do gate (host) | independent |
| Escopo/integridade Git | `scope` + invariantes git | diff/commit/ancestralidade (host) | independent |
| Comportamento funcional | `test_binding` | relatório estruturado por teste (host) + novos testes vs base | independent |
| Reuso, ausência de I/O, dependências | `structural_claim` | predicados estáticos sobre o commit (host, TS compiler API) | independent |
| Backend/transporte/runtime | `execution_evidence` | evidência de coder do host + transporte observado | independent |
| Adequação semântica | `human_review` | decisão humana explícita | humana (nunca converte em aprovação) |

Regras transversais: (1) nenhum gate é prova universal — um critério `gate_assertion` só cobre o aceite canônico do próprio gate; (2) `covers` ⊆ aceites aprovados,
sem duplicata, e todo aceite tem ao menos uma prova possível (lint); (3) `human_review` não conta como cobertura automática e não pode ser o único tipo de aceite em lane
obrigatória; (4) a evidência vem do host, nunca do executor; (5) o parecer segue advisory e recomputável; (6) escopo e integridade de Git são verificados
independentemente de qualquer critério substantivo (já é assim; a violação vinha só do acoplamento via `covers`).

## 3. Plano incremental

### I1 — Lint de contrato + `human_review` + Verifier v4 (TS puro, SEM migration) — PRIMEIRA ENTREGA
- Tipos: `WorkProofKind += 'human_review'` (parser de spec); `acceptance_contract: 2` no `execution_spec` como marcador de contrato novo.
- Novo `acceptance-contract-lint.ts` (puro): `covers_unknown_acceptance`, `duplicate_cover`, `acceptance_without_possible_proof`, `gate_assertion_covers_foreign_text`,
  `scope_criterion_foreign_covers`, `no_automated_proof` (todos os aceites `human_review`).
- Integração: `evaluateAutonomousEligibility` (gaps de prontidão) e criação/aprovação (`createProposal`/`work approve`) apenas quando o marcador existe; sem marcador, o lint
  roda em modo de aviso (mostrado em `work evidence`/`work approve`), nunca bloqueia item histórico.
- Verifier v4: `human_review` ⇒ finding `human_review_pending` (severidade `ok`, `subject` = aceite) e `humanReview.pending[]` no parecer; `VERIFIER_VERSION='work-verifier-v4'`;
  `parseVerifierOpinion` estendido; resto idêntico ao v3.
- Apresentação: `work evidence`/review listam aceites pendentes de revisão humana e avisos de lint.
- Fora do I1: coleta de evidência, executor, SQL, migrations, `accept` (sem reconhecimento ainda).

### I2 — `test_binding` com relatório estruturado do host (aditivo, sem migration)
- Critério `proof:'gate'`, `claim_kind:'test_binding'`, `binding:{ test_files:[…], min_new_tests?, expect:'pass' }` (arquivos exatos, sem glob/regex).
- Host: acrescenta, ao executar o MESMO comando declarado, `--json --outputFile=<caminho do host fora da worktree>` (o charset da allowlist de passthrough já admite os tokens);
  roda também no baseline (já existente quando há `target_paths`). `deriveTestReport` (como `deriveDifferentialBaseline`): `{runner:'jest', tests:[{file,fullName,status}], totals, digest}`,
  limitado, malformado ⇒ omitido (nunca invalida o gate). Campo aditivo por gate em `host_observed_gate_evidence_recorded`.
- Verifier: prova o aceite se há ≥ `min_new_tests` testes novos (ausentes no baseline) nos arquivos declarados, todos `passed`, nenhum `skipped/todo/only`, e nenhum teste ligado removido;
  caso contrário `test_binding_unmet`/`test_report_missing` (lacuna). Flake ⇒ `inconclusive`, nunca `rejected`.
- I2b (opcional): "testes do candidato contra o código da base" (fail-to-pass) para impedir testes vacuamente verdes.

### I3 — `structural_claim`: predicados fechados e avaliados pelo host na árvore do commit (`symbol_exported`, `symbol_referenced_by`, `no_import_of`, `no_io_in`, `file_unchanged`, `no_new_dependency`); campo aditivo na evidência git.
### I4 — `execution_evidence`: transporte observado (WSL/distro/usuário) e backend no registro do coder; critério `proof:'execution'`.
### I5 — Reconhecimento humano no aceite (`accept` carrega os `humanReview.pending` reconhecidos): exige migration/RPC e UI; só depois de I1–I2 provados.

## 4. Compatibilidade, migrações, autoridade
- Itens históricos: sem marcador ⇒ Verifier v4 produz o mesmo veredito e os mesmos códigos que v3; o parecer persistido de `d795e414` permanece `rejected` (contrato v1 imutável).
- Migrations: I1–I4 nenhuma (verificado: campos extras tolerados; códigos livres; SQL só lê veredito/base). I5 sim.
- Autoridade: Verifier advisory; sem novo caminho de escrita humana ou de sistema; evidências novas só pelo Trusted System Writer existente; `human_review` nunca vira `verified` automático.

## 5. Testes e critérios objetivos de aceitação do I1
- Positivos: contrato {gate_assertion canônico + scope sem `covers` + `human_review`} ⇒ `verified` com `humanReview.pending`; marcador ausente ⇒ lint apenas aviso.
- Negativos: `covers` fora do aceite; aceite sem prova possível; duplicata; `human_review` com `command`; todos os aceites `human_review`; gate_assertion cobrindo texto estranho.
- Adversariais: executor atesta o que o host não observa; rótulo `gate_assertion` em texto substantivo; whitespace/Unicode parecido nos `covers`; critério `proof` desconhecido (spec inválida, fail-closed).
- Replay: recomputar v4 vs v3 sobre os pareceres/itens históricos do ledger (read-only): **0 deriva** de veredito/códigos sem construtos novos; `d795e414` real continua `rejected`; fixture do `d795e414` com contrato v2 ⇒ `verified` + pendências.
- Gates: typecheck sem erro novo, suites core/web sem regressão, nenhuma migration.

## 6. Demonstrar `verified` numa execução real futura
1. Após I1: item novo (ex.: o resíduo real "`createConfiguredProjectPlanner` não repassa `env`") com aceites = {gate canônico, escopo} + comportamentos como `human_review`; volta Single-Item V1 ⇒ parecer `verified` + `humanReview.pending`; aceite humano com revisão.
2. Após I2: mesmo molde com `test_binding` para os comportamentos ⇒ `verified` sem pendências para eles. Controles negativos (teste vacuamente verde, teste removido, `it.skip`) como fixtures de teste, não em produção.

## 7. Relação com recovery e continuidade de executores
- Evidência por aceite (relatório de testes, predicados) permite avaliar um candidato de attempt falha/parcial por aceite atendido e criar continuação V1-compatível: NOVO item com `base_sha` = commit do checkpoint e só os aceites pendentes
  (sem `resume_from_checkpoint`); depende de autorizar commits de checkpoint (`anima-work/*`) como base.
- O contrato e a evidência são independentes do executor (o host observa): a troca Claude↔Codex preserva escopo, autoridade, orçamento e Verifier; `execution_evidence` impede declarar um executor que não rodou;
  `usage_limit_exceeded` continua sendo o sinal positivo de troca; o pacote de handoff lista commit + aceites atendidos/pendentes.

## 8. Riscos e dependências
Jest-only no início; quoting de `npm.cmd` no Windows e caminho de saída fora da worktree; testes vacuamente verdes (mitigar com I2b + `human_review` para adequação); flake ⇒ `inconclusive`; deriva de versão
entre web e Resident Host (spec com `proof` novo é inválido em código antigo — fail-closed); reconstrução do parser TS do parecer; custo do TS compiler API no I3; sem automação de adequação semântica de testes.
EOF

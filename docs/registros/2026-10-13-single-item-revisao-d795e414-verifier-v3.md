# 2026-10-13 — Revisão independente do candidato `d795e414` e do Verifier v3

Tipo: revisão read-only. Branch dev, HEAD a4f46f8 inicial e final; sem commit, sem alteração persistente (ledger/eventos/claims/Git
principal inalterados; max seq global 86394). Testes e mutações em snapshots descartáveis fora do repositório.

## Parecer técnico sobre o checkpoint `1a18fc8e95bb…` (branch `anima-work/2893a772-…`, +86/−2, 3 arquivos)

- Implementação: `resolveLocalProjectPlannerModel(env, model)` (puro) = `model ?? env.ANIMA_PROJECT_PLANNER_MODEL ?? 'qwen3-coder:latest'`,
  usado pelo construtor de `LocalOllamaProjectWorkPlanner` e por `diagnoseConfiguredProjectPlanner(env, model)` (provider via
  `resolveConfiguredProjectPlannerProvider`; modelo só quando local). Sem I/O, sem import novo de rede/fs, nenhum outro consumidor da regra.
- Equivalência com o HEAD: 49 combinações (resolvedor e construtor) e 343 (diagnóstico vs oráculo "provider antigo + regra antiga"):
  **0 divergências**; defaults `{provider:'openai'}`, `qwen3-coder:latest`; semântica de vazio e espaços preservada (`??`, sem trim).
- Segredos: diagnóstico lê só `ANIMA_PROJECT_PLANNER_PROVIDER` (+ `…_MODEL` se local); retorno só provider/modelo; ambiente com
  `OPENAI_API_KEY`/`OLLAMA_URL` não vaza.
- Testes: foco 49/49 (35 antigos + 14); `lib/ai` 256 pass e as MESMAS 2 suítes/3 testes falhando que a base limpa a4f46f8
  (`project-context-builder`, `project-tools`; 242 pass na base): zero regressão; `tsc` 0 erros.
- Mutação (11 mutantes): 9 mortos (precedência, default, `||`, trim, injetado ignorado, env do construtor, injetado no diagnóstico,
  leitura de segredo, provider sempre local); 2 SOBREVIVEM e são equivalentes (R7 construtor volta à expressão inline; D2 diagnóstico
  reimplementa a regra): "reutilizam a mesma resolução" é afirmação ESTRUTURAL que testes de comportamento não provam.
- Resíduo fora de escopo (e excluído do contrato): `createConfiguredProjectPlanner(env)` constrói o planejador local sem repassar `env`,
  então diagnóstico(env≠process.env) pode divergir da fábrica; preexistente. Nit: o diagnóstico ainda não tem consumidor (objetivo era expô-lo).
- Veredito: cumpre o objetivo aprovado; nenhum defeito encontrado.

## Matriz de aceites (aceite = `proposal.expected_effects`)

| Aceite | Evidência disponível | Lacuna |
|---|---|---|
| A1 reuso da resolução com precedência/fallback | diff (ambos chamam o resolvedor); 8+ casos de precedência/default; 7 mutantes de comportamento mortos; equivalência 392 combinações | reuso é estrutural (R7/D2 sobrevivem); gate do host só registra exit 0 |
| A2 diagnóstico sem segredos e sem I/O | Proxy que só admite 2 chaves; D3 morto; função sem imports de I/O; retorno restrito | "sem I/O" é estático; sem prova mecânica |
| A3 testes cobrem default/explícito/precedência/sem segredos | os testes existem e discriminam (mutação) | meta-afirmação sobre os testes; só revisão humana/mutação a prova |
| (escopo) só 3 arquivos | git independente: `changeAuthorization` verified, 3 arquivos | `covers` fora do aceite aprovado ⇒ violação |

## Causa da rejeição (Verifier v3) — classificação
1. Defeito real da implementação: **nenhum**.
2. Evidência insuficiente: sim, estrutural — gate verde sem `claim_kind` só associa (`acceptance_substantive_gate_insufficient` ×3); o
   gate não registra testes por nome.
3. Erro de modelagem do contrato: **sim** — o `covers` do critério de escopo não pertence ao aceite aprovado
   (`criterion_covers_unknown_acceptance` ⇒ `rejected`; só as lacunas dariam `inconclusive`); aceites escritos como comportamento sem
   `claim_kind`; A3 é meta-afirmação.
4. Limites do Verifier/governança: (a) nenhum lint pré-aprovação detecta `covers ⊄ expected_effects` (a elegibilidade deu 0 lacunas);
   (b) não há primitiva de prova funcional/estrutural entre `gate_assertion` e revisão humana; (c) V1 exige `verified`, o que só é
   atingível por contratos de gate+escopo. `rejected` foi intencional (fail-conservative), não bug.

## Recomendação
**Accept** humano do resultado (lane `advisory` ⇒ `evaluateVerifierRequirement` satisfeito), registrando que o Verifier não o
aprovou por razão de contrato. **Não** request-changes (o sucessor de correção carrega `resume_from_checkpoint`, que o V1 recusa) e
**não** rejeitar (sem defeito). Aceite ≠ integração: a branch é 1 commit sobre a4f46f8 (fast-forward); a mensagem do checkpoint é
automática e truncada, a ajustar na integração. Depois: `cde9684e` fica superado (decisão humana via `resolve-pending`).

## Desenho recomendado para propostas futuras
Lint na criação/aprovação (`covers ⊆ expected_effects`; todo aceite com prova possível); critério de escopo sem `covers` ou com aceite
canônico implícito; aceites de gate como `gate_assertion`; novos tipos proporcionais: `test_binding` (testes nomeados, relatório
estruturado do host, opcionalmente diferencial base×candidato), `structural_claim` (predicados estáticos sobre o diff/AST),
`execution_evidence` (transporte/runtime) e `human_review` declarado (o Verifier lista como pendente humano sem virar lacuna).
Evidência da attempt não pode ser reaproveitada retroativamente (contrato v1 imutável; o gate não guardou relatório por teste):
a revisão acima é evidência atestada do revisor, não cobertura do Verifier.

Evidências: `C:\Users\GeanTeco\anima-recovery\review-d795e414-*\`.

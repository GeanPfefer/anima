# 2026-09-18d — Self-Development Loop V0: prova E2E real do detector + causa-raiz da barreira AUTH

- **Data:** 2026-09-18
- **Tipo:** prova (viva) + correção de configuração (não destrutiva)
- **Objetivo:** fechar a única lacuna do Self-Development Continuous Loop V0 —
  executar o dry-run READ-ONLY do detector contra o histórico residente REAL, sob
  a identidade canônica, e auditar o resultado. Sem materializar proposta.

## Branch / HEAD

- **Branch:** `dev` (única linha autoritativa; nenhum branch/worktree paralelo).
- **HEAD inicial:** `09b3bc7` (= `origin/dev`).
- **HEAD final:** este commit (docs-only; ver `git log`).
- **`origin/main`:** `99bec54` — INTOCADA.

## Causa-raiz da barreira AUTH (Fase 1) e resolução

- Diagnóstico READ-ONLY: GoTrue local no ar (200); email/password habilitado.
- O sign-in canônico direto (lendo `.env.local` e chamando `/auth/v1/token`)
  **funcionava** (200, userId `e570e43b-…`, email confirmado), mas
  `resolveCliIdentity` sob o runner **falhava**.
- **Causa-raiz comprovada:** `ANIMA_RESIDENT_PASSWORD` (10 chars) em
  `apps/web/.env.local` tinha um `#` no índice 5, **sem aspas**. O parser
  `--env-file` do Node trata `#` como comentário inline em valor não citado e
  **truncava a senha para 5 chars** (verificado: runner via `len=5`, arquivo tem
  `len=10`). Afeta também Resident Host e CLI (mesmo runner).
- **Correção (não destrutiva):** citar o valor da senha em `.env.local` (via
  script, sem imprimir o segredo; backup no scratchpad; +2 bytes = as aspas; 52
  linhas preservadas). Depois: runner vê `len=10` e `resolveCliIdentity` retorna
  OK. **Sem `service_role`, sem `db reset`, sem recriar usuário, sem trocar
  identidade.** `.env.local` é gitignored → sem commit.
- Nenhuma mudança no detector (operou correto).

## Prova E2E real (Fase 2) — dry-run READ-ONLY, US$0

`apps/web/scripts/self-deficiency-dry-run-readonly.ts` sob a identidade residente:

- **eventos reais lidos:** 1130.
- **deficiências detectadas:** 6, todas `open` (0 work_items com
  `self_deficiency_provenance`):

| id | kind | occ | ocasiões | evidenceRefs |
|---|---|---|---|---|
| `capability_regression\|agency.supervised-self-development` | regressão | 5 | 5 | 6 |
| `repeated_failure\|gate_failed` | falha repetida | 11 | 11 | 33 |
| `repeated_failure\|ollama_no_effective_edits` | falha repetida | 5 | 2 | 12 |
| `repeated_failure\|ollama_read_round_limit` | falha repetida | 3 | 3 | 9 |
| `repeated_failure\|ollama_transport_error` | falha repetida | 3 | 3 | 9 |
| `verifier_recurrent_issue\|agency.supervised-self-development` | verifier recorrente | 5 | 5 | 10 |

## Auditoria (Fase 3)

- **evidenceRefs resolvem:** 100% dos refs `work_event` das 4 `repeated_failure`
  resolvem para `execution_failed` reais; work_items batem (11/11, 2/2, 3/3, 3/3).
  As duas de supervised-self-dev usam refs de `capability_assessment` (observações
  derivadas da cadeia forte canônica) + attempt refs — ids compostos ancorados em
  eventos reais.
- **Conservador comprovado:** dos 55 `execution_failed` reais, só 22 (as 4 causas
  recorrentes em ≥2 work_items) viraram deficiência; as demais são
  não-classificáveis (fail-closed) ou de um único work_item.
- **Corroboração independente:** `changes_requested`=6, `result_accepted`=3
  (supervised-self-dev tem aceites E rejeições reais → regressão genuína, padrão
  seq4→seq5). `work_items`=73, com proveniência=0 → nenhum work ativo equivalente
  ignorado (dedup por proveniência, correto por construção).
- **Falso positivo?** Nenhum que exija correção. Duas observações honestas: (1)
  supervised-self-dev é sinalizado por 2 classes (regressão + verifier recorrente)
  — duas lentes sobre as mesmas 5 negativas, ambas verdadeiras; (2) `gate_failed`
  é a causa mais coarse (11 tarefas heterogêneas) — julgamento humano se é uma
  deficiência ou várias.

## Candidata à primeira proposta (NÃO materializada)

Pela seleção determinística do materializer (ocasiões desc → ocorrências desc → id
asc), a candidata mais forte é **`repeated_failure|gate_failed`** (11 ocasiões).
Recomendação para revisão humana: considerar se uma causa mais específica/acionável
(ex.: `ollama_read_round_limit` — ligada à barreira de RAM 16GB→32GB — ou a
regressão de supervised-self-dev) é um primeiro alvo melhor. **Nenhuma proposta foi
criada** — a primeira criação real é etapa separada, após o Gean revisar.

## Efeitos externos (explicitamente NÃO realizados)

- approval? **NÃO**. authority? **NÃO**. reservation? **NÃO**. attempt? **NÃO**.
  provider pago/OpenAI/RunPod? **NÃO**. LLM externo? **NÃO**.
- `service_role`? **NÃO**. `db reset`? **NÃO**. usuário recriado? **NÃO**.
- `origin/main` intocada. Sem branch/worktree paralelo. `dev` única linha.
- Preservados: `.worktrees/`, `watch4-sensors.txt`, `.env.local` (só a senha citada).

## Próximo ponto exato de retomada

1. Gean revisa as 6 deficiências reais acima.
2. Escolhida UMA (deduplicada, sem work ativo equivalente): materializar UMA
   proposta via `materializeSelfImprovementProposal` (desfecho `proposed`) e parar
   na governança humana. Ver [[project_20260918c_self_development_loop_v0]].
3. Depois, fechar o laço avaliação-de-resultado → observação (Continuous Self-Dev V1).

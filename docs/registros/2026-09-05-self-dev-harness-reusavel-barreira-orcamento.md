# 2026-09-05 (cont.) — Self-dev do harness reutilizável: fluxo reprovado, barreira de orçamento

**Tipo:** prova viva (self-dev recursivo) + enabling infra. **Branch:** `dev`.
**HEAD inicial:** `90fd892`. **HEAD final:** `a55e316` (2 commits habilitadores locais desta
frente + este registro). **`origin/main`:** `99bec54` — **INTACTA** (sem push). Sem `db reset`.

## Objetivo

Usar o fluxo self-dev FORTE já provado ([registro anterior](2026-09-05-prova-e2e-openai-forte-planner-e-coder.md))
para tornar `apps/web/scripts/prove-openai-strong-e2e.ts` reutilizável: remover a `TASK_MESSAGE`
hardcoded e aceitar a mensagem em runtime por `--message-file <caminho>` (+ opcional `--message`),
com validação e testes. A IMPLEMENTAÇÃO deve vir do coder do fluxo, não do operador; só a ENTRADA
hardcoded do harness podia ser trocada temporariamente (e foi revertida).

## Reconciliação de partida

- Docker Desktop estava DOWN ⇒ Supabase local fora. Iniciei Docker Desktop + `supabase start`
  (reattach, SEM reset) — dado preservado. Ollama seguiu DOWN (irrelevante; compute forte é OpenAI).
- `dev`@`90fd892` (local, +1 de `origin/dev` `4ab99ac`); `origin/main` `99bec54` intacta.
- Item da prova anterior `cde9684e` confirmado em `review` (Verifier verified), **não aceito**.

## O que foi provado (e o que não)

- **Planejador FORTE (OpenAI):** produziu proposta terminal válida para a tarefa quando o provider
  respondeu (runs 1,2,4,5,10,12): escopo `prove-openai-strong-e2e.ts` + teste; item revisado,
  aprovado e classificado. Falhou por indisponibilidade do provider em runs 3,6,8,9 (HTTP não-ok) e
  por limite de tool-calls em 7,11 — consistente com **rate limiting da OpenAI** acumulado ao longo
  de ~12 execuções.
- **Coder FORTE (OpenAI):** implementou a FEATURE corretamente TODAS as vezes que rodou (5×):
  `resolveTaskMessage(argv, readFile?)` com `--message-file`/`--message`, leitor injetável, validação
  (ausente/vazio/ilegível) e guarda de `main()` no import. **Defeito recorrente e único:** ao criar
  um arquivo de teste NOVO em `apps/web/scripts` (diretório sem teste jest irmão), escolheu de forma
  instável um framework fora do jest — **vitest ×3** e **node:test ×1** — reprovando o gate (que roda
  jest). Resistiu a 3 refinamentos de mensagem cada vez mais explícitos E a uma âncora jest irmã
  committada. Na 1ª execução da tarefa anterior o coder ACERTOU o jest porque ANEXOU a um arquivo
  jest já existente — condição que aqui não ocorria.

## Enabling infra committada (não é a implementação da tarefa)

- `bf9e028`: extraiu a redação de segredos para `apps/web/scripts/prove-e2e-redact.ts` (puro) + teste
  jest real, como âncora de convenção no diretório. Harness passa a importar `redactSecrets` (alias).
- `a55e316`: moveu a âncora jest para o arquivo-ALVO `apps/web/scripts/prove-openai-strong-e2e.test.ts`
  (jest, testando `redactSecrets`), para forçar a condição "ESTENDER um arquivo jest existente" — a
  única em que o coder acerta a convenção. Gates: typecheck web 5/5; jest do arquivo alvo passa.

## Barreira objetiva (fronteira humana)

Na execução com o arquivo-alvo jest pré-semeado (run 12), o **planejador forte SUCEDEU** e o item
`ce90eb14-810d-4125-833c-4c7b35666855` foi revisado→aprovado→classificado — mas o attempt do coder
foi **interrompido pelo orçamento autônomo** (INTEL-04) ANTES de rodar: item `blocked` +
`input_requested` (`persistent_inability_after_limits`). `autonomous_work_budget_status`:
`admitted:false`, `user_attempt_budget_exhausted`, `userAttempts24h=8/remaining 0`,
`externalAttempts24h=6/remaining 0` (runtime OK: 6916s/2457s restantes). Ou seja: o teto de
TENTATIVAS na janela móvel de 24h esgotou por causa das ~12 execuções. Retomar exige a janela rolar
(tempo) OU um ato humano `authorize_work_resume` (+1 tentativa) — **não fabricado** (AUTO-APPROVAL não
existe). O item `ce90eb14` já carrega a proposta terminal válida do planejador forte e, com o
arquivo jest pré-semeado, tem alta probabilidade de o coder finalmente passar o gate ao ser
readmitido.

## Custo e segredos

Teto por-item US$0,25. Reservas `reserved` US$0,25 nas 5 execuções que chegaram ao attempt do coder
(≈US$1,25 de TETO reservado, NÃO gasto real; preço de `gpt-5.6-terra` desconhecido ⇒ custo settled
não fabricado). Planner-failed e o run 12 (blocked) não reservaram. Chave OpenAI nunca logada;
harness redige `sk-…`. `origin/main` intacta; nenhuma integração/merge/publicação.

## Estado para retomada

- `dev`@`a55e316` (local). Reverter a troca temporária de `TASK_MESSAGE` já foi feito (harness
  committado tem a mensagem de diagnóstico original).
- Itens órfãos `proposed` (placeholders de admissão sem execution_spec) das execuções com planner
  falho: `224475fa`, `ed519527`, `d4e13b0a`, `6a552fc0`, `38a0cb27`, `c41ad2ff` (inertes; seguros de
  cancelar). Item `blocked` com proposta válida: `ce90eb14`. Branches de resultado dos coder-runs
  reprovados preservadas (`anima-work/*`).
- **Próximo passo (humano):** quando a janela de 24h rolar OU via `authorize_work_resume` em
  `ce90eb14`, rodar novamente o harness (com a troca temporária de mensagem, ou após a feature
  `--message-file` ser integrada). Alternativa de fundo: o coder precisa de reforço de convenção jest
  para testes NOVOS em `scripts/` — considerar um coder mais aderente a instruções ou manter a âncora
  de arquivo-alvo pré-semeado.

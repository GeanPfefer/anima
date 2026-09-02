# 2026-09-02 — Diagnóstico semântico do PIN-02 e barreira de replanejamento

**Tipo:** diagnóstico/prova + correção mínima de infraestrutura.
**Branch:** dev. **HEAD inicial:** `05555cb49895e3e5954e018aea9a681f915d2285`.
**HEAD de código final:** `bc5825c`; o commit de encerramento documental que contém
este registro é o HEAD final da sessão (identificável por `git log -- <este arquivo>`).

Continua [prova do retry](2026-09-02-retry-pin02-fallback-gate-failed.md).
Fontes: [Plano 006](../planos/006-project-intake-v0.md),
[Plano 007 — desenho de recovery](../planos/007-replanejamento-apos-falha-deterministica.md),
[Plano 002](../planos/002-modo-autonomo-v0.md), ADR-003.

## Reconciliação

Work Item `5b8e371d-6ca9-453c-bbfe-693ae3266468`: failed, v1, 2/3 attempts usadas,
readiness `BLOCKED/failure_not_retryable`, saldo nominal 1. Attempt
`0cfdd6cb-a5ed-4217-b673-206078ea35f8`; claim `20ca7ae0-d6f7-4ac3-be1f-9d5423930593`
liberado. Branch `anima-work/0cfdd6cb-a5ed-4217-b673-206078ea35f8` permanece em
`1ee1921ec1c4dddfdfb74dfeb953d59e4a7e6083`; checkpoint pré-repair `4c0d5a6`.

Event log consultado novamente por GoTrue/Bearer user-scoped: failure `b6783ef2`,
gate evidence `636694be` (duas falhas exit 1, sem timeout/cancelamento), coder evidence
`a563e9c6` (qwen2.5-coder:14b, downgrade `preferred_exceeds_capacity`, 16/10 GB),
scope evidence `6b69ee4a` (delta somente teste). Nenhuma mutação de banco nesta sessão.

As três alterações documentais pendentes foram conferidas e preservadas no commit
`c9a15fa` — **Registre a prova do retry com fallback e falha de gate** — push
fast-forward `05555cb..c9a15fa` em origin/dev. O remoto foi verificado como
`https://github.com/GeanPfefer/anima.git`, igual ao repositório canônico do PRD.
A revisão automática de aprovação inicialmente recusou o push por não reconhecer
autorização/destino; após apresentar seção 16 do mandato e o remoto verificado,
aprovou a mesma operação. Nenhum workaround ou troca de destino.

## Saída relevante do gate — reprodução exata dos snapshots

A saída histórica integral não foi persistida no event log nem no log do Resident
Host; só códigos/durações ficaram disponíveis. Reproduzimos o gate em **duas cópias
extraídas por git archive**, sem editar os arquivos dos commits e sem tocar a branch:
`.worktrees/pin02-diagnosis-before` (4c0d5a6) e `pin02-diagnosis-after` (1ee1921).
Dependências por junction ao node_modules local. Comando em cada cópia:
`npm.cmd test --workspace=packages/core -- project-intake.test.ts --runInBand --no-cache`.

Antes do repair:

```text
FAIL src/project-intake.test.ts
  Test suite failed to run
  src/project-intake.test.ts:117:24 - error TS2304: Cannot find name 'serializeProjectIdeaV0'.
  117 const serialized = serializeProjectIdeaV0(baseIdea);
  src/project-intake.test.ts:118:26 - error TS2304: Cannot find name 'deserializeProjectIdeaV0'.
  118 const deserialized = deserializeProjectIdeaV0(serialized);
Test Suites: 1 failed, 1 total
Tests:       0 total
```

Após o repair, os mesmos dois erros MAIS:

```text
  src/project-intake.test.ts:123:18 - error TS2304: Cannot find name 'serializeProjectIdeaV0'.
  123 expect(() => serializeProjectIdeaV0({})).toThrow();
  src/project-intake.test.ts:127:18 - error TS2304: Cannot find name 'deserializeProjectIdeaV0'.
  127 expect(() => deserializeProjectIdeaV0({ version: 'unknown' })).toThrow();
Test Suites: 1 failed, 1 total
Tests:       0 total
```

Exit 1 em ambos. **Nenhuma asserção executou**; expected/received de Jest e stack de
teste em runtime não existem nessa falha. Há diagnóstico de compilação com arquivo,
linha e coluna. O gate foi bloqueado por imports ausentes, não por um teste que
efetivamente falsificou o codec. Os logs completos das reproduções estão em
`.worktrees/pin02-diagnosis-{before,after}-gate.log`.

O repair só acrescentou oito linhas (+22 → +30), sem remover duplicatas ou importar
as funções. Não houve correção manual nem mesmo nas cópias dos testes.

## Comportamento real e matriz de aceite

Sondagem separada via Node/assert importou a implementação imutável do commit
1ee1921. Não adicionou testes de produto nem alterou a branch. Resultado: round-trip
com campos estruturantes preenchidos preserva a ideia; desserialização lança para
campo extra, campo ausente, tipo incorreto, schemaVersion 2, null, array, objeto vazio,
campo extra em stakeholder e JSON sintaticamente inválido. Nove casos negativos
e um round-trip passaram. Log auxiliar `.worktrees/pin02-diagnosis-behavior.log`.

| Critério | Teste produzido / esperado pelo coder | Resultado do gate | Comportamento real por sondagem | Causa / teste correto? / implementação correta? |
|---|---|---|---|---|
| Round-trip | `de(ser(baseIdea))` igual à ideia | TS2304, não executado | Igualdade estrutural preservada | Chamada/asserção corretas, imports ausentes. Implementação correta no critério. |
| Extra field | `validateProjectIdea({...idea,extraField})` não null | Suite não executada | Validador rejeita; `de(JSON.stringify(...))` lança erro de campos exatos | Prova válida do validador, insuficiente para provar a fronteira do codec. Implementação correta. |
| Missing shape | `validateProjectIdea({})`, objetos sem vários campos: não null | Suite não executada | Desserialização de `{}` ou ideia sem goal lança | Prova do validador, não da desserialização; teste correto do codec deve entregar JSON textual. Implementação correta. |
| Malformed shape | Mesmo nome, mas exemplos só de campos ausentes; repair pede `ser({})` lançar | TS2304 na chamada nova | `de` com title numérico lança `title deve ser não vazio`; `ser({})` em JS retorna `"{}"` | Expectativa do repair é incorreta: `{}` não é ProjectIdeaV0, fora do domínio tipado do serializador. Não prova o shape lido. Implementação correta na fronteira de leitura. |
| Unknown version | `validateProjectIdea({...idea,version:'unknown'})` não null; repair chama `de({version:'unknown'})` | TS2304; asserções não executadas | `de(JSON.stringify({...idea,schemaVersion:2}))` lança `schemaVersion deve ser 1` | `version` é campo extra errado, não versão do contrato; argumento objeto não é string aceita por de. Expectativa throw pode passar pelo motivo errado em JS. Implementação correta. |

Mensagens reais dos negativos: `Invalid ProjectIdeaV0: A ideia de projeto exige
exatamente os campos do contrato V0.`, `Invalid ProjectIdeaV0: title deve ser não
vazio.`, `Invalid ProjectIdeaV0: schemaVersion deve ser 1.`. JSON inválido produz
SyntaxError. Não houve comportamento inesperado da implementação nos critérios.

**Classificação A — teste/coder incorreto.** Não é B nem C: não demonstramos bug
funcional no codec aprovado. Corrigir somente imports ainda deixaria chamadas fora
do tipo (`ser({})`, `de(objeto)`) e provas que falham/passem pelo motivo errado.
A evidência limita-se a esta tarefa/configuração do 14b; não conclui incapacidade
global do modelo. Fallback permanece provado, sem alteração de placement/design.

## Recovery existente e barreira demonstrada

`worktree-executor.ts` termina após o repair bounded com `retryable:false`.
`current_work_retry_readiness` (migration 20260825000000) verifica esse booleano
ANTES do saldo de attempts e devolve `failure_not_retryable`.

`readWorkRecoveryAssessment` sobre os fatos atuais devolveu:
`failureKind:unknown`, `normalizedCode:null`, `action:human_required`,
`reason:failure_not_classified`. A mensagem histórica usa só `execution_failed`,
um envelope genérico que a política deliberadamente não trata como causa. As duas
execuções do gate são repair dentro da mesma attempt, não duas failures de attempts.
O failure anterior foi transporte; não existe repetição de gate entre attempts.

Chamadas PURAS com o item/eventos reais (sem RPC de mutação):

- `planDecompositionFromFailure`: `strategy_not_decompose`.
- `planCorrectionFromReview`: `item_unavailable` (original failed, não changes_requested).
- `validateRecoverySuccessor` para candidato do mesmo escopo: `decomposition_not_recommended`
  + `scope_not_strictly_smaller`. Mesmo rotular gate_failure não remove o segundo bloqueio.

O Plano 002 já registra que seq nova igual é retry disfarçado; a derivação proíbe
escopo não redutível. Não é ausência de aprovação humana para a tarefa: a seção 11
do mandato a fornece condicionalmente. Falta uma **semântica canônica de replanejamento
com diagnóstico mantendo o escopo mínimo**, distinta das operações existentes.
Não satisfizemos a condição da seção 12 para implementar essa nova operação apenas
por inferência dos contratos. O [Plano 007](../planos/007-replanejamento-apos-falha-deterministica.md)
desenha o menor mecanismo, as garantias necessárias e a decisão pendente; nenhuma
guarda existente foi relaxada para materializar um successor.

## Correção de infraestrutura efetivamente implementada

`bc5825c` — **Preserve a causa classificável de falhas de gate após reparo**:
mensagem terminal passa a incluir `[gate_failed]` para gate não timed-out, mantendo
`code=execution_failed`, retryable false e transcript existentes. Timeout não recebe
essa classificação. Usa o token allowlisted já suportado por recoveryFailureCode;
não muda decideRecovery, schema, RPC, fallback ou o evento histórico. A partir de
novas falhas desse tipo, a causa deixa de se perder como unknown.

Regressão de infraestrutura com Git/npm reais, backend fixture e gate determinístico:
duas edições diferentes, dois gates exit 1, no máximo um repair, nenhum result,
terminal não retryable; decideRecovery recebe o terminal e devolve gate_failure /
human_required apesar de 2/3 usadas. Não é teste ou solução do conteúdo PIN-02.

Validação: 2 testes focados do executor PASS; 66 testes core de recovery/decomposição/
resume PASS; 16 testes web de assessment/decomposição PASS; typecheck web PASS;
diff check PASS. 35 testes do arquivo executor deliberadamente não selecionados.
Sem build geral (mudança de mensagem terminal, sem UI/bundle). Nenhum flake observado.

Fixture pura ADICIONAL sobre spec/proposal reais: gates PASS + observação independente
de escopo ⇒ verified, 3/3, zero gaps/violações; gates observados FAIL ⇒ rejected,
4 violações/1 gap. Sem persistência de parecer fictício, sem nova attempt.
Convergência do contrato de prova não é autorização para nova unidade de trabalho.

## Estado final, segurança e retomada

Sem successor, aprovação ou nova execução. Work Item/attempt/claim/failure originais
intactos. Sem mudança em project-intake.ts/test.ts na árvore principal ou na branch
da attempt. Cópias diagnósticas e artefatos locais anteriores preservados.
Sem migration, reset, service_role, cloud/gasto, apps do usuário encerrados, aceite,
integração, merge ou deploy. origin/main permanece `99bec54`.

Commits desta sessão: `c9a15fa` (docs anteriores), `bc5825c` (observabilidade) e o
commit documental de encerramento que contém este registro; destino somente origin/dev,
fast-forward. PRD/Plano 006 atualizados e Plano 007 criado como desenho, não política.

**Próxima decisão:** ratificar o critério de progresso material por diagnóstico quando
o conjunto de arquivos permanece igual, com autorização persistida e limite agregado
de linhagem. Então implementar/gatear a operação geral e só depois criar o successor
de correção de testes, dentro do mandato. Não usar a terceira attempt, não chamar
propose_recovery_successor diretamente pulando o validador, não abrir PIN-03.

### Encerramento — publicação parcial e approval review

O push de `c9a15fa` foi concluído. O push posterior (correção de infraestrutura +
diagnóstico/plano) foi **rejeitado pela revisão automática de aprovação**, que
considerou a publicação desse payload ampliado fora da autorização documental clara.
Não houve tentativa de contornar a rejeição. Aprovação explícita foi solicitada ao
usuário para publicar esses commits em origin/dev; até recebê-la, origin/dev permanece
`c9a15fa` e os commits posteriores permanecem locais. A confirmação final por RLS
encontrou zero eventos novos após seq 47178 e zero successors do item falho.

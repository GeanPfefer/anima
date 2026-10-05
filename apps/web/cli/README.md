# `anima` — CLI operacional do Anima (adapter oficial)

Primeira fatia da CLI oficial do Anima. Existe para uma tese arquitetural:

> **CAPABILITY FIRST → INTERFACES SECOND.** Web, CLI e (futuro) mobile/TUI são
> *adapters* sobre os mesmos contratos e application services. As regras — "pode
> aprovar?", "qual o próximo estado?", "como a cobertura funciona?", "quem pode
> executar?" — vivem em `packages/core` e no `WorkOrchestrationService`/RPC, nunca
> no adapter.

Consequências concretas desta CLI:

- **Não fala com `localhost:3000`.** Compõe os application services direto
  (`createWorkOrchestrationService`), então continua funcional com o Next parado —
  governança central não depende da página web estar no ar.
- **Não duplica lógica.** Usa `reconstructWorkPresentation`, `verifyPersistedWorkResult`
  e `planResultReview` do core — as MESMAS projeções/regra que a web usa.
- **Sem `service_role`.** A identidade é a residente, por GoTrue → Bearer → RLS
  (`auth.uid()` continua a autoridade). Nenhum bypass administrativo; o token nunca
  é logado.

## Rodar

Da raiz do monorepo:

```bash
npm run anima -- status
npm run anima -- work show <id> --json
```

Ou direto (mesmo runtime do resident host — Node 24 TS nativo, sem bundler), a
partir de `apps/web`:

```bash
node --no-warnings --experimental-transform-types --import ./scripts/ts-resolve.mjs --env-file-if-exists=.env.local cli/anima.ts status
```

Requer `apps/web/.env.local` com `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANIMA_RESIDENT_EMAIL`, `ANIMA_RESIDENT_PASSWORD`,
e o Supabase local no ar (`54321`). **Não** requer o Next.

## Comandos

| Comando | O que faz |
|---|---|
| `anima status` | Identidade conectada, Supabase, autonomia e resumo dos trabalhos retomáveis |
| `anima work list` | Lista os trabalhos não terminais (retomáveis) |
| `anima work show <id>` | Estado, versão, tentativa, Verifier (ao vivo × registrado) e cobertura de aceite |
| `anima work evidence <id>` | Critérios de aceite, gates, validações e lacunas (Verifier) |
| `anima work executors <id> [--json]` | READ-ONLY. Lista os 5 executores de coding (ollama, openai, deepseek-harness, codex-cli, claude-code) com disponibilidade (`ready`/`unavailable`/`unknown`), elegibilidade, motivo estável, modelo e classe de custo, e a recomendação determinística (`contract_declared` ou `local_first`, com `fallback`). Sonda `--version`/`auth status` dos CLIs nativos e `GET /api/tags` do Ollama; nunca chama a API da OpenAI e nunca expõe segredo, e-mail ou organização. A recomendação reflete só readiness, elegibilidade e custo — NÃO afirma adequação do modelo à tarefa. Não persiste, não grava evento, não escolhe executor nem inicia attempt; sai com 0 mesmo sem recomendação |
| `anima work request-changes <id> --reason "..."` | Registra REQUEST_CHANGES pelo fluxo canônico (`reviewResult`) |
| `anima work correct <id>` | Materializa o sucessor de correção governado (`proposed`) via `correctReviewedWorkItem` — NÃO aprova |
| `anima work approve <id>` | Aprova uma PROPOSTA (`proposed → approved`) via `resolveApproval` |
| `anima work accept <id>` | Aceita o RESULTADO em review (`review → completed`) via `reviewResult` |
| `anima work withdraw <id> --reason "..."` | Retira um plano APROVADO não iniciado (`approved → cancelled`) via `withdraw_approved_work` |
| `anima work resolve-pending <id> request-changes --reason "..."` / `... cancel [--reason "..."]` | Encerra um resultado CANDIDATO retido pelo Verifier obrigatório (`in_progress → changes_requested`/`cancelled`) via `resolve_pending_verification`; nunca verifica, nunca libera review |
| `anima work retry <id>` | Solicita o retry governado (ato humano) de um item `failed`/RETRY_READY via `request_work_retry` |
| `anima work authorize-resume <id> [--plan f]` | Autoridade humana de +1: recovery antigo de `failed` cria successor; bloqueio pré-attempt por orçamento readmite o mesmo item |
| `anima work prepare-autonomous <id>` | Paridade com o botão da UI "Preparar elegibilidade autônoma": classifica a versão aprovada vigente (sem executar) |
| `anima work authorize-compute <id> --max-usd N --max-minutes M --valid-hours H` | Ato humano: concede a authority paga EXATA que o Compute Router registrou como espera (provider/classe/modelo derivados da decisão; limites explícitos; recusa sem espera, com authority ativa ou duração < a pedida). Não executa |
| `anima help` | Ajuda |

`work retry` reusa a MESMA capability da rota web `retries`: lê `current_work_retry_readiness`
para DERIVAR automaticamente a versão vigente e o `failureEventId` (o usuário não repassa o que
o sistema já tem), gera um `retryRequestId` novo e chama `request_work_retry`. Fail-closed pela
prontidão (não RETRY_READY / sem failureEvent) e pela RPC (budget, correlação, versão,
idempotência, autoria). NÃO executa o trabalho — apenas reabre `failed → approved`.

`work authorize-resume` é a autoridade HUMANA de retomada quando o saldo transferido de
um replan de unidade mínima se esgotou (o item está `failed`, `retryable:true`, mas sem
tentativas): concede EXATAMENTE +1 tentativa, sob teto agregado explícito (consumo anterior
+1) e envelope de compute LOCAL, materializando um sucessor `proposed`. É distinta de
`retry` (que exige saldo) e de `replan` (que exige falha NÃO-retryável). A autorização
humana (`--plan arquivo.json`) carrega requestId idempotente, diagnóstico/plano corrigido,
teto e modelos; sem `--plan`, replaya a concessão já persistida. Append-only: o consumo
anterior nunca é reescrito e não há segunda extensão automática — nova falha volta ao
humano. NÃO aprova nem executa (aprovação segue sendo `anima work approve`).

O mesmo comando aceita a variante fechada `kind=budget_blocked_attempt_v1` somente
quando o item está `blocked` pelo último `work_blocked` pré-attempt com
`resolution=awaits_budget_window` e razão de tentativas allowlisted. Nesse caso não
há successor: a concessão item+versão+evento readmite o mesmo item, e a guarda de
`execution_started` consome atomicamente o token de +1. O consumo global de 24h não
é resetado; replay é idempotente e uma segunda partida volta ao budget normal.

`work withdraw` retira canonicamente um plano aprovado que ficou obsoleto ANTES da
execução (base mudou, o contrato de domínio evoluiu, um sucessor melhor o substitui).
Fail-closed: só atinge `approved` sem histórico de execução; não satisfaz dependências
nem apaga lineage. Distinto de `reject` (proposta nunca aprovada) e `failed` (execução
que falhou).

`work resolve-pending` é a saída HUMANA de um resultado candidato que o Verifier obrigatório
não conseguiu concluir (inconclusive/missing/timeout/erro/evidência incompleta). A CLI deriva o
candidato exato (resultado mais recente da versão e attempt vigentes) e a RPC revalida sob lock.
`request-changes` leva a `changes_requested` (daí `work correct` segue como após um review);
`cancel` leva a `cancelled`. Controle humano ≠ bypass: nada aqui produz `review`, parecer,
aceite ou integração. Item em `review` usa `work accept`/`work request-changes`.

`work approve` (aprovar proposta) e `work accept` (aceitar resultado) são operações
de domínio DISTINTAS — a CLI as mantém separadas em vez de colapsá-las.

### Ciclo de correção pós-review, sem a web

`correctReviewedWorkItem` (`lib/work-orchestration/review-correction-orchestration.ts`)
já era application-level: a rota web `review-corrections` só faz parse do body e mapeia
status HTTP. A CLI chama a MESMA capacidade. Assim o ciclo abaixo roda com o Next parado:

```
anima work show <id>            # review → request_changes já registrado → changes_requested
anima work correct <id>         # materializa o sucessor de correção (proposed), preservando
                                #   lineage/budget/idempotência; NÃO aprova
anima work show <successor>     # inspeciona escopo, objetivo e gates planejados (covers)
anima work approve <successor>  # aprovação humana da proposta (proposed → approved)
# a partir daqui, supervisor/resident host seleciona e executa o self-dev
```

O sucessor nasce `proposed` (boundary máximo da correção); a aprovação continua sendo
ato humano. `work show <successor>` expõe os `covers` dos gates planejados para inspeção
de governança do pipeline do Verifier v2 antes de aprovar.

`--json` em qualquer comando de leitura/decisão emite a interface estável para
automação e self-dev. O modo humano é derivado do mesmo payload.

## Códigos de saída

| Código | Significado |
|---|---|
| `0` | Sucesso |
| `1` | Erro operacional (identidade, rede, persistência, item ausente) |
| `2` | Uso inválido (comando/flag desconhecido, argumento obrigatório ausente) |
| `3` | Ação recusada por regra/governança (ex.: `request-changes` num estado que não permite) |


### Retrabalho estruturado em `work correct`

```bash
anima work correct <id> --rework apps/web/lib/exemplo.ts
anima work correct <id> --rework apps/web/lib/exemplo.ts --rework apps/web/lib/exemplo.test.ts --require-gate "npm run typecheck --workspace=apps/web"
```

`--rework <path>` é repetível e exclusivo de `work correct`. Cada valor precisa
ser um arquivo explicitamente incluído no escopo aprovado e não excluído. A
validação normaliza espaços externos, barras e `./` inicial; recusa lista vazia,
paths absolutos, `..`, segmentos vazios ou `.`, glob e paths fora do escopo.
A comparação usa a chave de caminho da derivação (barras e caixa normalizadas),
sem basename ou correspondência parcial. Duplicatas são removidas e a ordem
resultante vem do escopo aprovado.

Com a flag, o texto persistido em `requested_changes` continua obrigatório como
feedback do objetivo, mas não concede autoridade sobre arquivos. O escopo efetivo
é o restante ainda não tocado unido aos paths estruturados. O successor mantém
lineage, checkpoint e gates, e registra `correction_scope.rework_source: 'structured'`.
Sem a flag, permanece o comportamento legado de derivar retrabalho explícito do
texto, sem acrescentar essa chave. A operação apenas materializa um successor
`proposed`; aprovação, execução e aceite seguem a governança existente.

## Referências humanas de trabalho

Todos os comandos com `<id|REF>`, incluindo `budget status`, aceitam UUID ou
referência canônica exata em maiúsculas (`[A-Z]{2,6}-\d{2}`), como `SDC-01` ou
`AKT-04`. Exemplos: `anima work show SDC-01`, `anima work evidence SDC-01` e
`anima work executors SDC-01`. O UUID continua válido em todos os comandos e
permanece a identidade interna no JSON (`id`/`workItemId`).

A referência e o título vêm exclusivamente da provenance canônica persistida.
Não há busca por título, substring, aproximação ou normalização de maiúsculas.
Itens sem provenance canônica são acessíveis somente pelo UUID, com `reference`
e `title` nulos. As saídas humanas de show/evidence/executors/list priorizam
`REF — Título`, seguido do estado e de `id interno: UUID`.

Uma referência inexistente retorna `work_reference_not_found` (exit 1); formato
inválido retorna `invalid_work_reference` (exit 2). Mais de um candidato retorna
`work_reference_ambiguous` (exit 3), sem escolher nem despachar qualquer ação.
Os candidatos aparecem na mensagem humana e no campo opcional `candidates` do
JSON, com UUID, estado, versão da proposta, documento e data de criação. Escolha
explicitamente o UUID desejado; estado, recência e lineage não desempatam.

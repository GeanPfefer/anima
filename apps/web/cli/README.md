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
| `anima work request-changes <id> --reason "..."` | Registra REQUEST_CHANGES pelo fluxo canônico (`reviewResult`) |
| `anima work correct <id>` | Materializa o sucessor de correção governado (`proposed`) via `correctReviewedWorkItem` — NÃO aprova |
| `anima work approve <id>` | Aprova uma PROPOSTA (`proposed → approved`) via `resolveApproval` |
| `anima work accept <id>` | Aceita o RESULTADO em review (`review → completed`) via `reviewResult` |
| `anima work withdraw <id> --reason "..."` | Retira um plano APROVADO não iniciado (`approved → cancelled`) via `withdraw_approved_work` |
| `anima work retry <id>` | Solicita o retry governado (ato humano) de um item `failed`/RETRY_READY via `request_work_retry` |
| `anima help` | Ajuda |

`work retry` reusa a MESMA capability da rota web `retries`: lê `current_work_retry_readiness`
para DERIVAR automaticamente a versão vigente e o `failureEventId` (o usuário não repassa o que
o sistema já tem), gera um `retryRequestId` novo e chama `request_work_retry`. Fail-closed pela
prontidão (não RETRY_READY / sem failureEvent) e pela RPC (budget, correlação, versão,
idempotência, autoria). NÃO executa o trabalho — apenas reabre `failed → approved`.

`work withdraw` retira canonicamente um plano aprovado que ficou obsoleto ANTES da
execução (base mudou, o contrato de domínio evoluiu, um sucessor melhor o substitui).
Fail-closed: só atinge `approved` sem histórico de execução; não satisfaz dependências
nem apaga lineage. Distinto de `reject` (proposta nunca aprovada) e `failed` (execução
que falhou).

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

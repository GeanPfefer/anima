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
| `anima work approve <id>` | Aceita o resultado em review (`accept_result`) |
| `anima help` | Ajuda |

`--json` em qualquer comando de leitura/decisão emite a interface estável para
automação e self-dev. O modo humano é derivado do mesmo payload.

## Códigos de saída

| Código | Significado |
|---|---|
| `0` | Sucesso |
| `1` | Erro operacional (identidade, rede, persistência, item ausente) |
| `2` | Uso inválido (comando/flag desconhecido, argumento obrigatório ausente) |
| `3` | Ação recusada por regra/governança (ex.: `request-changes` num estado que não permite) |

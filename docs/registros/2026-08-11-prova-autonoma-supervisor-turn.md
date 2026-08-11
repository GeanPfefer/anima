# 2026-08-11 — Prova viva: execução autônoma por `Executar autonomamente`

- **Tipo:** prova (com um achado de superfície; **nenhuma alteração de código**).
- **Branch:** `claude/integration-application-layer`.
- **HEAD inicial e final:** `1fa71a3` (mais o commit deste registro). Nenhum commit de código.
- **Objetivo:** verificar se um item **novo**, mantido em `approved` e acionado
  direto por **Executar autonomamente** (`/supervisor-turn`, nunca `/start`),
  atravessa a cadeia `claim → attempt → worktree isolada → coder → gates → review`.

## Estado inicial

Branch `claude/integration-application-layer` @ `1fa71a3`; `origin/main` `973ef46`;
working tree limpa exceto `.worktrees/`. `G:/anima-local-test` detached em `44785fb`
(ambiente do operador) — **não tocada**. Supabase local no ar; Ollama com
`qwen3-coder:latest` (digest `06c1097efce0`, **idêntico** a `qwen3-coder:30b`).

## Setup da prova (reversível, documentado)

- Conta descartável `autoproof-1786474641@test.invalid` (`b225bf8d-9be2-4ff5-bf98-e6d663464f5b`),
  allowlistada para orquestração. **Preservada como evidência.**
- **Superfície de desenvolvimento habilitada temporariamente** e **revertida ao
  final**: `apps/web/.env.local` recebeu, marcada como REMOVÍVEL, a linha
  `ANIMA_DEVELOPMENT_CHAT_USER_IDS=b225bf8d-…`, necessária porque o planejador que
  gera o `execution_spec` de worktree exige `developmentMode:true` + allowlist
  dedicado. Ao final a linha foi removida; o `.env.local` voltou ao estado original.
- Provider `openai` (`gpt-5.6-terra`, configurado pelo operador) para o planejador;
  coder do worktree `ollama:qwen3-coder:latest`. Servidor Next.js iniciado em `:3000`
  (separado do `:3200` do operador) e **parado ao final**.

## Achado central — a UI real não cria item elegível para worktree

A UI padrão do chat (`ChatClient.tsx`) envia `provider`, mas **nunca**
`developmentMode`, e **não existe nenhuma superfície de UI** que o envie (o
`chat-surface.ts` exige `developmentMode:true` + allowlist dedicado, lockdown
deliberado pós-incidente da demo do Mateus). Consequência, comprovada ao vivo:

- **Item `713a34ff-f3c7-45e4-8e9e-92fe11a7d4d1`** — criado por um pedido de
  programação pela rota real do chat (sem `developmentMode`): `capability=programming`,
  `impact=low` (a correção da classificação **funciona ao vivo**), mas
  **`execution_spec` ausente**. Aprovado (`approved`) e acionado por
  `/supervisor-turn` → **`no_eligible_work`** (`selection=null`, `claimId=null`,
  `attemptId=null`).

Isto é **fail-closed esperado**, não defeito da cadeia: sem `execution_spec` não há
executor a rotear, e as pontes de classificação não elegem o item. A lacuna é a
**ausência de uma superfície de UI** que crie um item de worktree elegível — uma
decisão de produto (expor ou não a superfície de auto-desenvolvimento), não um bug.

## Prova da cadeia — com item elegível (produzido pelo único produtor existente)

O único produtor de um `execution_spec` de worktree é o planejador
(`planExecutableProjectWork`, OpenAI). Como nenhuma UI o aciona, o
`developmentMode:true` foi enviado pela **sessão autenticada real** (o próprio
achado acima). Foram criados dois itens elegíveis idênticos em contrato:

| Item | capability/impact | planner | executor | coder | base_sha |
|---|---|---|---|---|---|
| `337ba4ee-a404-430b-8895-a00268126ab8` | programming/low | openai_project_tools_v1 | worktree | ollama:qwen3-coder:latest | `1fa71a3` |
| `b72b67f0-6cd2-41b7-a799-d5b2bfd0e842` | programming/low | openai_project_tools_v1 | worktree | ollama:qwen3-coder:latest | `1fa71a3` |

Ambos: aprovados, **mantidos em `approved`** (nunca `/start`), acionados por
`/supervisor-turn`. **Cadeia persistida atravessada nos dois casos:**

```
work_approved → work_intelligence_classified → work_routing_adjusted →
work_routing_decided → work_claimed → work_started → execution_started →
execution_failed → work_claim_released
```

- **Seleção/roteamento reais:** `selectionPolicy=explicit_card_selection`;
  routing `worktree-v1:configured`, `executorId=worktree-v1`,
  `modelRef=ollama:qwen3-coder:latest`, `effort=strong`; factors
  complexity=bounded, risk=low, reversibility=reversible, planClarity=clear.
- **Claim/attempt reais:** item 1 claim `ed74c7cb…` / attempt `3de59323…`;
  item 2 claim `4bcdce00…` / attempt `03d49c1e…`.
- **Worktree isolada criada:** `anima-work/<attemptId>` a partir do `base_sha`
  `1fa71a3`, em diretório temporário (nunca no repo principal), e disposta ao fim.

## Resultado — falha diagnosticada, não `review`

Ambas as tentativas terminaram em **`execution_failed`** (terminalKind `error`):

> `[ollama_read_round_limit] o modelo esgotou as 3 rodadas de leitura sem propor edições`

O coder local investigou o repositório na worktree mas **não propôs nenhuma
edição** dentro do orçamento de leitura → falhou fechado; os gates (`npm run test`)
**nem chegaram a rodar**. Diagnóstico: **limitação estocástica do coder local**
(o único modelo, `qwen3-coder`, esgota o read-round nesta base), **não** defeito da
cadeia nem do contrato. **Nenhuma correção de código é justificada** — não se força
resultado verde. Uma sessão anterior (2026-08-04, ver PRD/ADR-001) já alcançou
`review` com um coder bem-sucedido, então a cauda `→ gates → review` é conhecida.

## Evidências (por item)

- **713a34ff** — v1, programming/low, `execution_spec` ausente, `approved`,
  `/supervisor-turn` → `no_eligible_work`.
- **337ba4ee** — v1, programming/low, spec worktree, `failed`; claim `ed74c7cb`,
  attempt `3de59323`, worktree `anima-work/3de59323…`, arquivos alterados **nenhum**,
  commits **nenhum**, gates **não executados**, terminal `execution_failed`.
- **b72b67f0** — v1, programming/low, spec worktree, `failed`; claim `4bcdce00`,
  attempt `03d49c1e`, mesma cadeia e mesmo terminal.

## Invariantes verificados

- `G:/anima` **byte-intacto**: HEAD `1fa71a3`, working tree limpa (só `.worktrees/`).
- Execução em **worktree isolada** (temp), disposta ao fim; **0** worktrees
  `anima-work/` remanescentes.
- **Nenhum** `result_accepted`, `integration_decided` ou `branch_published` (0).
- Nenhum push, PR, review request, merge, deploy, publicação externa; `origin/main`
  `973ef46` intacta; nenhum estado `integrated`.
- Itens terminam `failed` (fail-closed), nunca sucesso falso.
- `G:/anima-local-test` (`44785fb`), `.worktrees/` e `.claude/settings.local.json`
  preservados. Nenhum `db reset`.

## Estado final

Branch @ `1fa71a3` (mais este registro); `origin/main` `973ef46`; working tree
limpa; servidor `:3000` parado; `.env.local` restaurado ao original. Itens de prova
e conta descartável preservados como evidência auditável.

## Próximo ponto exato de retomada

1. **Achado central (prioritário):** não há superfície de UI que crie um item de
   worktree elegível para execução autônoma — o `developmentMode` não é exposto por
   nenhuma tela. Decisão humana: expor (e como) a superfície de auto-desenvolvimento,
   ou manter o lockdown e documentar que a criação de item autônomo é fora da UI.
   `BLOCKED_BY_HUMAN_DECISION`.
2. **Cadeia autônoma:** comprovada até o coder (`claim → attempt → worktree → coder`)
   com fail-closed correto; alcançar `review` depende da competência do coder local.
   Repetir com um coder mais capaz (ex.: backend OpenAI de código, hoje não
   selecionável pelo planejador, que fixa `ollama`) exigiria decisão/ajuste — não
   feito aqui.
3. `impact = structural` permanece `BLOCKED_BY_HUMAN_DECISION`; não ampliado.

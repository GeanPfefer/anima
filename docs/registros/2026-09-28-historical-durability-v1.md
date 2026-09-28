# 2026-09-28 — Historical Durability V1: archival refs dos 27 MUST_PRESERVE

## Problema

Uma auditoria Git dos commits **local-only** (alcançáveis por refs locais ou
HEADs de worktree, mas por nenhuma ref de `origin`) encontrou **55 commits**
que existiam apenas enquanto a Goma existisse. A classificação:

| Classe | Qtde |
|---|---|
| MUST_PRESERVE | 27 |
| ALREADY_SUPERSEDED | 5 |
| EPHEMERAL | 11 |
| UNKNOWN_NEEDS_LEDGER | 12 |

Os 27 MUST carregam história real do self-dev (provas pagas, recoveries,
checkpoints de settlement, oráculo B1/B2/B3, provas de runtime). Alguns deles
só eram alcançáveis por worktree (ex.: `af313c3`, HEAD de
`anima-recovery-base` no TEMP), ou seja, um `git worktree prune` ou a perda
do disco apagaria a história.

A classificação não foi refeita nesta tarefa. Ela é a entrada.

## Decisão

Publicar **refs apontando para os objetos existentes**, sem merge sintético,
cherry-pick, rebase ou recriação de commits. A história arquivada é a
história real.

### Por que 15 é o mínimo

Uma ref preserva o commit apontado e todos os ancestrais. Dos 27 MUST,
**12 são ancestrais de outro MUST** (não-maximais) e **15 são maximais**
(nenhum outro MUST os contém). Sem merge sintético, cada maximal precisa de uma
ref própria, e isso basta para carregar os 12 restantes. Um merge sintético
reduziria a contagem de refs, mas criaria um commit que nunca existiu, o que
esta decisão proíbe.

Prova (local, antes do push, e repetida contra `origin` depois):

- `rev-list <15 refs> ^<todas as refs remotas>` = 28 commits = 27 MUST + `42aeba3` (ver abaixo);
- os 27 MUST estão todos no conjunto;
- 15 maximais, cada um com ref própria; 12 não-maximais cobertos por ancestry;
- `af313c3` agora é alcançável por `archive/anima/settlement-benchmark-oracle`, e não só pela worktree;
- nenhuma archival ref aponta para um commit fora dos 15 tips.

### Carga inevitável: `42aeba3`

`archive/anima/prisma-persona-rescue` → `7446dde` tem como pai `42aeba3`
("docs: establish Anima foundation and identity milestone"), que também é
local-only. Ele é o **gêmeo pré-rebase de `05682b4`**, que já está em
`origin/dev`: mesma mensagem, mesma data de autor e o mesmo patch, com
contexto diferente. É, portanto, um commit superseded, carregado só como pai
estrutural da Prisma. Ele **não ganhou ref arquival própria**. Excluí-lo
exigiria reescrever `7446dde`, o que está proibido.

## As 15 refs

Tags anotadas (14). "Imutável" é convenção operacional: **não mover, não
sobrescrever, nunca force-push**.

| Ref | Tipo | Commit (tip) | MUST cobertos | Tema |
|---|---|---|---|---|
| `archive/anima/levels-sol-paid-review` | tag | `7ccc777` | 7ccc777, 9a60f42 | prova paga / review de levels |
| `archive/anima/settlement-benchmark-v3-result` | tag | `7143d69` | 7143d69, 5fad667, 61eb2eb, ccb7dcc | benchmark B1/B2/B3 V3 |
| `archive/anima/settlement-benchmark-oracle` | tag | `af313c3` | af313c3, 0bea4c8, ccb7dcc | oráculo B1/B2/B3 congelado |
| `archive/anima/settlement-paid-recovery` | tag | `41e27ec` | 41e27ec, 421a533, b6201d8 | recovery paga actual-cost settlement |
| `archive/anima/settlement-ponto2-failure` | tag | `f387c61` | f387c61 | failure/recovery settlement ponto 2 |
| `archive/anima/openai-planner-selection-proof` | tag | `1c8b419` | 1c8b419 | prova E2E de seleção OpenAI planner |
| `archive/anima/levels-first-paid-proof` | tag | `d4b91b1` | d4b91b1 | primeira prova paga governada de levels |
| `archive/anima/project-intake-recovery` | tag | `967008e` | 967008e, 1ee1921, 4c0d5a6, 2602dac | Project Intake implementation → repair → failure |
| `archive/anima/provisioning-on-demand-proof` | tag | `bc8c2aa` | bc8c2aa | provisionamento on-demand / observed proof |
| `archive/anima/chat-dev-accepted-recovery` | tag | `4b4cf25` | 4b4cf25, b5309a0, c89765a | Chat Dev accepted / verified recovery |
| `archive/anima/chat-dev-failed-recovery-b` | tag | `755cf95` | 755cf95, c89765a | Chat Dev failed recovery B |
| `archive/anima/chat-dev-failed-recovery-a` | tag | `d1a93ea` | d1a93ea, c89765a | Chat Dev failed recovery A |
| `archive/anima/next-typegen-runtime-proof` | tag | `55dabb6` | 55dabb6 | Next/typegen runtime proof + resource barrier |
| `archive/anima/resident-host-observed-proof` | tag | `e568973` | e568973 | Resident Host observedCommitSha / prova viva |
| `archive/anima/prisma-persona-rescue` | **branch** | `7446dde` | 7446dde | exploração arquitetural/produto da persona Prisma |

A Prisma é **branch** e não tag porque é uma linha histórica de exploração
que pode receber documentação complementar. O commit `7446dde` não foi
alterado e a branch nunca foi feita checkout.

Ao verificar, distinga o SHA do *tag object* do commit apontado: use
`git ls-remote origin 'refs/tags/archive/anima/*'` e leia as linhas `^{}`
(peeled).

### Os 27 MUST cobertos

```
7ccc777 9a60f42 7143d69 5fad667 61eb2eb ccb7dcc af313c3 0bea4c8 41e27ec
421a533 b6201d8 f387c61 1c8b419 d4b91b1 967008e 1ee1921 4c0d5a6 2602dac
bc8c2aa 4b4cf25 b5309a0 c89765a 755cf95 d1a93ea 55dabb6 e568973 7446dde
```

## O que NÃO foi arquivado

Os 28 commits local-only fora dos MUST (16 ALREADY_SUPERSEDED/EPHEMERAL +
12 UNKNOWN_NEEDS_LEDGER) **não receberam archival ref**. Deles, só `42aeba3`
ficou remotamente alcançável, e apenas como pai estrutural da Prisma
(superseded, ver acima). Os outros 27 continuam **apenas locais**:

```
b6438df 072211c e71a0a5 5f5f1f3 4527a5d b4bb3a3 06bcff2 3eaa656 4cc7e0b
7373a85 f5b033c 745959e ba227b7 b4a94a0 1078d1f 0f5bd6b 58450a7 8b08ffb
a97110b c084e1f f1ba1e7 3969ebd 4b2724e 83ad063 7551787 19e3e64 9512fc1
```

Os **12 UNKNOWN_NEEDS_LEDGER** estão entre esses e seguem **pendentes de
consulta ao ledger** (work item / attempt / desfecho) antes de qualquer
decisão. Esta tarefa não os arquivou nem os reclassificou. As `anima-work/*`
também não foram publicadas.

## Três níveis de durabilidade

- **Code Durable**: o código vigente está em `origin/dev` e sobrevive à perda da Goma.
- **Historical Code Durable**: a *história* (tentativas, recoveries, provas, falhas) é alcançável por refs remotas nomeadas e explicitamente arquivadas. Este registro inaugura esse nível para os 27 MUST.
- **Operational Durable**: o estado operacional (banco, ledger, reservas, eventos) sobrevive à perda da máquina. **Não foi tratado aqui**, e o banco continua local na Goma.

## Política

- `archive/anima/*` tags **não devem ser movidas, sobrescritas nem force-pushed**.
- Novas archival refs apontam para commits existentes, sem merge sintético e sem rewrite.
- A publicação é explícita, ref por ref (nunca `git push --tags`).
- A branch snapshot `backup/marco-historical-durability-v1-2026-09-28` registra o estado do `dev` que tomou esta decisão. Ela **não substitui** as archival refs.

## Futuro (não feito)

- **Git bundle** como redundância offline: ainda não criado.
- **Evolution History** poderá consumir `archive/anima/*` como fonte de linhagem histórica.
- Arquivamento dos 12 UNKNOWN depende do ledger.

US$0. Nenhum provider, nenhum banco, nenhum force, nenhum rewrite, nenhuma worktree alterada.

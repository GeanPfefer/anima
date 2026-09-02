# Plano 006 — Project Intake V0

> Estado em 2026-09-01: contrato puro implementado e testado (por Claude); persistência,
> caminho de criação e UI ficam para recortes seguintes — preferencialmente construídos pelo
> próprio Anima (self-dev). Nenhuma execução automática de projeto; nenhuma decisão humana
> fabricada.

## Objetivo

Dar ao Anima a capacidade de **receber uma ideia de projeto** em linguagem natural e persistir
uma **representação estruturada mínima** dela — ANTES de qualquer desenvolvimento. Marca a
transição de fase "construir a oficina" → "usar a oficina para construir o resto da oficina":
sempre que um recorte puder ser legitimamente implementado pelo coder local do Anima, ele deve
ser preferido ao trabalho manual de Claude.

## Distinção inegociável

```
Project Idea (intake)   ≠   Work Item (execução)
```

"Talvez construir um sistema para o estúdio da minha mãe" **não** é "implemente o CRUD de
alunos". O intake existe **upstream** do backlog executivo. A cadeia futura desejada:

```
ideia → discovery → entendimento → análise build/buy/investigate → hipótese de MVP
→ decisão humana → bootstrap → backlog → work_items → execução
```

Este plano cobre apenas o **começo** dessa cadeia (registrar e estruturar a ideia). Discovery,
build/buy, geração de backlog e execução de projeto externo são planos posteriores.

## Vocabulário canônico verificado

Não existe entidade "Project Idea" no repo. Os `project_*` atuais são outra coisa e **não**
devem ser confundidos nem estendidos para isto:

- `project_decision_proposals`/`project_decision_events` — governança conversacional de decisões
  do DESENVOLVIMENTO.
- `project_backlog_proposals`/`project_backlog_materialized_items` — proposta/materialização de
  backlog do desenvolvimento.

"Project" nesses nomes = o contexto de desenvolvimento do próprio Anima, não a ideia de projeto
de um usuário. Por isso Project Intake é um conceito NOVO, com módulo próprio `project-intake`.

## Recortes (V0)

1. **Contrato puro `ProjectIdeaV0`** — FEITO (`da11b90`, `packages/core/src/project-intake.ts`).
   Núcleo irredutível (title/summary/goal) + campos estruturantes (contexto, stakeholders,
   restrições, perguntas em aberto, riscos, integrações candidatas, hipótese de MVP) + `status`
   de exploração (captured→exploring→shaping→decided→archived). `validateProjectIdea`,
   `draftProjectIdea`, `summarizeProjectIdeaIntake`. Domínio-genérico; sem LLM/persistência.
2. **Persistência** — tabela owner-scoped `project_ideas` (RLS por `user_id`), append-only de
   eventos de intake OU linha mutável com histórico; migration + pgTAP. **Bloqueado hoje** por
   stack local desligado (ver Barreira).
3. **Caminho real de criação** — a partir de uma intenção explícita do usuário no chat, criar a
   `ProjectIdeaV0` (via `draftProjectIdea`) e persistir sob a identidade do usuário (nunca
   service_role). Desfecho: ideia em `captured`. NÃO inicia desenvolvimento.
4. **Leitura/projeção** — endpoint read-only + `summarizeProjectIdeaIntake` para listar ideias e
   o que o discovery ainda deve buscar.
5. **Apresentação mínima** — superfície existente (chat/Configurações) mostrando a ideia e seu
   resumo de estruturação. Read-only.
6. **Primeiro intake real** — registrar uma ideia de verdade (o caso do estúdio de pilates é a
   fixture natural; o MODELO permanece genérico).

## Como o Anima constrói os próximos recortes (handoff self-dev)

Cada recorte 2–5 é um bom objetivo para o coder local: pequeno, semanticamente fechado, com
localização descobrível e gate objetivo. O caminho canônico de self-dev:

```
item de backlog canônico (heading estável, ex.: PIN-02 …)
→ materializer (planner LLM produz execution_spec) → work_item `proposed`
→ APROVAÇÃO HUMANA (fronteira real; nunca auto-aprovar)
→ claim → coder local (READ→EDIT) → gates → repair → Verifier → `review`
```

Recorte 2 (persistência com migration) é o de MAIOR risco de convergência para um primeiro
self-dev (SQL + pgTAP + typegen). Recomenda-se dar ao coder primeiro um recorte SEM migration
— ex.: um serializador puro `ProjectIdeaV0 ↔ shape persistido`, ou a projeção de apresentação —
e deixar a migration para depois de uma convergência provada.

### PIN-02 — Codec persistível puro de ProjectIdeaV0

- **Status:** provado ao vivo pelo self-dev até `review` em 2026-09-02, **aguardando aceitação
  humana** (branch `anima-work/5a0c7716…`). 1ª prova de que o Anima consome o próprio backlog
  canônico e evolui a si mesmo pelo fluxo real supervisor→coder→gates→Verifier. Detalhe:
  [registro 2026-09-02](../registros/2026-09-02-pin02-prova-viva-self-dev-review.md). Achado para a
  revisão: a implementação do coder é mínima e o aceite escrito ainda não está codificado como teste
  executável (round-trip / campo extra / versão desconhecida).
- **Problema:** o contrato de domínio ainda não possui uma fronteira explícita e testada entre
  `ProjectIdeaV0` e o shape que uma futura camada de persistência poderá armazenar/ler.
- **Resultado esperado:** exatamente um recorte puro em `packages/core`: shape persistível V0,
  serialização e desserialização fail-closed com round-trip determinístico e testes focados.
- **Dependências:** nenhuma; o contrato puro do recorte 1 já existe.
- **Escopo:** `packages/core/src/project-intake.ts` e seu teste focado.
- **Fora do escopo:** migration, banco, RLS, API, UI, criação via chat, mudança de status,
  decisão build/buy e qualquer Work Item derivado de uma ideia de projeto.
- **Aceite:** round-trip preserva uma ideia V0 válida; shape ausente, extra, malformado ou com
  versão desconhecida falha fechado; teste focado e typecheck de `packages/core` passam.
- **Riscos:** acoplar o domínio prematuramente ao schema SQL futuro; o shape deve permanecer
  provider-neutral e não criar IDs, timestamps ou decisões ainda inexistentes.
- **Tamanho:** S · **Capacidade:** programação · **Raciocínio:** médio · **Checkpoint humano:** sim

## Barreira desta sessão (por que o self-dev não rodou)

Ato humano/infra impossível de substituir por Claude aqui, registrado sem inventar aprovação:

- **Docker daemon DOWN** → sem Supabase local → sem `work_items`/RPCs → sem materializer,
  supervisor turn ou coder. (Ollama e Next também desligados.)
- **Aprovação humana** do `proposed` é fronteira real (o máximo autônomo é `review`; aceitação é
  humana). O Anima não pode se auto-aprovar para executar Project Intake.
- Barreira de hardware conhecida (RAM da Goma) para o coder 30B permanece pano de fundo, embora
  `OLLAMA_MODEL=qwen2.5:14b` no ambiente atenue.

Consequência: o recorte 1 foi implementado por Claude (fundação/seam testável sem stack). Os
recortes 2–5 ficam preparados como trabalho self-dev para quando o stack + o humano estiverem
disponíveis.

## Não fazer (ainda)

Sistema completo de gestão de projetos, Kanban, GitHub Projects, criação de repo, deploy,
billing, CRM, discovery inteiro, geração completa de backlog, execução de projeto externo, o
sistema de Pilates em si, node remoto, microprova paga.

## Governança preservada

`evidência ≠ classificação ≠ decisão ≠ efeito`. Resultado em `review` não é `completed`; aceite
humano continua humano; integração continua separada; nada em `main`; nenhuma autorização paga
implícita.

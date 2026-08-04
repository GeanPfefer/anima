# ADR-001: Execução local de código no repositório real

**Status:** Aceito — Opção A ratificada por Gean (2026-08-04)
**Data:** 2026-08-04
**Decisores:** Gean (ratificado)

## Contexto

O objetivo de longo prazo do Anima (ver [manifesto](../../anima-manifesto.md), camada "Depois") é **codar localmente**: a partir do chat, o Anima planeja, executa e propõe mudanças no próprio código, sob aprovação e **sem merge automático**.

Estado atual:

- **Runner local** (`tools/local-agent`, ratificado no INT-04/Fase D) é um **POC de contrato de segurança**: prova plano-aprovado, execução isolada, **gate factual** (testes verdes antes de aplicar), nenhuma aplicação automática e revisão humana. Substrato: contêiner `python:3.11-slim`, `network none`, cópia sanitizada só de `.py/.json/.md/...`, sem `node_modules`.
- **Consequência dura:** esse substrato **não consegue construir o monorepo TypeScript do Anima** — não tem Node, não recebe os `.ts/.tsx` e não tem `node_modules` (e `network none` impede instalar). O planejador GPT já fixa alvo `project:anima` com gate `npm`, escrito **otimista**, assumindo um executor que ainda não existe.
- **Reutilizável, agnóstico de linguagem:** toda a orquestração (propostas, elegibilidade, claims, supervisor, checkpoints, revisão) e o *desenho* do envelope de segurança. O que falta é o **substrato de execução** que dirige o toolchain real.

Forças em jogo: fidelidade ao projeto real (o gate só vale se rodar de verdade), contenção/segurança, esforço de construção **e de manutenção**, qualidade do modelo que edita, e o contexto **uso pessoal, single-user, humano no loop, sem auto-merge**.

## Decisão (proposta)

Adotar a **Opção A — agente em git worktree com toolchain real** como executor de autodesenvolvimento, com **modelo coder selecionável (Ollama local + GPT nuvem)**, realocando a segurança do contêiner para: **allowlist de comandos + denylist de segredos + isolamento por worktree/branch + gate obrigatório + revisão humana + sem auto-merge**. Manter a Opção B como **endurecimento futuro** caso surja execução multiusuário ou não confiável.

## Ratificação (Gean, 2026-08-04)

Gean **escolheu e ratificou a Opção A**: execução em git worktree isolada usando o toolchain real do Anima no host. Objetivo canônico: tornar real o fluxo **"Anima desenvolve o próprio Anima"**, mantendo invioláveis:

- execução **sempre** em branch/worktree isolada;
- **nenhuma** alteração direta no workspace original;
- **nenhuma** aplicação ou merge automático;
- **allowlist explícita** de comandos;
- **bloqueio** de segredos e caminhos sensíveis;
- **gates obrigatórios**;
- **checkpoints e recuperação**;
- resultado **sempre** enviado para revisão humana;
- **inteligência selecionável por adaptadores**, inicialmente entre local e nuvem.

O **runner Python existente (`tools/local-agent`) não deve ser apagado**: seus contratos e componentes reutilizáveis são preservados, mas ele **deixa de ser o executor principal** para tarefas no monorepo TypeScript.

## Opções consideradas

### Opção A — Agente em git worktree (toolchain real)

O executor cria um `git worktree`/branch do repo real (com `node_modules` e toolchain de verdade); o modelo edita os `.ts`; o gate `npm` real roda; a saída é um **branch/diff para revisão**. Sem merge automático.

| Dimensão | Avaliação |
|---|---|
| Complexidade | Média |
| Custo (infra) | Baixo |
| Fidelidade ao repo real | **Alta** |
| Contenção/isolamento | **Média** (roda no host) |
| Manutenção | Baixa |
| Reuso dos contratos ratificados | Alto |

**Prós:** roda o toolchain real, então o gate é significativo; reaproveita o planejador GPT (já mira `anima`/`npm`); baixo atrito; é como agentes de código práticos (e como o próprio Claude Code) operam.
**Contras:** contenção mais fraca que um contêiner — comandos rodam com o toolchain do host; exige **denylist de segredos** (`.env.local`, credenciais), usuário restrito e allowlist de comandos para ser seguro; risco de operações git destrutivas se não delimitado.

### Opção B — Contêiner Node endurecido (network-none)

Estender a imagem com Node, copiar `.ts/.tsx`, e resolver `node_modules` (pré-instalar na imagem ou montar read-only), mantendo `network none`.

| Dimensão | Avaliação |
|---|---|
| Complexidade | **Alta** |
| Custo | Médio |
| Fidelidade ao repo real | Condicional (depende de provisionar deps certas) |
| Contenção/isolamento | **Alta** |
| Manutenção | **Alta** (imagem sincronizada com as deps a cada mudança) |
| Reuso dos contratos ratificados | Alto |

**Prós:** melhor contenção (network-none, não-root, raiz read-only, sem host).
**Contras:** `node_modules` é grande e versionado; `network none` impede `npm ci` dentro → deps têm de ser pré-providas; montar deps do host esbarra em módulos nativos/paths/plataforma; workspaces npm complicam a cópia; **imposto de manutenção recorrente**.

### Eixo ortogonal — quem escreve o código (decisão do Gean: selecionável)

O executor deve aceitar **provedor selecionável**, no mesmo padrão de [`chat-provider.ts`](../../apps/web/lib/ai/chat-provider.ts): **Ollama local** (tudo na máquina, sem custo, mais fraco/estocástico — visto no INT-04) e **GPT nuvem** (muito mais capaz, API paga, conteúdo sai da máquina dentro das fronteiras já ratificadas). Vale avaliar um terceiro backend pragmático: **invocar um agente de código existente** (Claude Code / Codex) como executor sobre o worktree — menor esforço e maior qualidade que um laço de edição próprio. Selecionável por tarefa entrega o melhor dos dois.

## Análise de trade-off

A tensão central é **contenção (B) × fidelidade + baixo atrito (A)**. Para o monorepo TS real, o modelo network-none-Python-container **briga de frente** com o npm (deps grandes, rede para instalar), e o custo de manter a imagem em dia com as deps é recorrente. A Opção A entrega a visão **hoje**, reaproveitando os contratos ratificados; a segurança migra do contêiner para **branch + gate + revisão + sem-merge + allowlist/denylist** — postura defensável para uso pessoal single-user com humano no loop. A Opção B só se paga se o requisito virar execução de código **não confiável** ou **multiusuário** — que não é o caso agora.

## Consequências

- **Fica mais fácil:** o Anima realmente construir/testar TS; o gate passa a valer; reaproveitar o planejador GPT; a qualidade do resultado sobe com modelo selecionável.
- **Fica mais difícil / exige cuidado:** contenção mais fraca → depende de allowlist de comandos, denylist de segredos, usuário restrito, isolamento por worktree e revisão; nunca passar segredos ao modelo; evitar git destrutivo.
- **A revisitar:** se um dia houver multiusuário ou execução não confiável, reintroduzir o contêiner (B) **por cima** de A.
- **Ainda falta** a ponte de aplicação (INT-03): transformar o branch/resultado aceito em PR revisável — é etapa separada.

## Ação (após decisão)

1. [x] **Gean decidiu**: Opção A ratificada, com modelo selecionável (local + nuvem) — ver *Ratificação* acima.
2. [ ] Se A: definir o `WorkExecutorAdapter` de worktree — criar worktree/branch, editar, rodar gate `npm` real, produzir diff/branch; especificar allowlist de comandos + denylist de segredos + usuário/escopo.
3. [ ] Executor de modelo **selecionável** reusando o padrão de `chat-provider` (local + nuvem; avaliar backend "agente existente").
4. [ ] **Primeiro marco mínimo:** uma mudança trivial e verdadeira (ex.: função pura + teste em `packages/core`, gate `npm run typecheck`/`npm test` escopado) rodando o loop completo chat→proposta→aprovar→executar→review.
5. [ ] Rotular `tools/local-agent` como **POC de contrato** (não executor de produção do monorepo TS).
6. [ ] Planejar INT-03 (aplicação do resultado revisado como branch/PR).

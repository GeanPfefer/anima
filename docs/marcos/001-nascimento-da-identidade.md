# Marco 001 — Nascimento da Identidade do Anima

> Registro histórico. **Append-only** — não editar para alterar ou apagar o conteúdo já registrado; correções pequenas de texto, links ou formatação são aceitáveis, mas o conteúdo histórico principal permanece preservado. Se uma decisão mudar no futuro, cria-se um novo marco.

**Data:** 2026-07-06

---

## Contexto

Gean retomou o plano Claude Pro após um período afastado, durante o qual continuou desenvolvendo a visão do Anima em paralelo com o ChatGPT. Essa maturação trouxe uma mudança de escala na identidade do produto: de "app de memória e evolução pessoal" para "parceiro de evolução pessoal, com visão de longo prazo de se tornar um Sistema Operacional Pessoal".

A sessão começou com um pedido de análise arquitetural crítica do estado atual do projeto à luz dessa visão nova (ver `anima-prd.md` para o estado técnico à época deste marco). Da análise, surgiram decisões de escopo e uma proposta de documentação fundadora, revisada e aprovada por Gean.

## Insight central

> "O que estamos fazendo aqui já é o que o Anima deveria fazer."

O fluxo desta própria sessão — Gean conversa com o ChatGPT sobre visão e arquitetura, depois leva a decisão ao Claude para documentação e código — é um protótipo manual do futuro Anima:

**Hoje:** Gean → ChatGPT → Claude → código/documentação
**Futuro:** Gean → Anima → capacidades internas → ferramentas/modelos → código/documentação/ações

A experiência que o Anima deve um dia oferecer de forma unificada já está sendo simulada manualmente, por fora, nesta própria conversa.

## O que mudou

- **Faseamento explícito da visão** — **Visão A (trabalho ativo agora):** Anima como sistema de evolução pessoal. **Visão B (norte de longo prazo):** Anima como orquestrador de capacidades / Sistema Operacional Pessoal completo. A Visão B é documentada para não fechar a arquitetura futura, mas **não deve engolir o produto atual nem virar backlog imediato** — permanece norte, não tarefa.
- **Jornadas de evolução** — novo princípio: o Anima acompanha jornadas de vida (skate, música, programação, carreira, quarto inteligente, finanças, saúde, etc.), não apenas tarefas.
- **Capacidades internas** — formalização de uma lista de capacidades (Programação, Pesquisa, Arquitetura, Planejamento, Aprendizado, Organização, Automação residencial, Reflexão Crítica) que o Anima pode envolver por trás de uma única experiência conversacional.
- **Regra de autonomia por impacto** — dois regimes formalizados: observação de baixo risco (roda silenciosamente) e ação de impacto (sempre exige confirmação prévia).
- **Reposicionamento do Prisma** — deixa de ser persona conversacional paralela ao Anima (convocada manualmente via `@prisma`, decisão de jun/2026) e passa a ser a capacidade interna de Reflexão Crítica, acionada pelo próprio Anima quando fizer sentido. **Nota de estado:** este marco registra a decisão de identidade — a implementação técnica anterior (`@prisma` manual, persona paralela no `route.ts`/`ChatClient.tsx`) ainda não foi alterada; a reconciliação no PRD (§1a) e no código é trabalho pendente, não concluído por este marco.
- **Criação da documentação fundadora** — `anima-manifesto.md` como constituição do projeto, e este log de marcos (`docs/marcos/`) como histórico append-only de mudanças de visão, separado do PRD (que continua tático).

## Citação-âncora

> "O Anima começa como um parceiro de evolução pessoal, mas deve ser arquitetado para, no futuro, orquestrar capacidades em qualquer jornada da vida do usuário."

## Referências

- [`anima-manifesto.md`](../../anima-manifesto.md) — documento fundador resultante deste marco
- `anima-prd.md` — PRD tático; próximos passos: §0 Fundação, reposicionamento do Prisma (§1a), Capacidades Internas e Jornadas de Evolução

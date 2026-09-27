# 2026-09-27d — Revisão humana da Evolution V2 (review notes)

- **Tipo:** docs-only. Revisão manual, feita pelo humano, da tela `/evolution` depois da
  [Evolution Reconciliation V2](2026-09-27c-evolution-reconciliation-v2.md) (`851876d`).
- **Branch:** `dev`. **HEAD inicial:** `851876d`.
- **Status:** estas são **observações aceitas pelo humano para uma futura Evolution V2.1**.
  Ainda **NÃO** são alterações no modelo. Nenhuma capacidade, maturidade, relação, registry ou UI
  foi alterada nesta unidade.

## 1. Durabilidade do progresso (`memory.durability`)

**`projected` está correto.**

**Ponto forte:** o processo humano comprovado (push de `dev` + snapshot remoto) **não** foi
confundido com capacidade do sistema.

**Durabilidade é maior que git push.** O objetivo deve contemplar algo como:
- Code Durable;
- State Durable;
- Configuration Recoverable;
- Artifact Durable;
- Restore Proven.

Não precisam ser cinco capacidades; primeiro vem especificar o conceito.

**Próximo estágio (`specified`):** definir antes um contrato de **Durable State**:
- o que conta como progresso importante;
- quais classes de estado precisam sobreviver;
- destinos autorizados;
- como detectar estado `local-only`;
- o que jamais pode ser enviado automaticamente;
- quando avisar, e quando propor publicação;
- quando a authority pode permitir publicação;
- como provar recuperabilidade.

Não saltar de `projected` direto para push automático.

**Formulação preferida:**

> O ANIMA detecta progresso importante existente somente localmente e garante, sob política e
> authority apropriadas, que exista uma cópia recuperável fora da máquina de origem.

## 2. Objetivos e dependências

A UI diz, por exemplo, "7/7 capacidades necessárias já existem". Isso é útil, mas insuficiente.

É preciso distinguir:
- a dependência **existe**;
- a dependência **atingiu a maturidade necessária** para o objetivo.

Possível evolução do contrato: `requires capability >= maturity`.

Exemplo conceitual — autonomia progressiva poderia exigir:
- persistence ≥ operational;
- authority ≥ proven/operational;
- run-tests ≥ operational;
- verifier ≥ proven;
- differential-evidence ≥ proven.

Não implementar ainda.

## 3. Authority (`governance.authority`)

**Definição atual:** derivar um envelope de intenção/limites e impedir o que estiver fora dele.

**Evidência real:** várias authorities item-scoped, cada uma consumida por exatamente uma attempt.

**Questão para a V2.1:** para a sua definição atual, a Authority talvez já satisfaça `operational`.
O `advancement` atual cobra "envelopes reutilizáveis e revogáveis por evidência". Isso parece
pertencer a outra evolução:
- delegated authority;
- progressive authority;
- authority reutilizável/revogável;
- promoção/rebaixamento por evidência.

**Não promover agora.** Fica registrada só a necessidade de revisar essa fronteira semântica.

## 4. Autonomia progressiva

**Clarificação aceita.** Autonomia progressiva **não** é simplesmente "o ANIMA faz mais coisas
sozinho". É:

> o ANIMA altera, de forma governada, o quanto pode fazer sozinho com base em evidência acumulada.

**Loop conceitual:**

evidência → avaliação/readiness → mudança de authority → execução → nova evidência → promoção **ou** rebaixamento.

Rebaixar é tão importante quanto promover. O controlador desse loop ainda não existe.

## 5. Fronteira de ferramentas externas (`governance.external-tool-boundary`)

**Revisar a dependência obrigatória em `governance.authority`.** O Research Web mostrou que uma
primitiva read-only governada pode existir só com:
- policy;
- fail-closed;
- fronteira de dado não confiável.

Isso sem paid authority. A authority passa a ser necessária quando a ação externa exige uma
permissão mais forte.

**Revisar também o `advancement`:**
- um segundo consumidor prova **generalidade**;
- uma prova adversarial viva prova **segurança**.

**Critério futuro melhor:**

> provar fail-closed em execução adversarial real e demonstrar que conteúdo externo não consegue
> ampliar ações autorizadas.

## 6. Persistência (`memory.persistence`)

**`operational` está coerente.**

**Limite da escala universal.** O degrau `operational → autonomous` não tem, necessariamente, boa
semântica para toda capacidade. Para a persistência, "resiliência multi-nó/portátil" é mais
disponibilidade, replicação, recuperação e self-healing do que autonomia.

**Questão futura:**

> `autonomous` precisa ser destino obrigatório de toda capability?

Algumas capacidades talvez tenham `operational` como maturidade terminal saudável e evoluam por meio
de capacidades relacionadas.

**Prova exibida:** o card mostra só `supabase/migrations`, embora a persistência seja usada ao vivo
por work items, eventos, authorities etc. Enriquecer a evidência de runtime no futuro, sem rebaixar.

## 7. Abrir página web (`research.web.open`)

**O card está conceitualmente correto.**

`proven → operational` deveria considerar duas dimensões:
- **integração operacional:** um consumidor real dentro do ANIMA;
- **segurança operacional:** runtime com boundary suficiente (contêiner Linux + egress controlado).

O Windows provou funcionalidade, não isolamento de segurança.

## 8. Navegar na web (mínimo) (`research.web.navigate`)

**O que significa hoje:** abrir outra URL validada numa nova sessão efêmera. Não há clique,
histórico nem sessão contínua.

**Possível problema de taxonomia/nome:**
- "navegação stateless";
- "seguir URL validada";
- ou talvez seja só parte de `open` até existir navegação stateful.

**Não mudar agora.**

## 9. Citar evidência web (`research.web.cite`)

**Manter `specified` parece correto.** A descrição da escala merece revisão: existem tipos e helpers
em código (`WebExtractedFindingV1`, `webFindingCitation`), mas nenhum fluxo realiza a capacidade
de ponta a ponta.

**Conclusão importante:**

> supporting code implementado ≠ capability implemented.

A maturidade da capacidade deve refletir realização funcional, não a mera existência de
tipos/helpers.

## 10. Comparar fontes web (`research.web.compare`)

**`projected` está coerente.**

**Relação futura provável, ausente hoje:** `research.web.compare` → `agency.reuse-discovery`. A
descoberta de reuso deveria poder depender da comparação de findings citáveis quando houver
múltiplas fontes.

**Não criar a relação agora.**

## 11. Insight transversal

Preservar explicitamente:

> maturidade da capability ≠ maturidade dos helpers/contratos ≠ maturidade da ferramenta externa.

Avaliar no futuro a distinção entre **capacidade atômica** e **capacidade composta**:
- persistência é primitiva/fundação;
- autonomia progressiva é composição.

Aplicar exatamente a mesma lógica de `advancement` às duas pode criar distorções.

## 12. Durabilidade e memória evolutiva

**Cadeia conceitual futura:**

Durability → Historical Trace → Evolution Narrative → Architectural Memory → continuous self-development.

Sem durabilidade, a memória arquitetural pode perder partes da própria história.

**Distinção a preservar:**
- **Recovery Evidence:** memória operacional/local de curto alcance.
- **Evolution / Architectural Memory:** memória arquitetural de longo alcance.

## Efeitos

- Docs-only: nenhuma alteração de código, registry, maturidade, relação ou UI.
- Sem provider, authority, reserva ou gasto (US$ 0).
- Push de `dev` e snapshot `backup/marco-evolution-v2-2026-09-27` autorizados explicitamente pelo
  humano nesta tarefa.

# Anima — Product Requirements Document
> Documento vivo de design. Última atualização: 2026-08-12 (sessão: proveniência do cancelamento do executor corrigida — `author=executor` no `work_cancelled` do executor, separado do cancelamento humano; migration `20260812000000`, pgTAP 29/730 — e clareza de prompt do coder na volta final; hardening determinístico do coder/executor (orçamento e truncamento do reparo medidos no payload real; cobertura do desfecho de zero alterações); e o desacople do transporte estendido à execução comandada (`/execute-commanded`, mesma classe do `3c9ac70`); ver [registro](docs/registros/2026-08-12-proveniencia-cancelamento-executor.md) e [Plano 002](docs/planos/002-modo-autonomo-v0.md))
> Para retomar o projeto em qualquer IA: cole `anima-manifesto.md` + este documento e diga "quero continuar desenvolvendo o Anima a partir deste PRD."

---

## 0. Fundação

> A identidade e os princípios do Anima estão registrados em [`anima-manifesto.md`](anima-manifesto.md) — documento fundador, que muda raramente. Este PRD é o documento **tático**: features, decisões técnicas e estado de implementação, que muda a cada sessão de desenvolvimento. Mudanças de visão ficam registradas em `docs/marcos/` (histórico append-only) — ver [Marco 001](docs/marcos/001-nascimento-da-identidade.md).

### Princípio → consequência operacional

| Princípio (manifesto) | Consequência operacional (este PRD) |
|---|---|
| "O Anima não tem compromisso com ferramentas" | Modelos e ferramentas de IA (hoje: provedor selecionável no chat — GPT/OpenAI na nuvem ou Ollama local; braço de programação em `tools/local-agent`) são tratados como substituíveis — nenhuma decisão de produto deve depender de um modelo específico |
| "O Anima acompanha jornadas de evolução" | Pilares, quests e futuras features devem permitir acompanhar projetos de vida variados (ver §1g) — não só atividades de tempo cronometrado |
| "Autonomia por nível de impacto" | Observações de baixo risco (detecção de atividade/nota/entidade) continuam rodando silenciosamente; qualquer ação de impacto estrutural/financeiro/irreversível exigirá confirmação prévia quando capacidades de execução existirem (ver §1f) |
| "O usuário interage com uma única experiência principal: o Anima" | Capacidades internas (Prisma, e futuras) não viram personas ou telas concorrentes — tudo acontece na mesma frente conversacional (ver reposicionamento do Prisma em §1a) |
| "Visão A agora / Visão B como norte" | O roadmap tático (§13) continua sendo só Visão A; nada em §1f/§1g vira backlog imediato só por estar documentado |

---

## 1. Visão geral

**Nome provisório:** Anima  
**Plataformas:** Desktop, Web, Mobile (todas)  
**Estágio atual:** Em desenvolvimento ativo — produto pessoal funcional em web e mobile; Modo Construção comprovado; Modo Autônomo V0 concluído até a Fase F; Fase G (experiência no chat) em andamento — UX-01 a UX-04 ratificados; paridade mobile, integração GPT (provedor selecionável) e runner trazido para `tools/local-agent` prontos para revisão (não ratificados)
**Repositório:** https://github.com/GeanPfefer/anima  
**Público inicial:** O próprio criador (uso pessoal para validar o sistema)  
**Público futuro:** Aberto ao público após o sistema estar bem estruturado e funcional

### Conceito central

> **"Um sistema operacional pessoal baseado em memória narrativa, organização implícita e continuidade cognitiva."**

O Anima não é um app de produtividade, um diário gamificado, um chatbot ou um life tracker tradicional. É um **sistema de continuidade cognitiva pessoal** — absorve a vida como ela é (caótica, não-linear, imprevisível) e organiza tudo invisível e continuamente.

**Princípio central atualizado:**
> O sistema aprende o modelo mental do usuário — não o contrário.

O usuário nunca configura a própria vida. Nunca escolhe pilares, preenche formulários nem categoriza. O sistema observa, infere e aprende quem a pessoa é enquanto ela simplesmente vive e escreve.

**O que o Anima NÃO é:** app de produtividade, diário gamificado, chatbot, life tracker tradicional, agenda de pilares.

**O que o Anima É:** uma memória viva capaz de entender, organizar e contextualizar a vida do usuário ao longo do tempo. A gamificação (XP, níveis, radar, eras, quests) é a **camada de feedback visual/emocional** — não o núcleo.

**Standalone primeiro, integrações depois:** 100% autossuficiente. Integrações externas (Obsidian, Apple Health, etc.) só *adicionam* — nunca são dependência. Ver seção 13b.

---

## 1a. Evolução da visão — Anima Core e Prisma

> **Decisão de jun/2026, reposicionada em jul/2026** (ver [Marco 001](docs/marcos/001-nascimento-da-identidade.md)). Esta seção **evolui** a visão original (não a substitui). O Anima deixa de ser visto só como um app de registros e passa a ser uma **infraestrutura pessoal de memória e reflexão**. Formaliza o que o PRD já vinha construindo (camadas cognitivas, memória semântica, arquétipo) sob uma arquitetura única.

### Topologia

```
Usuário
  ↓
Anima  (experiência principal — única frente conversacional)
  ↓
Anima Core  (memória viva — fonte única da verdade)
  ↓
Capacidades internas
  └── 🟣 Prisma  (Reflexão Crítica — reflete e amplia perspectivas)
```

### Anima Core
O **Core** é a fonte única da verdade. Responsável por: memórias, notas, registros, entidades, relações, embeddings, contexto e **identidade emergente**. Consolida as camadas cognitivas já descritas (ver §1d Camadas 1–4) e os objetos já implementados (`xp_records`, `notes`, `semantic_entities`, `entity_pillars`, `pillar_relationships`, embeddings).

**O Core não tem personalidade.** Ele só organiza, compreende e disponibiliza informação. O Anima conversa com o usuário **através** do Core, acionando capacidades internas quando fizer sentido.

### Prisma — capacidade interna de Reflexão Crítica

> **Reposicionamento (jul/2026, ver [Marco 001](docs/marcos/001-nascimento-da-identidade.md)):** Prisma deixa de ser uma persona conversacional paralela ao Anima e passa a ser uma **capacidade interna** — Reflexão Crítica. O usuário não escolhe "falar com o Prisma"; o Anima aciona essa capacidade quando fizer sentido refletir, questionar ou revelar uma tensão. O Anima continua sendo a única frente conversacional (ver [`anima-manifesto.md`](anima-manifesto.md)).

**Estado técnico (jul/2026):** a exploração anterior de convocação manual e Persona Prisma foi retirada da árvore principal e preservada apenas em branch de resgate. O produto não expõe uma segunda identidade conversacional. O acionamento reflexivo interno ainda será desenhado como capacidade do Anima, sem `@prisma`, chat ou identidade visual paralela.

**🟠 Anima** — a experiência principal: registrar, organizar, resumir, lembrar.
- Tom: breve, objetiva, factual, pouco interpretativa.
- Exemplo:
  > Anima — ✓ Registro salvo. Pilares: Carreira, Criatividade. Emoções: Entusiasmo, Ansiedade.

**🟣 Prisma (capacidade interna)** — refletir, gerar hipóteses, revelar perspectivas, identificar padrões e tensões, ampliar a consciência do usuário. Acionada pelo Anima — não é uma frente separada que o usuário escolhe.
- Tom: curioso, reflexivo, **não diretivo**.
- Exemplo:
  > 🟣 Prisma — Observei uma possível tensão. Você demonstra entusiasmo ao falar do Anima, mas preocupação quando fala de estabilidade financeira. Essa interpretação faz sentido pra você?

> Prisma é a Camada 4 (insights/reflexão, ver §1d) expressa como capacidade do Anima. Seu acionamento interno ainda não está implementado como contrato próprio.

### Regra fundamental do Prisma
O Prisma **não** toma decisões, não define objetivos, não determina caminhos, não substitui a autonomia do usuário. Seu papel é formular perguntas e mostrar perspectivas, riscos, oportunidades e padrões. **Toda conclusão é hipótese ou interpretação — nunca verdade absoluta.**

- ❌ "Você deve fazer isso."
- ✅ "Observei estes fatores. Como você enxerga essa situação?"

O objetivo é **ampliar a capacidade de reflexão**, não pensar pelo usuário.

### Identidade Emergente (nova camada conceitual)
A identidade **não é cadastrada — emerge da memória.** O sistema gera **hipóteses** sobre valores, objetivos, interesses, crenças, medos, motivações e padrões comportamentais, cada uma com **evidências** e **confiança (%)**.

Exemplo:
> **Hipótese:** Autonomia parece ser importante pra você.
> **Evidências:** interesse por IA local · projetos próprios · preocupação com independência financeira.
> **Confiança:** 87%

> Generaliza o `profiles.archetype` (4 arquétipos contínuos, já implementado) para um conjunto aberto e evidenciado de traços. Apoiada na memória semântica (`semantic_entities`, `entity_pillars`) e no histórico.

### Hipóteses dinâmicas
Nenhuma hipótese é permanente — a identidade é **viva**. A força de cada hipótese é influenciada por: frequência, recorrência, intensidade emocional, decisões relacionadas e registros recentes. Os registros cotidianos **alimentam as hipóteses automaticamente** — o usuário não reconfirma manualmente; as próprias experiências reforçam, enfraquecem ou transformam hipóteses.

Exemplo:
> Valor: Autonomia · Confiança: 82% · Última evidência: ontem · Baseado em: 47 registros.

O objetivo não é definir **quem o usuário é**, e sim observar **o que parece importante pra ele neste momento da vida.**

### Confirmação conversacional
**Sem telas de configuração.** Toda confirmação acontece na conversa:
> 🟣 Prisma — Observei um possível padrão.  ☐ Faz sentido  ☐ Não faz sentido  ☐ Ainda não sei

Hipóteses confirmadas passam a integrar a Identidade Emergente. (Coerente com o princípio do PRD: nada de wizard/formulário — ver §1c.)

### Arquitetura da IA (camadas do prompt)
A IA **não** é uma representação do usuário e não finge ser ele — ela o **compreende profundamente**. O prompt é montado em três camadas:
1. **Prompt base** — regras permanentes (tom, limites de cada persona).
2. **Identidade Emergente** — valores, objetivos, padrões e interesses observados. ✅ Conectada ao prompt (jun/2026): hipóteses `confirmed` injetadas agrupadas por tipo, sem percentuais, com instrução explícita ao modelo para tratar como observações contextuais — nunca como definições.
3. **Contexto atual** — memórias recentes, conversa atual, situação atual.

O sistema evolui junto com o usuário.

### ~~Controle de personas~~ (superado pelo reposicionamento do Prisma)
~~O usuário escolhe a participação das personas — `[✓] Anima  [✓] Prisma` — podendo deixar **só Anima**, **só Prisma** ou **ambas**, adaptando o nível de reflexão desejado a cada momento.~~

**Superado (jul/2026):** não existe mais escolha entre personas paralelas — Prisma é capacidade interna acionada pelo Anima (ver reposicionamento acima e [Marco 001](docs/marcos/001-nascimento-da-identidade.md)). Este toggle nunca chegou a ser implementado tecnicamente.

### Acionamento reflexivo interno
Não existe convocação de uma persona Prisma. Quando essa capacidade for implementada, o Anima decidirá quando aplicar Reflexão Crítica dentro da mesma conversa e deixará claro que apresenta uma hipótese, sem transferir a interação para outra entidade.

### Filosofia central (reforço)
- O Anima **não** é produtividade, gerenciador de tarefas ou coach.
- O Anima é uma **memória viva**. O Prisma é uma **lente de reflexão** construída sobre essa memória.
- Nem Anima nem Prisma definem quem o usuário é — apenas observam **quem ele parece estar se tornando**.

> **Frase guia:** "O Anima registra a jornada. O Prisma ajuda a enxergar perspectivas. A decisão continua sendo do usuário."

### Proatividade cognitiva (ratificação 2026-08-12)

A necessidade que originou o "Prisma" é a **proatividade cognitiva**, e ela pertence ao **próprio Anima** — não exige uma segunda persona. O Anima evolui de `receber → armazenar → exibir` para `observar → lembrar → relacionar → refletir → projetar → conversar sobre o futuro`: usar os dados acumulados para ajudar o usuário a decidir como seguir adiante.

Neste momento, "proatividade" significa proatividade **cognitiva** — analisar padrões históricos, relacionar dados ao longo do tempo, perceber mudanças, identificar tensões entre objetivos e comportamento real, comparar planos com resultados, projetar cenários, sugerir próximos passos e conversar sobre decisões futuras. **Não** significa, por esta ratificação, iniciar execuções no mundo, começar projetos sozinho ou modificar coisas externas sem um mandato apropriado. A implementação (acionamento reflexivo interno) permanece futura, como já registrado acima. Ver [Marco 005 — Autonomia Progressiva e Identidade Una](docs/marcos/005-autonomia-progressiva-e-identidade-una.md).

---

## 1b. Modelo de interação e cadência

> Definido na sessão de design de jun/2026. Mistura princípios já **decididos** com **hipóteses em teste** no protótipo.

### Princípio organizador
A frequência de input deve **espelhar a velocidade com que cada coisa muda**. Não se pergunta tudo na mesma cadência:

| O que | Velocidade de mudança | Como é capturado |
|-------|----------------------|------------------|
| Identidade, pilares | Emergente e contínua | IA infere da primeira conversa e do comportamento acumulado; nunca configurado manualmente |
| Humor / energia / o dia | Diária | Pulso/entrada do dia (quando der) |
| Atividades | Ao longo do dia | Registro oportunista via texto livre |
| Eventos de vida, mudanças de estado | Rara | Orientado a evento |
| Sono, passos, treino (futuro) | Contínua | Passivo via integração |

### Camadas de input (do mais frequente ao mais raro)
- **Camada 1 — Pulso/entrada do dia:** momento leve, "quando der". **Não** é streak obrigatório.
- **Camada 2 — Registro/entrada (oportunista):** escreve quando quer; opcionalmente com tempo (gera XP). Nunca obrigatório.
- **Camada 3 — Eventos e marcos (raro):** o app não pergunta; o usuário busca quando algo notável acontece. No máximo o app reage.
- **Camada 0 — Passivo (futuro):** integrações puxam dados sozinhas. As camadas 1–3 funcionam plenas mesmo sem ela.

### Princípio: acolhedor com a ausência (decisão de design)
O criador (primeiro usuário) costuma passar **dias sem mexer no celular**. Isso elimina qualquer mecânica de streak punitiva:
- Sem sequência diária "a perder". A ausência nunca é punida.
- Voltar depois de dias fora é **acolhido**, não cobrado ("faz X dias, sem pressa, conta o que rolou").
- O bônus de **pilar esquecido (+50%)** é reposicionado como um *bem-vindo de volta*, não penalidade.
- Mantém a regra do PRD: consistência recompensa, nunca pune.

### Decisões tomadas (jun/2026)
- **Entrada unificada:** ✅ decidido. Diário e registro de atividade são **um único objeto** ("entrada"). Uma entrada tem: data, pilar(es), tempo opcional (gera XP pela fórmula), texto livre, links. O radar/níveis são derivados das entradas. Objetos distintos descartados — podemos revisar no futuro se o uso pedir.
- **Entrada sem tempo:** ✅ decidido. Permitida, gera 0 XP, conta como presença.
- **Backfill com data passada:** ✅ decidido. Registrar com data anterior é permitido; bônus calculados relativos à data informada, não à data do submit.

---

## 1c. Filosofia de produto e perfil do usuário

### Quem é o usuário central
O criador — e o público que ele representa — funciona melhor em estados de **exploração, improviso, adaptação rápida e resolução dinâmica de problemas**. Não se trata de falta de disciplina: é um perfil cognitivo que gera atrito constante com ferramentas lineares e rígidas.

Ferramentas tradicionais (Notion, Todoist, Obsidian) pressupõem um usuário que quer *montar e manter* um sistema. Para esse perfil, manter o sistema vira o trabalho — o usuário rapidamente se transforma em gerente da própria ferramenta.

### O problema central: custo cognitivo de organizar
O problema não é "falta de organização". É o **custo mental** de precisar estruturar tudo manualmente, continuamente, para não perder contexto.

Em videogames esse custo é zero: o sistema mantém inventário, histórico, progresso e objetivos automaticamente. O jogador só vive o jogo. O Anima persegue essa mesma sensação para a vida real.

### Princípio fundador
> O sistema deve se organizar para o usuário — não obrigar o usuário a se organizar para o sistema.

### Papel da gamificação (esclarecido em jun/2026)
A gamificação não é o núcleo do produto. É a **camada de feedback**:
- Progressão visual clara (XP, níveis, radar de vida)
- Sensação de avanço contínuo sem julgamento
- Contexto emocional dos dados acumulados
- Celebração de consistência — nunca punição de ausência

O que o usuário realmente ganha é **clareza sobre a própria vida** — a gamificação torna essa clareza tangível e motivadora.

### Papel da IA (atualizado jun/2026)
A IA opera em dois modos que se complementam:

**Modo 1 — Conversa (único ponto de entrada e reflexão intencional):**
O chat é a **única superfície de entrada do sistema**. Toda informação entra pelo chat — atividades, registros de tempo, eventos de vida, quests, mudanças de estado, reflexões. O usuário nunca "registra algo": ele conta o que aconteceu. A IA interpreta e estrutura automaticamente.
- Primeira conversa: acolhe, infere contexto, detecta pilares iniciais, inicia memória narrativa
- Uso recorrente: continua sendo o único ponto de entrada — o usuário narra, a IA organiza; reflexão e brainstorming acontecem no mesmo chat que o registro cotidiano

Tom ideal: curioso, observador, humano, leve, acolhedor, não-invasivo. Sem coaching genérico, sem pseudo-psicologia, sem perguntas excessivas.

**Modo 2 — Organização implícita (segundo plano, constante):**
- Absorve texto livre e extrai estrutura automaticamente (pilares, duração, humor, entidades)
- Mantém contexto acumulado sem o usuário recontá-lo
- Infere arquétipo comportamental ao longo do tempo
- Constrói memória semântica (Camada 3)
- Detecta padrões invisíveis no histórico

### Diretriz de feature
Toda nova feature deve responder:

> **"Isso reduz ou aumenta a carga mental organizacional do usuário?"**

Se aumentar → provavelmente vai contra a filosofia central.  
Se reduzir → provavelmente está alinhado.

**Consequência arquitetural:** o sistema deve favorecer texto livre, contexto contínuo, memória persistente e organização automática — e **eliminar completamente** campos rígidos, categorização manual e fluxos baseados em formulários ou modais de entrada. A UI é exclusivamente de visualização e navegação — nunca de captura.

---

## 1d. Modelo cognitivo em camadas

O sistema opera em 4 camadas. A ordem importa: cada camada depende da anterior.

### Camada 1 — Memória bruta
Armazena tudo que o usuário despeja: texto original, transcrição de áudio, pensamentos, registros, reflexões, ideias, contexto emocional.

**Nada deve ser perdido. O texto bruto é extremamente importante.**

O usuário não deve sentir que está "alimentando um sistema" — deve sentir que está despejando.

### Camada 2 — Estrutura derivada
A IA extrai automaticamente: pilares, sub-pilares, duração estimada, temas, entidades, humor, contexto emocional, intensidade, relações implícitas.

Essa camada transforma vida narrada em dados computáveis — sem exigir esforço do usuário.

### Camada 3 — Memória semântica
O sistema aprende relações persistentes ao longo do tempo.

Exemplos:
- `"portal dos clientes"` → trabalho recorrente, contexto de estresse
- `"skate"` → regulação emocional, lazer ativo
- `"Anima"` → projeto central da vida atual
- `"dias sem celular"` → padrão comportamental de desconexão intencional
- `"Goma"` → máquina de IA pessoal

Essa camada é responsável pela **continuidade cognitiva real**: o sistema sabe o que aquele contexto significa para *esta* pessoa — sem o usuário reexplicar.

Implementação (jun/2026): entidades nomeadas são extraídas de qualquer mensagem (`detect-entities.ts`) e ligadas a pilares via `entity_pillars` (`link-entities.ts`), além da ligação derivada de atividades via `entity_mentions`. Interesses que não geram atividade ("amo Nujabes") passam a ancorar um pilar emergente (ex: Música).

### Camada 4 — Insights e reflexão
Somente depois das camadas anteriores existirem: insights, padrões, sugestões, previsões, reflexões, perguntas contextualizadas.

**Critérios de qualidade dos insights:**
- Raros (não frequentes a ponto de virar ruído)
- Específicos (vinculados a dados reais do histórico da pessoa)
- Contextualizados (fazem sentido *para esta pessoa*, não são genéricos)
- Honestos (observações, não motivação artificial)

**O que evitar:**
- Frases motivacionais genéricas
- Coaching automático não solicitado
- Pseudo-psicologia
- Respostas vagas que poderiam se aplicar a qualquer pessoa

Exemplo de insight de qualidade:
> "Nas últimas semanas, seus períodos de maior clareza mental coincidiram com dias onde houve atividade física e menor carga contínua de trabalho."

---

## 1e. Arquitetura de IA — princípios

### Estrutura da organização automática

| Nível | Estabilidade | Quem controla |
|-------|-------------|---------------|
| 3 pilares raiz (Saúde, Mente, Relações) | **Fixo** — sempre existem para qualquer pessoa | Sistema — criados automaticamente no signup |
| Pilares emergentes | Semi-dinâmico | IA cria silenciosamente quando detecta área nova; usuário pode renomear/remover |
| Tags / contexto / entidades | Altamente dinâmico | IA extrai automaticamente de cada entrada |

Os 3 pilares raiz são universais: todo ser humano tem corpo, mente e conexões humanas. Os demais emergem da vida real de cada pessoa — sem lista pré-definida, sem catálogo fixo. O usuário que nunca mencionar dinheiro nunca verá "Finanças" no radar.

### A inteligência não vem de modelos maiores
O diferencial do Anima NÃO está em trocar `qwen2.5:14b` por GPT-4 ou Claude. Trocar modelos ajuda marginalmente.

O ganho principal vem de:
- **Memória contextual** — o sistema lembra quem é o usuário
- **Retrieval eficiente** — encontra o contexto certo no momento certo
- **Embeddings semânticos** — entende relações entre entradas distantes no tempo
- **Estrutura semântica persistente** — Camada 3 acima
- **Continuidade temporal** — o sistema sabe o que aconteceu antes
- **Histórico persistente e rico** — quantidade + qualidade de memória bruta

### Prioridade arquitetural (antes de expandir features)
1. Refinar fluxo de entrada natural (reduzir fricção de captura)
2. Melhorar parsing e contextualização (Camada 2 mais rica)
3. Construir memória semântica consistente (Camada 3)
4. Fortalecer timeline narrativa (acesso temporal ao histórico)
5. Criar retrieval contextual temporal (busca semântica no histórico)

Só depois: expansão de features, modelos maiores, integrações externas.

### Objetivo emocional do produto (marco de sucesso)

| Tempo de uso | O que o usuário deve sentir |
|-------------|---------------------------|
| Semana 1 | "Legal." |
| Semana 3 | "Isso está entendendo minha rotina." |
| Mês 2 | "Esse sistema está acompanhando minha vida." |
| Mês 6 | "Esse app lembra coisas sobre mim que eu esqueceria." |

O objetivo é criar: continuidade, confiança, sensação de memória persistente e clareza pessoal.

---

## 1f. Capacidades internas

> **Conceitual — norte arquitetural, não backlog.** Registrado em [`anima-manifesto.md`](anima-manifesto.md) e [Marco 001](docs/marcos/001-nascimento-da-identidade.md). Nada nesta seção deve ser lido como feature a implementar agora; é a Visão B (orquestrador de capacidades) documentada para não fechar a arquitetura futura, sem virar tarefa imediata (ver §0).

O usuário interage com uma única experiência principal: o Anima. As demais inteligências e ferramentas existem como **capacidades internas** — não como personas, não como chats separados, não como telas concorrentes.

Capacidades previstas (ainda não formalizadas como contratos de execução; Prisma já está definido como capacidade conceitual — ver §1a):
- Programação
- Pesquisa
- Arquitetura
- Planejamento
- Aprendizado
- Organização
- Automação residencial
- Reflexão Crítica (Prisma — ver §1a)

Dentro de uma solicitação já aprovada pelo usuário, o Anima poderá escolher quais capacidades internas consultar para executar melhor a tarefa. Fora de uma solicitação aprovada, o Anima não inicia ações por conta própria (ver regra de autonomia por impacto, `anima-manifesto.md`).

## 1f.1 Orquestração de Trabalho e Modo Construção

> Fundação iniciada em jul/2026 — ver [arquitetura de Orquestração de Trabalho](docs/arquitetura/orquestracao-de-trabalho.md), [Plano 001](docs/planos/001-modo-construcao-mvp.md) e [Marco 002](docs/marcos/002-anima-constroi-anima.md).

O Modo Construção é o primeiro caso de uso de uma orquestração genérica de trabalho: o Anima compreende um pedido, propõe trabalho estruturado, solicita aprovação, preserva contexto, acompanha execução e registra resultado e decisões. A fundação futura usa o modelo conceitual `work_items` + `work_events`, separado de quests e sem XP automático.

O bootstrap continua **privado**, mas não é mais apenas manual. O Anima já
possui uma primeira integração local estreita e ratificada: trabalhos
explicitamente aprovados podem ser executados pelo `LocalRunnerAdapter` em
workspace isolada, com limites, evidências, checkpoints, retomada e revisão
humana. Claude, Codex, modelos e ferramentas continuam executores
substituíveis de capacidades, nunca personagens do produto. Não há merge,
publicação, ampliação de escopo ou uso autônomo de segredos.

Após o aceite de um resultado, o mesmo cartão conversacional agora projeta a
segunda decisão humana de integração a partir de `work_events`: **autorizar** ou
**recusar**. A decisão consome a RPC persistida `decide_integration`, é
versionada/idempotente e reaparece corretamente após reload em web e mobile.
`authorize` significa somente **integração autorizada, aguardando execução
protegida**; não significa integrado, publicado, enviado, PR criado ou mergeado.
Existe um publisher Git restrito à primeira etapa autorizada, mas nenhum efeito
Git externo foi executado: o banco local não contém, no checkpoint atual, um
`integration_decided=authorize` correlacionado a resultado aceito com
`WorktreeHandoffV1` persistido. Sem esse conjunto de fatos, o fluxo falha fechado.

O substrato seguinte separa os fatos da execução protegida:
`integration_authorized → branch_published → review_request_created`. Requests e
receipts verificáveis preservam repositório, branch, commit e base exatos, com
reconciliação idempotente após timeout/crash. O provider Git da etapa de branch
faz preflight, inspeção, push por refspec explícito sem force, tags ou wildcard
(`--no-follow-tags` neutraliza `push.followTags` do ambiente) e verificação
pós-efeito; só então uma RPC append-only admite `branch_published`. PR, merge,
apply e `integrated` continuam fora desta etapa e exigem novas autorizações.

O caminho de branch agora é coordenado a partir de fatos persistidos: boundary,
resultado aceito, autorização e `WorktreeHandoffV1` são relidos antes do provider.
Retries após restart reconciliam o remote; resposta incerta entre persistência e
processo não cria falso conflito; drift posterior (branch removida ou alterada)
falha fechado. Web e mobile distinguem “autorizada, aguardando publicação” de
“branch publicada”, mostrando branch/SHA sem afirmar PR ou integração.

Esse caminho está **fiado a uma rota autenticada** (`POST /api/work-orchestration/branch-publications`,
ratificada em 2026-08-10): o corpo carrega só o `workItemId`; remote, repositório,
base e provider vêm da configuração do operador, e branch, commit, SHA e
idempotência do log persistido — nada do cliente vira argumento Git. Sem
configuração de alvo no servidor a rota recusa fechado (503): habilitar o efeito
Git externo é um ato explícito do operador. A autoridade é `auth.uid()` via RLS;
o item de outra conta é invisível e recusado. Nenhum push contra remote externo
foi executado nesta linha — a fiação foi provada contra remote bare local, com
`origin/main` intacta. A criação de review request permanece a próxima fronteira humana.

O **substrato de persistência** do próximo fato do protocolo
(`branch_published → review_request_created`) já existe, **fail-closed e pronto
para revisão (NÃO ratificado)** (2026-08-13): migration + RPC
`record_review_request_created` (exige `branch_published` prévia e amarra o receipt
de review ao de branch), projeção pura `projectReviewRequestReceipt` e orquestração
`createAndPersistReviewRequest` com provider **injetado**.

A **fase 3** — o substrato completo de criação de review request — foi então
**implementada e fiada atrás dos gates do operador, com zero efeito externo**
(2026-08-14, pronto p/ revisão, NÃO ratificado): provider concreto
`GitHubReviewRequestProvider` (só `GET`/`POST /pulls`, idempotente, token só do
ambiente), composição server-side, rota `POST /api/work-orchestration/review-requests`
(corpo só `workItemId`; **duplo gate fail-closed** — sem alvo `ANIMA_INTEGRATION_*`
OU sem `ANIMA_INTEGRATION_GITHUB_TOKEN` ⇒ `503`), e projeção de apresentação do
estado `review_request_created` (web+mobile, sem afirmar merge). Endurecimentos:
liveness da autoridade persistida (`remote_drift` quando o PR observado diverge do
persistido) e desacoplamento das rotas mutativas do `request.signal`. Provado
end-to-end **localmente** (bare Git local + servidor HTTP local emulando o GitHub),
com idempotência e crash-recovery. A **primeira criação real de PR** contra o
GitHub continua sendo o **primeiro efeito externo** e a fronteira humana explícita
— não atravessada. Detalhes nos registros de
[2026-08-13](docs/registros/2026-08-13-substrato-review-request.md) e
[2026-08-14](docs/registros/2026-08-14-fase3-review-request-fiada.md).

O [Marco 003 — Trabalho Autônomo Seguro](docs/marcos/003-trabalho-autonomo-seguro.md)
já possui implementação incremental registrada no
[Plano 002 — Modo Autônomo V0](docs/planos/002-modo-autonomo-v0.md). As fases
A–E estão concluídas: elegibilidade, fila, seleção, claims exclusivos,
tentativas persistentes, execução local, reconciliação, checkpoints reais,
retomada e Supervisor V0 foram implementados e ratificados. A Fase F também
está concluída: o INTEL-01 classifica o trabalho e impede execução autônoma sem
classificação vigente e completa; o INTEL-02 seleciona e registra
automaticamente executor, provedor, modelo e esforço por política explícita;
o INTEL-03 ajusta o esforço entre tentativas por histórico persistido, com
escalonamento e redução auditáveis; o INTEL-04 aplica orçamento por tentativas
e tempo em janelas móveis, preserva capacidade interativa e interrompe com
checkpoint e razão tipada. Tokens e custo financeiro permanecem fora do V0.

**Estado vivo da prova de superfície (2026-08-21, HEAD `5896862`).** A prova
restante `chat → proposta → aprovação → supervisor-turn → qwen3-coder → Next
typegen → typecheck web → Verifier → review` foi consultada primeiro pela RPC
canônica `autonomous_work_budget_status`, como o usuário autorizado. Ela segue
legitimamente pendente: `admitted=false`, razão
`user_attempt_budget_exhausted`, uso `6/6` tentativas do usuário em 24h e
`remainingUserAttempts=0`. Runtime não é a barreira (`354/7200s` em 24h e
`0/2700s` da reserva autônoma em 60 min). A primeira tentativa da janela expira
após `2026-08-22 10:25:00 -03:00`; a prova deve ser retomada por nova consulta
canônica, sem bypass. Ver o
[registro da sessão](docs/registros/2026-08-21-prova-viva-pendente-janela-orcamento.md).

Uma prova em 2026-08-11 (HEAD `1fa71a3`) exercitou o caminho autônomo em duas
partes distintas — não uma prova ponta a ponta completa pela UI. **Pela UI normal:**
um pedido de programação vira proposta `programming/low` **sem `execution_spec`**
(nenhuma tela envia `developmentMode`) e o Supervisor a recusa corretamente
(`no_eligible_work`). **Por sessão autenticada com `developmentMode:true`** (não
pela UI): o botão **Executar autonomamente** (`/supervisor-turn`) sobre um item
**novo** mantido em `approved`, sem início manual, atravessou de fato a cadeia
`classificação → roteamento (worktree-v1/ollama:qwen3-coder) → claim → tentativa →
worktree isolada` (a partir do `base_sha`) e **falhou fechado no coder antes dos
gates/review**: o coder local atual, sob o protocolo e o orçamento de leitura
vigentes, **falhou repetidamente em produzir uma edição antes do limite de leitura**
(`ollama_read_round_limit`) — comportamento observado a diagnosticar, sem afirmar
causa aleatória nem defeito. O repo original ficou byte-intacto, nada foi
aceito/integrado/publicado, o item terminou `failed`. Conclusão: falta uma
superfície de UI que crie um item de worktree elegível; expor (ou não) uma
superfície de auto-desenvolvimento é decisão de produto. Detalhes no
[registro](docs/registros/2026-08-11-prova-autonoma-supervisor-turn.md).

Na continuação da sessão, a hipótese de cancelamento foi confirmada no código:
`/supervisor-turn` repassava o `request.signal` do transporte ao executor, de modo
que abandonar a conexão virava terminal `cancelled` e a RPC o atribuía a `user`.
Isso não representava decisão humana explícita e contrariava a continuidade
aprovada; o commit `3c9ac70` desacoplou os lifetimes sem introduzir daemon ou
scheduler. Nova prova completa pela UI real criou e aprovou o item
`b6ab5eeb`, clicou `Executar autonomamente` e atravessou routing, claim, attempt,
worktree e coder. Com conexão estável, terminou em `execution_failed` por
`ollama_read_round_limit`; gates não rodaram e `review` não foi alcançado. A
causa permanece a separar entre modelo, protocolo, limite de três leituras,
prompt e tarefa. Detalhes no [novo registro](docs/registros/2026-08-11-investigacao-cancelamento-transporte.md).

### Mapa de maturidade do ciclo de programação (ratificação 2026-08-12)

**Estado tático do host autônomo (2026-08-22):** o Resource Governor agora é
gate real para admissão de cada novo ciclo/turno do backlog: pressão baixa permite,
moderada/alta adia com `resource_pressure`, e telemetria indeterminada/erro falha
fechada. O gate não interrompe execução já iniciada e permanece independente do
budget V2, claims, cancelamento e limites anti-loop. O **Resident Local Host V0**
foi desenhado ([ADR-003](docs/arquitetura/adr-003-resident-local-host.md)) e sua
**engine + portos + superfície** implementados: `runResidentHost` (processo Node
iniciado por Gean via `npm run local-host`, Node 24 TS nativo) reconcilia, consulta
o kill-switch (control-plane local, fail-closed), adquire identidade user-scoped
(**Bearer/`auth.uid()`/RLS, sem `service_role`**, fail-closed sem identidade), respeita
o Governor, invoca o host-turn bounded por HTTP, classifica e quiesce/backoff/acorda —
sem cron, sem daemon, sem always-on ainda. Engine agnóstica de transporte (portos
injetados); `tools/local-agent` (Python) permanece EXECUTOR, não orquestrador.
Provado: resident-host **57/57**, typecheck 5 workspaces, duas provas vivas de governança,
e — **PROVA VIVA DO HAPPY PATH: PASS** — com o stack completo (Supabase + Ollama
`qwen3-coder` + Next), o processo assinou como o usuário (Bearer, sem service_role),
reconciliou, o Governor permitiu, invocou o host-turn bounded → worktree isolada → gate
PASS → evidência host-observed → **Verifier `verified`** → item em **`review`** → voltou a
**idle**, **sem nenhuma chamada manual à rota** (item `fdba6c78`; bonus: a 2ª iteração foi
a `waiting_resource` — Governor deferindo admissão ao vivo). Repo byte-intacto,
`origin/main` intacta. **Transporte IN-PROCESS: PASS (2026-08-23, `3a0018a`)** — `RESIDENT_IN_PROCESS=PASS`,
`NEXT_SERVER_REQUIRED=NO`: o resident host compõe a aplicação diretamente (composition root
compartilhada `runProjectBacklogHostTurn`; `createBearerClient` isolado de `next/headers`;
loader zero-dep + `--experimental-transform-types` para rodar o grafo `@anima` standalone),
provado AO VIVO com o **Next DERRUBADO** (item `ff2a8f99` → `review`, Verifier `verified`,
worktree descartada). A rota HTTP continua para web/API/provas mas não é mais requisito.
**AUTO_EVENT_WAKE: PASS (2026-08-23, `0b24573`)** — o polling deixou de ser o wake
primário: o resident host assina o Realtime de `work_events` (RLS por assinante, sem
service_role) e acorda por EVENTO; o poll vira safety net. Fonte do wake ≠ fonte da decisão
(reconcile + política decidem; perdido/duplicado é seguro). Provado AO VIVO com Next DOWN:
runner idle → item criado por processo separado → `wakeSource=event` em 31s (poll=600s não
podia disparar) → `verified` → `review`. Telemetria durável mínima: FEITA (`bfe6876` — log JSONL append-only
`ANIMA_RESIDENT_LOG_FILE`; HostTurnOutcome ganha workItemIds). **Backlog canônico/documental:
descoberta + elegibilidade FEITAS** (`8925b2f`+`213ccfb`, `CANONICAL_BACKLOG_DISCOVERY=PASS`,
`NEXT_CANONICAL_CANDIDATE=PASS`): core puro lê o backlog documental (28 candidatos, IDs
estáveis, deps, estado por keyword) e decide conservadoramente o próximo materializável — no
doc real, `none` (tudo done/unknown; NÃO re-materializa concluído). **Frente aberta — Level 6
(materialização fase→work_item proposed): decisão de produto (granularidade + derivação de
spec).** Registros
[V0](docs/registros/2026-08-22-resident-local-host-v0.md) ·
[in-process](docs/registros/2026-08-23-resident-host-transporte-in-process.md) ·
[auto-wake](docs/registros/2026-08-23-resident-host-auto-event-wake.md) ·
[backlog-canônico](docs/registros/2026-08-23-backlog-canonico-descoberta-e-elegibilidade.md).

O [Marco 005](docs/marcos/005-autonomia-progressiva-e-identidade-una.md) fixou que a programação autônoma **não tem teto artificial**: o ciclo completo (`entender → investigar → planejar → propor → implementar → testar → revisar → corrigir → commit → publicar → PR → integrar → merge → deploy → observar → reparar`) é destino, e **cada estágio recebe autonomia conforme sua própria maturidade e evidência** — as maturidades não são acopladas. O estado atual, classificando cada barreira como **restrição de maturidade** (promovível por evidência) ou **restrição fundamental** (exige decisão humana por não estar definida):

| Estágio | Estado atual | Classificação da barreira |
|---|---|---|
| planejar/propor · implementar (worktree isolada) · testar (gates reais) | maduro e provado ao vivo (ADR-001). **Planejador de trabalho SELECIONÁVEL (2026-08-19, NÃO default):** a etapa de planejamento (mensagem Dev → proposta executável) é provider-agnóstica via porta `ProjectWorkPlanner.proposeArguments`; config de deploy `ANIMA_PROJECT_PLANNER_PROVIDER=openai|local` (default openai). O planejador LOCAL (Ollama, mesmas ferramentas READ-ONLY, sem edição/subprocesso/worktree e sem receber Authorization/segredos) produz só os ARGUMENTOS brutos; o HOST valida (`safePath`/`safeValidationCommand`) e fixa target/executor/coder_backend/base_sha/permissões/limites — o modelo nunca ganha essas autoridades (regressão prova que chaves injetadas são ignoradas). **Prova viva:** proposta executável válida 100% local, **0 chamadas OpenAI**; variância do `qwen3-coder` tratada com host fail-closed + forçar-submit (tools=só submit) + coerção escalar→lista, **sem afrouxar o contrato**. Inteligência que escreve o código é **selecionável** por `CoderBackend` (Ollama local, OpenAI nuvem). **Candidato versionado, ligação viva em construção (2026-08-18, NÃO ratificado, NÃO default, NÃO no `backendFor`):** o **DeepSeek Harness** entra por adaptador com runtime injetado (porta); política pura do host em `harness-turn-lifecycle` (step budget pelo hook `agent/pre-step`; `turn/end completed` **nunca** é sucesso — gates do host decidem). Deps ratificadas e pinadas (`@deepseek-ai/dsh` rc.7 + pi-ai). Arquitetura = **subprocesso confinado** (`dsh --profile headless`, envelope `workspace-write`/rede-off/cwd-worktree); binding versionado e testado (plugin `--patch` que carrega ao vivo + planejador + driver `HarnessRuntime`), **sem editar `node_modules`**. **Tool-protocol RESOLVIDO** (catálogo focado 24→7). **Harness SELECIONÁVEL no fluxo real (2026-08-18, NÃO default):** `coder_backend: "deepseek-harness"` → borda Node real (`node-harness-runtime`, `require.resolve`, `shell:false`) com **retry INTERNO** dirigido por falha de gate observada pelo host (`gateRetryLimit` 1 só p/ harness; Ollama/OpenAI 0), no mesmo attempt/worktree, sem novo attempt/carriedContext, fail-closed em scope/timeout/cancel/throw. Verifier corrigido: classifica gates pelo **estado terminal** (`terminalObservedGates`), FAIL→PASS ⇒ `verified`, evidência bruta preservada append-only (Resource Governor conta o custo bruto). **PROVA VIVA do caminho real 2/2 `verified`** (worktree→coder qwen3-coder→gate host→handoff→Verifier). **Selecionável por config de DEPLOY** (`ANIMA_WORKTREE_CODER_BACKEND`, dev/admin, default ollama — não é escolha por-proposta do usuário). **`pwsh` provado** sob o env mínimo (PowerShell resolvido por caminho absoluto). **Causa raiz do no-op no fluxo real (2026-08-19): plugin `agent-instructions` do DSH injetava `AGENTS.md`/`CLAUDE.md` do repo e derrapava o `qwen3-coder`** → desabilitado no catálogo focado (só config, via `--patch`); com o fix, **prova viva completa do fluxo real = `Verifier verified`** (coder→gate host→handoff→Verifier, nada aplicado). A "correção SystemRoot" do handoff foi **reclassificada como defensiva** (libuv reabastece `SystemRoot`; a falha viva `≈102ms` não reproduz; valor real do commit = isolamento de credenciais). Ver [design note](docs/arquitetura/deepseek-harness-coder-backend.md) | — |
| revisar | **humana** hoje; existe um **Verifier V0 advisory** read-only (web+mobile) que confere **coerência + consistência com o contrato aprovado** (correlação, escopo, gates, cross-check adversarial) e **NÃO** substitui o humano nem os gates. **Prevenção real de git IMPLEMENTADA (2026-08-15):** a evidência de **arquivos/commit** deixou de depender só da atestação do executor — o host inspeciona a branch descartável e persiste `host_observed_evidence_recorded` (`author=system`/`origin=host`, append-only, idempotente por tentativa); o Verifier compara **observed × attested** e uma mentira sobre arquivos/commit vira `attested_contradicts_observed` (observed vence). **Parecer versionado IMPLEMENTADO (2026-08-16):** o parecer do Verifier é persistido append-only (`verifier_opinion_recorded`, `author=system`/`origin=verifier`), **versionado** por `(attempt, verifierVersion, base de evidência)` — a chegada de evidência observada ou um Verifier V2 acrescenta um novo parecer sem apagar o anterior; é **advisory e recomputável** (auditoria, não decisão) e **≠ `integration_decided`** (que é `author=user`, pós-aceite). **Independência de GATE IMPLEMENTADA (2026-08-16), sem reexecução:** o host preserva sua observação de primeira parte dos gates que ele mesmo executa (`runGate` in-process) como `host_observed_gate_evidence_recorded` (`author=system`/`origin=host`, outcome DERIVADO do exitCode); o Verifier a trata como autoridade (gate observado falho reprova; `attested_gate_contradicts_observed` quando o executor mente) e `coverage.gates` vira **true** nesse caminho. Cobertura honesta: **git e gate independentes no caminho worktree**; para executores que rodem gates fora do host, permanece atestado. A política de maturidade que ponderar a atestação segue futuro/**bloqueada** | maturidade (evidência acumulando) |
| commit (branch descartável) | feito na worktree, nunca aplicado | — |
| publicar branch | maduro, atrás de configuração explícita do operador (ADR-002) | maturidade (efeito habilitado por config, não por payload) |
| criar PR (review request) | substrato completo fiado atrás de **duplo gate do operador** (provider GitHub + RPC + rota `503` fail-closed + apresentação), provado só localmente, **zero efeito externo** (2026-08-14, pronto p/ revisão, não ratificado); **primeira criação real de PR = fronteira humana, não atravessada** | maturidade (efeito habilitado por config, não por payload) |
| integrar / merge / deploy | **sem** caminho alcançável; exige nova autorização humana | maturidade |
| alterar a própria política de segurança | exige processo reforçado (isolamento, testes adversariais, replay/simulação, revisão independente, auditabilidade, rollback, rollout gradual, observabilidade, limites explícitos, revogação automática) | **maturidade de grau máximo** — o ato mais protegido, não teto eterno ([Marco 006](docs/marcos/006-politica-de-seguranca-como-maturidade-maxima.md)) |

A leitura correta de "sem publicação/merge automáticos" e "revisão humana antes de integrar" (Marco 003, V0) passa a ser **restrição de maturidade**, não teto permanente — sem afrouxar nada agora. Promover um estágio exige **trabalho de evidência** (testes, dry-run, simulação, idempotência, rollback, reconciliação, validação independente, auditabilidade), não remoção arbitrária da proteção.

**Aprovação como mandato.** A direção ratificada é que o usuário expresse **intenção de nível mais alto** e o sistema derive um **mandato/envelope** (escopo, contratos, invariantes, limites, gates, condições de parada e escalonamento), impedindo automaticamente ações fora dele — em vez de aprovar comando por comando. A arquitetura já pratica parte disso (`execution_spec`, elegibilidade, permissões declaradas, limites, gates); o Supervisor é o candidato natural a autor do mandato, e Executor/Reviewer permanecem papéis separáveis que não precisam ser o mesmo provider (Marco 005 §8–9).

**Separação de contextos de chat (direção; UX em aberto).** Considera-se separar o **chat principal** (vida, memória, planejamento pessoal) de um **contexto de Desenvolvimento/Projetos** (repositórios, work items, diffs, branches, revisão, integração, políticas do projeto), servindo a contexto, memória de trabalho, segurança, permissões, custo de contexto e UX — **sem** separar a identidade (ambos são o mesmo Anima). Um primeiro passo defensivo já existe (fronteira `developmentMode` + allowlist dedicada, §10). A **UX final permanece decisão de produto em aberto**; registra-se apenas a direção conceitual.

## 1g. Jornadas de evolução

> **Conceitual — norte arquitetural, não backlog.** Registrado em [`anima-manifesto.md`](anima-manifesto.md) e [Marco 001](docs/marcos/001-nascimento-da-identidade.md).

O Anima não gerencia apenas tarefas. Ele acompanha **jornadas de evolução** — qualquer área da vida do usuário em construção contínua, não só trabalho ou estudo formal:

- Skate — árvore de evolução, conquistas, manobras, progresso e próximos desafios
- Música — práticas, estudos, repertório, gravações e evolução técnica
- Programação — projetos, decisões técnicas, código, bugs, arquitetura e aprendizado
- Carreira — objetivos, vagas, currículo, aprendizados e decisões
- Quarto inteligente — luzes, cenas, dispositivos e automações
- Finanças, saúde, estudos, empresa e outros projetos futuros

O Anima deve adaptar sua memória, interface e ferramentas ao tipo de jornada que o usuário está desenvolvendo — sem que programação, ou qualquer outra jornada, engula o produto.

**Decisão de arquitetura em aberto (não resolvida nesta atualização):** a relação exata entre "jornada", pilar (§2), entidade (`semantic_entities`) e quest (§6) ainda não foi definida — se uma jornada é um tipo especial de pilar, uma composição de entidade+quests, ou um objeto novo no schema. Fica registrado como pendência para quando a Visão B sair do estágio conceitual.

---

## 2. Pilares de vida

Os pilares são **estruturas emergentes** — não configuradas pelo usuário, inferidas pela IA a partir da vida real de cada pessoa.

### Pilares raiz (fixos — universais)

Criados automaticamente no signup para todo usuário. Representam dimensões que todo ser humano possui, independente de fase de vida, cultura ou situação.

| Pilar | Por quê é universal |
|-------|---------------------|
| **Saúde** | Todo mundo tem um corpo: dorme, move, adoece, envelhece |
| **Mente** | Todo mundo pensa, aprende, sente, processa |
| **Relações** | Todo mundo tem (ou ausência de) conexão humana |

Estes 3 pilares **sempre existem** no perfil do usuário. Ele pode desativá-los se quiser, mas nunca precisa criá-los.

### Pilares emergentes (livres — inferidos pela IA)

Surgem silenciosamente quando a IA detecta um padrão recorrente na vida da pessoa. Não há catálogo pré-definido — o nome, o momento de criação e a relevância são determinados exclusivamente pelo comportamento observado.

**Exemplos de emergência:**
- Alguém que menciona trabalho frequentemente → pilar **Trabalho** aparece
- Alguém que fala de dinheiro/dívidas → pilar **Finanças** aparece
- Alguém com família e casa para cuidar → pilar **Casa** pode aparecer
- Alguém religioso → pilar **Espiritualidade** pode aparecer
- Ninguém tem os mesmos pilares — é um espelho da vida real, não uma planilha

**Pilares que emergem com frequência** (sem serem obrigatórios):

| Pilar | Quando costuma aparecer |
|-------|------------------------|
| Trabalho | carreira, projetos profissionais, entregas |
| Finanças | dinheiro, renda, dívidas, investimentos |
| Lazer | hobbies, descanso, diversão, criatividade pessoal |
| Crescimento | valores, terapia, identidade, vida interior |
| Casa | moradia, família, organização doméstica |

> **Decisão jun/2026:** Catálogo fixo de 7 pilares removido. A taxa XP é 1,0× para todos os pilares — sem hierarquia implícita entre áreas de vida. O `pillar_catalog` existe no schema mas está vazio.

**Regras dos pilares:**
- Os 3 raiz são criados pelo trigger `handle_new_user` no signup — sem onboarding necessário
- Pilares emergentes são criados pela função `getOrCreatePillar` quando a IA os detecta
- O usuário pode renomear, desativar ou remover pilares emergentes a qualquer momento
- Cada pilar tem seu próprio nível (1–50)
- O nível geral do personagem é a média dos níveis de todos os pilares raiz ativos

---

## 3. Sistema de XP

### Filosofia
- Tempo é a única âncora objetiva — não tem como inflar
- O usuário informa apenas o tempo investido; o resto é calculado automaticamente
- Consistência é sempre recompensada, nunca punida
- Todos os usuários usam as mesmas regras (equidade quando abrir ao público)

### Fórmula base
```
XP = tempo (min) × taxa do pilar × multiplicador de bônus
```

### Bônus automáticos (sem input do usuário)
| Bônus | Multiplicador | Condição |
|-------|--------------|----------|
| Pilar esquecido | +50% | Pilar sem registro há 5+ dias |
| Sequência ativa | +30% | 7+ dias consecutivos no mesmo pilar |
| Primeiro do dia | +20% | Primeiro registro do dia em qualquer pilar |
| Quest ativa | +40% | Ação vinculada a uma quest em andamento |

**Teto de bônus:** ×2,5 total (evita distorções extremas)

### Implementação dos bônus (decisão técnica)
- Bônus são detectados automaticamente no servidor no momento do registro
- `primeiro_do_dia`: consulta `xp_records` do dia atual (qualquer pilar)
- `pilar_esquecido`: consulta `xp_records` dos últimos 5 dias para o pilar
- `sequencia_ativa`: consulta `xp_records` dos 6 dias anteriores; se todos têm registro, aplica bônus (7º dia consecutivo)
- Bônus são recalculados no save — não apenas no preview — para evitar race conditions

### O que foi REMOVIDO
- ~~Dificuldade percebida (1–3)~~ — subjetivo demais
- ~~Frequência punindo XP~~ — desmotivador. Consistência só recompensa.

---

## 4. Sistema de eventos

Eventos são ações sem duração — um momento, não uma atividade. Existem 3 tipos:

### Tipo 1 — Marco de quest
- Conclusão de uma quest ou sub-missão definida previamente
- XP é definido pelo usuário **no momento da criação da quest** (antes de começar)
- Sem renegociação após conclusão
- Faixas sugeridas: pequena 50–150 XP / média 200–400 XP / grande 500–1000 XP

### Tipo 2 — Evento de contexto
- Acontecimento sem quest prévia
- XP calculado por âncoras verificáveis:
  - Valor financeiro: XP = valor em R$ ÷ 10 (ex: guardar R$500 = 50 XP)
  - Conquista física inédita (primeira maratona, etc): XP fixo por categoria (~300 XP)
  - Conexão significativa (sim/não binário): XP fixo (~80 XP)

### Tipo 3 — Mudança de estado
- Algo na vida mudou de patamar permanentemente
- XP calculado pelo **delta** (diferença entre estado anterior e novo):
  - Financeiro: delta em R$ (quitou R$5k de dívida = 500 XP)
  - Saúde: delta em métrica verificável (perdeu 5kg em 3 meses = XP proporcional)
  - Trabalho/Propósito: mudança de cargo, área ou renda
  - Relações/Mente: estados binários com XP fixo por categoria

### Por que é difícil trapacear
- Tempo não escala infinito (realidade limita)
- Âncoras numéricas existem fora do app (R$, kg, km)
- Perguntas binárias (sim/não) em vez de escalas
- O usuário é o único juiz — trapacear só prejudica o próprio espelho

---

## 5. Sistema de níveis e eras

### Estrutura
- 50 níveis totais por pilar
- Nível geral do personagem = média dos níveis de todos os pilares ativos
- Curva exponencial: começo rápido, meio desafiador, topo quase inalcançável
- Fórmula: `XP para nível L = ROUND(10 × 1,6^(L-1))` — espelhada no banco via função SQL

### As 5 eras

| Era | Níveis | Nome | XP total aprox. | Tempo estimado* |
|-----|--------|------|----------------|-----------------|
| 1 | 1–10 | Despertar | ~300 XP | ~2 semanas |
| 2 | 11–20 | Construção | ~2.800 XP | ~3 meses |
| 3 | 21–35 | Expansão | ~18.000 XP | ~1,5 anos |
| 4 | 36–45 | Maestria | ~55.000 XP | ~5 anos |
| 5 | 46–50 | Lenda | ~100.000 XP | ~10 anos |

*Assumindo ~60 XP/dia de uso ativo (45 min registrados com bônus ocasionais)

### Funcionalidades desbloqueadas por era

**Despertar (1–10):** pilares básicos, check-in diário, radar de vida, quests simples  
**Construção (11–20):** histórico de evolução, conexões entre pilares, quests com sub-missões, insights automáticos  
**Expansão (21–35):** análise de padrões mensais, comparativo de períodos, quests de longo prazo, pilares customizáveis  
**Maestria (36–45):** relatório anual de vida, predição de tendências, modo foco com IA, exportação de dados  
**Lenda (46–50):** perfil público (quando abrir ao público), mentoria de quests, acesso antecipado a features

> **Estado técnico:** ✅ Implementado — `EraPanel` no modo Game do dashboard mostra era atual, barra de progresso dentro da era, chips de features desbloqueadas e prévia da próxima era (tracejadas). Lógica em `packages/core/src/levels.ts` (`ERAS`, `getEraForLevel`).  

> **Papel de XP/níveis/eras — deliberadamente em aberto (ratificação 2026-08-12).** Não há decisão nova sobre a centralidade de XP/níveis/eras; o tema ficou em segundo plano enquanto o foco é o modo autônomo de desenvolvimento. Por ora: **preservar** o sistema, **não** removê-lo, **não** torná-lo fundamento obrigatório de toda arquitetura nova, manter aberta a possibilidade de Game/Analítico/Minimal (ou outras visões) e avaliar sua importância quando houver uso cotidiano real suficiente da parte pessoal do Anima. A decisão permanece em aberto de propósito — não deve ser preenchida por opinião do agente. Ver [Marco 005](docs/marcos/005-autonomia-progressiva-e-identidade-una.md).

---

## 6. Quests

Quests são objetivos do usuário traduzidos em missões com estrutura de game.

### Tipos de quest
- **Quest principal:** objetivo grande e transformador (ex: trocar de área profissional)
- **Hábito:** repetição que sobe um atributo (ex: dormir 7h por 30 dias)
- **Aprendizado:** conclusão de curso, livro, skill
- **Desafio pontual:** algo com prazo definido

### Estrutura de uma quest
- Pertence a um pilar
- Pode ter sub-missões
- XP total definido na criação (para marcos/conclusão)
- Ações de atividade dentro da quest ganham XP pela fórmula de tempo
- Status: aberta / em andamento / concluída / abandonada

### Sugestão contextual
O app sugere quests e ações disponíveis com base em:
- Estado atual dos pilares (qual está negligenciado)
- Check-in do dia (como o usuário está)
- Quests em andamento
- Hora do dia e histórico de hábitos

---

## 7. Chat unificado — onboarding + logging + conversa

> **Decisão fundamental de jun/2026:** onboarding, chat e registro de atividades são **um único fluxo**. Não existem dois modos separados. O mesmo chat serve desde a primeira mensagem até o uso diário.

### Princípio (Chat-First Total — decisão definitiva jun/2026)
O chat é o **único** ponto de entrada do sistema. Toda informação entra pelo chat, sem exceções:
- atividades do dia, registros de tempo, eventos de vida
- quests, mudanças de estado, reflexões
- qualquer input do usuário

O usuário nunca precisa de:
- Modal de nova entrada / "Registrar atividade"
- Formulários de pilares e duração
- Inputs estruturados fora do chat

Esses elementos **não existem** no produto. A UI é exclusivamente de **visualização, exploração e navegação** — nunca captura dados.

Toda entrada passa pelo chat e é estruturada pela IA: `xp_records`, `life_events`, `quests`, atualização de pilares e memória semântica são gerados pela interpretação do chat — nunca por formulários.

### O que acontece em cada mensagem enviada (Fase 1 — implementado)

Ao receber qualquer mensagem o backend:

1. **Detecta atividades intencionais** (Ollama, conservador — temperatura 0.1, timeout 15s)
   - Registra automaticamente no `xp_records` se encontrar algo válido
   - Retorna header `X-Activity-Logged` com JSON das atividades logadas
   - A IA confirma brevemente no início da resposta, de forma natural

2. **Gera embedding semântico** da mensagem (em paralelo com a detecção)
   - Usado para retrieval contextual no mesmo turno
   - Embedding das notas das atividades salvo em `entry_embeddings` (fire-and-forget)

3. **Responde como IA** com contexto completo do usuário:
   - Pilares ativos (nível, XP, contexto)
   - Atividades recentes
   - Quests ativas
   - Memória semântica
   - Retrieval contextual (entradas similares da história do usuário)

4. **O cliente atualiza o dashboard** via `router.refresh()` se atividades foram logadas

### Modelo de detecção — destinos paralelos

Cada mensagem passa por classificação silenciosa. Os detectores rodam em sequência (para não sobrecarregar o Ollama) e cada um pode gerar um destino diferente:

| Tipo de conteúdo | Destino | XP |
|------------------|---------|-----|
| Atividade intencional (esporte, estudo, trabalho, criação...) | `xp_records` + pilar | Fórmula: tempo × taxa × bônus |
| Nota (alimentação, gasto, humor, ideia, interesse) | `notes` | 5–20 XP flat (profundidade da nota) |
| Meta / objetivo / hábito explícito | `quests` | XP de recompensa ao concluir |
| Entidade nomeada (pessoa, obra, lugar, ferramenta...) | `semantic_entities` + `entity_pillars` | — |
| Conversa pura (pergunta, planejamento, bate-papo) | Nenhum registro | 0 XP |

**Dedup entre destinos (decisão de jun/2026).** Atividades e quests são detectadas primeiro; suas descrições viram exclusões passadas ao detector de notas, e um filtro determinístico na rota descarta notas que descrevem uma atividade cronometrada (duração no texto) ou que repetem muito uma nota de atividade. Evita que "corri 40min" vire ao mesmo tempo XP e nota, ou que "meu objetivo é X" vire nota em vez de quest.

### O que NÃO é registrado como atividade
A detecção é conservadora por design. Falso negativo é melhor que registrar lixo:
- ❌ Comer, beber, almoçar, jantar, tomar café ou qualquer refeição
- ❌ Dormir, descansar, assistir TV, rolar o feed
- ❌ Deslocamento comum (ir ao trabalho, pegar ônibus)
- ❌ Compras rotineiras
- ❌ Perguntas, planos futuros, sentimentos sem ação concreta

### Matching de pilares — estrito
A atividade só é registrada se o pilar detectado corresponder **exatamente** (normalizado, sem acentos) a um pilar ativo do usuário. Sem fallback fuzzy — evita jogar atividades no pilar errado por falta de opção.

### Tom da IA (decisão de jun/2026)
- **Direto.** Sem "Claro!", "Ótima pergunta!", introduções ou rodeios
- **Humano.** Como um amigo que presta atenção, não um assistente que quer agradar
- **Sem perguntas de encerramento.** "Como posso ajudar?" e "Há algo mais?" não existem
- **Sem emojis** na maioria das respostas
- **Prosa em vez de listas** quando o conteúdo for conversacional
- Quando perguntam "o que você é?": responde com o que FAZ na prática, com exemplos reais do histórico do usuário

### Onboarding dentro do chat (Fase 3 — implementado)
A primeira conversa acontece no `/chat`. A rota `/welcome` foi dissolvida — o chat detecta que é o primeiro uso e adapta o comportamento:
- Primeira mensagem: acolhe e pergunta o nome; `api/ai/onboarding/route.ts` extrai via heurística `extractName` e salva no profile. Apelido explícito ("pode me chamar de X") tem prioridade sobre o nome formal quando os dois aparecem na mesma frase (fix jun/2026)
- Depois do nome: chat segue normalmente com detecção de atividades e pilares
- Em segundo plano: infere pilares iniciais, arquétipo, inicia memória narrativa
- `onboarding_completed_at` é setado após contexto suficiente (sem critério rígido)
- O usuário nunca percebe a transição — é o mesmo chat desde o primeiro dia

### Pilares pendentes (Fase 2 — pendente)
Quando o chat detecta uma atividade em pilar ainda não criado para o usuário:
- Cria o pilar com status `pending` (sem aparecer no dashboard)
- Na próxima abertura do dashboard ou ao fim da conversa: "Percebi que você começou kung fu — quer que eu crie um pilar para isso?"
- O usuário confirma (nome editável) ou ignora
- Confirmado → pilar vira `active`; XP da atividade original é aplicado

### Arquétipo inferido (não mais quiz)
Os 4 arquétipos (Explorador, Focado, Construtor, Visionário) são um **modelo comportamental vivo**, inferido continuamente pela IA. O campo `profiles.archetype` é atualizado a cada nova conversa — não fixado num momento inicial.

### Estado técnico
- **✅ Fase 1:** detecção + logging automático via chat implementado (`/api/ai/chat`)
- **✅ Fase 2:** pilares pendentes — pilar novo detectado → `status='pending', is_active=false`; widget no dashboard com confirmação/descarte; XP da atividade original aplicado ao confirmar
- **✅ Fase 3:** `/welcome` dissolvido no `/chat`; onboarding acontece na primeira conversa; `onboarding_completed_at` setado após contexto suficiente
- **✅ Notas no chat:** `detect-note.ts` detecta food/expense/mood/idea/interest/other; XP 5–20 por heurística; `pillar_hint` inferido; IA silenciosa (não comenta). Excluem atividades/quests já detectadas (dedup); item de comida com valor gera duas notas (food + expense) (jun/2026)
- **✅ Detecção de quest robusta (jun/2026):** `detect-quest.ts` sem `format:json` (que enviesava o qwen a retornar `[]`); prompt captura metas mesmo no meio de mensagens multitema ("meu objetivo é aprender japonês" → quest `learning`)
- **✅ Entidades ↔ pilares (jun/2026):** `detect-entities.ts` extrai entidades nomeadas da mensagem inteira (não só de atividades) com `pillarHint`; `link-entities.ts` faz upsert em `semantic_entities` e popula `entity_pillars` (ligação direta entidade↔pilar). Quando o `pillarHint` é uma área nova, cria pilar `pending` para o usuário confirmar — captando interesses/identidade que não geram atividade (ex: "amo Nujabes" → pilar Música)
- **✅ Pilar pendente sem duplicata (jun/2026):** os 3 caminhos que criam pilar pendente (atividade, quest, entidade) usam o helper `create-pending-pillar.ts` (select-or-insert tolerante a corrida); migração `20260617000000` consolida duplicatas e impõe unique index `user_pillars(user_id, lower(name))`
- **✅ Arquétipo contínuo:** `infer-archetype.ts` infere 4 arquétipos (explorer/focused/builder/visionary) em % via Ollama; fire-and-forget a cada ~15 mensagens; salvo em `profiles.archetype`
- **✅ Hierarquia via chat:** `detect-pillar-link.ts` detecta intenção de criar sub-pilar na conversa; header `X-Pillar-Links` + cards Sim/Não no `ChatClient`; `lib/link-pillar.ts` com validação anti-ciclo e múltiplos pais (vínculo aditivo, idempotente por aresta — alinha com o design de "múltiplos pais" da seção de sub-pilares); dropdown também disponível no editor de Config e no card de pilar pendente

---

---

## 7b. Notas — captura silenciosa sem comentário da IA

> **Decisão de jun/2026.** Notas são um objeto central do sistema — tão importantes quanto atividades. São capturadas silenciosamente, sem que a IA comente ou avalie o conteúdo.

### O que é uma nota
Uma nota é qualquer registro que **não se encaixa como atividade intencional**, mas que o usuário quer preservar para análise futura:
- Alimentação (o que comeu, bebeu, onde)
- Gastos e transações financeiras
- Humor e estado emocional
- Ideias, reflexões, observações
- Acontecimentos do dia sem pilar claro

### Por que não é atividade
Comer, beber, sentir algo, gastar dinheiro — são parte da vida, não investimentos intencionais em pilares. Registrar "tomar sorvete" como atividade de Saúde distorce o sistema e cria ruído.

### Filosofia de captura silenciosa
**A IA não comenta, avalia, elogia nem questiona o conteúdo das notas.**

Exemplos do que a IA NÃO faz com notas:
- ❌ "Boa escolha de alimentação!"
- ❌ "Você tem comido muitos carboidratos..."
- ❌ "Isso pode afetar sua saúde!"
- ❌ "Quanto gastou no total hoje?"

A IA simplesmente registra. O usuário vê os padrões por conta própria nos relatórios mensais.

### Contexto implícito das notas
Cada nota carrega contexto pelo tipo de conteúdo detectado:
- Alimento → saúde implícita (para relatório de hábitos alimentares)
- Gasto → finanças implícitas (para relatório de gastos)
- Humor → emocional (para relatório de padrões emocionais)

Esse contexto é armazenado, mas **nunca exibido como julgamento em tempo real**.

### XP de notas (decisão pendente de calibrar)
- Notas geram XP flat com base na profundidade inferida pela IA
- Faixa: 5–20 XP por nota (sem multiplicador de tempo — notas não têm duração)
- Racional: registrar algo tem valor; a quantidade de detalhes indica intenção

### Relatórios mensais — onde as notas fazem sentido
Os dados das notas são apresentados no relatório mensal do usuário:
- Frequência e variedade alimentar
- Total gasto e distribuição de categorias
- Padrão emocional ao longo do mês
- Correlações detectadas (ex: humor baixo nos dias sem exercício)

**Os relatórios são para o usuário ver e interpretar — a IA não apresenta conclusões, apenas organiza os dados.**

### Tabela `notes` (implementada)
```sql
notes (
  id            uuid primary key,
  user_id       uuid references auth.users,
  content       text not null,
  note_type     text,                   -- 'food', 'expense', 'mood', 'idea', 'interest', 'other'
  context       jsonb,                  -- dados estruturados extraídos
  pillar_hint   text,                   -- pilar implícito (Saúde, Finanças, Mente ou null)
  xp_awarded    int default 0,          -- 5/10/20 XP por comprimento+riqueza de contexto
  note_date     date not null,
  created_at    timestamptz default now()
)
```

### Estado técnico
- **✅ Implementado:** migração SQL (`20260609000001_notes.sql`), detecção no chat (`lib/detect-note.ts` web + mobile), tela de notas (web + mobile), XP de notas (5/10/20 por heurística de comprimento/contexto), `pillar_hint` inferido pelo Ollama
- **✅ Tipo `interest` (jun/2026):** migração `20260612000001_notes_interest_type.sql` adiciona `interest` ao check constraint — para gostos/descobertas (música, mídia, hobbies); distinto de atividade e de meta
- **✅ Relatórios mensais:** página `/reports` (web) com navegação por mês, XP por dia (gráfico), tempo por pilar (barras), notas por tipo, maiores sessões

---

## 7c. Modos de exibição

> **Decisão de jun/2026.** Os mesmos dados podem ser apresentados em três modos visuais. O usuário alterna conforme seu estado — não muda o que é registrado, só a apresentação.

### Os três modos

| Modo | Visual | Para quem / quando |
|------|--------|--------------------|
| **Game** | Radar de vida, níveis, XP, eras, conquistas em destaque | Usuário que quer motivação visual, sensação de progresso, o "jogo" |
| **Analítico** | Gráficos de linha, calendário de atividade, estatísticas por pilar, tendências | Usuário em modo de análise, quer padrões, números, comparativos |
| **Minimal** | Lista limpa de entradas e notas, sem game elements, sem métricas | Usuário que quer só escrever e registrar sem distração |

### Princípio
Os dados são idênticos em qualquer modo. A estrutura subjacente (XP, pilares, notas) não muda — só a interface de visualização.

### Implementação
- Campo `display_mode` em `profiles` (`'game' | 'analytical' | 'minimal'`, padrão: `'game'`)
- Alternância via toggle no header do dashboard, persiste no DB via `/api/profile/display-mode`
- **Game:** radar SVG + cards de pilares + `EraPanel` (progresso de era, features desbloqueadas)
- **Analítico:** 3 cards de resumo (XP 30d, dias ativos, pilar líder) + gráfico de linha SVG de XP diário (30d) com tooltips + calendário de atividade (heatmap de dias ativos) + tabela de pilares com XP 7d
- **Minimal:** lista de pilares + registros recentes
- Estado técnico: **✅ Implementado** — web (`HomeDashboard.tsx`) + mobile (`home.tsx`)

---

## 7d. Grafo de vida — visualização das conexões

> **Implementado em jun/2026.** Visualização interativa das relações emergentes entre pilares e entidades extraídas da história do usuário.

### O que é o grafo
O grafo de vida representa visualmente as conexões que emergem dos dados do usuário — sem configuração manual. É uma janela sobre o que o sistema aprendeu sobre a vida da pessoa: como as áreas se correlacionam, quais entidades (pessoas, projetos, lugares) aparecem em cada contexto.

### Estrutura visual

| Elemento | O que representa |
|----------|-----------------|
| Nó de pilar | Cada pilar ativo — tamanho proporcional ao nível; cor por era |
| Nó de entidade | Pessoa, lugar ou projeto extraído das entradas — nó menor; exibido via toggle |
| Aresta pilar↔pilar | Correlação por co-ocorrência temporal (atividades no mesmo período) |
| Aresta entidade↔pilar | Entidade mencionada em atividades daquele pilar |

### Física e interação
- **Force-directed:** nós se repelem, arestas os atraem; simulação contínua de física
- **Viewport anchored:** bounds clampados — nós não escapam da tela
- **Toggle de entidades:** exibe/oculta nós de entidades sem recarregar o grafo
- **Drag:** o usuário pode arrastar nós para explorar

### Implementação
- Página `/graph` (web)
- Three.js + física force-directed customizada
- `GraphClient.tsx` — renderização e simulação no cliente
- Conexão entidade↔pilar: many-to-many emergente via `entity_mentions → xp_records → user_pillars` — **sem tabela extra** (relação já existe implicitamente nos dados)
- `lib/extract-entities.ts` chamado direto no chat route (fix: antes fazia fetch interno sem cookies → 401)
- `scripts/backfill-entities.mjs` — reprocessa entradas históricas com a extração corrigida

### Estado técnico
- **✅ Implementado** — `/graph` (web); pilares + correlações + entidades com toggle; viewport anchored

---

## 8. Fluxo de autenticação

### Rotas
| Rota | Comportamento |
|------|--------------|
| `/` | Roteador inteligente: sem sessão → `/login`; com sessão + onboarding feito → `/home`; com sessão sem onboarding → `/chat` |
| `/login` | Server Action via Supabase Auth; sucesso → `/home` |
| `/signup` | Server Action via Supabase Auth; sucesso → `/chat` (onboarding dissolve na primeira conversa) |
| `/chat` | Chat unificado — onboarding (primeira conversa, extrai nome via `api/ai/onboarding`) + logging + conversa recorrente; detecta automaticamente se é primeiro uso |
| `/home` | Dashboard — radar, pilares, modo Game/Analítico/Minimal; protegida por auth guard |
| `/history` | Timeline de atividades agrupada por dia com XP diário/semanal e badges de bônus |
| `/notes` | Lista de notas agrupadas por data com badges de tipo (food/expense/mood/idea) |
| `/quests` | Lista, criação, sub-missões, conclusão e abandono de quests |
| `/reports` | Relatórios mensais — XP por dia, tempo por pilar, notas por tipo, maiores sessões; navegação por mês |
| `/graph` | Grafo de vida — Three.js force-directed; nós=pilares+entidades; arestas=correlações |
| `/settings` | Dados da conta, troca de senha, logout, export Obsidian |
| `/forgot-password` | Envia e-mail de reset via `supabase.auth.resetPasswordForEmail`; em dev, e-mail chega no Mailpit (porta 54324) |
| `/auth/callback` | Route Handler que troca o `code` por sessão (PKCE); redireciona para `?next=` |
| `/reset-password` | Define nova senha via `supabase.auth.updateUser`; redireciona para `/home` |
| ~~`/welcome`~~ | ~~Deprecated — dissolvida no `/chat`~~ |
| ~~`/step-1` a `/step-5`~~ | ~~Deprecated — substituídas pelo onboarding conversacional no `/chat`~~ |

### Decisões técnicas de auth
- Auth via `@supabase/ssr` com cookies — necessário para Server Components lerem a sessão
- Server Actions para login/signup — garante que o cookie é setado antes do redirect
- Layouts assíncronos como auth guards — padrão Next.js App Router
- `resetPasswordForEmail` chamado do cliente browser (PKCE requer código de verificação armazenado em cookie)
- `server.ts` usa try/catch no `setAll` de cookies — Server Components não podem escrever cookies, mas a leitura da sessão funciona normalmente
- Cliente browser usa `createBrowserClient` do `@supabase/ssr` (não o vanilla `createClient`) para ler sessão dos cookies em sincronia com o servidor

---

## 9. Banco de dados

### Tabelas principais

| Tabela | Função |
|--------|--------|
| `profiles` | Dados do usuário (nome, onboarding_completed_at) |
| `pillar_catalog` | Legado — estrutura existe, dados vazios (catálogo fixo removido em jun/2026) |
| `user_pillars` | Pilares do usuário — raiz (criados pelo trigger) + emergentes (criados pela IA) |
| `xp_records` | Histórico imutável de atividades registradas |
| `notes` | Notas de alimentação, gastos, humor, ideias (ver seção 7b) |
| `life_events` | Eventos sem duração (marcos, conquistas, mudanças de estado) |
| `quests` | Quests do usuário |
| `quest_missions` | Sub-missões de uma quest |
| `ai_conversations` | Histórico de mensagens do chat |
| `entry_embeddings` | Embeddings semânticos das notas de atividades (pgvector) |
| `semantic_entities` | Entidades persistentes extraídas pela IA (pessoas, lugares, projetos) |
| `entity_mentions` | Vínculo entre entidade e entrada (`xp_records`); fonte para o grafo de vida |

### Triggers automáticos
- `on_auth_user_created` → cria row em `profiles` + os 3 pilares raiz (Saúde, Mente, Relações) em `user_pillars`
- `on_xp_record_insert` → atualiza `xp_total` e `level` em `user_pillars` ao inserir atividade
- `on_life_event_insert` → mesmo comportamento para eventos de vida
- `on_mission_completed` → auto-completa a quest quando todas as missões estão concluídas

### View
- `character_stats` → agrega nível e XP de todos os pilares ativos por usuário

### Acesso local (desenvolvimento)
- Studio visual: `http://127.0.0.1:54323`
- URL PostgreSQL direta: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- Subir: `npx supabase start` (dentro de `~/anima`)
- Resetar dados: `npx supabase db reset`

---

## 10. Decisões de design registradas

| Decisão | Escolha feita | Motivo |
|---------|--------------|--------|
| Nível do personagem | Média dos níveis dos pilares | Representa a vida completa, não uma área só |
| Âncora de XP | Tempo (único input do usuário) | Objetivo, não inflável |
| Dificuldade percebida | Removida | Subjetiva demais |
| Frequência punindo XP | Removida | Desmotivador |
| Nível inicial pelo onboarding | Removido | XP deve ser ganho, não declarado |
| Stack técnica | React Native + Expo + Next.js + Supabase + TypeScript | Multiplataforma real, compartilhamento de lógica, início rápido sem infra |
| Pilares | **Emergentes** — IA infere e sugere; usuário nunca configura explicitamente | Configuração forçada é fricção; pilares devem refletir a vida real observada, não a ideal declarada |
| XP de quests | Definido antes de começar | Remove viés de inflação pós-conclusão |
| ~~Onboarding em 5 steps~~ | ~~Removido~~ | Substituído por primeira conversa natural; wizard rígido contradiz filosofia central |
| Auth via Server Actions | Escolhido sobre client-side | Cookie setado server-side é necessário para SSR ler a sessão |
| `xp_records` imutável | Update bloqueado por design no schema | Histórico de XP não pode ser editado — integridade do sistema |
| Bônus recalculados no save | Não confia no preview do cliente | Evita race condition se outro registro acontece entre preview e submit |
| Cliente browser usa `createBrowserClient` | Em vez do vanilla `createClient` do supabase-js | Sessão gravada em cookies pelo servidor; vanilla lia do localStorage e não encontrava o usuário |
| `setAll` de cookies em try/catch no server.ts | Ignora erro silenciosamente em Server Components | Next.js só permite escrever cookies em Server Actions e Route Handlers; a leitura da sessão funciona normalmente |
| Lente do produto | Agenda + diário por pilares, com game por cima | Escrever é algo que a pessoa já quer fazer; logar é fricção que se abandona — input vira valor |
| Input natural com IA | Campo único de texto livre; IA detecta pilares, duração e nota | Formulário estruturado gerava fricção — usuário não devia "administrar o sistema"; IA absorve a classificação silenciosamente |
| Registro multi-entrada | Um texto pode gerar múltiplas entradas (ex: "corri 45min e li 30min") | Vida não é atômica; um momento pode nutrir vários pilares simultaneamente |
| Papel da gamificação | Camada de feedback, não núcleo do produto | XP/níveis tornam a clareza tangível — mas o diferencial real é a auto-organização invisível; gamificação sem essa base é só estética |
| Papel da IA | Duas camadas: organizadora implícita (segundo plano) + chat como único ponto de entrada | IA organiza silenciosamente o que o usuário narra; chat é onde toda informação entra — tanto registro cotidiano quanto reflexão e brainstorming |
| ~~Chat como camada complementar~~ | ~~Não é a interação primária nem o modo padrão~~ | **Decisão revertida (jun/2026):** Chat-First Total — chat é o único ponto de entrada; ver linha abaixo |
| Chat-First Total | Chat é o único ponto de entrada do sistema; UI serve apenas para visualização, exploração e navegação — nunca captura | Todo registro que não passa pelo chat cria fricção e contradiz a filosofia central; a IA é o único parser do sistema |
| Fronteira chat pessoal × desenvolvimento | O chat padrão é conversa pessoal e **nunca** recebe ferramentas de repositório; o código só é investigável no modo de desenvolvimento explícito (`developmentMode` + allowlist dedicado `ANIMA_DEVELOPMENT_CHAT_USER_IDS`), nunca pela linguagem da mensagem | Incidente na demo (ago/2026): o GPT expôs caminhos internos e um arquivo não versionado a um usuário comum que pediu "implementar upload". Separar as superfícies impede o vazamento; o limite de ferramentas degrada para resposta textual (sem 422 vazio) e turnos interrompidos ficam retryáveis sem duplicar a mensagem |
| Entrada por áudio | Mic button no **chat**: grava → Whisper transcreve → insere no campo de texto do chat | Falar é mais natural que digitar; alinha com o princípio de input caótico/natural; modal de entrada de áudio eliminado pelo Chat-First Total |
| Diretriz de feature | "Reduz ou aumenta a carga mental organizacional?" | Critério de priorização de toda nova feature; detalhado na seção 1c |
| Acolhimento da ausência | App nunca pune ausência; voltar depois de dias é acolhido | Criador passa dias sem o celular; streak punitivo faria largar o app |
| Streak punitivo | Nunca existirá | Mesma razão; consistência só recompensa |
| Cadência de input | Espelha a velocidade de mudança de cada coisa | Evita pedir tudo na mesma frequência; reduz fricção |
| Obsidian | Integração aditiva (opção híbrida): app fala markdown, não depende do Obsidian | Funciona standalone e integrado; "só adiciona, nunca atrapalha" |
| IA local (Ollama) | Modelos open-source rodando na máquina do usuário (Goma) via API HTTP | Privacidade total, custo zero, sem dependência de terceiros; qualidade inferior ao GPT-4 mas aceitável para uso pessoal |
| Arquitetura IA | Notebook → API Next.js → Ollama na Goma (100.68.239.78:11434) | Separação de responsabilidades: notebook para dev, Goma para inferência pesada |
| Modelo padrão | qwen2.5:14b (general purpose, não coder) | Respostas mais naturais para contexto pessoal vs. coder que é técnico/seco |
| Sistema de arquétipos | 4 arquétipos (Explorador, Focado, Construtor, Visionário) com % combinados — **inferidos comportamentalmente** | Personalidade não é binária; arquétipo vivo é mais preciso que resultado de quiz pontual |
| ~~Quiz de arquétipo~~ | ~~Removido~~ | Substituído por inferência contínua da IA a partir de escrita, padrões e comportamento |
| Sub-pilares | Hierarquia infinita com múltiplos pais; XP propaga 100% para todos os ancestrais | Tudo na vida é correlacionado — 1h de Skate melhora Saúde E Lazer de verdade, não 50% de cada |
| Sub-pilares excluídos do nível | character_stats só conta pilares raiz (sem pais) | Sub-pilares já propagam XP para pais — incluí-los causaria dupla contagem no nível do personagem |
| Contexto de pilar | **Inferido pela IA** da primeira conversa e entradas acumuladas; salvo em `user_pillars.context` (JSONB) | Perguntas de contexto explícitas são fricção; IA extrai contexto da conversa natural |
| ~~Perguntas estruturadas de contexto~~ | ~~Removidas~~ | Substituídas pela inferência via primeira conversa e comportamento acumulado |
| XP de quests limitado | Máx 10.000 XP por quest e por missão | Evita distorções extremas no sistema de progressão |
| Taxas XP iguais | Todos os pilares em 1,0× XP/min | Tempo vale igual em qualquer área da vida — sem hierarquia implícita |
| 3 pilares raiz fixos | Saúde, Mente, Relações criados automaticamente no signup | Universais — todo ser humano tem corpo, mente e conexões; elimina onboarding obrigatório |
| Catálogo de pilares removido | `pillar_catalog` vazio; pilares emergem livremente via `getOrCreatePillar` | Catálogo pré-definido (7 pilares) era contradição com filosofia de sistema que aprende — a vida real não tem lista fixa |
| Nomes de pilares emergentes | IA nomeia livremente em português, máx 20 chars | Sem restrição de vocabulário — "Casa", "Espiritualidade", "Skate" são tão válidos quanto "Trabalho" |
| Auth guard no index.tsx (mobile) | `index.tsx` faz getUser() + checa DB; `_layout.tsx` é estático | Expo Router 54 não tolera retorno condicional no root layout sem quebrar navegação |
| getUser() na abertura (mobile) | Em vez de getSession() | Valida sessão no servidor; detecta usuário deletado após db reset e limpa AsyncStorage |
| SafeAreaProvider na raiz (mobile) | `app/_layout.tsx` envolve tudo | useSafeAreaInsets() crasha silenciosamente sem o provider |
| useFocusEffect em home e history (mobile) | Em vez de useEffect | Recarrega dados ao entrar na aba; XP de quests aparece imediatamente ao voltar |
| PillarCard fora do componente (mobile) | Componente definido no módulo, não dentro do pai | Componentes definidos dentro de outros criam novo tipo a cada render → chave duplicada e remount desnecessário |
| Padrão de adaptador p/ integrações | Núcleo agnóstico + conector plugável na borda | Mesmo encaixe serve depois para Health/Fit; não acopla o app a ferramenta externa |
| Sync Obsidian inicial | Só export, mão única (Postgres → markdown) | Duas vias (conflito/parsing) poderia quebrar e "atrapalhar"; fica para fase 2 |
| Chat como superfície única | Chat = onboarding + logging + conversa; sem modal separado de "nova entrada" | Unifica o ponto de entrada; reduz fricção; a IA organiza em segundo plano |
| Notas vs Atividades | Alimentação, gastos, humor → `notes`; esportes, estudo, trabalho → `xp_records` | Comer não é investimento em pilar; registrar tudo como atividade distorce o sistema |
| IA silenciosa em notas | A IA não comenta, avalia nem questiona o conteúdo das notas | Usuário quer registrar, não ser julgado; padrões ficam para os relatórios mensais |
| Relatórios mensais | Dados de notas apresentados mensalmente para o usuário interpretar | IA organiza, usuário interpreta — sem conclusões automáticas |
| Modos de exibição | game / analytical / minimal — mesmos dados, apresentações diferentes | Diferentes estados do usuário pedem diferentes interfaces; sem criar dois produtos |
| Pilares pendentes | Novo pilar detectado → status `pending` → confirmação do usuário | Evita criar pilares errados; confirma intenção sem bloquear o fluxo |
| Tom da IA (jun/2026) | Direto, humano, sem "Claro!", sem perguntas de encerramento, prosa > listas | Respostas corporativas afastam; o diferencial é parecer um amigo, não um assistente |
| Detecção estrita de pilares | Match normalizado exato — sem fallback fuzzy | Falso negativo é melhor que registrar em pilar errado |
| Alimentos → notas, não Saúde | Comida e bebida nunca viram atividade de pilar | Comer é rotina básica; registrar como atividade cria ruído e dilui o valor de Saúde |
| Grafo de vida | Nós = pilares (tamanho por nível) + entidades (toggle); arestas = correlações por co-ocorrência temporal | Visualização das relações emergentes — padrão deriva dos dados sem configuração manual |
| Entidades no grafo via `entity_mentions` | Many-to-many entidade↔pilar emerge de `entity_mentions → xp_records → pillar`; sem tabela extra | Relação já existe implicitamente nos dados de menções; tabela explícita seria redundante |
| Hierarquia de pilares via chat | `detect-pillar-link.ts` detecta intenção de aninhamento em linguagem natural; cards Sim/Não inline | Reduz fricção: usuário expressa a relação conversando, sistema confirma sem sair do chat |
| Dedup de atividades/quests | Pilar+data+nota e título de quest deduplicados antes de persistir no chat route | Previne duplicatas quando o modelo detecta a mesma atividade em mensagens similares consecutive |
| Extração de entidades direta | `lib/extract-entities.ts` chamado como lib, não via `fetch` interno | Fetch interno no Route Handler não carrega cookies de auth → 401; chamada direta resolve |
| Banco único multi-máquina (jun/2026) | Goma é a única fonte de Postgres; qualquer notebook cliente novo (ex: Nomad) aponta `.env.local` para a Goma via Tailscale em vez de rodar Supabase local | `supabase start` cria um Postgres isolado por máquina — cada notebook com banco próprio duplicava conta e histórico do usuário; ver §15 |
| GRANT ausente em tabelas de migration | Nova migration `20260620000000_grant_default_privileges.sql`: `GRANT ALL` + `ALTER DEFAULT PRIVILEGES` em `public` para `anon`/`authenticated`/`service_role` | Tabelas criadas por migration (role `postgres`) não recebem GRANT automático como as criadas pela role `supabase_admin` — PostgREST nega acesso antes de avaliar RLS, silenciosamente (o chat engole o erro). Só aparece num banco 100% do zero; a Goma nunca teve esse problema (corrigida manualmente em algum momento, fora de migration) |
| Anima como experiência principal | Usuário interage com uma única frente conversacional; capacidades internas ficam por trás, nunca como telas ou chats concorrentes | Evita fragmentar a experiência entre "falar com Anima" e "falar com outra coisa"; ver `anima-manifesto.md` |
| Prisma reposicionado (jul/2026) | Deixa de ser persona paralela convocada pelo usuário; vira capacidade interna de Reflexão Crítica, acionada pelo Anima | Consistente com "Anima como experiência principal"; exploração técnica de persona foi arquivada e o acionamento interno permanece futuro — ver §1a e [Marco 001](docs/marcos/001-nascimento-da-identidade.md) |
| Orquestração de Trabalho (jul/2026) | Fundação futura em `work_items` + `work_events`; Modo Construção é o primeiro caso de uso, em bootstrap privado e manual | Permite provar intenção, aprovação, resultado e decisão antes de integrações, sem transformar o Anima atual em gerenciador de tarefas — ver [arquitetura](docs/arquitetura/orquestracao-de-trabalho.md) e [Marco 002](docs/marcos/002-anima-constroi-anima.md) |
| Visão A agora / Visão B como norte (jul/2026) | Anima como sistema de evolução pessoal é o único trabalho ativo; orquestrador de capacidades / Sistema Operacional Pessoal fica documentado como norte, não vira backlog imediato | Evita que a visão de longo prazo engula o produto atual ou pare o roadmap tático em andamento; ver `anima-manifesto.md` e [Marco 001](docs/marcos/001-nascimento-da-identidade.md) |
| Autonomia por nível de impacto (jul/2026) | Observação de baixo risco roda silenciosamente (atividade, nota, entidade, hipótese); ação de impacto estrutural/financeiro/irreversível sempre exige confirmação prévia | Generaliza o padrão de confirmação já usado em pilar pendente e hipótese de identidade para qualquer futura capacidade de execução; ver `anima-manifesto.md` |
| Jornadas de evolução (jul/2026) | Anima não gerencia só tarefas — acompanha jornadas de vida variadas (skate, música, programação, carreira, quarto inteligente, etc.); relação com pilar/entidade/quest fica em aberto | Reconhece que nem toda evolução de vida é uma "atividade cronometrada"; ver §1g — decisão de schema é arquitetura futura, não desta atualização |
| Trabalho Autônomo Seguro (jul/2026) | Modo Autônomo formalizado e implementado até a Fase F: fila elegível, claim exclusivo, tentativas persistentes, checkpoints, retomada, Supervisor V0, interrupção humana tipada, classificação, roteamento, ajuste de esforço e orçamento com reserva interativa; V0 estreita (um trabalho por projeto, execução local, sem merge/publicação automáticos) | Permite continuidade de trabalho sem supervisão constante mantendo intenção aprovada, limites explícitos, uso sustentável de inteligência e evidências verificáveis — ver [Marco 003](docs/marcos/003-trabalho-autonomo-seguro.md) e [Plano 002](docs/planos/002-modo-autonomo-v0.md) |
| Anima Portátil e Nós Locais (jul/2026) | Contexto pessoal pode acompanhar o usuário entre dispositivos; arquivos, ferramentas e recursos permanecem locais e acessíveis somente por permissões explícitas de cada máquina | Permite continuidade no Nomad e em futuras máquinas sem exigir exposição ou cópia indiscriminada dos arquivos; orienta o INT-04 sem ampliar seu escopo — ver [Marco 004](docs/marcos/004-anima-portatil-e-nos-locais.md) |
| Autonomia progressiva por evidência (ago/2026) | Não há teto filosófico para a autonomia (merge/deploy/main podem, com evidência, tornar-se autônomos); autoridade é conquistada e revogável por evidência; barreira atual classificada como restrição de maturidade vs fundamental; aprovação evolui de micropermissão para mandato | Segurança limita o estado atual, não a ambição final; nada é afrouxado agora — promover uma capacidade exige trabalho de evidência (testes, dry-run, simulação, idempotência, rollback, reconciliação, auditoria). Alterar a própria política é o ato mais protegido — **maturidade de grau máximo, não teto eterno** ([Marco 006](docs/marcos/006-politica-de-seguranca-como-maturidade-maxima.md)). Ver [Marco 005](docs/marcos/005-autonomia-progressiva-e-identidade-una.md) |
| Identidade única + proatividade cognitiva (ago/2026) | Uma só identidade conversacional (Anima); programação/pesquisa/arquitetura/reflexão são capacidades internas roteadas pelo Anima; a proatividade cognitiva (`observar → lembrar → relacionar → refletir → projetar → conversar sobre o futuro`) pertence ao Anima, não a uma persona Prisma | Reafirma e nomeia o reposicionamento do Prisma (§1a, Marco 001); proatividade cognitiva ≠ autonomia operacional espontânea. Ver [Marco 005](docs/marcos/005-autonomia-progressiva-e-identidade-una.md) |
| local-first != local-only (ago/2026) | Prefere capacidades locais quando suficientes, mas usa modelos/ferramentas externos enquanto forem mais capazes; providers (Ollama/OpenAI/Anthropic/outros) são substituíveis; o núcleo preserva memória, contexto, governança e orquestração independentemente do provider | O fluxo externo atual (ChatGPT/Claude/Codex) é arquitetura de transição; provider é decisão de capacidade e política, nunca identidade. Ver [Marco 005](docs/marcos/005-autonomia-progressiva-e-identidade-una.md) |
| Separação de contextos de chat — direção (ago/2026) | Direção conceitual de separar o chat principal (vida/memória) do contexto de Desenvolvimento/Projetos (repos/work items/diffs/revisão), sem separar a identidade; UX final deliberadamente em aberto | Serve a contexto, memória de trabalho, segurança, permissões, custo e UX; primeiro passo defensivo já existe (`developmentMode` + allowlist). Não concluir a UX por conta própria — é decisão de produto. Ver [Marco 005](docs/marcos/005-autonomia-progressiva-e-identidade-una.md) |
| Política de segurança = maturidade de grau máximo (ago/2026) | Alterar a própria política de segurança deixa de ser classificada como restrição fundamental/teto eterno; é a restrição de maturidade de maior risco, hoje sob governança humana/reforçada | Corrige erro de categoria do Marco 005; nada afrouxado — promoção exige processo reforçado (isolamento, testes adversariais, replay, revisão independente, auditabilidade, rollback, rollout gradual, observabilidade, limites, revogação automática). Fundamentais permanecem só criador-da-instância e decisões de produto não definidas. Ver [Marco 006](docs/marcos/006-politica-de-seguranca-como-maturidade-maxima.md) |
| Interação com o computador e aplicações locais (ago/2026) | Capacidade provider-neutral de primeira classe: perceber estado visível de apps/OS e operar interfaces locais (abrir/focar, navegar, clicar, digitar, copiar/colar), como braço executor sob mandato do Supervisor, com Supervisor/Executor/Reviewer separáveis; cada classe de efeito (leitura, digitação, envio, alteração, exclusão, publicação, autenticação) tratada e amadurecida à parte | Estende os nós locais (Marco 004) à camada GUI, herdando a fronteira de privacidade; exige evidência observável, correlação, auditabilidade, idempotência quando aplicável, fail-closed, proteção contra prompt injection e confirmação para efeitos externos/sensíveis. Hierarquia de interação ("não clicar se puder chamar"): API nativa → shell/fs → DOM/acessibilidade do browser → automação de UI/acessibilidade do OS → visão da tela → mouse/teclado por coordenadas (fallback). Estado estreito: a entrega deste mandato é só prova inicial do canal; sem agendamento/recorrência sem nova autorização; contrato/taxonomia em aberto. Ver [Marco 007](docs/marcos/007-interacao-com-computador-e-aplicacoes-locais.md) |

---

## 11. Stack técnica

### Frontend
| Camada | Tecnologia |
|--------|-----------|
| Mobile (iOS + Android) | React Native + Expo 54 (SDK 54, RN 0.81) |
| Web + Desktop | Next.js 15 (App Router) |
| Linguagem | TypeScript strict |
| Estilo (web) | CSS Modules com variáveis de tema escuro |

### Backend
| Camada | Tecnologia |
|--------|-----------|
| Server Actions | Next.js (`'use server'`) |
| Banco de dados | PostgreSQL via Supabase |
| Auth | Supabase Auth + `@supabase/ssr` |
| Realtime | Supabase Realtime (futuro) |

### Estrutura de repositório
```
anima/
├── apps/
│   ├── mobile/                    # React Native + Expo
│   └── web/
│       ├── app/
│       │   ├── (app)/home/        # Dashboard — visualização, radar, pilares
│       │   ├── (app)/quests/      # Quests — visualização e acompanhamento
│       │   ├── (onboarding)/      # Deprecated — dissolvido no /chat
│       │   ├── login/             # Página de login
│       │   ├── signup/            # Página de cadastro
│       │   └── page.tsx           # Roteador raiz inteligente
│       └── lib/supabase/          # Clientes SSR e browser
├── packages/
│   ├── core/                      # Lógica de XP, níveis, quests, onboarding
│   └── types/                     # TypeScript types + tipos do banco
└── supabase/
    └── migrations/                # Schema, funções, triggers, RLS, seed
```

---

## 12. O que está implementado (web)

- [x] Schema completo do banco com triggers e RLS
- [x] Autenticação — login, signup, logout explícito (botão em Configurações)
- [x] Recuperação de senha — forgot-password → e-mail (Mailpit em dev) → reset-password
- [x] Roteamento inteligente na raiz (`/`)
- [x] Sub-pilares hierárquicos — `pillar_relationships` (muitos-para-muitos); **múltiplos pais** por pilar (link aditivo, anti-ciclo de grafo, jun/2026); XP propaga 100% recursivamente para todos os ancestrais via `computeEffectiveXP` (`packages/core`, cálculo em tempo de leitura — dedup de descendentes por ancestral, seguro para diamantes e ciclos); sub-pilares excluídos do cálculo de nível do personagem
- [x] Contexto de pilar — salvo em `user_pillars.context` (JSONB); IA usa no system prompt
- [x] Dashboard home — radar de vida SVG, cards de pilares com barra de XP
- ~~Registro de atividades via modal/formulário~~ — **eliminado** pela diretriz Chat-First Total; toda entrada de atividades acontece exclusivamente pelo chat (ver §7)
- ⚠️ **Onboarding em 5 steps** — implementado mas **pendente remoção** (deprecated). Código em `app/(onboarding)/step-1` a `step-5` está deprecated.
- [x] Histórico de atividades — timeline agrupada por dia, total de XP diário e semanal, badges de bônus
- [x] Configurações — dados da conta, troca de senha, logout
- [x] Nav compartilhada — AppNav com Home, Quests, Histórico, Notas, IA, Relatórios, Config
- [x] Quests — lista, criação com sub-missões, XP máx 10.000, conclusão e abandono
- [x] Chat com IA local — `/chat`; streaming via Ollama (qwen2.5:14b na Goma); contexto completo do usuário (pilares, arquétipo, histórico, quests, retrieval semântico); histórico salvo em `ai_conversations`; markdown renderizado; botão limpar histórico; 3 pontinhos animados enquanto processa
- [x] Dashboard hierárquico — sub-pilares indentados sob os pais; borda lateral esquerda; card mais compacto/sutil; radar e nível do personagem usam só pilares raiz
- [x] **Chat unificado — Fase 1** — detecção automática de atividades em cada mensagem do chat; logging direto no `xp_records`; pilares só registrados com match exato (sem fuzzy fallback); `X-Activity-Logged` header → `router.refresh()` no cliente; embedding fire-and-forget salvo em `entry_embeddings`; IA confirma naturalmente (sem linguagem corporativa)
- [x] **Tom da IA corrigido** — novo system prompt: direto, humano, sem introduções, sem perguntas de encerramento, sem listas desnecessárias; responde "o que você é?" com exemplos do histórico real do usuário
- [x] **Onboarding melhorado** — extração de pilares com proibições explícitas; sub-pilares limitados a 3; match estrito; `onboarding_completed_at` setado após contexto suficiente
- [x] **Notas — captura silenciosa** — `lib/detect-note.ts` detecta food/expense/mood/idea/other via Ollama; XP 5–20 por heurística de comprimento+contexto; `pillar_hint` inferido; IA não comenta; tela `/notes` com agrupamento por data e badges de tipo
- [x] **Pilares pendentes** — novo pilar detectado no chat → `status='pending'`; `PendingPillarsWidget` no dashboard com confirmação (ativa pilar + loga atividade original) ou descarte
- [x] **Modos de exibição** — Game (radar + EraPanel), Analítico (cards de resumo + gráfico 30d + tabela), Minimal (lista limpa); persiste em `profiles.display_mode`
- [x] **Features por era** — `EraPanel` no modo Game: barra de progresso dentro da era, chips de features ativas, prévia tracejada da próxima era
- [x] **Analítico mais rico** — 3 cards (XP 30d, dias ativos, pilar líder) + gráfico de linha SVG de XP diário (30d) com tooltips + calendário de atividade (heatmap de dias ativos)
- [x] **Relatórios mensais** — `/reports`; navegação por mês (query params); XP por dia, tempo por pilar (barras horizontais), notas por tipo, maiores sessões; server-rendered
- [x] **Arquétipo contínuo** — `lib/infer-archetype.ts`; Ollama infere 4 arquétipos (explorer/focused/builder/visionary) em %; fire-and-forget a cada ~15 mensagens; salvo em `profiles.archetype`
- [x] **Hierarquia de pilares via chat** — `lib/detect-pillar-link.ts` detecta intenção de aninhamento na conversa (ex: "Anima é um sub-pilar de Trabalho"); header `X-Pillar-Links` + cards Sim/Não inline no `ChatClient`; `lib/link-pillar.ts` com validação anti-ciclo e múltiplos pais (vínculo aditivo, idempotente por aresta — alinha com o design de "múltiplos pais" da seção de sub-pilares); `/api/pillars/link` e `/api/pillars/unlink`; também disponível via dropdown no editor de Config e no card de pilar pendente
- [x] **Extração de entidades corrigida** — `lib/extract-entities.ts` chamado direto no chat route (antes fazia `fetch` interno sem cookies → 401); `format:json` removido do prompt (o qwen retornava 1 objeto só, perdendo entidades — agora força array); `scripts/backfill-entities.mjs` reprocessa histórico
- [x] **Grafo de vida** — `/graph`; Three.js + física force-directed; nós de pilares (tamanho por nível) + nós de entidades (toggle on/off); arestas de correlação por co-ocorrência temporal entre pilares + arestas entidade↔pilar via `entity_mentions`; viewport anchored (bounds clampados)
- [x] **Dedup de atividades e quests no chat** — pilar+data+nota e título de quest deduplicados antes de persistir no route do chat; evita duplicatas quando detecção roda em mensagens similares

---

## 12b. O que está implementado (mobile — Expo SDK 54, RN 0.81)

- [x] Auth — login e signup nativos; login redireciona explicitamente (checa `onboarding_completed_at` no DB)
- [x] Sessão persistida em `AsyncStorage`; `getUser()` valida no servidor na abertura (detecta sessão stale após `db reset`)
- [x] Roteamento inteligente — `app/index.tsx` resolve auth + onboarding e redireciona; `_layout.tsx` é estático (só renderiza Stack)
- ⚠️ **Onboarding em 5 steps** — implementado mas **pendente remoção** (deprecated). Código em `app/(onboarding)/step-1` a `step-5` está deprecated.
- [x] Dashboard home — radar de vida SVG (SIZE=300, labels truncados em 8 chars), cards de pilares, `useFocusEffect` (recarrega ao voltar à aba)
- ⚠️ **LogActivityModal (5 fases)** — implementado mas **pendente remoção** pela diretriz Chat-First Total (ver §7); toda entrada de atividades deve acontecer pelo chat; `logMultipleActivities` e bônus server-side serão migrados para o fluxo do chat mobile
- [x] Histórico — `useFocusEffect` (recarrega ao entrar na aba após registrar atividade ou concluir quest); XP semanal
- [x] Configurações — `useSafeAreaInsets`; dados da conta, troca de senha, logout
- [x] Quests — `useSafeAreaInsets` no header; XP de quest e missão propagado via trigger `on_life_event_insert` → `user_pillars`
- [x] `SafeAreaProvider` na raiz (`app/_layout.tsx`) para todas as telas usarem `useSafeAreaInsets`
- [x] **Notas** — `lib/detect-note.ts` com pillar_hint + XP 5–20; `lib/log-note.ts`; tela `/notes` agrupada por data com badges de tipo
- [x] **Pilares pendentes** — novo pilar detectado → `status='pending'`; `PendingPillarsWidget` na home com confirmação/descarte via `Alert`
- [x] **Modos de exibição** — Game (radar + EraPanel), Analítico (tabela de stats + XP semanal), Minimal (lista limpa); persiste em `profiles.display_mode`
- [x] **Chat com IA** — `app/(app)/chat.tsx`; streaming via Ollama (qwen2.5:14b); contexto completo (pilares, atividades recentes, arquétipo); histórico em `ai_conversations`; detecção de atividades e notas fire-and-forget em cada mensagem; botão limpar histórico
- [x] **XP de notas + pillar_hint** — `lib/log-note.ts` e `lib/detect-note.ts` replicados do web com env vars `EXPO_PUBLIC_`

### Arquitetura mobile (estado atual)
| Arquivo | Responsabilidade |
|---------|-----------------|
| `app/_layout.tsx` | Root layout estático — `<SafeAreaProvider><Stack /></SafeAreaProvider>` sem lógica de auth |
| `app/index.tsx` | Porteiro de auth: `getUser()` + checa `onboarding_completed_at`; redireciona; spinner enquanto resolve |
| `hooks/use-auth.ts` | Exporta `{ session, profile, loading }` via `onAuthStateChange`; carrega profile separadamente quando userId muda |
| `lib/supabase.ts` | `createClient` com `AsyncStorage`; URL via `EXPO_PUBLIC_SUPABASE_URL` |
| `lib/activity.ts` | Detecção de bônus + `logActivity` + `logMultipleActivities` + `getOrCreatePillar` (pending) + `confirmPendingPillar` + `dismissPendingPillar` |
| ~~`lib/parse-activity.ts`~~ | ~~`parseActivityText` → Ollama → `[{pillarName, durationMinutes, note}]`; timeout 30s; usado no LogActivityModal~~ — **deprecated (Chat-First Total; §7)** |
| `lib/detect-activity.ts` | `detectActivities` conservador (bloqueia food/sleep/etc); usado no chat mobile |
| `lib/detect-note.ts` | `detectNotes` → Ollama → `[{note_type, content, context, pillarHint}]` |
| `lib/log-note.ts` | Persiste notas com XP 5–20 e pillar_hint |
| `lib/mobile-chat.ts` | Streaming via Ollama; salva em `ai_conversations`; detecção fire-and-forget |
| `lib/transcribe.ts` | `startRecording` via expo-av → `stop()` envia áudio ao Whisper → texto; `cancel()` descarta |
| `contexts/onboarding-context.tsx` | `allPillarOptions` exclui sub-pilares (filhos), não pais |
| `components/LifeRadar.tsx` | SVG 300×300; labels truncados em 8 chars; `MAX_R=95` |
| ~~`components/LogActivityModal.tsx`~~ | ~~5 fases + detecção de notas fire-and-forget + pilares pendentes com estilo âmbar~~ — **deprecated (Chat-First Total; §7; pendente remoção)** |
| `app/(app)/home.tsx` | `useFocusEffect`; modos Game/Analítico/Minimal; `PendingPillarsWidget`; `PillarCard` fora do componente pai |
| `app/(app)/chat.tsx` | Chat com streaming, histórico, input, `KeyboardAvoidingView`, clear |
| `app/(app)/notes.tsx` | `SectionList` agrupada por data; badges de tipo |
| `app/(app)/history.tsx` | `useFocusEffect`; try/catch/finally garante `setLoading(false)` |
| `app/(app)/quests.tsx` | `useSafeAreaInsets` no header; XP via `life_events` → trigger SQL |
| `app/(app)/settings.tsx` | `useSafeAreaInsets` |
| `app/(auth)/login.tsx` | Redireciona explicitamente após login (checa `onboarding_completed_at`) |
| `app/(auth)/signup.tsx` | `router.replace('/(onboarding)/step-1')` após criar conta |

### Decisões técnicas mobile (sessão jun/2026)
- **Auth guard em `index.tsx`** (não no `_layout.tsx`): Expo Router 54 não lida bem com return condicional no root layout. `index.tsx` mostra spinner e faz toda a lógica de redirect.
- **`getUser()` em vez de `getSession()` no `index.tsx`**: valida sessão no servidor — detecta usuário deletado (ex: após `db reset`). Se inválido, chama `signOut()` para limpar AsyncStorage antes de ir ao login.
- **`SafeAreaProvider` obrigatório na raiz**: `useSafeAreaInsets()` crasha silenciosamente sem o provider → tela preta. Adicionado em `_layout.tsx`.
- **`useFocusEffect` em home e history**: recarrega dados ao entrar na aba, garantindo que XP de quests apareça imediatamente.
- **`PillarCard` fora do componente**: definir componente filho dentro do pai cria um novo tipo em cada render → "two children with same key" e performance ruim.
- **XP de quests via `life_events`**: trigger `on_life_event_insert` atualiza `user_pillars.xp_total` e `level` automaticamente. A home recarrega via `useFocusEffect` ao voltar da tab Quests.
- Sem `@supabase/ssr` no mobile — usa `createClient` do `supabase-js` direto com `AsyncStorage`

### Aviso de ambiente local
- `EXPO_PUBLIC_SUPABASE_URL=http://<IP-DA-MAQUINA>:54321` para dispositivo físico (hotspot ou rede local)
- `EXPO_PUBLIC_OLLAMA_URL=http://100.68.239.78:11434` — Ollama na Goma via Tailscale; modelo `qwen2.5:14b`
- `EXPO_PUBLIC_WHISPER_URL=http://100.68.239.78:9000` — servidor Whisper na Goma (ver setup abaixo)
- `npx supabase start` antes de rodar o app; `npx supabase db reset` limpa todos os dados (inclusive usuários)
- Após `db reset`, app detecta sessão stale automaticamente e redireciona para login
- Iniciar com `npx expo start` dentro de `apps/mobile`

#### Setup do Whisper na Goma (Windows)
```bash
py -m pip install faster-whisper fastapi uvicorn python-multipart
# salvar o script em C:\Users\GeanTeco\whisper_server.py (ver memory para o conteúdo)
py -m uvicorn whisper_server:app --host 0.0.0.0 --port 9000 --app-dir C:\Users\GeanTeco
```

---

## 13. Próximos temas a explorar

> Atualizado em jun/2026: features P0–P4 + grafo de vida concluídas. Sistema com cobertura completa em web e mobile. Próximos passos são refinamento de UX, QA e integrações externas.

### Próximo
- **Anima Core + capacidades (visão jun/2026, ver §1a)** — evolução estrutural:
  - **✅ Identidade Emergente — fundação (jun/2026):** tabelas `identity_hypotheses` + `identity_evidence` (migração `20260617000001`); gerador `infer-identity.ts` (Ollama, fire-and-forget na cadência do arquétipo) propõe/atualiza hipóteses com evidências rastreáveis e reforço de confiança; tela `/identity` (agrupada por tipo, barras de confiança, "por quê?" com evidências, confirmar/rejeitar). Generaliza `profiles.archetype`
  - **Prisma como capacidade interna (futuro)** — modo reflexivo no mesmo chat, acionado pelo Anima, usando Identidade + memória + contexto e sem interface própria
  - **Confirmação conversacional** de hipóteses pelo Anima com apoio da capacidade reflexiva, além da tela
  - ~~**Controle de personas** e convocação explícita~~ — **superado (jul/2026):** não será recuperado na arquitetura atual; ver §1a e [Marco 001](docs/marcos/001-nascimento-da-identidade.md)
- **✅ Tela de entidades (`/entities`)** — `semantic_entities`/`entity_pillars` agrupadas por pilar, com tipo e ocorrências
- **✅ Filtro no grafo** — toggle de entidades + foco por pilar (isola pilar + vizinhos)
- **Chat-First Total — limpeza mobile (próximo)** — remover `LogActivityModal.tsx` e `lib/parse-activity.ts`; migrar mic button para o input do chat; garantir que toda entrada de atividades passa pelo chat; web já alinhado (nunca teve modal como entrada primária)
- **QA áudio** — testar Whisper no iPhone em condições reais; mic button no chat (não no modal)
- **Onboarding mobile** — dissolver steps deprecated e usar o chat como entrada; espelhar o que foi feito no web
- **Grafo mobile** — portar `/graph` para o mobile (Three.js → biblioteca 2D nativa ou WebView)
- **Relatórios mais ricos** — correlações entre notas (ex: humor × exercício); relatório anual
- **Refinamento do analítico** — comparativo entre meses; tendência por pilar
- **Qualidade do grafo** — threshold de correlação configurável; cores por era; animação de entrada dos nós
- **Obsidian import** — fase 2: import com resolução de conflito (fase futura)
- **Google Fit** — quando necessário (Health Connect Android)
- **Modelo de monetização** — quando abrir ao público

### Concluído (P0–P4)
- [x] **P0 — Chat-First Total (jun/2026)** — diretriz arquitetural definitiva: chat é o único ponto de entrada; UI serve apenas visualização/exploração/navegação; modais e formulários de entrada eliminados; web alinhado; mobile com remoção do LogActivityModal pendente
- [x] **P0 — Onboarding conversacional** — primeira conversa substitui wizard; IA infere pilares e arquétipo; web + mobile
- [x] **P0 — Steps deprecated e removidos** — `step-1..5`, `archetypes.ts`, `pillar-questions.ts` removidos
- [x] **P1 — Input natural com IA** — texto livre + áudio via chat (web + mobile)
- [x] **P1 — Memória semântica** — Camada 3: `semantic_entities`, `entry_embeddings`, `match_entries` (pgvector)
- [x] **P1 — Timeline narrativa** — histórico como narrativa temporal; web + mobile
- [x] **P1 — Retrieval contextual** — busca semântica no histórico alimenta o chat
- [x] **P1 — Backfill com data passada** — `activity_date` separado de `created_at`
- [x] **P2 — Insights automáticos** — Camada 4; trigger por ≥5 entradas + ≥3 dias; Ollama gera; `dismissed_at`
- [x] **P2 — Pulso do dia** — entrada ultra-leve sem duração (XP=0); classifica pilar em background
- [x] **P3 — Editor de pilares** — renomear/desativar pilares pós-onboarding; web + mobile
- [x] **P3 — Chat com IA contextual** — streaming via Ollama; contexto completo; web + mobile
- [x] **P4 — Adaptador Obsidian** — export ZIP com .md (web/settings); fase 1 concluída
- [x] **P4 — Apple Health scaffold** — infraestrutura pronta; requer dev build (não Expo Go)
- [x] **Arquitetura de pilares livres** — 3 raiz fixos (Saúde, Mente, Relações) + emergência livre pela IA; catálogo pré-definido removido
- [x] **Notas — captura silenciosa** — `notes` table; detecção via Ollama; XP 5–20; pillar_hint; tela dedicada; web + mobile
- [x] **Pilares pendentes** — novo pilar detectado → pending; confirmação no dashboard; web + mobile
- [x] **Modos de exibição** — Game / Analítico / Minimal; persiste no DB; web + mobile
- [x] **Features por era** — EraPanel no modo Game com progresso, unlocks e prévia da próxima era
- [x] **Analítico mais rico** — 3 cards de resumo (XP 30d, dias ativos, pilar líder) + gráfico de linha SVG de XP diário (30d) com tooltips + calendário de atividade (heatmap de dias ativos) + tabela de pilares com XP 7d
- [x] **Relatórios mensais** — `/reports` (web); navegação por mês; XP por dia, por pilar, por tipo de nota
- [x] **Arquétipo contínuo** — inferência Ollama fire-and-forget a cada ~15 mensagens; salvo em `profiles.archetype`
- [x] **XP de notas** — heurística 5/10/20 XP por comprimento + riqueza de contexto; web + mobile
- [x] **Hierarquia de pilares via chat** — `detect-pillar-link.ts`; header `X-Pillar-Links`; cards Sim/Não inline no `ChatClient`; `lib/link-pillar.ts`
- [x] **Extração de entidades corrigida** — chamada direta (sem fetch interno); `format:json` removido; `backfill-entities.mjs`
- [x] **Grafo de vida** — `/graph` (web); Three.js + física force-directed; pilares + entidades; correlações por co-ocorrência; viewport anchored
- [x] **Dedup de atividades/quests** — deduplicação no chat route evita registros duplicados

---

## 13b. Integrações externas e padrão de adaptador

### Princípio
O núcleo do app **não conhece** nenhuma ferramenta externa. Integrações vivem em **adaptadores plugáveis na borda** (connector pattern). Assim o app funciona 100% sem nenhuma integração, e cada integração é opcional e isolada — se falhar, não derruba o app.

### Obsidian (primeiro adaptador)
- **Modelo:** híbrido. O Postgres é a fonte da verdade; o Obsidian é um espelho **opcional** em markdown.
- **Projeção:** cada entrada vira markdown — frontmatter com o estruturado (pilar, data, tempo, XP, id, links), corpo com o texto livre; `[[links]]` viram as conexões entre entradas/pilares/quests (substrato do motor de insights).
- **Fase 1:** export apenas (mão única). O usuário standalone nunca sabe que o Obsidian existe.
- **Fase 2 (futuro):** import / duas vias, com resolução de conflito — só se o uso pedir.
- **Plataforma:** nasce como recurso desktop/web (acesso a pasta de vault no mobile, iOS especialmente, é problemático).

### Próximos adaptadores (mesmo encaixe)
- Apple Health / Google Fit (sono, passos, treino → camada 0 passiva)
- Calendário (agenda)

---

## 14. Como usar este documento

**Para continuar em outra sessão de IA:**
1. Cole este documento inteiro no início da conversa
2. Diga: *"Quero continuar desenvolvendo o Anima a partir deste PRD. [Próximo tema]"*
3. A IA terá todo o contexto das decisões já tomadas

**Para atualizar após novas decisões:**
- Adicione à seção "Decisões de design registradas"
- Atualize a seção relevante com o novo conceito
- Mova itens da lista "Próximos temas" para "O que está implementado" quando concluídos

---

## 15. Como subir o Anima localmente (runbook)

> Passo a passo para rodar e testar quando quiser.

### Arquitetura de ambientes (multi-máquina, jun/2026)

O Anima roda em **duas máquinas físicas**, ligadas por Tailscale:

| Papel | Máquina | O que roda lá |
|-------|---------|---------------|
| **Servidor** | Goma (`100.68.239.78`) | Supabase completo (Postgres + Auth + Studio), Ollama (`qwen2.5:14b`, `nomic-embed-text`), Whisper (`:9000`) |
| **Cliente** | Notebook novo (ex: Nomad) | Só `npm run dev:web` — sem Docker, sem Supabase local, sem Ollama local |

**Banco único na Goma.** Cada `supabase start` cria um Postgres isolado naquela máquina — se cada notebook rodasse o seu, o usuário teria conta e histórico diferentes em cada lugar (foi exatamente o que aconteceu ao configurar o Nomad: pilares e XP zerados, sem nada do que já existia na Goma). Por isso todo cliente novo aponta `NEXT_PUBLIC_SUPABASE_URL` e `OLLAMA_URL` para a Goma via Tailscale — nunca para `127.0.0.1`. Só a Goma roda Postgres local; qualquer outra máquina é cliente fino.

> Rodar Supabase local num cliente ainda funciona tecnicamente (ex: dev 100% offline) — só significa dados isolados daquela máquina, sem sincronia com a Goma. Use sabendo dessa troca.

### Pré-requisitos

**Na Goma (servidor — uma vez):**
- Docker Desktop + `npx supabase start`
- Ollama com `qwen2.5:14b` e `nomic-embed-text` (`ollama list` confere)
- Whisper rodando na porta `:9000`
- Tailscale logado, IP conhecido pelos clientes

**Num cliente novo (ex: Nomad — uma vez):**
- Git + Node LTS + `npm install` na raiz
- Tailscale logado na mesma conta — `tailscale status` precisa listar a Goma
- `apps/web/.env.local`:
  ```
  NEXT_PUBLIC_SUPABASE_URL=http://100.68.239.78:54321
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<ver nota>
  OLLAMA_URL=http://100.68.239.78:11434
  OLLAMA_MODEL=qwen2.5:14b
  ```
  - **Nota sobre a anon key:** nenhuma das máquinas customizou o JWT secret do Supabase local, então a anon key padrão de qualquer instância local não customizada funciona em ambas — já vem em `apps/web/.env.example`, não precisa rodar `supabase status` na Goma para pegar uma nova.
- **Não precisa Docker nem Ollama/Whisper local** — tudo roda na Goma

### Subir

**Servidor (Goma):**
1. Docker Desktop aberto (`docker info` responde)
2. `npx supabase start` (Postgres 54322 · API/Auth 54321 · Studio 54323)
3. `npx supabase migration up` (ou `db reset` para zerar o banco do zero)
4. Ollama e Whisper no ar

**Cliente (ex: Nomad):**
1. Confirma que a Goma está alcançável: `curl http://100.68.239.78:54321/auth/v1/health` → 200
2. `npm run dev:web` → abrir `http://localhost:3000`
3. Não roda Docker nem `supabase start` localmente

### Sintomas comuns
- **Login dá "fetch failed"** → Supabase inacessível.
  - Setup com banco local: Docker parado — suba o Docker, depois `npx supabase start`. (Erro nos logs: `ECONNREFUSED 127.0.0.1:54321`.)
  - Setup cliente (apontando pra Goma): Goma desligada, Tailscale desconectado, ou IP errado no `.env.local`. Confira `tailscale status` e o health check acima.
- **Login dá "Invalid login credentials"** → isso não é bug de conexão, é senha errada mesmo (a Auth respondeu certo). Resetar via Admin API se necessário: `PUT /auth/v1/admin/users/{id}` com `service_role` key e `{ "password": "..." }`.
- **Chat não detecta nada / "não foi possível conectar ao Ollama"** → Ollama fora ou modelo errado (local ou na Goma). Confira `ollama list` e `OLLAMA_MODEL`.
- **Atividade aparece na resposta do chat mas `xp_records` continua vazio** → PostgREST está negando acesso a tabelas, silenciosamente (a chamada do chat engole o erro — ver `app/api/ai/chat/route.ts`). Acontece em banco criado só com `supabase db reset`/migrations do zero, sem a migration `20260620000000_grant_default_privileges.sql` (ver §10): só tabelas criadas pela role `supabase_admin` recebem GRANT automático para `anon`/`authenticated`/`service_role`; tabelas das suas próprias migrations (role `postgres`) não recebem. Aplique a migration e teste de novo. Pra confirmar o diagnóstico: `curl` no REST (`/rest/v1/<tabela>`) com a `service_role` key — `permission denied for table X` é esse bug; resultado vazio `[]` é só RLS filtrando, banco está ok.
- **Inferência de identidade/arquétipo não dispara** → roda em cadência (Identidade a cada 5 msgs do usuário, arquétipo a cada 10). Mande mensagens suficientes.

### Regenerar tipos após mudar o schema
`npx supabase gen types typescript --local 2>/dev/null | sed '/^Connecting to db/d' > packages/types/src/database.ts`
(o `sed` remove a linha de ruído do CLI que quebra o typecheck; roda na máquina com o Postgres — normalmente a Goma)

### Comandos úteis
- Typecheck: `npm run typecheck` · Build: `npm run build`
- Inspecionar o banco local: `docker exec supabase_db_anima psql -U postgres -d postgres -c "..."`
- Inspecionar/gerenciar o banco remoto (cliente sem Docker local): Admin API (`/auth/v1/admin/...`) e REST (`/rest/v1/<tabela>`) da Goma, com a `service_role` key
- Aplicar migration num Postgres remoto: `supabase migration up --db-url "postgresql://postgres:postgres@<IP>:54322/postgres"` — **atenção:** o CLI tenta TLS por padrão e o Postgres local recusa (`tls error: server refused TLS connection`); quando isso acontece, aplique a migration direto na máquina que hospeda o banco em vez de forçar a conexão remota
- Parar tudo (servidor): `npx supabase stop` (containers) — o Docker pode continuar aberto

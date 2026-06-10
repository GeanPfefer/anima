# Anima — Product Requirements Document
> Documento vivo de design. Última atualização: 2026-06-10 (sessão: notas com XP e pillar_hint; pilares pendentes; modos de exibição; arquétipo contínuo; features por era; analítico rico; relatórios mensais; chat mobile)
> Para retomar o projeto em qualquer IA: cole este documento e diga "quero continuar desenvolvendo o Anima a partir deste PRD."

---

## 1. Visão geral

**Nome provisório:** Anima  
**Plataformas:** Desktop, Web, Mobile (todas)  
**Estágio atual:** Em desenvolvimento ativo — auth, onboarding, registro de atividades, histórico e quests implementados em web e mobile  
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

**Modo 1 — Conversa (porta de entrada e reflexão intencional):**
O chat é a **primeira interação do usuário** com o sistema — a "primeira conversa" substitui o onboarding. Depois, volta a ser usado para reflexão, planejamento e brainstorming com contexto completo da vida.
- Primeira conversa: acolhe, infere contexto, detecta pilares iniciais, inicia memória narrativa
- Uso recorrente: reflexão sobre padrões, planejamento, decisões, perguntas sobre a própria vida

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

**Consequência arquitetural:** o sistema deve favorecer texto livre, contexto contínuo, memória persistente e organização automática — e reduzir dependência de campos rígidos, categorização manual e fluxos baseados em formulários.

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

### Princípio
O chat é a superfície de entrada universal. O usuário nunca precisa:
- Abrir um "modal de nova entrada"
- Clicar em "Registrar atividade"
- Preencher formulários de pilares e duração
- Ter um "modo onboarding" separado do "modo uso"

Tudo isso acontece **na mesma conversa**, silenciosamente, em segundo plano.

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

### Modelo de detecção — três destinos

Cada mensagem passa por classificação silenciosa com três saídas possíveis:

| Tipo de conteúdo | Destino | XP |
|------------------|---------|-----|
| Atividade intencional (esporte, estudo, trabalho, criação...) | `xp_records` + pilar | Fórmula: tempo × taxa × bônus |
| Nota (alimentação, gasto, sentimento, ideia, reflexão) | `notes` (futuro) | 5–20 XP flat (baseado em profundidade da nota) |
| Conversa pura (pergunta, planejamento, bate-papo) | Nenhum registro | 0 XP |

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

### Onboarding dentro do chat (Fase 3 — pendente)
A primeira conversa já acontece no chat. A rota `/welcome` será dissolvida — o chat detecta que é o primeiro uso e adapta o comportamento:
- Primeira mensagem: acolhe e pergunta o que está acontecendo na vida
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
- **✅ Notas no chat:** `detect-note.ts` detecta food/expense/mood/idea/other; XP 5–20 por heurística; `pillar_hint` inferido; IA silenciosa (não comenta)
- **✅ Arquétipo contínuo:** `infer-archetype.ts` infere 4 arquétipos (explorer/focused/builder/visionary) em % via Ollama; fire-and-forget a cada ~15 mensagens; salvo em `profiles.archetype`

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
  note_type     text,                   -- 'food', 'expense', 'mood', 'idea', 'other'
  context       jsonb,                  -- dados estruturados extraídos
  pillar_hint   text,                   -- pilar implícito (Saúde, Finanças, Mente ou null)
  xp_awarded    int default 0,          -- 5/10/20 XP por comprimento+riqueza de contexto
  note_date     date not null,
  created_at    timestamptz default now()
)
```

### Estado técnico
- **✅ Implementado:** migração SQL (`20260609000001_notes.sql`), detecção no chat (`lib/detect-note.ts` web + mobile), tela de notas (web + mobile), XP de notas (5/10/20 por heurística de comprimento/contexto), `pillar_hint` inferido pelo Ollama
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
- **Analítico:** 3 cards de resumo (XP 30d, dias ativos, pilar líder) + gráfico SVG de barras diárias (30d) + tabela de pilares com XP 7d
- **Minimal:** lista de pilares + registros recentes
- Estado técnico: **✅ Implementado** — web (`HomeDashboard.tsx`) + mobile (`home.tsx`)

---

## 8. Fluxo de autenticação

### Rotas
| Rota | Comportamento |
|------|--------------|
| `/` | Roteador inteligente: sem sessão → `/login`; com sessão + onboarding feito → `/home`; com sessão sem onboarding → `/welcome` |
| `/login` | Server Action via Supabase Auth; sucesso → `/home` |
| `/signup` | Server Action via Supabase Auth; sucesso → `/welcome` |
| `/welcome` | ⚠️ Pendente: tela de nome + primeira conversa (substitui `/step-1` a `/step-5`) |
| `/forgot-password` | Envia e-mail de reset via `supabase.auth.resetPasswordForEmail`; em dev, e-mail chega no Mailpit (porta 54324) |
| `/auth/callback` | Route Handler que troca o `code` por sessão (PKCE); redireciona para `?next=` |
| `/reset-password` | Define nova senha via `supabase.auth.updateUser`; redireciona para `/home` |
| `/settings` | Exibe dados da conta e formulário de troca de senha |
| `/history` | Timeline de atividades registradas agrupada por dia |
| `/home` | Protegida por auth guard no layout do grupo `(app)` |
| ~~`/step-1` a `/step-5`~~ | ~~Deprecated — substituídas por `/welcome`~~ |

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
| `notes` | ⚠️ Pendente — notas de alimentação, gastos, humor, ideias (ver seção 7b) |
| `life_events` | Eventos sem duração (marcos, conquistas, mudanças de estado) |
| `quests` | Quests do usuário |
| `quest_missions` | Sub-missões de uma quest |
| `ai_conversations` | Histórico de mensagens do chat |
| `entry_embeddings` | Embeddings semânticos das notas de atividades (pgvector) |
| `semantic_entities` | Entidades persistentes extraídas pela IA (pessoas, lugares, projetos) |

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
| Papel da IA | Duas camadas: organizadora implícita (segundo plano) + chat intencional (brainstorming) | IA trabalha silenciosamente no input natural; chat existe para quando o usuário quer conversar ativamente — as duas camadas se complementam |
| Chat como camada complementar | Chat existe e é válido para brainstorming/reflexão; não é a interação primária nem o modo padrão | Input implícito é mais frequente e sustentável; chat requer intenção e é usado esporadicamente |
| Entrada por áudio | Mic button no modal de nova entrada: grava → Whisper transcreve → preenche campo de texto → usuário toca "Interpretar →" | Falar é mais natural que digitar; alinha com o princípio de input caótico/natural |
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
│       │   ├── (app)/home/        # Dashboard + registro de atividades
│       │   ├── (app)/quests/      # Quests (lista, criação, sub-missões)
│       │   ├── (onboarding)/      # Steps 1–3 com auth guard
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
- [x] Sub-pilares hierárquicos — `pillar_relationships` (muitos-para-muitos); XP propaga 100% recursivamente para todos os ancestrais; sub-pilares excluídos do cálculo de nível do personagem
- [x] Contexto de pilar — salvo em `user_pillars.context` (JSONB); IA usa no system prompt
- [x] Dashboard home — radar de vida SVG, cards de pilares com barra de XP
- [x] Registro de atividades — input natural via IA (texto livre → 5 fases → registro)
- ⚠️ **Onboarding em 5 steps** — implementado mas **pendente substituição** pelo onboarding conversacional (ver seção 7). Código em `app/(onboarding)/step-1` a `step-5` está deprecated.
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
- [x] **Analítico mais rico** — 3 cards (XP 30d, dias ativos, pilar líder) + gráfico SVG de barras diárias (30d) com tooltips
- [x] **Relatórios mensais** — `/reports`; navegação por mês (query params); XP por dia, tempo por pilar (barras horizontais), notas por tipo, maiores sessões; server-rendered
- [x] **Arquétipo contínuo** — `lib/infer-archetype.ts`; Ollama infere 4 arquétipos (explorer/focused/builder/visionary) em %; fire-and-forget a cada ~15 mensagens; salvo em `profiles.archetype`

---

## 12b. O que está implementado (mobile — Expo SDK 54, RN 0.81)

- [x] Auth — login e signup nativos; login redireciona explicitamente (checa `onboarding_completed_at` no DB)
- [x] Sessão persistida em `AsyncStorage`; `getUser()` valida no servidor na abertura (detecta sessão stale após `db reset`)
- [x] Roteamento inteligente — `app/index.tsx` resolve auth + onboarding e redireciona; `_layout.tsx` é estático (só renderiza Stack)
- ⚠️ **Onboarding em 5 steps** — implementado mas **pendente substituição** pelo onboarding conversacional. Código em `app/(onboarding)/step-1` a `step-5` está deprecated.
- [x] Dashboard home — radar de vida SVG (SIZE=300, labels truncados em 8 chars), cards de pilares, `useFocusEffect` (recarrega ao voltar à aba)
- [x] Registro de atividades — input natural com áudio ou texto: texto livre → IA detecta pilares, duração e nota → usuário confirma; 5 fases: input → parsing → reviewing → submitting → success; mic button grava → Whisper transcreve → preenche o campo; `logMultipleActivities` registra em série; bônus recalculados server-side
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
| `lib/parse-activity.ts` | `parseActivityText` → Ollama → `[{pillarName, durationMinutes, note}]`; timeout 30s; usado no LogActivityModal |
| `lib/detect-activity.ts` | `detectActivities` conservador (bloqueia food/sleep/etc); usado no chat mobile |
| `lib/detect-note.ts` | `detectNotes` → Ollama → `[{note_type, content, context, pillarHint}]` |
| `lib/log-note.ts` | Persiste notas com XP 5–20 e pillar_hint |
| `lib/mobile-chat.ts` | Streaming via Ollama; salva em `ai_conversations`; detecção fire-and-forget |
| `lib/transcribe.ts` | `startRecording` via expo-av → `stop()` envia áudio ao Whisper → texto; `cancel()` descarta |
| `contexts/onboarding-context.tsx` | `allPillarOptions` exclui sub-pilares (filhos), não pais |
| `components/LifeRadar.tsx` | SVG 300×300; labels truncados em 8 chars; `MAX_R=95` |
| `components/LogActivityModal.tsx` | 5 fases + detecção de notas fire-and-forget + pilares pendentes com estilo âmbar |
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

> Atualizado em jun/2026: todas as features P0–P4 concluídas. Sistema com cobertura completa em web e mobile. Próximos passos são refinamento de UX, QA e integrações externas.

### Próximo
- **QA áudio** — testar Whisper no iPhone em condições reais (código pronto; Docker na Goma `:9000`)
- **Onboarding mobile** — dissolver steps deprecated e usar o chat como entrada; espelhar o que foi feito no web
- **Relatórios mais ricos** — correlações entre notas (ex: humor × exercício); relatório anual
- **Refinamento do analítico** — comparativo entre meses; tendência por pilar
- **Obsidian import** — fase 2: import com resolução de conflito (fase futura)
- **Google Fit** — quando necessário (Health Connect Android)
- **Modelo de monetização** — quando abrir ao público

### Concluído (P0–P4)
- [x] **P0 — Onboarding conversacional** — primeira conversa substitui wizard; IA infere pilares e arquétipo; web + mobile
- [x] **P0 — Steps deprecated e removidos** — `step-1..5`, `archetypes.ts`, `pillar-questions.ts` removidos
- [x] **P1 — Input natural com IA** — texto livre + áudio (web + mobile); 5 fases
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
- [x] **Analítico mais rico** — cards de resumo + gráfico SVG de barras diárias (30d)
- [x] **Relatórios mensais** — `/reports` (web); navegação por mês; XP por dia, por pilar, por tipo de nota
- [x] **Arquétipo contínuo** — inferência Ollama fire-and-forget a cada ~15 mensagens; salvo em `profiles.archetype`
- [x] **XP de notas** — heurística 5/10/20 XP por comprimento + riqueza de contexto; web + mobile

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

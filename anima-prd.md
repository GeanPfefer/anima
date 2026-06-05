# Anima — Product Requirements Document
> Documento vivo de design. Última atualização: 2026-06-05 (sessão: paradigma de pilares emergentes — onboarding conversacional substitui wizard de 5 steps; arquétipo inferido comportamentalmente; seções 1c/1d/1e/2/7/8/10/13 reescritas)
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
A IA NÃO deve inventar livremente pilares ou a estrutura principal do sistema. A estabilidade da estrutura é intencional:

| Nível | Estabilidade | Quem controla |
|-------|-------------|---------------|
| Pilares principais | Relativamente estável | Usuário define no onboarding; editável raramente |
| Sub-pilares | Semi-dinâmico | Usuário define; IA pode sugerir; nunca cria sem confirmação |
| Tags / contexto / entidades | Altamente dinâmico | IA extrai automaticamente de cada entrada |

Isso mantém coerência, previsibilidade e qualidade dos insights. Um sistema com pilares flutuantes vira bagunça semântica impossível de usar para continuidade.

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

Os pilares são **estruturas emergentes** — não configuradas explicitamente pelo usuário, mas inferidas pela IA a partir da primeira conversa e do comportamento acumulado. O usuário nunca precisa "escolher pilares" para começar.

**Como emergem:** a IA detecta temas recorrentes na escrita do usuário e sugere/cria pilares silenciosamente. O usuário pode confirmar, renomear ou adicionar a qualquer momento — mas nunca é obrigado a.

**Pilares padrão disponíveis** (a IA usa como ponto de partida):

| Pilar | Foco | Taxa XP/min |
|-------|------|-------------|
| Mente | clareza, aprendizado, foco | 1,0 |
| Propósito | valores, legado, visão | 1,0 |
| Trabalho | produção, metas, carreira | 1,0 |
| Saúde | sono, exercício, energia | 1,0 |
| Relações | família, amigos, amor | 1,0 |
| Finanças | gastos, reserva, metas | 1,0 |
| Lazer | hobbies, descanso | 1,0 |

> **Decisão jun/2026:** Todas as taxas igualadas a 1,0×. O valor está no tempo dedicado, não na hierarquia de importância entre pilares — cada área de vida vale igual.

**Regras dos pilares:**
- Pilares emergem organicamente — nenhum é obrigatório no início
- O usuário pode adicionar, renomear ou desativar pilares a qualquer momento
- Cada pilar tem seu próprio nível (1–50)
- O nível geral do personagem é a média dos níveis de todos os pilares raiz ativos

**Conexões entre pilares:**
- Saúde impacta fortemente Mente e Trabalho (detectável em 1–2 dias)
- Saúde impacta medianamente Relações e Lazer
- Saúde impacta fracamente Finanças e Propósito
- Mente e Saúde são bidirecionais (estresse afeta saúde; saúde afeta clareza mental)
- O app detecta e exibe esses padrões como insights automáticos

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

## 7. Onboarding — primeira conversa natural

> **O onboarding tradicional (5 steps rígidos) foi removido.** Substituído por uma primeira conversa com a IA.

### Princípio
O onboarding nunca deve parecer setup, formulário, questionário ou configuração de sistema. Deve parecer o início de uma relação — um espaço leve onde a pessoa simplesmente conta o que está acontecendo na vida.

### Fluxo

**1. Tela inicial pós-signup:** só pede o nome (como quer ser chamado). Nenhuma outra configuração.

**2. Primeira conversa:** a IA inicia com uma pergunta aberta de baixa fricção.

Exemplos de abertura:
- "O que fez você baixar o Anima?"
- "O que está ocupando sua mente ultimamente?"
- "Sem pressa — me conta o que está acontecendo na sua vida agora."

**3. A IA trabalha em segundo plano durante a conversa:**
- Acolhe a resposta (tom: curioso, humano, não-invasivo)
- Infere pilares iniciais dos temas mencionados
- Detecta arquétipo comportamental preliminar pela linguagem e foco
- Inicia a memória narrativa (Camada 1 e 2)

**4. Encerramento natural:** quando há contexto suficiente (sem critério rígido), a IA propõe ir para o dashboard. Sem "conclusão" formal — o onboarding é contínuo.

### O que a primeira conversa NÃO é
- Não é um quiz
- Não é uma entrevista de diagnóstico
- Não é um formulário disfarçado
- Não é coaching
- Não tem número mínimo de perguntas ou etapas obrigatórias

### Descoberta progressiva de identidade
O sistema não assume que o usuário sabe quem é, o que quer ou quais áreas priorizar. A identidade emerge ao longo do uso. O "onboarding" nunca termina formalmente — o sistema aprende continuamente.

### Arquétipo inferido (não mais quiz)
Os 4 arquétipos (Explorador, Focado, Construtor, Visionário) passam a ser um **modelo comportamental vivo**, inferido pela IA com base em:
- Forma e frequência de escrita
- Temas recorrentes
- Padrões de decisão
- Linguagem e intensidade emocional

O resultado em `profiles.archetype` é atualizado continuamente — não fixado num momento inicial.

### Estado técnico
- **⚠️ Pendente refatoração:** o código atual (steps 1–5) implementa o onboarding antigo. Precisa ser substituído pelo fluxo conversacional descrito acima.
- O campo `onboarding_completed_at` ainda é usado como guard de rota. No novo modelo, é setado após a primeira conversa ter contexto suficiente (a definir).

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
| `pillar_catalog` | Catálogo dos 7 pilares padrão com taxas XP |
| `user_pillars` | Pilares ativos por usuário (xp_total, level, is_active) |
| `xp_records` | Histórico imutável de atividades registradas |
| `life_events` | Eventos sem duração (marcos, conquistas, mudanças de estado) |
| `quests` | Quests do usuário |
| `quest_missions` | Sub-missões de uma quest |

### Triggers automáticos
- `on_auth_user_created` → cria row em `profiles` automaticamente no signup
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
| Auth guard no index.tsx (mobile) | `index.tsx` faz getUser() + checa DB; `_layout.tsx` é estático | Expo Router 54 não tolera retorno condicional no root layout sem quebrar navegação |
| getUser() na abertura (mobile) | Em vez de getSession() | Valida sessão no servidor; detecta usuário deletado após db reset e limpa AsyncStorage |
| SafeAreaProvider na raiz (mobile) | `app/_layout.tsx` envolve tudo | useSafeAreaInsets() crasha silenciosamente sem o provider |
| useFocusEffect em home e history (mobile) | Em vez de useEffect | Recarrega dados ao entrar na aba; XP de quests aparece imediatamente ao voltar |
| PillarCard fora do componente (mobile) | Componente definido no módulo, não dentro do pai | Componentes definidos dentro de outros criam novo tipo a cada render → chave duplicada e remount desnecessário |
| Padrão de adaptador p/ integrações | Núcleo agnóstico + conector plugável na borda | Mesmo encaixe serve depois para Health/Fit; não acopla o app a ferramenta externa |
| Sync Obsidian inicial | Só export, mão única (Postgres → markdown) | Duas vias (conflito/parsing) poderia quebrar e "atrapalhar"; fica para fase 2 |

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
- [x] Nav compartilhada — AppNav com Home, Quests, Histórico, IA, Configurações
- [x] Quests — lista, criação com sub-missões, XP máx 10.000, conclusão e abandono
- [x] Chat com IA local — `/chat`; streaming via Ollama (qwen2.5:14b na Goma); contexto completo do usuário (pilares, arquétipo, histórico, quests); histórico salvo em `ai_conversations`; markdown renderizado; botão limpar histórico; 3 pontinhos animados enquanto processa
- [x] Dashboard hierárquico — sub-pilares indentados sob os pais; borda lateral esquerda; card mais compacto/sutil; radar e nível do personagem usam só pilares raiz

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

### Arquitetura mobile (estado atual)
| Arquivo | Responsabilidade |
|---------|-----------------|
| `app/_layout.tsx` | Root layout estático — `<SafeAreaProvider><Stack /></SafeAreaProvider>` sem lógica de auth |
| `app/index.tsx` | Porteiro de auth: `getUser()` + checa `onboarding_completed_at`; redireciona; spinner enquanto resolve |
| `hooks/use-auth.ts` | Exporta `{ session, profile, loading }` via `onAuthStateChange`; carrega profile separadamente quando userId muda |
| `lib/supabase.ts` | `createClient` com `AsyncStorage`; URL via `EXPO_PUBLIC_SUPABASE_URL` |
| `lib/activity.ts` | Detecção de bônus + `logActivity` + `logMultipleActivities` (série) |
| `lib/parse-activity.ts` | `parseActivityText` → Ollama → `[{pillarName, durationMinutes, note}]`; timeout 30s |
| `lib/transcribe.ts` | `startRecording` via expo-av → `stop()` envia áudio ao Whisper → texto; `cancel()` descarta |
| `contexts/onboarding-context.tsx` | `allPillarOptions` exclui sub-pilares (filhos), não pais |
| `components/LifeRadar.tsx` | SVG 300×300; labels truncados em 8 chars; `MAX_R=95` |
| `components/LogActivityModal.tsx` | 5 fases (input → parsing → reviewing → submitting → success); mic button; pillar picker inline |
| `app/(app)/home.tsx` | `useFocusEffect`; `PillarCard` definida fora do componente pai |
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

> Prioridade P0 adicionada em jun/2026: onboarding conversacional é a base de tudo.

### P0 — Onboarding conversacional (bloqueante)
- [ ] **Substituir steps 1–5 por primeira conversa** — web e mobile; rota `/welcome`; a IA acolhe, infere pilares e arquétipo iniciais, inicia memória narrativa; `onboarding_completed_at` setado após contexto suficiente
- [ ] **Deprecar e remover código dos steps** — `app/(onboarding)/step-1` a `step-5`, `lib/archetypes.ts` (quiz), `lib/pillar-questions.ts`

### P1 — Captura e memória (núcleo do produto)
- [ ] **Testar input por áudio no mobile** — servidor Whisper na Goma (porta 9000); setup documentado na seção 12b
- [ ] **Memória semântica — Camada 3** — sistema aprende entidades persistentes do usuário (pessoas, lugares, projetos, padrões); retrieval semântico com embeddings + pgvector
- [ ] **Timeline narrativa** — histórico como narrativa temporal, não só lista; base para insights
- [ ] **Retrieval contextual temporal** — busca semântica no histórico para alimentar chat e insights
- [ ] **Backfill com data passada** — registrar atividade com data anterior (decidido, não implementado)

### P2 — Reflexão e insights (Camada 4)
- [ ] **Insights automáticos** — IA lendo timeline; critérios: raros, específicos, contextualizados, honestos (sem coaching genérico)
- [ ] **Pulso/entrada do dia** — entrada ultra-leve, "quando der", sem pilar obrigatório, nunca streak

### P3 — UX complementar
- [ ] **Editar pilares pós-onboarding** — confirmar/renomear pilares inferidos pela IA
- [ ] **Seleção de foco** — "Em que quer focar agora?" nas configurações

### P4 — Integrações e expansão
- [ ] **Adaptador Obsidian** — export markdown fase 1 (Postgres → markdown)
- [ ] **Integrações passivas** — Apple Health, Google Fit, calendário (camada 0)
- [ ] **Modelo de monetização** — quando abrir ao público

### Concluído
- [x] **Input natural com IA** — texto livre + áudio (web + mobile); 5 fases
- [x] **Chat com IA contextual** — streaming via Ollama; contexto completo do usuário; web
- [x] **Dashboard hierárquico** — sub-pilares indentados sob pais; web + mobile

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

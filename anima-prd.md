# Anima — Product Requirements Document
> Documento vivo de design. Última atualização: 2026-06-02 (sessão: mudança de paradigma — de "organizador gamificado" para "sistema operacional pessoal adaptativo"; input natural via IA; seção 1c adicionada)
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
Um sistema operacional pessoal adaptativo: absorve a vida como ela é — caótica, não-linear, imprevisível — e organiza tudo em segundo plano. O usuário despeja informações naturalmente; o sistema extrai estrutura, detecta padrões e mantém continuidade sem exigir gerenciamento manual.

A camada de game (XP, níveis, eras, quests, radar) não é o núcleo — é o **feedback layer**: transforma dados de vida em progressão visual, sensação de avanço e contexto emocional. O usuário é o personagem, a vida é o mapa, o app é o HUD — mas o HUD se atualiza sozinho.

**Diferencial principal:** Outros apps pedem que o usuário se organize *para* o sistema. O Anima se organiza *para* o usuário. A interação principal é escrever sobre a vida — o sistema classifica, conecta e evolui automaticamente.

**A lente do produto (definida em jun/2026):** na prática, o Anima se comporta como uma **agenda + diário** organizada por pilares, com a camada de game (XP, níveis, eras, quests) por cima. A interação principal é *escrever* o que aconteceu ou se planeja — não preencher formulários. Insight central: logar dados é fricção que as pessoas abandonam; escrever um diário é algo que a pessoa já quer fazer. Quando o ato de organizar a vida *é* a interação, o input deixa de ser custo e vira o próprio valor.

**Standalone primeiro, integrações depois:** o app é 100% autossuficiente. Qualquer integração externa (Obsidian, Apple Health, etc.) só *adiciona* — nunca é dependência. Ver seção 13b.

---

## 1b. Modelo de interação e cadência

> Definido na sessão de design de jun/2026. Mistura princípios já **decididos** com **hipóteses em teste** no protótipo.

### Princípio organizador
A frequência de input deve **espelhar a velocidade com que cada coisa muda**. Não se pergunta tudo na mesma cadência:

| O que | Velocidade de mudança | Como é capturado |
|-------|----------------------|------------------|
| Identidade, pilares | Raríssima | Onboarding + edição esporádica |
| Humor / energia / o dia | Diária | Pulso/entrada do dia (quando der) |
| Atividades | Ao longo do dia | Registro oportunista |
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

### Papel da IA (esclarecido em jun/2026)
A IA atua em duas camadas complementares — não mutuamente exclusivas:

**Camada primária — organizadora implícita (trabalha em segundo plano):**
- Absorve texto livre e extrai estrutura automaticamente
- Mantém contexto ao longo do tempo sem o usuário recontá-lo
- Conecta áreas da vida sem o usuário modelar as relações manualmente
- Detecta padrões invisíveis no histórico acumulado
- Mantém continuidade narrativa sem exigir organização explícita

**Camada secundária — chat intencional (quando o usuário quer):**
- Brainstorming sobre a própria vida ("o que está acontecendo com meu pilar de Trabalho?")
- Reflexão orientada por perguntas
- Planejamento de quests e objetivos
- Qualquer conversa com contexto completo da vida

O chat não é o modo padrão — é uma ferramenta para quando o usuário quer uma conversa intencionalmente. A diferença é que a camada primária funciona sem esforço; o chat requer intenção.

### Diretriz de feature
Toda nova feature deve responder:

> **"Isso reduz ou aumenta a carga mental organizacional do usuário?"**

Se aumentar → provavelmente vai contra a filosofia central.  
Se reduzir → provavelmente está alinhado.

**Consequência arquitetural:** o sistema deve favorecer texto livre, contexto contínuo, memória persistente e organização automática — e reduzir dependência de campos rígidos, categorização manual e fluxos baseados em formulários.

---

## 2. Pilares de vida

O usuário escolhe quais pilares acompanhar durante o onboarding. Os pilares padrão são:

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
- O usuário pode remover pilares padrão (mínimo 1 ativo)
- O usuário pode adicionar pilares personalizados (ex: Espiritualidade, Criatividade, Aventura)
- Pilares são definidos no onboarding e podem ser editados depois
- Cada pilar tem seu próprio nível (1–50)
- O nível geral do personagem é a média dos níveis de todos os pilares ativos

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

## 7. Onboarding (primeiro login)

**5 etapas** (web e mobile). Duas etapas do design original foram removidas — ver decisões de design.

### Etapa 1 — Nome
- Campo: nome (como quer ser chamado)

### Etapa 2 — Arquétipo
- Quiz de 5 perguntas com chips de resposta
- Resultado: combinação percentual de 4 arquétipos (Explorador, Focado, Construtor, Visionário)
- Salvo em `profiles.archetype`; injetado no system prompt da IA

### Etapa 3 — Pilares
- Apresenta os 7 pilares padrão pré-selecionados
- Usuário pode desmarcar (mínimo 1) e adicionar pilares personalizados
- Permite criar sub-pilares vinculados a pais (hierarquia)

### Etapa 4 — Contexto por pilar
- Para cada pilar selecionado: perguntas com chips multiselect + opção "Outro" (texto livre, múltiplas)
- Respostas salvas em `user_pillars.context` (JSONB); usadas no system prompt da IA

### Etapa 5 — Resumo / Personagem
- Exibe o personagem criado: nome, Nível 1, Era: Despertar, arquétipo dominante
- Lista os pilares ativos com a taxa de XP
- CTA: "Começar a jornada"
- Ao confirmar: salva `name` e `onboarding_completed_at` no perfil, insere pilares em `user_pillars`

### O que foi REMOVIDO do design original
- ~~Sliders de baseline (1–10)~~ — diagnóstico visual sem impacto no sistema; fricção sem valor
- ~~Seleção de prioridades~~ — afetava apenas sugestões de quest (ainda não implementadas); fricção desnecessária

---

## 8. Fluxo de autenticação

### Rotas
| Rota | Comportamento |
|------|--------------|
| `/` | Roteador inteligente: sem sessão → `/login`; com sessão + onboarding feito → `/home`; com sessão sem onboarding → `/step-1` |
| `/login` | Server Action via Supabase Auth; sucesso → `/home` |
| `/signup` | Server Action via Supabase Auth; sucesso → `/step-1` |
| `/forgot-password` | Envia e-mail de reset via `supabase.auth.resetPasswordForEmail`; em dev, e-mail chega no Mailpit (porta 54324) |
| `/auth/callback` | Route Handler que troca o `code` por sessão (PKCE); redireciona para `?next=` |
| `/reset-password` | Define nova senha via `supabase.auth.updateUser`; redireciona para `/home` |
| `/settings` | Exibe dados da conta e formulário de troca de senha |
| `/history` | Timeline de atividades registradas agrupada por dia |
| `/step-1` a `/step-3` | Protegidas por auth guard no layout do grupo `(onboarding)` |
| `/home` | Protegida por auth guard no layout do grupo `(app)` |

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
| Pilares | Customizáveis por usuário | Cada vida é diferente |
| XP de quests | Definido antes de começar | Remove viés de inflação pós-conclusão |
| Etapas 3 e 4 do onboarding | Removidas | Baseline sem impacto no sistema; prioridades sem quests implementadas — fricção desnecessária no fluxo inicial |
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
| Sistema de arquétipos | 4 arquétipos (Explorador, Focado, Construtor, Visionário) com % combinados por pessoa | Personalidade não é binária; combinação única captura melhor quem a pessoa é |
| Arquétipo no onboarding | Quiz de 5 perguntas com chips antes da seleção de pilares | Contexto de personalidade molda como a IA orienta desde o primeiro dia |
| Sub-pilares | Hierarquia infinita com múltiplos pais; XP propaga 100% para todos os ancestrais | Tudo na vida é correlacionado — 1h de Skate melhora Saúde E Lazer de verdade, não 50% de cada |
| Sub-pilares excluídos do nível | character_stats só conta pilares raiz (sem pais) | Sub-pilares já propagam XP para pais — incluí-los causaria dupla contagem no nível do personagem |
| Contexto de pilar | Perguntas com chips multiselect + "Outro" (texto livre, múltiplas); salvo como JSONB | Cada pilar tem intenções diferentes; contexto rico melhora orientação da IA |
| "Outro" em perguntas | Enter confirma como chip selecionado e abre novo input vazio; toque no chip remove | Permite múltiplas opções customizadas por pergunta; fluxo natural igual ao web |
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
- [x] Onboarding em 5 etapas — `/step-1` a `/step-5` com botão "← Voltar" em todas
  - Step 1: nome do usuário
  - Step 2: quiz de arquétipo (5 perguntas → resultado com % por arquétipo)
  - Step 3: seleção de pilares com criação de sub-pilares vinculados a pais
  - Step 4: contexto por pilar — perguntas com chips multiselect + "Outro" (texto livre)
  - Step 5: resumo completo — frase personalizada, barras de arquétipo, pilares com tags de contexto
- [x] Sistema de arquétipos — 4 tipos (Explorador, Focado, Construtor, Visionário) com combinação % única por pessoa; salvo em `profiles.archetype`; injetado no system prompt da IA
- [x] Sub-pilares hierárquicos — `pillar_relationships` (muitos-para-muitos); XP propaga 100% recursivamente para todos os ancestrais; sub-pilares excluídos do cálculo de nível do personagem
- [x] Contexto de pilar — respostas do onboarding salvas em `user_pillars.context` (JSONB); IA usa no system prompt
- [x] Dashboard home — radar de vida SVG, cards de pilares com barra de XP
- [x] Registro de atividades — modal com seleção de pilar, tempo, preview de XP ao vivo, bônus automáticos *(ainda usa formulário estruturado — pendente refatoração para input natural, como no mobile)*
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
- [x] Onboarding em 5 etapas (nome → arquétipo quiz → pilares com sub-pilares → contexto → resumo)
  - Input "Outro" em contexto: chips múltiplos — Enter confirma e abre novo campo vazio; toque no chip remove
  - Sub-pilares: `allPillarOptions` exclui filhos (não pais) do picker; múltiplos sub-pilares com mesmo pai funcionam
  - Todos os steps: `useSafeAreaInsets` para respeitar Dynamic Island / notch do iPhone
  - Step-5: `router.replace('/(app)/home')` direto após salvar (sem depender de refreshSession)
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

- [ ] **Pulso/entrada do dia** — experiência ainda mais leve, "quando der", sem pilar obrigatório, nunca streak
- [ ] **Web: refatorar para input natural** — modal de registro ainda usa formulário estruturado; alinhar com o mobile
- [ ] **Onboarding conversacional** — substituir os 5 steps por uma conversa com a IA (hipótese futura)
- [ ] **Insights automáticos** — IA lendo timeline acumulada e gerando padrões entre pilares
- [ ] **Criar sub-pilares pós-onboarding** — adicionar/editar pilares da home ou configurações
- [ ] **Backfill com data passada** — registrar atividade com data anterior (decidido no PRD, não implementado)
- [ ] **Adaptador Obsidian** — export markdown fase 1 (Postgres → markdown)
- [ ] **Integrações passivas** — Apple Health, Google Fit, calendário (camada 0)
- [ ] **Modelo de monetização** — quando abrir ao público
- [ ] **Seleção de foco** — "Em quais pilares quer focar agora?" no onboarding + Configurações
- [x] **Dashboard hierárquico** — sub-pilares indentados sob os pais no home (web + mobile)
- [x] **Input natural com IA** — texto livre + áudio; implementado no mobile

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

# Marco 007 — Interação com o Computador e Aplicações Locais

> Registro histórico. **Append-only** — mudanças futuras devem criar um novo marco, sem apagar a decisão registrada aqui. Registra uma decisão humana de **direção e princípios** (uma nova capacidade e suas restrições), **não** uma especificação técnica. Não cria, por si só, contrato, taxonomia, agendamento, backlog de implementação nem autonomia ampla.

**Data:** 2026-08-12

---

## Contexto

O [Marco 004](004-anima-portatil-e-nos-locais.md) estabeleceu os **nós locais**: capacidades, autorizadas por máquina, para observar ou atuar sobre **arquivos, pastas, ferramentas e recursos** explícitos, sob uma fronteira de privacidade estrita. O [Marco 005](005-autonomia-progressiva-e-identidade-una.md) fixou que a autonomia evolui **por evidência** (§2), por capacidade e **não acoplada** entre capacidades (§7), que a aprovação evolui para **mandato/envelope** (§8) e que **Supervisor, Executor e Reviewer/Verifier** são papéis separáveis (§9), com o núcleo **independente de provider** (§3).

Este marco **estende o braço executor local** para uma classe de capacidade ainda não ratificada explicitamente: **interagir com o computador e com aplicações locais** — perceber o que está visível e operar interfaces gráficas e o sistema operacional, na direção do que se chama *computer-use / local interaction*. É a continuação natural do "nó local" do Marco 004, agora alcançando a **camada visual/GUI/OS**, e permanece integralmente dentro das fronteiras e da disciplina de maturidade já ratificadas.

O canal por onde este próprio mandato chegou é apenas uma **prova inicial do canal** — evidência de que a interação local funciona em um caso, **não** evidência suficiente para liberar autonomia ampla.

---

## 1. Capacidade de primeira classe, provider-neutral (princípio existencial)

O Anima deve poder, como capacidade arquitetural de primeira classe:

- **perceber** o estado visível de aplicações e do sistema operacional (ler tela, janelas, conteúdo, foco, estruturas de acessibilidade);
- **atuar**: abrir/focar aplicações, navegar, clicar, digitar, selecionar, copiar/colar e operar fluxos locais completos.

Esta é uma **capacidade do Anima**, realizada por um **braço executor** substituível. A arquitetura **não** se acopla a Claude, GPT, Codex, Ollama ou qualquer outro provider (Marco 005 §3): o provider concreto que realiza a percepção/atuação é uma decisão de capacidade e política, nunca parte da identidade do produto nem do contrato de domínio.

> **Princípio:** interação com o computador é um **braço executor** do Anima, provider-neutral, não um agente ou persona próprios. Ela empresta capacidade; não empresta identidade nem intenção.

## 2. Sob mandato do Supervisor (arquitetura desejada + política)

A interação local opera **sempre sob mandato** (Marco 005 §8), com um envelope **explícito** que declara, no mínimo:

- **escopo** (o que pode e o que não pode ser tocado);
- **impacto** e **classe de efeito** de cada ação;
- **alvo** (quais aplicações, janelas, recursos);
- **duração** e **orçamento** (tempo, número de ações, custo);
- **dados permitidos** (o que pode ser lido/enviado; o que é proibido);
- **condições de parada** e de **escalonamento**.

O Executor trabalha **dentro** do mandato e **não** expande a própria autorização; o sistema **impede automaticamente** ações fora do envelope. Mantêm-se separáveis **Supervisor → Executor → Reviewer/Verifier** (Marco 005 §9): quem opera a tela não é necessariamente quem define as próprias permissões nem quem certifica o resultado.

## 3. Cada classe de efeito é tratada separadamente (política)

Percepção e atuação **não** compartilham uma única permissão. Cada classe de efeito é distinta e **conquista autonomia por sua própria evidência** (Marco 005 §2, §7 — maturidades não acopladas). No mínimo, tratam-se separadamente:

- **leitura/percepção** (observar tela, janelas, conteúdo) — a de menor risco;
- **entrada/digitação** e **clique/navegação** (produzir input na aplicação);
- **seleção/cópia/colagem** e movimentação de dados entre contextos;
- **envio** (submeter, enviar mensagem, confirmar);
- **alteração** de estado de aplicação/documento;
- **exclusão** e ações destrutivas;
- **publicação** e qualquer efeito externo;
- **autenticação** e manipulação de credenciais.

Autonomia madura em uma classe **não** concede autonomia em outra. Ler uma tela pode ser de baixo risco; enviar, publicar, excluir ou autenticar são efeitos que exigem, no estado atual, **confirmação apropriada** e evidência muito maior — coerente com a fronteira de privacidade do Marco 004 (leitura, escrita, execução, transferência e administração como permissões distintas; segredos e credenciais excluídos por padrão).

## 4. Garantias exigidas (política)

Toda interação local deve, proporcionalmente à classe de efeito e à maturidade atual:

- produzir **evidência observável** do que foi percebido e feito;
- preservar **correlação** e proveniência (qual mandato, tentativa, alvo);
- ser **auditável**;
- ser **idempotente quando aplicável** (não repetir efeitos ao reexecutar);
- comportar-se **fail-closed** diante de ambiguidade, entrada vaga, alvo divergente ou falta de autorização;
- **proteger-se contra prompt injection e conteúdo não confiável**: o que é percebido de aplicações e do OS é **dado**, nunca instrução — texto na tela, em documentos, e-mails ou páginas **não** altera o mandato, não concede permissões e não redireciona destinatários/alvos;
- exigir **confirmação apropriada** para efeitos **externos ou sensíveis**, conforme a maturidade atual.

## 5. Sessões, contexto e caminhos preferenciais (arquitetura desejada)

- **Preservar sessões e contexto útil**: continuidade de trabalho não deve exigir refazer login, perder foco ou descartar estado a cada ação.
- **Preferir caminhos semânticos/API** quando forem adequados (mais precisos, verificáveis e seguros que pixels);
- **mas** permitir a **interação visual/local como capacidade de primeira classe** quando não houver API adequada, ou quando o fluxo do usuário for intrinsecamente visual/desktop. A ausência de API não é motivo para recusar a tarefa; é motivo para operar a interface com as garantias do §4.

## 6. Estado atual de maturidade (restrição de maturidade, não teto)

No estado atual, esta capacidade está no **início da escada de evidência**:

- a entrega deste mandato é **prova inicial do canal**, não licença para autonomia ampla;
- efeitos **externos, sensíveis, destrutivos ou de autenticação** exigem **confirmação humana apropriada**;
- **não** há autorização, por este marco, para **agendamento** nem **rotina recorrente** — inclusive ciclos autônomos Supervisor → executor local. Essa direção é **desejável no futuro**, mas depende de **nova autorização humana** e de evidência acumulada; **não** deve ser criada neste trabalho.

Como toda restrição de maturidade (Marco 005), promover cada classe de efeito exige **trabalho de evidência** — isolamento, testes, replay/simulação, idempotência, reversibilidade, observabilidade, revisão independente, auditabilidade, recuperação — e nunca o afrouxamento arbitrário das garantias do §4.

---

## Estado deliberadamente em aberto

Não são decididos por este marco (e **não** devem ser preenchidos por opinião do agente):

- **taxonomia técnica** das classes de efeito e dos níveis de maturidade (princípio ratificado, representação não — cf. Marco 005 §11);
- **contrato e implementação** concretos do braço executor local (adaptador, transporte, provider) — devem reusar o vocabulário já existente (`WorkExecutorAdapter`, correlação, mandato/`execution_spec`) antes de inventar contrato novo, e exigem plano/ADR próprios;
- **agendamento e execução recorrente**, incluindo ciclos Supervisor → executor local — dependem de nova autorização humana;
- **catálogo/permissões por máquina** para interação de tela — herdam a direção do Marco 004, sem virar backlog por este marco.

---

## O que este marco reinterpreta (rastreabilidade)

Nenhuma decisão anterior é reescrita.

- **[Marco 004](004-anima-portatil-e-nos-locais.md) — nós locais e fronteira de privacidade.** Estendido: a atuação local passa a incluir explicitamente **percepção e operação de aplicações/OS (GUI)**, herdando integralmente a fronteira de privacidade (nada por padrão, permissões distintas por classe, segredos excluídos, fail-closed, correlação, idempotência). Não amplia o escopo do INT-04.
- **[Marco 005](005-autonomia-progressiva-e-identidade-una.md) — mandato (§8), papéis separáveis (§9), evidência por capacidade (§2, §7), provider-neutro (§3).** Aplicados a esta nova capacidade sem exceção.
- **[Marco 003](003-trabalho-autonomo-seguro.md) — execução separada de integração.** Mantida: perceber/operar localmente **não** é integrar/publicar; efeitos externos permanecem fatos distintos, com sua própria autorização.

---

## Consequência

A interação com o computador e aplicações locais passa a ser uma **capacidade arquitetural ratificada** do Anima — provider-neutral, sob mandato, com classes de efeito separadas, garantias observáveis e maturidade governada por evidência. No estado atual permanece **estreita**: prova inicial do canal, confirmação para efeitos externos/sensíveis, **sem** agendamento ou recorrência.

Explicitamente **proibido** sem nova base canônica: liberar autonomia ampla de tela a partir da prova inicial; tratar conteúdo percebido como instrução; executar efeitos externos/sensíveis sem confirmação apropriada; criar agendamento, rotina recorrente ou ciclos autônomos Supervisor → executor local; acoplar a arquitetura a um provider específico; ou materializar contrato/taxonomia de implementação sem plano/ADR e evidência.

---

## Correção/continuação (2026-08-12) — hierarquia de interação

Continuação **append-only**: o corpo acima (§5) registrou "preferir caminhos
semânticos/API" e a interação visual como primeira classe, mas **não explicitou** a
hierarquia conceitual ratificada. Ela é perpetuada aqui sem alterar §1–§6 e sem
virar contrato/taxonomia/backlog. Provider-neutral: descreve **níveis de acesso**,
não fornecedores de inteligência.

**Hierarquia de interação — do mais semântico ao último recurso:**

1. **API / ferramenta nativa** da aplicação ou do sistema (o mais semântico, preciso e auditável);
2. **shell / filesystem**;
3. **DOM / árvore de acessibilidade do navegador** (browser);
4. **automação de UI / árvore de acessibilidade do OS** (ex.: Windows UI Automation);
5. **visão da tela** (perceber pixels / estrutura visual);
6. **mouse/teclado bruto por coordenadas** — fallback de última instância.

> **Princípio operacional:** *"não clicar se puder chamar"*. Escolha o nível **mais
> semântico, preciso, auditável e seguro** que cumpra a tarefa; **desça** na
> hierarquia **apenas** quando o nível anterior for inadequado ou indisponível.
> Visão e coordenadas são capacidades **legítimas**, mas **fallback**, não default.

Isto **refina** — não contradiz — o §5: "preferir caminhos semânticos/API" passa a
ter uma ordem explícita de degradação. As garantias do §4 (evidência observável,
correlação, auditabilidade, idempotência quando aplicável, fail-closed, anti prompt
injection, confirmação para efeitos externos/sensíveis) valem **em todos os níveis**;
quanto mais baixo o nível, maior a exigência de evidência e confirmação. A
materialização operacional vive na [arquitetura](../arquitetura/orquestracao-de-trabalho.md);
contrato/taxonomia continuam **em aberto**.

---

## Referências

- [`../../anima-manifesto.md`](../../anima-manifesto.md) — capacidades internas e autonomia por impacto
- [`../../anima-prd.md`](../../anima-prd.md) — estado tático vivo
- [Marco 004 — Anima Portátil e Nós Locais](004-anima-portatil-e-nos-locais.md)
- [Marco 005 — Autonomia Progressiva e Identidade Una](005-autonomia-progressiva-e-identidade-una.md) (§2, §3, §7, §8, §9, §11)
- [Arquitetura da Orquestração de Trabalho](../arquitetura/orquestracao-de-trabalho.md) — mandato, contrato de executor, correlação, fail-closed

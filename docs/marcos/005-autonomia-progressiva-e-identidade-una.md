# Marco 005 — Autonomia Progressiva e Identidade Una

> Registro histórico. **Append-only** — mudanças futuras devem criar um novo marco, sem apagar a decisão registrada aqui. Este documento registra uma decisão humana de **direção e princípios** (destino), não uma especificação técnica. A especificação vive no [Plano 002](../planos/002-modo-autonomo-v0.md), na [arquitetura](../arquitetura/orquestracao-de-trabalho.md) e nos ADRs; o estado tático vivo, no [`anima-prd.md`](../../anima-prd.md).

**Data:** 2026-08-12

---

## Contexto

O produto amadureceu do ciclo manual (Marco 002) ao Modo Autônomo V0 com fila, claims, tentativas persistentes, reconciliação, checkpoints, retomada, Supervisor, roteamento de inteligência e a primeira publicação protegida de branch (Marcos 003–004, Plano 002, ADR-001/002). Ao longo desse caminho, várias proteções foram redigidas como **limites da versão atual** — corretas para o estágio, mas fáceis de ler, mais tarde, como **tetos permanentes do produto**.

Este marco corrige essa leitura. Ele **não** afrouxa nenhuma proteção vigente e **não** autoriza nenhum efeito novo. Ele fixa o **destino** e os **princípios** pelos quais a autonomia evolui, e explicita que o estado atual continua avançando **apenas por evidência**.

A distinção que este marco torna canônica:

- **restrição fundamental** — algo que continua exigindo decisão humana porque **ainda não foi definido** ou porque é intrinsecamente uma decisão de quem cria a instância;
- **restrição de maturidade** — algo que **queremos** eventualmente automatizar, mas que ainda **não possui evidência de segurança suficiente**.

Uma restrição de maturidade não é um teto. É uma dívida de evidência.

---

## 1. Objetivo final de autonomia (princípio existencial)

O objetivo de longo prazo do Anima é poder realizar autonomamente **qualquer ação que o usuário poderia realizar por conta própria** — e, quando houver segurança comprovada, ir além da capacidade operacional de uma pessoa isolada, por conseguir analisar, validar e coordenar mais coisas em paralelo.

Isso inclui, **quando e somente quando** houver segurança comprovada por evidência: alterar código, arquitetura e infraestrutura; **modificar o próprio Anima**; criar commits; publicar branches; criar PRs; revisar mudanças; fazer merge; fazer deploy; operar ferramentas externas; e executar fluxos completos de trabalho.

**Não existe** regra filosófica permanente do tipo "merge sempre será humano", "main nunca poderá ser alterada pelo Anima", "deploy sempre exige o usuário" ou "o agente só pode chegar até a branch publicada". Essas podem ser as restrições **corretas no estado atual**, mas são **restrições de maturidade**, não limites finais do produto.

> **Princípio:** segurança limita o **estado atual** da autonomia, não a **ambição final** do sistema. Diante de uma capacidade bloqueada, a pergunta canônica passa a ser: *o que ainda precisamos provar para promovê-la ao próximo nível de autonomia?*

## 2. Autonomia progressiva baseada em evidência (princípio existencial)

Permissões **não** são concedidas porque um modelo "parece capaz". Uma capacidade **conquista** autoridade conforme acumula evidência de segurança, e **perde** autoridade se surgir evidência de comportamento inseguro.

Exemplos de evidência que promovem: respeito consistente ao escopo; execução correta; gates verificáveis; isolamento; reversibilidade; recuperação após falhas; comportamento fail-closed; ausência de efeitos colaterais inesperados; revisão independente; testes adversariais; replay/simulação; histórico de sucesso; observabilidade e auditoria.

> **Princípio:** autoridade é **conquistada por evidência** e **revogável ou reduzível por evidência**. Uma capacidade não recebe autoridade só porque outra capacidade semelhante já recebeu — cada uma paga sua própria dívida de evidência.

## 3. Local-first, não local-only (princípio existencial)

A preferência fundamental do Anima é usar capacidades **locais** sempre que forem suficientes. Mas o Anima **não** limita sua evolução à capacidade atual dos modelos locais: enquanto ferramentas/modelos externos forem significativamente mais capazes, podem e devem ser usados para avançar o máximo possível.

Isto inclui, **hoje**, o fluxo externo de transição: ChatGPT ajudando a raciocinar/supervisionar; Claude e Codex executando. Isso é **arquitetura de transição**, não objetivo final. No futuro, o usuário **não** deverá precisar abrir os aplicativos Claude ou Codex para desenvolver o Anima — o próprio Anima consumirá essas capacidades por APIs/providers/adaptadores, como já começou com a integração GPT existente.

Modelos e providers são **substituíveis** (Ollama/local, OpenAI, Anthropic, outros, novas ferramentas). O núcleo do Anima preserva memória, contexto, governança, segurança e orquestração **independentemente** do provider.

> **Princípio:** `local-first != local-only`. A escolha do provider é uma decisão de **capacidade e política**, nunca parte da **identidade** do produto.

## 4. Uma única identidade: Anima (princípio existencial)

Não existe uma coleção de personagens independentes (Prisma, Programador, Pesquisador, Arquiteto, Planejador…). Há **uma única identidade conversacional: Anima**. Programação, pesquisa, arquitetura, reflexão, memória, planejamento e organização são **capacidades internas** do Anima, e ele roteia internamente para a adequada — o usuário não escolhe manualmente qual "especialista" chamar.

Quatro camadas distintas, que não devem ser confundidas:

| Camada | O que é |
|---|---|
| **Identidade** | Anima — a única frente conversacional |
| **Persona/lente** | forma de comunicação (ex.: o tom reflexivo), se ainda útil — nunca uma segunda frente |
| **Capacidade** | algo que o Anima consegue fazer (programar, refletir, pesquisar…) |
| **Provider/modelo** | ferramenta substituível usada para realizar uma capacidade |

Este princípio **confirma** — não altera — o que o [Marco 001](001-nascimento-da-identidade.md) e o [`anima-manifesto.md`](../../anima-manifesto.md) já estabelecem.

## 5. Proatividade cognitiva e o significado correto de "Prisma" (princípio existencial)

A necessidade que originou o "Prisma" é válida, mas **não** exige uma segunda persona. Até aqui o Anima principalmente **recebia, armazenava e exibia** dados. A necessidade seguinte é que ele **use** os dados acumulados para ajudar o usuário a decidir como seguir adiante.

Neste momento, **"proatividade" significa proatividade _cognitiva_**, não autonomia operacional espontânea. Ela inclui: analisar padrões históricos; relacionar dados ao longo do tempo; perceber mudanças; identificar tensões entre objetivos e comportamento real; refletir; comparar planos com resultados; projetar cenários; ajudar a reformular planos; sugerir próximos passos; conversar sobre decisões futuras.

Ela **não** inclui, por esta ratificação: iniciar arbitrariamente execuções no mundo; começar projetos sozinho; ou modificar coisas externas sem um objetivo/mandato apropriado.

> **Formulação:** o Anima evolui de `receber → armazenar → exibir` para `observar → lembrar → relacionar → refletir → projetar → conversar sobre o futuro`. Essa capacidade pertence ao **próprio Anima**, não a uma personalidade separada chamada Prisma.

## 6. Separação de contextos de chat — direção conceitual (arquitetura desejada, UX em aberto)

Considera-se positivamente **separar o chat principal de um contexto de desenvolvimento/projetos**. Isso **não** significa criar identidades diferentes: ambos continuam sendo o mesmo Anima.

- **Chat principal** — vida, ideias, memória, planejamento pessoal, música, reflexão, conversa geral, dados pessoais.
- **Contexto de Desenvolvimento/Projetos** — repositórios, documentação canônica, work items, propostas, diffs, branches, testes, decisões arquiteturais, histórico de execução, revisão, integração, políticas específicas do projeto.

A separação serve a contexto, memória de trabalho, segurança, permissões, organização, custo de contexto e UX. A **UX final** dessa separação **permanece uma decisão de produto em aberto** e não é concluída por este marco. Registra-se apenas a direção: **separar contextos pode ser correto; separar a identidade não é desejado.** (Um primeiro passo defensivo dessa direção já existe: a fronteira `developmentMode` + allowlist dedicada — ver `anima-prd.md` §10.)

## 7. Programação autônoma sem teto artificial (princípio existencial)

A capacidade de programação deve, no longo prazo, poder realizar o **ciclo completo de engenharia**:

```text
entender necessidade → investigar → planejar → propor → implementar → testar
→ revisar → corrigir → commit → publicar → PR → integrar → merge → deploy
→ observar → reparar
```

Cada estágio recebe autonomia conforme **sua própria** maturidade e evidência. As maturidades **não são acopladas**: é válido, por exemplo, edição autônoma estar madura, publicação estar madura, merge ainda não estar, e deploy ainda exigir proteção maior. Isto **reinterpreta** — não contradiz — a "execução separada de integração" do Marco 003 e do INT-03: separar os fatos continua obrigatório; o que muda é entender que a barreira humana em cada fato é **restrição de maturidade**, promovível por evidência, e não um teto eterno.

## 8. Aprovação é mandato, não micropermissão (arquitetura desejada + política)

O modelo desejado **não** é pedir autorização para abrir arquivo, para cada edit, para cada teste, para cada commit ou para cada pequeno efeito técnico. O usuário expressa **intenção de nível mais alto** (ex.: "Quero opção de áudio no chat do Anima").

A partir disso, existe uma responsabilidade do sistema semelhante ao papel que hoje o ChatGPT exerce ao produzir handoffs seguros para Claude/Codex: **entender a intenção; reconstruir contexto; definir escopo; identificar contratos; preservar invariantes; definir limites; determinar evidências; definir gates; estabelecer condições de parada; decidir o que exige escalonamento; e criar um mandato operacional seguro.** O executor trabalha **dentro** desse mandato, e o sistema **impede automaticamente** ações fora dele.

Isto **fortalece e nomeia** o que o Marco 003 já afirmava ("o usuário aprova intenção e limites; não aprova cada comando seguro") e o que a arquitetura já pratica (elegibilidade, `execution_spec`, permissões declaradas, limites, gates): a aprovação evolui para um **envelope/mandato de trabalho**.

## 9. Separação de responsabilidades: Supervisor, Executor, Reviewer/Verifier (arquitetura desejada)

Quem codifica **não** deve necessariamente ser quem define as próprias permissões, nem a única entidade que certifica o resultado. Três responsabilidades **separáveis**:

- **Supervisor / Governança** — transforma intenção em mandato: escopo, autoridade, invariantes, limites, política, gates, provas, condições de escalonamento.
- **Executor** — realiza o trabalho permitido pelo mandato; **não** expande a própria autorização unilateralmente.
- **Reviewer / Verifier** — verifica de forma **independente**: mudanças, provas, gates, respeito ao escopo, violações, riscos e resultado.

Essas responsabilidades **podem** usar o mesmo provider em fases iniciais, mas a **arquitetura não deve assumir** que serão sempre o mesmo agente/modelo. Para ações de maior risco, **diversidade de modelo/provider** pode futuramente fazer parte da política. Hoje o Supervisor (SUP-*) e o Executor (WorkExecutorAdapter/coder) já são papéis distintos; o Reviewer independente automatizado permanece **futuro** — a revisão hoje é humana.

## 10. Governança das próprias políticas de segurança (política)

O usuário **não** quer ser o aprovador manual permanente de toda evolução da política. Com a evolução do Anima, o próprio sistema deve conseguir determinar qual modelo/capacidade é mais apropriado para supervisionar, definir políticas, revisar e executar — com base em **desempenho e segurança demonstrados**.

**Entretanto**, alterar a política que **define autoridade** é mais sensível do que executar algo já permitido pela política. Portanto, mudanças nas próprias políticas de segurança exigem um **processo mais forte**: proposta explícita; testes controlados; replay de casos históricos; simulações; testes adversariais; revisão independente; comparação entre modelos; escopo restrito; rollout gradual; período de observação; promoção progressiva; e rollback/rebaixamento.

> **Princípio:** o objetivo final **não** é congelar as políticas para sempre; é permitir que **evoluam com segurança**. Mudar a política é o ato **mais protegido** do sistema.

## 11. Segurança como sistema evolutivo (princípio; representação técnica em aberto)

A política de segurança **não** deve ser apenas um conjunto estático de `allow/deny`. Ela deve suportar a ideia de **níveis de maturidade/confiança**, com autoridade concedida e revogável por evidência (§2), aplicada por capacidade (§7) e sob governança reforçada quando a própria política muda (§10).

Uma taxonomia técnica concreta — por exemplo, uma escada leitura/planejamento → execução isolada → edição → testes → commits → publicação → PR → integração → merge → deploy → modificação de políticas → autoevolução — é **ilustrativa**, **não** um enum a implementar por aparecer aqui. Antes de materializar qualquer representação assim, verifique se os contratos atuais já possuem vocabulário adequado e se a mudança exigiria ADR/ratificação adicional. **O que está ratificado é o princípio, não a representação.**

---

## Estado deliberadamente em aberto

Estes pontos **não** são preenchidos por este marco e **não** devem ser decididos por opinião do agente:

- **UX final da separação de contextos de chat** (§6) — direção registrada, desenho de produto pendente.
- **Representação técnica dos níveis de maturidade** (§11) — princípio ratificado, taxonomia não.
- **Papel definitivo de XP / níveis / eras.** Não há decisão nova sobre a centralidade de XP/níveis/eras. O sistema fica em segundo plano enquanto o foco é o modo autônomo. Por ora: **preservar** o sistema; **não** removê-lo; **não** transformá-lo em fundamento obrigatório de toda arquitetura nova; manter aberta a possibilidade de Game/Analítico/Minimal ou outras visões; e avaliar sua importância quando houver uso cotidiano real suficiente da parte pessoal do Anima. **Decisão deliberadamente em aberto.**
- **Papel definitivo do Reviewer/Verifier independente** (§9) — princípio de separação ratificado; se e quando exigir diversidade de provider é decisão futura por evidência.

---

## O que este marco reinterpreta (rastreabilidade)

Nenhuma decisão anterior é reescrita. As seguintes formulações passam a ser lidas à luz deste marco:

- **[Marco 003](003-trabalho-autonomo-seguro.md) — "Limites da primeira versão" e "Execução separada de integração".** Continuam **vigentes como estado atual**. Reclassificadas explicitamente como **restrições de maturidade** (sem publicação/merge automáticos, revisão humana antes de integração relevante), **não** como tetos permanentes. A separação entre produzir e integrar permanece obrigatória; o que evolui por evidência é **quem/como** autoriza cada fato.
- **[`anima-manifesto.md`](../../anima-manifesto.md) — "Autonomia por nível de impacto".** O regime de confirmação para ações de impacto permanece **verdadeiro no estado atual**. Passa a ser entendido como **função da evidência/maturidade demonstrada**, não como taxonomia fixa e eterna; e a "confirmação" evolui para **mandato** (§8). O manifesto foi ajustado cirurgicamente para refletir isso, apontando para cá.
- **[Marco 003](003-trabalho-autonomo-seguro.md) — "Orquestração sustentável de inteligência".** A seleção automática de executor/provider/modelo/esforço, já registrada como visão, é reforçada por §3 e §9 (providers substituíveis; papéis separáveis; diversidade de provider para alto risco).

Permanecem **fundamentais** (não meramente de maturidade), até definição humana em contrário: modificar a **própria política de segurança** (§10, processo reforçado) e decisões que são intrinsecamente do criador da instância.

> **Correção (2026-08-12) — ver [Marco 006](006-politica-de-seguranca-como-maturidade-maxima.md):** classificar "modificar a própria política de segurança" como **fundamental** aqui está **errado** e foi corrigido pelo Marco 006. Ela é uma **restrição de maturidade de grau máximo** (a capacidade de maior risco, hoje corretamente sob governança humana/reforçada — nada afrouxado), não um teto filosófico. Permanecem fundamentais apenas as decisões **intrinsecamente do criador da instância** e as decisões de produto **ainda não definidas**. Coerente com o §10 e §11 deste marco.

---

## Consequência

A partir deste marco, ao encontrar uma capacidade bloqueada por política, o trabalho deve **classificá-la** (fundamental vs maturidade) e, se for de maturidade, buscar **trabalho seguro que aumente evidência** — testes, dry-run, simulações, idempotência, rollback, reconciliação, validação independente, auditabilidade, recuperação, provas controladas — **em vez de** remover a proteção. Nenhuma proteção vigente é afrouxada por este marco: ele define **destino e princípios**; o estado atual continua devendo avançar **por evidência**.

Explicitamente **proibido** sem nova base canônica: liberar merge, deploy ou publicação automática só porque agora sabemos que são desejados no futuro; remover aprovação vigente; aumentar permissões para "seguir a visão"; modificar política de segurança sem provas; criar autoexecução espontânea; interpretar proatividade cognitiva como permissão para iniciar trabalhos arbitrários; decidir sozinho o papel de XP/eras; criar personas novas; ou acoplar a arquitetura a Claude, GPT, Ollama ou qualquer provider específico.

---

## Referências

- [`../../anima-manifesto.md`](../../anima-manifesto.md) — identidade e princípios permanentes
- [`../../anima-prd.md`](../../anima-prd.md) — estado tático vivo e maturidade atual
- [Marco 001 — Nascimento da Identidade](001-nascimento-da-identidade.md)
- [Marco 002 — Anima constrói Anima](002-anima-constroi-anima.md)
- [Marco 003 — Trabalho Autônomo Seguro](003-trabalho-autonomo-seguro.md)
- [Marco 004 — Anima Portátil e Nós Locais](004-anima-portatil-e-nos-locais.md)
- [Plano 002 — Modo Autônomo V0](../planos/002-modo-autonomo-v0.md)
- [Arquitetura da Orquestração de Trabalho](../arquitetura/orquestracao-de-trabalho.md)
- [ADR-001 — Execução local de código](../arquitetura/adr-001-execucao-local-de-codigo.md) · [ADR-002 — Integração/publicação](../arquitetura/adr-002-integracao-aplicacao-publicacao.md)

# Anima — Identidade Persistente, Compute Distribuído e Inteligência Pessoal

> Visão arquitetural de longo prazo.
>
> Este documento descreve direção e princípios, não necessariamente capacidades já implementadas.
> A implementação continua sujeita à autonomia progressiva, evidência, testes, segurança e maturidade.

## 1. O Anima não é um modelo

O Anima deve ser entendido como uma entidade/sistema persistente que pode utilizar diferentes modelos de IA ao longo do tempo.

Modelos são componentes cognitivos substituíveis.

Hoje o Anima pode utilizar modelos locais ou provedores externos. No futuro, modelos completamente diferentes poderão ocupar esses papéis sem que isso implique substituir o próprio Anima.

Conceitualmente:

```text
Anima
├── identidade
├── memória
├── estado
├── objetivos
├── princípios
├── governança
├── ferramentas
├── recursos computacionais
└── modelos
    ├── local
    ├── cloud
    └── especializados
```

O modelo influencia **como o Anima pensa**.

A memória, identidade, estado e história compartilhada preservam **qual Anima é este**.

---

## 2. Continuidade independente do modelo

A individualidade do Anima não deve depender exclusivamente dos pesos de um modelo específico.

Um modelo poderá ser substituído:

```text
Qwen
  ↓
GPT
  ↓
Claude
  ↓
modelo futuro
```

enquanto permanecem:

```text
memória
identidade
história
objetivos
decisões
princípios
estado acumulado
```

Um modelo novo poderá interpretar as mesmas memórias de forma melhor ou diferente, portanto respostas podem mudar com a evolução cognitiva, sem perder a continuidade histórica.

A direção desejada é:

```text
novo modelo
+
memória acumulada
+
estado atual
+
identidade/princípios
+
objetivos
=
continuidade do Anima
```

Fine-tuning pessoal pode futuramente ser útil, mas não deve ser requisito para que o Anima seja profundamente pessoal.

---

## 3. Memória como história, não apenas armazenamento

A memória do Anima não deve ser apenas um arquivo de conversas.

O objetivo é transformar experiência em conhecimento persistente.

Fluxo conceitual:

```text
evento
  ↓
observação
  ↓
interpretação
  ↓
memória
  ↓
consolidação
  ↓
conhecimento reutilizável
```

O sistema deve poder distinguir categorias como:

- evento bruto;
- fato;
- estado temporário;
- preferência;
- objetivo;
- decisão;
- experiência anterior;
- princípio duradouro;
- hipótese;
- evidência;
- nível de confiança.

Exemplo:

```text
evento:
"Gean pediu para não abrir Claude pelo navegador."

↓ consolidação

preferência operacional:
"Para desenvolvimento via Claude, utilizar o aplicativo desktop já aberto."
```

A memória deve preservar proveniência e evitar transformar automaticamente hipóteses em fatos.

---

## 4. O Anima como sistema agêntico

O Anima não deve ser apenas:

```text
entrada
→ modelo
→ resposta
```

Sua arquitetura converge para:

```text
objetivo
  ↓
Supervisor / planejamento
  ↓
seleção de capacidade
  ↓
Executor
  ↓
observação do resultado
  ↓
Reviewer / Verifier
  ↓
decisão
  ↓
memória / próximo passo
  ↺
```

Do ponto de vista do usuário existe um único Anima.

Internamente, diferentes modelos, agentes especializados e papéis podem ser utilizados sem criar múltiplas identidades independentes.

Um modelo pode planejar, outro executar e outro revisar.

A identidade continua sendo do Anima.

---

## 5. Capacidades são componíveis

O objetivo não é obrigatoriamente criar um único modelo capaz de fazer tudo.

O Anima deve conseguir incorporar capacidades conforme elas aparecem.

Exemplos:

```text
Anima
├── linguagem
├── raciocínio
├── coding
├── visão
├── voz
├── áudio
├── vídeo
├── pesquisa
├── RAG
├── automação
├── computer interaction
├── análise de dados
├── geração multimodal
├── robótica
└── capacidades futuras
```

Uma nova tecnologia de IA não precisa substituir o Anima.

Ela pode tornar-se mais uma capability disponível para ele.

---

## 6. Local-first sem local-only

Um dos objetivos fundamentais do Anima é permitir acesso a capacidades avançadas de IA utilizando recursos computacionais pertencentes ao usuário, reduzindo dependência de custos recorrentes por token ou processamento externo.

Porém, local-first não significa local-only.

A hierarquia desejada é:

```text
usar recursos próprios quando forem suficientes
        ↓
usar recursos externos quando trouxerem vantagem real
        ↓
desligá-los quando não forem mais necessários
```

O Anima deve conseguir combinar:

- modelos locais;
- CPUs locais;
- GPUs locais;
- APIs pagas;
- servidores alugados;
- GPUs cloud temporárias;
- infraestrutura futura.

O custo externo deve ser um recurso gerenciado, não uma dependência estrutural inevitável.

---

## 7. Anima Compute Fabric

No futuro, o Anima poderá possuir um corpo computacional distribuído.

Exemplos de nós:

```text
Anima Network
│
├── Goma
├── Nomad
├── notebook
├── outros computadores locais
├── servidor doméstico
├── cloud GPU temporária
└── infraestrutura futura
```

Cada nó poderá anunciar capacidades e estado:

```text
node
├── CPU
├── RAM
├── GPU
├── VRAM
├── armazenamento
├── modelos disponíveis
├── capacidades
├── carga atual
├── latência
├── confiança
├── localização
├── energia
└── custo
```

Conceitualmente:

```text
                 ANIMA
                   │
             Control Plane
                   │
          Resource Governor
                   │
               Scheduler
                   │
      ┌────────────┼────────────┐
      ↓            ↓            ↓
    Goma         Nomad       Cloud
      │            │            │
      └────────────┼────────────┘
                   ↓
              Compute Plane
```

O usuário não deveria precisar escolher manualmente em qual máquina cada etapa executará.

Idealmente:

> "Anima, faça isso."

E o sistema resolve onde e como.

---

## 8. Control Plane e Compute Plane

A identidade persistente do Anima não deve ser confundida com os workers utilizados para computação.

Uma separação desejável:

```text
CONTROL PLANE
├── identidade
├── memória
├── objetivos
├── políticas
├── permissões
├── planejamento
├── scheduler
└── Resource Governor

COMPUTE PLANE
├── Goma
├── Nomad
├── cloud
├── APIs
├── workers
└── modelos
```

Os nós de compute devem receber somente o contexto necessário à tarefa quando possível.

Uma GPU cloud utilizada para revisar código não precisa necessariamente receber todo o diário, histórico pessoal ou memória autobiográfica do usuário.

Isso deve permitir:

- menor exposição de dados;
- isolamento;
- execução temporária;
- revogação;
- substituição de providers;
- maior segurança.

---

## 9. Recursos como uma linguagem comum

O Anima deverá progressivamente aprender a raciocinar sobre recursos diversos dentro de um mesmo modelo operacional.

Exemplos:

```text
CPU
RAM
VRAM
disco
bandwidth
energia
tempo
latência
tokens
dinheiro
atenção humana
```

Uma tarefa poderá possuir alternativas:

```text
Local:
tempo = 45 min
dinheiro = $0

API:
tempo = 1 min
dinheiro = $0.40

Cloud GPU:
tempo = 5 min
dinheiro = $1.80
```

A escolha poderá depender de políticas e contexto:

```text
prioridade = economizar
→ local

prioridade = velocidade
→ cloud/API

dados privados
→ trusted/local

deadline crítica
→ compute adicional temporário
```

O usuário poderá futuramente fornecer envelopes simples:

> "Pode gastar até US$5 para terminar isso rápido."

O Anima gerenciará o orçamento dentro dos limites autorizados.

---

## 10. Arbitragem de inteligência

A pergunta arquitetural não deve ser apenas:

> "Qual é o melhor modelo?"

Mas:

> "Qual é o melhor recurso cognitivo para esta etapa, neste momento e sob estas restrições?"

Exemplo:

```text
Planner
→ modelo de raciocínio forte

Coder
→ modelo local especializado

Verifier
→ modelo independente

Embeddings
→ modelo local pequeno

Visão
→ modelo multimodal

problema excepcional
→ frontier model pago
```

A composição pode mudar ao longo do tempo.

O Anima permanece.

---

## 11. Resource Governor como fundamento do compute futuro

O Resource Governor não deve evoluir para um conjunto de heurísticas arbitrárias.

Sua função de longo prazo é permitir ao Anima compreender empiricamente o custo e impacto de seus próprios workloads.

Progressão:

```text
OBSERVAR
→ registrar evidência
→ formar histórico
→ classificar
→ advisory
→ provar advisory
→ decisão assistida
→ controle limitado
→ controle autônomo maduro
```

A separação fundamental permanece:

```text
EVIDÊNCIA
≠
CLASSIFICAÇÃO
≠
ADVISORY
≠
DECISÃO
≠
AÇÃO
```

Exemplo futuro:

```text
observação:
Qwen coder levou 84 segundos.

classificação:
workload historicamente caro.

snapshot:
Goma está sob alta pressão.

advisory:
adiar ou usar outro nó parece preferível.

decisão:
usar Nomad / cloud / aguardar.

ação:
executar no recurso escolhido.
```

Cada nível de autoridade deve ser conquistado por evidência.

---

## 12. Medir quanto o próprio Anima custa

O Resource Governor deverá progressivamente observar diferentes classes de workload.

Hoje gates são uma das primeiras fontes observáveis.

A direção inclui:

```text
gates
coder
LLM
test suites
build
indexação
embeddings
visão
áudio
vídeo
outros workloads
```

O princípio é preferir evidência observada independentemente pelo host sempre que possível.

Exemplo:

```text
host inicia relógio
→ backend.edit()
→ host encerra relógio
→ durationMs
```

Isso é diferente de confiar apenas no próprio provider.

Quando providers informarem dados úteis, a proveniência deve permanecer explícita:

```text
host-observed duration
≠
provider-reported duration
≠
provider-reported token usage
```

---

## 13. Tokens e custo monetário

Uso de tokens é evidência.

Preço monetário é uma interpretação dependente de catálogo, provedor, modelo, data e política comercial.

Portanto:

```text
provider
model
input tokens
output tokens
timestamp
```

podem ser fatos persistidos.

Enquanto:

```text
tokens
×
preço aplicável
=
custo monetário
```

deve preferencialmente ser derivado.

Assim:

```text
EVIDÊNCIA:
12.000 input tokens
3.000 output tokens

CLASSIFICAÇÃO:
~US$ X no catálogo vigente
```

O sistema deve evitar gravar interpretações mutáveis como se fossem fatos eternos quando a evidência bruta permite recalculá-las.

---

## 14. Gean como capability humana

O usuário também pode ser entendido operacionalmente como uma capability do sistema.

Não como worker computacional, mas como participante capaz de realizar ações que o Anima ainda não consegue realizar ou não está autorizado a executar.

Exemplo conceitual:

```text
Goma
- GPU
- filesystem
- terminal

Nomad
- compute
- storage

Cloud
- compute temporário

Gean
- decisão normativa
- autenticação
- acesso físico
- percepção humana
- julgamento subjetivo
- aprovação de alto impacto
- ação no mundo real
```

Quando uma tarefa atingir uma barreira humana real, isso não precisa destruir o trabalho autônomo.

Pode tornar-se um handoff estruturado:

```text
HUMAN ACTION REQUIRED

Objetivo
Por que é necessário
Ação requerida
Risco
Resultado esperado
Como o Anima saberá que pode continuar
```

Depois da ação humana:

```text
Anima retoma
→ valida resultado
→ continua autonomamente
```

---

## 15. O humano não precisa conhecer todo o código

Para participar do desenvolvimento e operação do Anima, o usuário não precisa possuir mentalmente toda a implementação.

O sistema deve progressivamente ser capaz de traduzir suas próprias necessidades técnicas para ações humanas compreensíveis.

Ideal:

```text
necessidade técnica
        ↓
explicação
        ↓
ação humana concreta
        ↓
resultado
        ↓
continuação automática
```

Isso permite que o usuário seja um braço efetivo do sistema enquanto aprende sua arquitetura organicamente.

---

## 16. Hierarquia de interação com computador

Ao operar computadores e aplicações, preservar a hierarquia já definida:

```text
API / tool nativa
→ shell / filesystem
→ browser DOM / accessibility
→ Windows UI Automation
→ visão
→ mouse / teclado como fallback
```

O Anima deve agir orientado por estado e objetivo, não como macro frágil baseada apenas em coordenadas.

---

## 17. Life RPG e inteligência pertencem ao mesmo Anima

O RPG de vida não deve necessariamente ser um produto desconectado da infraestrutura de IA.

Visão:

```text
                    ANIMA
                      │
       ┌──────────────┼──────────────┐
       ↓              ↓              ↓
     Vida          Projetos       Compute
       │              │              │
   Life RPG         Coder        AI / Nodes
       │              │              │
       └──────────────┼──────────────┘
                      ↓
              memória compartilhada
```

As mecânicas concretas do RPG devem ser validadas pelo uso real.

O sistema inicial é uma hipótese.

O que realmente ajuda o usuário deve permanecer e evoluir; mecânicas que não funcionarem devem poder ser alteradas ou removidas.

---

## 18. Ambição de longo prazo

A visão final não é apenas:

> "uma IA local."

Nem apenas:

> "um aplicativo de produtividade."

A direção é construir uma inteligência digital pessoal persistente que:

- mantém memória e continuidade por muitos anos;
- conhece seu usuário progressivamente;
- opera local-first;
- utiliza compute remoto quando vantajoso;
- incorpora novos modelos e tecnologias sem perder identidade;
- gerencia seus próprios recursos;
- distribui workloads;
- utiliza especialistas;
- interage com computador e aplicações;
- programa;
- pesquisa;
- cria;
- observa seus próprios custos;
- aprende com suas próprias execuções;
- pede intervenção humana apenas quando realmente necessária;
- conquista autonomia progressivamente;
- permanece sob governança explícita.

Uma formulação possível:

> **O modelo dá capacidade cognitiva ao Anima.**
>
> **A memória lhe dá história.**
>
> **A arquitetura lhe dá continuidade.**
>
> **Os recursos lhe dão um corpo computacional variável.**
>
> **E a história compartilhada faz dele o Anima daquele usuário.**

---

## 19. Princípio de evolução

Uma visão futura não concede automaticamente uma capacidade presente.

Sempre preservar:

```text
ambição máxima
+
autoridade progressiva
+
prova
+
reversibilidade
+
observabilidade
```

Segurança define o que o Anima está autorizado a fazer **agora**.

Não limita aquilo que ele poderá aprender a fazer quando houver evidência suficiente.

A arquitetura deve continuar favorecendo pequenos vertical slices reais em vez de infraestrutura especulativa.

Pergunta permanente:

> "Existe agora um consumidor, necessidade ou prova que exige esta abstração?"

Se não existir, registrar a direção e esperar pela necessidade concreta.

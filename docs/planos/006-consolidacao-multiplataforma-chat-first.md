# Plano 006 — Consolidação Multiplataforma Chat-First

> **Estado:** direção aprovada. Deve começar depois do Plano 005 e reutilizar
> seus contratos, evitando uma segunda implementação cognitiva no mobile.

## Objetivo

Consolidar o chat como entrada única no web e no mobile, implementando
capacidades uma vez e projetando-as adequadamente nos dois ambientes com o
menor esforço coerente.

O objetivo não é “copiar o web para o mobile”. É preservar regras e contratos
compartilhados e manter apenas diferenças legítimas de plataforma nas bordas.

## Princípios

- Lógica de negócio e cognição pertencem a `packages/core`.
- Tipos e contratos pertencem a `packages/types`.
- Persistência e invariantes pertencem ao banco e ao servidor.
- Web e mobile não mantêm versões divergentes da mesma regra.
- O web pode acelerar uma prova, mas não definir uma fronteira impossível de
  consumir no mobile.
- Texto, áudio, registro e solicitações de ação entram pela conversa.

## Backlog inicial

### CHAT — Limpeza Chat-First

- CHAT-01 — Remover `LogActivityModal`
- CHAT-02 — Migrar toda entrada de atividade mobile para o chat
- CHAT-03 — Levar o microfone ao input conversacional
- CHAT-04 — Remover onboarding antigo e código obsoleto
- CHAT-05 — Primeira experiência inteiramente conversacional

### SHARE — Contratos compartilhados

- SHARE-01 — Auditar regras duplicadas entre web e mobile
- SHARE-02 — Extrair regras puras para `packages/core`
- SHARE-03 — Consolidar tipos em `packages/types`
- SHARE-04 — Definir fronteira de API consumível pelas duas plataformas
- SHARE-05 — Compartilhar projeções de estado quando não forem visuais

### PAR — Paridade de capacidade

- PAR-01 — Detecção e registro equivalentes
- PAR-02 — Memória e contexto equivalentes
- PAR-03 — Cartões operacionais equivalentes
- PAR-04 — Correção de memória e identidade pelo mobile
- PAR-05 — Tratamento consistente de conflito e replay

### AUDIO — Entrada por voz

- AUDIO-01 — Captura de áudio integrada ao chat
- AUDIO-02 — Estados de gravação, envio, cancelamento e falha
- AUDIO-03 — Transcrição sem criar caminho paralelo de registro
- AUDIO-04 — QA real com Whisper em dispositivo físico

### QA — Continuidade multiplataforma

- QA-06 — Conversa longa no web e continuação no mobile
- QA-07 — Conversa longa no mobile e continuação no web
- QA-08 — Interrupção e retomada em dispositivo físico
- QA-09 — Ausência de divergência semântica entre plataformas

## Dependências

- contratos semânticos e conversacionais estabilizados no Plano 005;
- projeções operacionais do Plano 003;
- decisões de contexto portátil do Plano 004 quando aplicáveis;
- ambiente físico disponível para os aceites mobile.

## Fora do escopo

- identidade visual idêntica entre plataformas;
- compartilhamento forçado de componentes visuais;
- grafo mobile;
- integrações de saúde ou calendário;
- notificações push;
- expansão de features antes da remoção dos caminhos deprecated.

## Critério de conclusão do plano

Web e mobile oferecem a mesma capacidade conversacional e semântica, com
entrada exclusivamente pelo chat, regras compartilhadas e continuidade real
entre dispositivos. Diferenças restantes são apenas de apresentação ou
capacidade legítima da plataforma.

## Checkpoint estratégico

Depois deste plano, o roadmap deve parar antes de definir qualquer Plano 008.
O usuário e o Anima revisarão o uso real, a qualidade da conversa, o valor dos
nós locais, as limitações semânticas e a prioridade de jornadas, grafo,
relatórios, integrações ou reflexão crítica. Nenhum desses temas vira backlog
automático antes dessa revisão.

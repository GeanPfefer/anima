# Plano 004 — Nós Locais e Portabilidade

> **Estado:** direção aprovada. Requer refinamento arquitetural e ratificação
> dos contratos iniciais antes de liberar braços de implementação.

## Objetivo

Permitir que o contexto pessoal do Anima acompanhe o usuário, enquanto
arquivos, ferramentas e recursos permanecem sob permissões explícitas de cada
máquina.

Este plano transforma gradualmente o
[Marco 004](../marcos/004-anima-portatil-e-nos-locais.md) em incrementos
executáveis. Portabilidade não significa copiar indiscriminadamente conteúdo
local para um servidor.

## Princípios

- Um nó é uma capacidade local do Anima, não uma persona ou produto paralelo.
- Nenhum diretório, comando ou privilégio é acessível por padrão.
- Leitura, escrita, execução e transferência são permissões distintas.
- Referências portáteis não vazam caminhos, segredos ou nomes sensíveis.
- Conteúdo local só alcança modelos e serviços compatíveis com a autorização.
- O domínio não depende de sistema operacional, transporte ou fornecedor.
- A indisponibilidade de um nó falha fechada e não inventa capacidade remota.

## Backlog inicial

### NODE — Identidade e capacidade

- NODE-01 — Contrato de identidade opaca do nó
- NODE-02 — Catálogo tipado de capacidades disponíveis
- NODE-03 — Saúde, disponibilidade e versão de contrato
- NODE-04 — Referências locais opacas e portáteis

### PERM — Permissões locais

- PERM-01 — Modelo de raízes explicitamente autorizadas
- PERM-02 — Separação entre leitura, escrita, execução e transferência
- PERM-03 — Exclusão e sanitização de segredos
- PERM-04 — Aprovação para ampliar uma permissão existente

### DISC — Descoberta e vínculo

- DISC-01 — Registro manual de um nó
- DISC-02 — Vínculo autenticado com a instância pessoal
- DISC-03 — Remoção e revogação do nó

### EXEC — Seleção e execução

- EXEC-01 — Seleção de nó compatível com o trabalho aprovado
- EXEC-02 — Resolução local do alvo opaco
- EXEC-03 — Execução sem vazar caminho no contexto portátil
- EXEC-04 — Indisponibilidade, reconexão e diagnóstico tipado

### PORT — Continuidade

- PORT-01 — Consultar em outro dispositivo o estado de um recurso local
- PORT-02 — Retomar trabalho quando o nó voltar a ficar disponível
- PORT-03 — Distinguir contexto sincronizável de artefato exclusivamente local

### QA — Provas reais

- QA-03 — Prova Goma ↔ Nomad com uma capacidade delimitada
- QA-04 — Revogação de permissão durante uma tentativa
- QA-05 — Nó indisponível sem perda de estado ou ampliação de autoridade

## Checkpoints humanos obrigatórios

Antes de implementar NODE-02 ou PERM-02, ratificar:

1. identidade e ciclo de vida de um nó;
2. formato das referências opacas;
3. catálogo mínimo de permissões;
4. fronteira entre contexto portátil e conteúdo local;
5. modelo de autenticação e revogação.

## Fora do escopo

- indexação integral do computador;
- acesso irrestrito ao filesystem;
- cópia geral de arquivos;
- privilégio administrativo permanente;
- marketplace de capacidades;
- execução remota contínua;
- descoberta automática de segredos;
- sincronização arbitrária entre máquinas.

## Critério de conclusão do plano

Uma solicitação aprovada pode escolher uma capacidade autorizada em um nó,
executá-la com referências opacas e preservar evidências portáteis, enquanto o
conteúdo e as permissões locais permanecem sob controle da máquina.

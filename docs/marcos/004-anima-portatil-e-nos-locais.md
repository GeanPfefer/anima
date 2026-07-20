# Marco 004 — Anima Portátil e Nós Locais

> Registro histórico. **Append-only** — mudanças futuras devem criar um novo marco, sem apagar a decisão registrada aqui. Este documento registra direção de produto e restrições arquiteturais; não cria, por si só, backlog de sincronização, administração de máquina ou acesso amplo ao sistema.

**Data:** 2026-07-20

---

## Contexto

O Anima já preserva memória narrativa, estrutura de evolução e continuidade de trabalho. O Modo Autônomo começa a conectar essa intenção aprovada a executores locais. Surge então uma exigência de longo prazo: o contexto pessoal deve acompanhar o usuário entre dispositivos, enquanto arquivos, ferramentas e recursos de cada máquina continuam sob controle local e não precisam ser expostos na rede.

## Decisão

O Anima deve evoluir como uma camada pessoal portátil composta por duas responsabilidades separadas:

- **contexto pessoal portátil:** memória, identidade emergente, jornadas, decisões, trabalhos e checkpoints que podem acompanhar o usuário entre dispositivos;
- **nós locais:** capacidades disponíveis em cada máquina para observar ou atuar sobre arquivos, pastas, ferramentas e recursos explicitamente autorizados.

O Anima continua sendo a única experiência principal. Um nó local não é uma persona, um segundo produto nem uma fonte paralela de intenção: ele executa capacidades delimitadas em nome do Anima.

## Fronteira de privacidade

- Nenhum diretório, arquivo, comando ou privilégio administrativo é acessível por padrão.
- Cada máquina mantém suas próprias raízes e capacidades autorizadas.
- Leitura, indexação, escrita, execução, transferência e administração são permissões distintas.
- Arquivos podem permanecer exclusivamente locais; o contexto portátil pode guardar apenas referências ou descrições seguras quando isso for suficiente.
- Conteúdo local não é enviado a modelo ou serviço externo sem autorização compatível com o trabalho aprovado.
- Segredos e credenciais permanecem excluídos por padrão.
- Ações estruturais, destrutivas, privilegiadas ou com efeito externo continuam sujeitas a checkpoint humano.
- Toda atuação deve preservar correlação, evidências, idempotência quando aplicável e comportamento fail-closed.

## Portabilidade não é centralização obrigatória

Portabilidade significa continuidade do Anima entre dispositivos, não copiar indiscriminadamente todos os arquivos para um servidor ou banco central. Uma máquina pode conhecer a existência e o estado resumido de um recurso localizado em outra sem possuir seu conteúdo. A disponibilidade real de cada capacidade depende do nó local estar presente, autorizado e saudável.

## Relação com o Modo Autônomo

O INT-04 permanece estreito: um trabalho aprovado, início manual, um executor, uma tentativa, workspace isolada, resultado e evidências, revisão humana e nenhuma aplicação automática. Seu adaptador concreto será tratado como a primeira prova de uma capacidade local, sem tornar portabilidade, sincronização entre máquinas, catálogo de permissões ou administração geral requisitos da integração inicial.

Decisões atuais devem evitar bloquear a evolução futura para múltiplos nós. Em especial, contratos de domínio não podem depender de caminho absoluto, nome de máquina, sistema operacional, fornecedor ou transporte específico; referências locais devem ser opacas e não vazar dados sensíveis para eventos portáteis.

## Fora do escopo imediato

- sincronização automática entre máquinas;
- cópia ou upload geral de arquivos;
- indexação integral do computador;
- acesso irrestrito ao filesystem;
- privilégio administrativo permanente;
- descoberta automática de segredos;
- catálogo ou marketplace de capacidades locais;
- execução remota contínua;
- UI de gerenciamento de dispositivos;
- alteração do escopo aprovado do INT-04.

## Consequência

A portabilidade passa a ser uma restrição arquitetural permanente: novas capacidades devem distinguir o que é contexto pessoal portátil do que é recurso local. A implementação continuará incremental, começando pela prova estreita de execução local do INT-04 e somente criando backlog específico para nós, permissões e sincronização quando casos reais justificarem os contratos.

## Referências

- [`../../anima-manifesto.md`](../../anima-manifesto.md)
- [`../arquitetura/orquestracao-de-trabalho.md`](../arquitetura/orquestracao-de-trabalho.md)
- [Marco 003 — Trabalho Autônomo Seguro](003-trabalho-autonomo-seguro.md)
- [Plano 002 — Modo Autônomo V0](../planos/002-modo-autonomo-v0.md)

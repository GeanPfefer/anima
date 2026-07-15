# Plano 001 — Modo Construção MVP

> Plano interino incremental. O Modo Construção valida a Orquestração de Trabalho usando o próprio Anima, sem tornar desenvolvimento de software o centro do produto.

Documento arquitetural: [`../arquitetura/orquestracao-de-trabalho.md`](../arquitetura/orquestracao-de-trabalho.md).

## Estado das fases

| Fase | Estado | Resultado |
|---|---|---|
| F0 | Concluída | Árvore estabilizada; exploração de Persona Prisma preservada em resgate e correções independentes isoladas no commit `072211c` |
| F1 | Concluída neste commit | Roteador operacional, stub de ferramenta, arquitetura, plano, marco e PRD compartilhados. Este estado só é válido após o commit que contém este documento |
| F2 | Concluída | Persistência mínima, contratos transacionais, RLS, tipos e testes pgTAP |
| F3 | Concluída | Domínio compartilhado, serviço e adaptador Supabase independentes de fornecedor |
| F4 | Concluída | Proposta versionada e decisões de aprovação integradas ao chat web |
| F5 | Concluída | Execução manual, resultado, correções, revisão e encerramento preservando histórico |
| F6 | Não iniciada | Contexto versionado, proveniência e arquivamento de conversa |
| F7 | Não iniciada | Paridade mobile e múltiplos trabalhos/foco |
| F8 | Não iniciada | Contrato de adaptadores e executor falso; integrações reais continuam fora de escopo até nova aprovação |

## F0 — Estabilização

**Objetivo:** preservar a exploração anterior e separar correções úteis da Persona Prisma paralela.

**Critérios de aceite:** snapshot de resgate sem push; branch de fundação na base original; correções independentes commitadas separadamente; nenhuma Persona Prisma na fundação; typecheck e build executados; limitações dos testes registradas.

**Riscos:** perda de trabalho local, mistura de conceitos e recuperação acidental de UI paralela.

## F1 — Documentação compartilhada

**Objetivo:** criar uma fonte operacional curta e registrar as decisões antes do schema.

**Critérios de aceite:** `AGENTS.md` canônico; `CLAUDE.md` como stub; arquitetura e plano registrados; Marco 002 indexado; PRD aponta para o bootstrap; verificações repetidas; commit separado de F0.

**Riscos:** duplicar documentos, transformar visão futura em backlog imediato e registrar detalhes de F2 como implementados.

## F2 — Persistência mínima

**Objetivo:** implementar o schema inicial de `work_items` e `work_events`, RLS e RPCs transacionais conforme as emendas aprovadas.

**Dependências:** F1 aprovada. **Aceite:** migrations do zero, escrita somente por RPC, propriedade da mensagem validada, tipos regenerados e testes de transição/RLS. **Riscos:** RPC permissiva, estado divergente do log e acoplamento a quests.

## F3 — Domínio e orquestração

**Objetivo:** centralizar estados, eventos, impacto e propostas em regras compartilhadas.

**Dependências:** F2. **Aceite:** transições inválidas recusadas, contrato comum a web/mobile e núcleo independente de fornecedor. **Riscos:** infraestrutura no core e duplicação do pipeline.

## F4 — Proposta e aprovação no chat web

**Objetivo:** transformar pedido em proposta e permitir aprovar, corrigir, rejeitar ou adiar na conversa.

**Dependências:** F2/F3. **Aceite:** nada de impacto antes de aprovação, cartão versionado, rejeição persistida e conversa comum não convertida automaticamente. **Riscos:** formulário disfarçado e autorização ambígua.

## F5 — Ciclo manual completo

**Objetivo:** acompanhar execução externa manual, registrar resultado, revisar e encerrar.

**Dependências:** F4. **Aceite:** ciclo aprovado até conclusão, correções preservam histórico e usuário dá a decisão final. **Riscos:** resultado sem evidência e falsa impressão de automação.

## F6 — Contexto, proveniência e conversa

**Objetivo:** montar pacotes versionados por referência e arquivar conversas sem destruir memória.

**Dependências:** F5. **Aceite:** reconstrução de pedido/contexto/aprovação/resultado, sem cópias integrais; “limpar” não apaga proveniência. **Riscos:** vazamento, snapshots excessivos e referências quebradas.

## F7 — Paridade e foco

**Objetivo:** suportar o ciclo no mobile e vários trabalhos ativos com um item em foco.

**Dependências:** web estabilizada. **Aceite:** mesmos estados nas plataformas, troca de foco sem duplicação e confirmação em ambiguidade. **Riscos:** lógica duplicada e conversa fragmentada.

## F8 — Fronteira de executores

**Objetivo:** validar contrato de adaptador com executor falso, sem integração real.

**Dependências:** fluxo manual comprovado e nova aprovação. **Aceite:** sucesso, falha, timeout, cancelamento e retorno; capacidade independente; ciclos limitados. **Riscos:** abstração especulativa e integração externa acidental.

## Tarefa piloto

> Persistir a rejeição de propostas de vínculo entre pilares, impedindo que uma proposta recusada reapareça.

Ela exercita intenção, proposta, rejeição, memória de decisão e prevenção de repetição sem executor automático. Só será detalhada depois de F2 fornecer persistência e contratos.

# Plano 003 — Experiência Operacional

> **Estado:** próximo plano canônico. Este documento registra direção e backlog
> inicial; cada item deve receber especificação executável antes de ser
> delegado.

## Objetivo

Projetar o Modo Autônomo na conversa, permitindo que o usuário acompanhe,
interrompa, decida e revise trabalhos sem depender de console, dashboard ou
estado inventado pela interface.

Este plano sucede a Fase F do
[Plano 002](002-modo-autonomo-v0.md) e absorve sua antiga Fase G.

## Princípios

- O chat continua sendo a única experiência principal.
- Cartões são projeções do estado persistido, nunca fontes próprias de estado.
- Pausa e cancelamento têm efeito real, cooperativo e auditável.
- Toda decisão aponta para item, tentativa e versão exatos.
- Execução, aceite, integração, merge e publicação permanecem separados.
- Web pode provar primeiro uma experiência, mas regras pertencem às camadas
  compartilhadas sempre que forem portáveis.

## Backlog inicial

### UX-01 — Cartão de execução

Exibir estado, progresso conhecido, rota de inteligência, limites, orçamento e
checkpoint mais recente. Permitir solicitar pausa ou cancelamento com efeito
real e auditável.

### UX-02 — Cartão de decisão necessária

Projetar as razões tipadas de interrupção humana, contexto mínimo, alternativas
reais e ações vinculadas à versão apresentada.

### UX-03 — Cartão de resultado para revisão

Apresentar resumo, evidências, validações e handoff. Permitir aceitar, rejeitar
ou pedir alterações sem integrar automaticamente o resultado.

### UX-04 — Histórico e retomada pelo chat

Reencontrar trabalhos ativos, pausados ou aguardando decisão e retomá-los do
último checkpoint válido por meio da conversa.

### MOB-01 — Paridade essencial dos cartões

Projetar no mobile os mesmos estados e decisões, sem duplicar regras de
domínio ou persistência.

### HARD-01 — Preservar o sentido de “fora do escopo”

Impedir que nomes de recursos citados como excluídos sejam reinterpretados pelo
executor como alvos de alteração.

### HARD-02 — Abandono explícito de tentativa comandada

Criar caminho humano, auditável e fail-closed para encerrar uma tentativa
comandada sem duração máxima que permaneça em `in_progress`.

### HARD-03 — Desacoplar execução da conexão HTTP

Evitar que uma execução longa dependa de manter uma única requisição aberta,
preservando correlação, cancelamento cooperativo e retomada.

### HARD-04 — Diagnóstico e recuperação operacional

Oferecer ao próprio Anima informações suficientes para explicar tentativas,
claims, checkpoints e orçamento sem criar dashboard de administração.

### QA-01 — Jornada operacional completa pelo chat

Comprovar proposta, aprovação, execução, checkpoint, decisão, resultado e
revisão inteiramente pela conversa.

### QA-02 — Interrupção e retomada entre dispositivos

Comprovar interrupção real, reconstrução do estado persistido e continuidade
sem depender do contexto privado do executor.

## Ordem inicial

```text
UX-01
  ├─→ UX-02 → UX-03 → UX-04
  └─→ MOB-01

HARD-01 e HARD-02 podem ser refinados em paralelo.
HARD-03 requer decisão arquitetural antes de implementação.
QA-01 e QA-02 fecham o plano.
```

## Fora do escopo

- dashboard dedicado;
- streaming de log bruto;
- merge, aplicação ou publicação automática;
- paralelismo geral;
- notificações externas;
- administração ampla das máquinas.

## Critério de conclusão do plano

O usuário acompanha e decide o ciclo operacional pelo chat; toda projeção é
reconstruível a partir de persistência; interrupções e retomadas sobrevivem ao
encerramento da sessão; nenhuma integração relevante ocorre sem gate humano.

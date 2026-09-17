# Proteção de contrato canônico do estado residente

> Fundação implementada (linha `dev`). Fecha o lado de ESCRITA da classe do
> incidente 51929 e cria um ponto central único; o resíduo de leitura entre
> linhas divergentes é decisão humana registrada em "Limite e próxima decisão".

## Causa estrutural modelada

Um **formato canônico persistível** é aquele cuja evidência, gravada no log
append-only `work_events` (o **estado residente**), é REPROJETADA depois pelo
Capability Proof Engine / Evolution. Cada formato tem **dois lados** que precisam
concordar: um **produtor** que o escreve e um **leitor** (a linha autoritativa)
que precisa reprojetá-lo de volta.

O incidente **51929** (`host_observed_coder_evidence_recorded`,
`0c3e2c6d-652f-49ae-a1e1-53d60bc63e61`) nasceu da divergência entre esses lados
**entre linhas de código**: a linha snapshot/Harness V3 persistiu transcripts do
coder com `runtimeEvents` (formato novo), e a linha `dev` posterior não carregava
mais o reader correspondente. O `validCoderTranscripts` rejeitava a chave extra,
o projector retornava `null`, e o read-model do Evolution falhava fechado com
`semantic_projection_rejected` — quebrando a leitura inteira.

A combinação perigosa é: **código divergente + novo contrato persistível +
escrita no estado residente sem reconciliação/isolamento.** O objetivo é
enforcement técnico num ponto central, não dependência de documentação/memória.

## Boundary escolhido

Os quatro contratos canônicos persistidos hoje são gate, coder, git observados
pelo host e o parecer do Verifier. Cada um já tinha um **projector** no core
(`projectHostObserved*`, `projectVerifierOpinionHistory`) e o read-model do
Evolution (`capability-assessment-read.ts`) já os enumerava para falhar fechado.

O ponto central é o **registry** `packages/core/.../canonical-resident-contract.ts`,
que enumera cada contrato uma única vez e amarra ESCRITA e LEITURA à **mesma
régua**: o projector do próprio contrato. Ele não substitui os builders (que
validam a construção); garante a invariante **read-your-writes** no nível do
ENVELOPE — o exato nível onde o 51929 quebrou.

## Mecanismo de proteção

1. `guardCanonicalResidentWrite(contractId, payload)` — guarda **fail-closed** do
   lado de escrita. Sintetiza o evento **como o leitor o verá** (a partir da
   própria correlação da carga, fiel ao que a RPC materializa) e o reprojeta.
   Recusa se o contrato não está registrado (`unknown_canonical_contract`) ou se a
   carga não sobrevive ao reader (`unreadable_by_authoritative_reader`). É invocada
   nos quatro sinks (`*EvidenceSinkFor`, `verifierOpinionSinkFor`) **antes** da RPC.
2. `isCanonicalResidentEventReadable(event)` — a MESMA régua do lado da leitura;
   `capability-assessment-read.ts` passou a consumi-la. Escrita e leitura não podem
   mais divergir dentro de uma linha, porque são a mesma função.
3. Introduzir um novo formato canônico é, por construção, adicionar um membro ao
   registry — um único lugar, verificado por teste (writer ⇔ reader).

## Como worktrees normais continuam funcionando

Cargas em formatos já conhecidos passam a guarda e são persistidas normalmente. A
guarda vive na porta de persistência da observação, que é **fail-open**: uma
recusa vira "sem evidência nesta volta", nunca quebra a tentativa. O laço legítimo
`dev → worktree → coder → gates → verifier → review` é inalterado.

## Como o 51929-equivalente passa a ser bloqueado

- **Lado de escrita (runtime, fail-closed):** uma linha rodando como host residente
  não consegue mais persistir um formato canônico que ela própria não lê de volta —
  bloqueado ANTES de tocar o estado residente, em vez de deixar o Evolution quebrar
  depois.
- **Dentro de uma linha (build/CI):** escrita e leitura são a mesma régua; um writer
  sem reader (ou vice-versa) falha no teste. O registry é a única superfície de
  reconciliação — um merge que derrube um lado é visível e testável.

## Limite e próxima decisão (barreira humana)

Esta fundação é **pura** (sem migration). Ela NÃO fecha, sozinha, a regressão de
**leitura entre linhas divergentes**: linha A (que conhece o formato) escreve; linha
B, mais antiga, lê e não conhece. A guarda de A passa (A lê o próprio formato), e B
ainda falha. Fechar esse resíduo exige uma de duas opções — ambas mudam a
persistência/schema e são **decisão humana (migration + checkpoint)**:

- **(A) Namespace isolado:** um tipo/namespace de evento para formatos ainda não
  reconciliados que o reader canônico ignora por construção.
- **(B) Carimbo de contrato no envelope:** `contractId`+`version` explícitos no
  envelope persistido, permitindo ao reader classificar "versão que não conheço"
  (reconciliação) distinta de "corrupção", em vez do atual `event_history_invalid`
  opaco.

Recomendação: preferir (B) por preservar a régua fail-closed e dar diagnóstico
acionável; (A) como escape hatch para experimentação. Nenhuma foi implementada aqui.

## Referências

- Incidente e regressão permanente: commit `4f0c745`, reconciliação `dd5936f`.
- Read-model: `apps/web/lib/evolution/capability-assessment-read.ts`.
- Contratos: `packages/core/src/work-orchestration/{host-observed-*,verifier-opinion,coder-transcript}.ts`.
- Orquestração de trabalho: `docs/arquitetura/orquestracao-de-trabalho.md`.

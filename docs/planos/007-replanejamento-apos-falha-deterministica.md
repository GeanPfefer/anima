# Plano 007 — Replanejamento após falha determinística

> **Desenho proposto, não implementado nem promovido a política.** Diagnóstico e
> barreira demonstrados em 2026-09-02. Não é PIN-03. O mandato permite implementar
> recovery quando sua semântica decorre claramente dos contratos existentes; aqui
> falta definir progresso material sem redução de escopo, hoje proibido pelo
> anti-loop da decomposição. Nenhum successor criado por este plano.

## Problema e contratos vigentes

Uma attempt pode editar dentro do escopo e consumir o repair interno sem passar no
gate. `failed/retryable:false` impede reentrada, mesmo com saldo nominal de attempts.
Hoje existem duas derivações: decomposição de falha (`decision.action=decompose`)
e correção de resultado revisado (`changes_requested`). Ambas exigem subconjunto
estritamente menor de arquivos. Um item falho que já só permite um arquivo não
satisfaz nenhuma delas. A RPC de lineage aceitar um original failed não substitui
a validação da application layer.

Fontes: [recovery-successor.ts](../../packages/core/src/work-orchestration/recovery-successor.ts),
[decomposition.ts](../../packages/core/src/work-orchestration/decomposition.ts),
[Plano 002 — reconciliação do Item 1](002-modo-autonomo-v0.md),
[diagnóstico PIN-02](../registros/2026-09-02-diagnostico-semantico-pin02.md).

## Menor mecanismo proposto

Uma operação explícita de **replanejamento humano por diagnóstico**, separada de
retry e decomposição. Nome ilustrativo, ainda não CLI implementada:
`work replan <failed-id> --diagnosis <artefato>`.

1. Ler owner, versão vigente, failure event e attempt terminais, gates observados,
   checkpoint Git e delta de escopo. Recusar fontes ausentes, divergentes, stale,
   claim/attempt ativos e falha sem evidência correlacionada.
2. Receber diagnóstico humano estruturado: propriedade falsificada, causa comprovada,
   evidências, cenário A/B, correção semântica solicitada e o que muda no plano.
   Prosa do coder e exit 1 isolado não concedem autoridade.
3. Derivar proposal candidata e preview, no máximo `proposed`, com lineage direta
   à falha. Nunca mudar o estado, spec, retryability ou histórico do original.
4. No cenário A, manter exatamente o conjunto de arquivos permitido, excluir os
   demais e preservar produção. No B, a alteração de implementação exige proposal
   com nova autoridade explicitamente revisada; não herdar permissão por conveniência.
5. Preservar alvo, capability, permissões, gates, covers e requisitos heterogêneos;
   retomar checkpoint auditável. Declarar o diagnóstico no objetivo para que uma
   repetição do pedido anterior não passe por replanejamento.
6. Aprovar em operação humana separada, após preview validado. Supervisor continua
   dono da seleção/claim/attempt; Verifier e gates permanecem independentes.

## Fronteira ainda não definida pelos contratos

O mecanismo atual prova progresso pela redução estrita do conjunto de arquivos.
Este novo mecanismo precisaria provar **mudança material de plano mantendo os
mesmos arquivos**. Nenhum tipo/validador atual define essa equivalência. Trocar
`<` por `<=`, forjar `changes_requested`, marcar repetição do repair como duas
attempts ou chamar a RPC pulando o validador removeria a proteção existente.

Proposta para ratificação: somente diagnóstico explicitamente aprovado por humano,
uma autorização de replanejamento por failure event, idempotência estável e um
novo ciclo bounded sem geração automática de descendentes. Repetição com outro
texto não cria nova unidade; nova falha exige nova decisão humana. O orçamento
agregado da linhagem precisa ser explícito para impedir reset ilimitado de budgets.
Também é necessário decidir como evidenciar a aprovação desse diagnóstico e como
relacionar sua identidade com a aprovação versionada da proposal. Não há esse ato
tipado hoje; não inferir consentimento futuro de um campo textual.

## Contrato candidato para o PIN-02 (somente desenho)

Derivar diretamente de `5b8e371d`, failure `b6783ef2`, attempt `0cfdd6cb`, checkpoint
`1ee1921`. Cenário A: corrigir exclusivamente as provas do codec. Importar os exports
usados; round-trip pela composição pública; negativos na desserialização de texto
JSON; mudar `schemaVersion` para testar versão; remover expectativas fora do domínio
tipado e duplicatas. Não modificar `project-intake.ts` nem escrever a solução manualmente.

Escopo: `packages/core/src/project-intake.test.ts`. Exclusões: implementação,
`apps/`, `supabase/`, `packages/types/`. Aceite funcional continua ligado aos gates
Project Intake focado e Typecheck core; escopo/preservação a `proof:scope`, sem comando
artificial. Preferred `qwen3-coder:latest`, fallback local já governado para 14b;
sem cloud. Budget da nova autorização não pode ser inferido das três attempts do pai.

O contrato de prova existente foi exercitado com fixture pura sobre o spec real:
gates verdes + escopo observado → verified 3/3, zero gaps/violações; gates falhos
→ rejected. Isso comprova compatibilidade de evidência, NÃO a legitimidade de criar
uma nova unidade no mesmo escopo nem que o coder já produziu testes corretos.

## Gates para eventual implementação

- Recusar falta/expiração de diagnóstico aprovado, fonte stale, correlação cruzada,
  scope expansion no cenário A, gate/covers removidos e permissões/budget ampliados.
- Reentrega idêntica replaya; conflito de diagnóstico/candidato não cria outro filho;
  duas chamadas concorrentes não duplicam. Filho terminal não habilita novo filho.
- Persistir failure/attempt/diagnóstico/lineage; original intacto; sem efeito máximo
  superior a proposed até aprovação humana separada.
- Verifier: prova positiva gate+scope, negativas gate fail, arquivo excluído alterado,
  scope apenas atestado e critério sem covers.
- Classificação de inteligência: proveniência via múltiplos hops de lineage precisa
  ser validada sem aceitar órfãos/ciclos. Hoje a preparação busca só um ancestral e
  exige limites exatos 3/30; não alterar o budget do candidato apenas para passar nela.

## Próxima retomada

Ratificar a semântica de progresso sem redução de arquivos e orçamento da linhagem;
então implementar a operação geral, suas garantias na persistência e application
layer/CLI. Apenas após os gates e preview, aplicar o mandato humano de uma recovery
ao caso. Até lá: original failed, nenhuma terceira attempt, nenhuma criação ad hoc.

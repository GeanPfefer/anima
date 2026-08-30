# Plano 004 — Execution Placement V0 / Cloud Burst do Coder

> Estado em 2026-08-30: primeiro recorte implementado e provado localmente; cloud real não provisionada.

## Objetivo

Permitir que somente a inferência do coder rode em outro node quando a Goma não
tiver headroom, mantendo na Goma worktree, filesystem, Git, aplicação das operações,
scope/stale enforcement, checkpoint, gates, Verifier, state machine e evidência.

## Boundary V0

O seam existente `CoderBackend` foi preservado. `OllamaCoderBackend` usa o mesmo
protocolo read/edit host-mediado contra um endpoint escolhido pelo placement. O node
recebe prompts e devolve pedidos/operações; nunca recebe posse da worktree.

`decideCoderPlacement` é puro e determinístico:

- pressão `low` → `local`;
- pressão `moderate|high` + node habilitado, saudável, capaz e com o modelo → `remote`;
- pressão desconhecida, node inelegível ou ausência de node → `defer`;
- node `paid` sem autorização → `defer`.

O catálogo V0 é uma única configuração explícita: id, endpoint loopback (túnel),
capability, modelos, health, resource class, locality, billing mode e enabled. Não há
registro automático, descoberta, scheduler, autoscaling ou provisionamento.

## Evidência

A observação continua sendo produzida pela Goma ao redor de `backend.edit()`. Além de
backend lógico, duração e outcome, pode carregar `placement`, `nodeId` e `model`. Esses
campos vêm da configuração escolhida pelo host, não do auto-relato remoto. Eventos
legados V1 sem identidade de placement continuam válidos.

## Prova do recorte

Um endpoint HTTP controlado em porta efêmera, diferente do Ollama local padrão,
devolveu uma operação do protocolo. O `WorktreeExecutorAdapter` local aplicou-a,
criou checkpoint Git, rodou gate real e observou identidade remota. As provas negativas
de transporte, timeout, operação fora de escopo e stale hash reutilizam as guardas do
protocolo/executor existentes; node sem modelo e node pago sem autorização são recusados
pela decisão pura.

## Fronteira financeira

O gate canônico de autorização de compute pago ainda não existe. Portanto a integração
viva injeta `paidComputeAuthorized=false` sem override por ambiente: pressão de recurso
nunca autoriza gasto. Nodes próprios ou já provisionados podem ser selecionados; nodes
pagos permanecem fail-closed.

## Próximo recorte exato

Execution Placement V0 ainda precisa de uma prova viva pelo Resident Host com um Ollama
real em segundo processo/túnel e persistência no Supabase local. Depois disso, investigar
Provisionamento On-demand V1 somente como porta externa explícita de start/health/stop e
custo por hora, subordinada à autorização financeira persistida; sem autoscaling.

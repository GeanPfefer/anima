# Backend OpenAI host-mediated — implementação fechada, prova paga barrada pela governança

**Data:** 2026-09-03  
**Tipo:** desenvolvimento + auditoria de prova  
**Branch:** `dev`  
**HEAD inicial:** `6adce1ce0094b0f7cf0163255034ff9e6e263c69`  
**origin/dev inicial:** `6adce1ce0094b0f7cf0163255034ff9e6e263c69`  
**origin/main:** `99bec54e3ab42bfe882a8686cd1385d8058b916e` (intacta)

## Objetivo

Reconciliar o parcial herdado do backend coder OpenAI, fechar o adapter sobre o
protocolo host-mediated existente e executar uma prova real paga somente se toda a
governança financeira estivesse efetivamente no caminho vivo.

## Estado herdado e mudanças

- O parcial era uma única implementação coerente: `GptCoderBackend` delega ao mesmo
  laço READ→EDIT do `OllamaCoderBackend`; OpenAI nunca recebe filesystem direto.
- Preservados manifesto, reads servidos pelo host, operações estruturadas,
  `replace_exact`, `in_lines`, stale/scope/no-op, EOL, ambiguidade bounded,
  transcript e múltiplas rodadas.
- Responses API usa chave somente server-side, `store:false`, timeout/cancelamento,
  parsing fail-closed e classifica auth/rate-limit/timeout/cancel/API/malformed.
- Usage retornado pelo provider é agregado por attempt e persistido separado de
  duração/lifecycle observados pelo host.
- Fechados três gaps: provider configurado inválido falha fechado; `ANIMA_CODER_MODEL`
  atravessa a seleção real; OpenAI declara `placement=remote`, `nodeId=openai-api` e
  modelo na observação host-side.
- Corrigida uma regressão Jest: o delegate recebe o `fetchImpl` injetado e não exige
  `global.fetch` quando o transporte OpenAI já foi fornecido.

## Validação

- Suíte focada inicial: web 145/145; core 22/22.
- Suíte web completa: 1.283/1.284 inicialmente; única falha reproduzida e corrigida
  (`fetch is not defined`). Reteste relevante 33/33 verde. As advertências React
  `act(...)` e do ignore global Git são flakes preexistentes, não regressões.
- Core completo: 1.475/1.475.
- Typecheck: 5/5 workspaces.
- Build web: PASS (65 páginas).
- `git diff --check`: PASS.

## Credencial e efeitos externos

- `OPENAI_API_KEY` está presente em `apps/web/.env.local`; seu valor não foi lido,
  exibido, logado nem persistido.
- Nenhuma chamada OpenAI foi feita nesta sessão: zero calls, tokens e custo.
- Nenhum work item novo, attempt, worktree, gate vivo ou Verifier foi criado.
- Nenhum merge, deploy, integração, aceite ou alteração de `origin/main`.
- `.worktrees/`, `.claude/settings.local.json` e `watch4-sensors.txt` preservados.

## Barreira comprovada e próxima retomada

O substrato financeiro persistido governa nodes pagos/on-demand e exige autorização
humana, teto agregado e reserva no ledger. O caminho vivo de `coder_backend=openai`
ainda não consulta `paid_compute_authorizations` nem reserva/contabiliza exposição;
o envelope de autoaprovação também rejeita OpenAI deliberadamente. Portanto a prova
paga foi barrada antes do provider: executá-la agora bypassaria requisitos explícitos.

Próximo ponto exato: criar o wiring mínimo provider-paid para OpenAI (autorização
humana correlacionada ao work item, teto de chamadas/duração/custo, reserva e accounting
fail-closed, testes), então criar item novo independente e executar pelo pipeline normal
até `review`, sem aceitar ou integrar.

# Diferencial OpenAI autorizado — bloqueado antes do planner pelo Governor

Data: 2026-08-23
Tipo: tentativa de prova viva

## Objetivo e autorização

Executar uma única prova diferencial da cadeia canônica, trocando somente o planner para
OpenAI `gpt-5.6-terra`. A autorização humana cobriu fixture, instruções e saídas read-only
estritamente necessárias; excluiu segredos, `.env*`, dados pessoais desnecessários e qualquer
egress fora do planner. Coder `qwen3-coder`, worktree, gates, evidência e Verifier permaneceriam
locais.

## Estado e execução

- Branch `dev`; HEAD inicial/final funcional `efdf3ed`; quatro commits locais anteriores
  preservados sem rewrite; `origin/main=99bec54` intacta.
- Docker/Supabase/Ollama verificados; migration `20260823000001` aplicada, sem `db reset`.
- Primeira inicialização: daemon Docker caiu entre a checagem e a execução; identidade ficou
  indisponível. Instância encerrada antes do planner, sem egress.
- Após relançar Docker, Supabase e autenticação user-scoped ficaram saudáveis. A instância
  efetiva executou 60 reavaliações bounded; todas terminaram em
  `waiting_resource/host_turn_resource_pressure`, com zero itens tocados.
- Medição do host: ~2,21 GiB livres de 15,87 GiB (13,9%); Governor
  `pressure=moderate`, `verdict=defer`. Foram parados reversivelmente apenas os containers
  auxiliares `studio`, `pg_meta`, `vector` e `analytics`; banco, auth, REST, Realtime e Kong
  permaneceram ativos. A reserva de 25% não foi alterada.

## Resultado e invariantes

- OpenAI: **zero chamadas, zero tokens, zero custo**; a prova diferencial ainda não ocorreu.
- Nenhum work_item, aprovação, tentativa, worktree, gate ou parecer foi criado nesta sessão.
- Nenhum segredo foi exibido ou persistido; nenhum PR, merge, deploy, publicação, integração,
  service_role runtime ou cleanup destrutivo.
- `.worktrees/`, `.claude/settings.local.json` e `apps/web/.env.local` preservados.

Próximo ponto exato: aguardar recuperação natural do host até `Governor=permit` e repetir a
única execução diferencial autorizada. Não reduzir a reserva e não encerrar processos do
usuário para fabricar PASS.

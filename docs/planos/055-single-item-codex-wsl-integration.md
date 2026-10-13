# 055 — Integração focal Single-Item / Codex WSL

Autorização de 2026-10-10: código local, migration candidata separada e testes
focais. Nenhuma promoção, liberação de gate ou execução governada autorizada.

## Implementação preparada

- Preservado o [candidato mínimo 054](054-single-item-first-attempt-sql.md).
  `20261010000001_single_item_terminal_temporal_candidate.sql` substitui somente
  `record_commanded_work_terminal` e `private.release_mandated_result`;
  delta de corpo: `now()` → `GREATEST(created_at,updated_at,clock_timestamp())`.
  Assinaturas, grants, autorização, replay e transições não mudam. O helper usa
  a linha já bloqueada pelo chamador; nenhum novo lock ou RPC de retomada.
- Codex exige contrato worktree / codex-cli / default, WSL explícito e login
  ChatGPT observado pelo readiness existente. API key e login desconhecido
  recusados. Profile e ai-memory não entram nessa fronteira. O adapter confere
  novamente login antes de cada edit, sob o deadline e o AbortSignal existentes.
  Windows e os demais fluxos conservam seus defaults.
- Rota e observações precisam corresponder a codex-cli:default. Sem fallback
  de modelo/provider/cloud; orçamento externo existente permanece aplicável.
- Supervisor isolado persiste terminal e retorna pendente. A composição existente
  do backlog persiste gate/coder/git e Verifier, exige verified persistido e
  review relido, então libera somente o claim correlacionado. Sucesso da volta
  não significa aceite nem integração. O global mantém sua semântica anterior.
  Em advisory, o SQL histórico já pode ter colocado o item em review antes do
  parecer; a exigência nova impede sucesso da volta sem verified, sem desfazer
  nem alterar essa transição no banco.
- Erro/cancelamento com terminal confirmado preservam seu resultado e liberam
  a claim própria. Falha/timeout de evidências ou Verifier nunca viram sucesso.
  Liberação recusada, resposta divergente/ausente ou timeout ficam explícitos;
  não há retry automático. Sem terminal confiável, a posse é retida e requer
  inspeção humana: não inventar encerramento para prometer ausência de órfãs.

## Fronteiras restantes

Gate `single_item_atomic_claim_unavailable` intacto. `resume_from_checkpoint`
continua recusado; uma base Git inicial não representa retomada. Nenhuma proposta
foi alterada para trocar um contrato aprovado. As quatro falhas históricas de
orçamento local/externo continuam falhas, com expectativas e fixtures preservadas.

Timeout do pipeline limita a espera, mas não cancela uma RPC já enviada; um sink
pode concluir tarde para a mesma correlação. Falha de liberação exige consultar
estado antes de qualquer novo ato. Não há prova de segurança global de locks.
`record_work_decision_required`, controles no checkpoint e interrupção de orçamento
continuam fora do delta temporal: não corrigidos por arrasto nem certificados
contra relógio regressivo nesta sessão. A autorização atual não inclui outras RPCs.

## Próximo ponto de revisão/prova

1. Revisar este delta, os resultados e os limites no [checkpoint](../registros/2026-10-10-single-item-integracao-wsl.md).
2. Sob autorização de prova focal, repetir o preflight conhecido (Git/46 worktrees,
   DB/Auth, writer, RAM, imagem pinada, isolamento e históricos intocados).
3. Reutilizar bootstrap congelado 272, guard, executor e comparador 052 integrais;
   aplicar em um novo descartável **somente** 054 e a candidata temporal separada.
   Catálogo 279, mudanças permitidas exatamente cinco corpos; ACL/owner/RLS/
   policies/triggers/constraints/índices preservados. Não usar migration up genérico
   com as duas candidatas anteriores que incluem retomadas fora do escopo.
4. Prova focal: transação antiga, created_at/updated_at mais recentes e replay de
   terminal result/error/cancelled; liberação mandated e replay do parecer;
   autorização revogada durante espera, claims de terceiros inclusive vencidos,
   rollback e cleanup. Reutilizar fixtures e controles existentes, sem Codex pago
   ou tentativa real. Evidências raw/SQLSTATE e hashes antes de encerrar somente
   o novo ambiente. Não repetir a campanha completa nem classificar FAIL histórico
   como PASS. Decisão sobre caminhos temporais excluídos exige revisão humana.
5. Promoção, alteração do gate e primeira execução são autorizações distintas,
   posteriores. Nenhuma delas decorre dos testes offline.

## Checkpoint PostgreSQL focal — 2026-10-10

A prova autorizada foi concluída em um único novo descartável, já encerrado sem
remoção: bootstrap272/272, catálogo279 GO com exatamente cinco corpos e nenhum
atributo protegido alterado; oito cenários focais PASS; orçamento12 com oito PASS
e os mesmos quatro FAIL históricos. Rollback/cleanup e preservação do residente
confirmados. [Registro e limites](../registros/2026-10-10-single-item-terminal-prova.md).
Próximo ponto: revisão humana de promoção; instalação, gate e execução continuam
não autorizados. Não repetir a campanha completa como pré-condição automática.

# 2026-10-10 — Integração focal Single-Item / Codex WSL

Tipo: desenvolvimento e provas offline. [Plano 055](../planos/055-single-item-codex-wsl-integration.md).
Branch dev; HEAD inicial/final `6bc4aadef9414d655600c2ea37c6be436b3628c8`.
Nenhum commit, staging ou integração; índice vazio e 46 worktrees preservadas.

Migration separada: [terminal temporal](../../supabase/migrations/20261010000001_single_item_terminal_temporal_candidate.sql),
SHA-256 `5c486b7395e729201c320ff8cf9e8eb808277174dcdf9754d722341931d797c6`.
Só duas funções e duas atribuições de updated_at; candidato 054 e todas as
migrations anteriores preservados byte a byte. Sem DDL ou alteração de ACL.

Código: contrato puro, readiness WSL existente, adapter Codex e seleção;
Supervisor isolado adia sucesso/liberação; composição do backlog reutiliza o
pipeline de evidências e Verifier com exigência de persistência/verified/releitura.
Liberação requer resposta correlacionada; timeout ou erro não afirma liberação.
Advisory global, manutenção global e orçamento não foram alterados. Ver plano
para transições, limites de timeout e situações de posse retida.

Provas e evidências: [diretório](2026-10-10-single-item-integracao-wsl-evidencias).
Testes cobrem contrato/base versus retomada, login ChatGPT/API key/unknown,
backend/modelo/WSL, deadline/cancelamento, ciclo simulado completo, evidências
recusadas, Verifier rejected/inconclusive, timeout, liberação indeterminada e
preservação do item/claim vizinho. Modelos temporais não são prova PostgreSQL.

- 13 suítes web: 298 PASS; delta final acrescenta quatro testes (deadline e
  três respostas de liberação incompletas); 128 PASS nas três suítes afetadas.
  Total de casos distintos web: 302 PASS, sem somar repetições.
- Core: 16 PASS. Python focal: 106 PASS, incluindo cinco testes novos do delta SQL.
- Typecheck core e aplicação sem scripts temporários: PASS. Typecheck web completo:
  85 erros preexistentes em `scripts/_session`, preservados e registrados.
- Primeiro ensaio de seleção falhou por cwd da raiz não possuir Next; repetição
  no workspace web passou. Erros iniciais de tipagem dos novos testes foram
  corrigidos, com logs anteriores preservados.
- 2.484 arquivos dos pacotes 052r2, 556 hashes de bootstrap e 229 fontes protegidos
  íntegros. Fixtures/expectativas pgTAP e quatro FAIL históricos não alterados.

Diffs: `integration-snapshotted.diff` compara os quatro WIPs fotografados antes
da edição; `terminal-candidate.diff` contém a migration inteira. O diff Git
arquivado é relativo ao HEAD e **inclui WIPs anteriores**, não apenas esta sessão.
Hashes e snapshots permitem distinguir o delta desta sessão do trabalho herdado.

O teste Python anterior passou a congelar sua seleção de migrations até 054;
continua exigindo exatamente os três corpos daquela candidata, sem confundir o
novo delta posterior com uma alteração histórica. No fake SQL, a resposta de
release agora representa os campos snake_case da RPC real, para exigir confirmação
correlacionada. Não houve mudança em asserções ou fixtures SQL.

Nenhum Docker, SQL, attempt, Host, supervisor real ou API foi executado.
Residente, propostas, classificação, recovery OpenAI e eventos históricos não
foram acessados/modificados. Gate fechado e arquivos preexistentes preservados.
Nenhuma prova funcional antiga foi reinterpretada como aprovação do novo delta.

Decisão: GO para revisão técnica focal; **NO-GO para promoção/execução**.
Falta validar em PostgreSQL descartável as duas substituições temporais e sua
composição com Verifier/claims, além de decidir os caminhos temporais excluídos.
Interrupções sem terminal e revogação que impeça liberar claim continuam exigindo
tratamento humano explícito. Nenhuma nova recuperação foi implementada.

Checkpoint: revisar o plano 055 e autorizar somente sua prova SQL focal; não
aplicar ao residente, alterar gate ou executar o backlog por inferência.

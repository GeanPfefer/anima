# Single-Item — coleta concorrente corrigida offline

2026-10-09; desenvolvimento e testes exclusivamente offline.
**GO offline do runner dos dois cenários naturais; prova PostgreSQL pendente.**
[Plano053](../planos/053-single-item-natural-session-results.md),
[falha original](2026-10-09-single-item-guard-prova.md),
[diffs/logs/replay/pin](2026-10-09-single-item-runner-sessoes-evidencias/).

## Causa raiz e resultado

S segurava advisory do alvo; A acquire esperava S; B start/release esperava A.
Após liberar S, A recebia55000, psql ON_ERROR_STOP encerrava exit3. O envio
incondicional de ROLLBACK ao stdin encerrado produzia Broken pipe antes de
finish(A). O finally terminava B com-15, sem resposta completa. O runner gravava
FAIL_HARNESS_OR_PRECONDITION, retornava0 e o dispatcher seguia a campanha.
Esses fatos vêm dos três concurrent-session-*.json e result.json de cada cenário.

Agora somente esses dois cenários usam NaturalSession e o dispatcher canônico
em supabase/tests. EOF esperado é coletado, não seguido de write; corrida entre
poll/write confirma término e não repete comando. A e B têm coleta independente,
stdout/stderr/exit/SQLSTATE preservados antes da limpeza, sinais/timeout/completude
explícitos. Marcador de término precede rollback dos clientes ainda vivos;
EOF de recusa não exige rollback. Falha A não pula B. Só resultados completos
sem timeout/signal recebem classificação funcional/deadlock. Falhas internas e
INDETERMINADO produzem exit não zero no cenário e no dispatcher.

Cleanup tenta todas as sessões, preserva erro individual, terminate/kill limitado
para travamento e verifica backends e snapshot sintético. Terminação SQL futura
fica restrita ao PID conhecido quando disponível, banco atual e application_name
exato nonce/side emitido pelo próprio runner; nunca indiscriminada. Cleanup que
não for comprovado é FAIL, mesmo se uma SQLSTATE esperada já tiver sido observada.
ctx.check precede o primeiro snapshot SQL; review/hash e históricos são recusas
adicionais antes de importar o contexto. Import não executa SQL ou Docker.

Guard, comparator/executor052, migrations históricas/candidatas, fixture helpers,
Session geral e runners comprovados não foram editados. Quatro arquivos novos:
single_item_natural_session.py, single_item_natural_pairs.py,
single_item_natural_campaign.py e single_item_natural_session_test.py. A rota antiga
arquivada não é a rota da próxima prova desses dois cenários. Nenhum segundo
comparador/conector; transporte SQL existente reutilizado. AST verifica setup e
RPCs iguais aos originais, sem pré-lock de linha nas sessões A/B.

## Provas offline e falhas preservadas

- 170 testes Single-Item PASS (209,063s), incluindo17 novos;33 bootstrap PASS
  (11,896s). Subset final17 também PASS (0,083s).
- Processos/contextos simulados cobrem EOF precoce,55000,40P01, stdin fechado,
  corrida EPIPE, timeout/travamento/kill, resultado incompleto, signal-15, coleta
  idempotente, coleta B após falha A, cleanup/backends residuais, FAIL interno
  com exit0, resultado ausente, PASS desconhecido, pin adulterado e CID histórico.
- Replay offline usa stderr/exitA reais arquivados para simular o send antigo e
  reproduz BrokenPipeError nos dois casos; novo helper preserva A e coleta B
  **modelada** sem terminá-la. Não recupera ou transforma a resposta antiga de B.
- A primeira suíte completa correu enquanto eu ainda editava módulos:166 testes,
  dois ImportError de verify_review (módulo antigo já carregado versus import novo).
  Log preservado em single-item-tests.log. Reexecução final170 feita após congelar
  os fontes passou; isso foi uma sobreposição de desenvolvimento/teste, não um
  erro ignorado da revisão final.

Resultados SQL antigos permanecem FAIL/INDETERMINADO. Todos6051 arquivos das
evidências da campanha anterior conferidos por SHA256SUMS, sem substituição.
2484 pacotes052r2,156 migrations,556 hashesbootstrap e pins ativos052 PASS.
334 asserções/quatro FAIL históricos permanecem com as expectativas originais.
Review do novo overlay053:998098fabe9cc6810994e2afbf51b02b59d7b06a8f38627c0c7631e121bbb206.
Arquivos anteriores/pacotes não repinados; review/hashes novos só do harness.

## Estado operacional e fronteira humana

Git Windows dev; HEAD inicial/final
6bc4aadef9414d655600c2ea37c6be436b3628c8. Índice vazio, WIPs e46worktrees
preservados; snapshots inicial/final nas evidências. Sem commits/staging/push/
reset/clean/prune. Mudanças: quatro novos fontes, plano053, checkpoint PRD/052,
este registro e evidências novas. Residente e Docker não consultados nem modificados
nesta sessão; saúde atual não inferida do snapshot anterior. Sem SQL, containers,
serviço pago, INV-11/Resident Host ou remoção de single_item_atomic_claim_unavailable.

Próximo ponto exato: revisão humana do diff/pin053 e autorização posterior para
preflight integral e prova mínima descrita no plano. Novos ambientes sequenciais,
bootstrap272 e catálogo279 obrigatório; priorizar os dois controles naturais
baseline/item-claim/combinado. Não repetir as26 suítes baseline/item-claim sem
drift ou nova razão; combinado ainda precisa334asserções e matriz orçamento/
revogação/replay/retomadas/ACL/RLS/cleanup real antes de qualquer avaliação final.
Prontidão do runner orçamento no combinado é pendência distinta; não ampliada
nesta correção exclusiva. Não reutilizar nenhum CID/cluster histórico.

**Parada para revisão humana, sem campanha SQL autorizada nesta sessão.**

Git final:25 tracked modificados (preexistentes),171 entradas untracked agregadas;
índice vazio, HEAD e46worktrees idênticos ao início. WIPs preservados.

# Single-Item V1 — hardening das provas SQL — 08/10/2026

## Estado operacional e autoridade

Sessão autorizada para implementar hardening local e testar deterministicamente,
sem criar/acessar bancos de teste, iniciar/consultar Docker, aplicar migrations,
executar pgTAP/runner real, Host, INV-11 ou compute pago. Partiu da revisão da
entrega V1 preservada, não de uma implementação limpa.

Branch inicial/final `dev`; HEAD inicial/final
`6bc4aadef9414d655600c2ea37c6be436b3628c8`. Index vazio confirmado por Git Windows
`--no-optional-locks`; nenhum staging, commit, push, reset, clean ou prune. As 46
worktrees continuam registradas por leitura de `worktree list --porcelain`;
nenhuma worktree criada, removida ou alterada. Working tree continua com V0/V1
anteriores e demais WIPs. Não houve fetch nem consulta aos itens residentes.

## Manifesto exato desta sessão — 17 arquivos

Os 14 arquivos existentes abaixo já integravam WIPs anteriores. Somente o delta
necessário ao hardening foi acrescentado/alterado; não representam entrega nova
de todo o diff contra HEAD. Os registros anteriores/checkpoint ficaram intactos.

| Arquivo | Delta desta sessão |
|---|---|
| `supabase/migrations/20261008000000_single_item_work_claim.sql` | Revogar concessão herdada default service_role; corrigir comentário de ordem de locks do início |
| `supabase/tests/single_item_work_claim.test.sql` | Lock de alvo novo exclusivamente scoped; 55 asserções; cenários faltantes, ACLs, revogação claim→start e consumo único/replay/recusa da autoridade |
| `supabase/tests/single_item_concurrency.py` | Preflight real futuro pinado; fixtures/controls; locks/PIDs/XID; resultado específico; snapshots/ledger; deadlines/cleanup |
| `supabase/tests/single_item_concurrency_test.py` | 25 testes offline, incluindo processos Python locais simulados e orquestração sem DB/Docker |
| `supabase/tests/single_item_concurrency.md` | Adendo vigente de isolamento, interface, autorização, critérios e lacunas; texto inicial mantido como histórico |
| `packages/core/src/work-orchestration/single-item-execution.ts` | Recusa explícita de codex-cli sem comprovação de assinatura/autenticação |
| `packages/core/src/work-orchestration/single-item-execution.test.ts` | Regressão da recusa Codex; 16 casos ao todo |
| `apps/web/lib/work-orchestration/supervisor.ts` | Consulta dedicada do ledger de execution_started antes de orçamento/escritas; erro/resposta inválida/histórico recusados só no modo single |
| `apps/web/lib/work-orchestration/supervisor.test.ts` | Histórico antigo mesmo com new_execution, erro de leitura e Codex sem autenticação; fake da leitura dedicada |
| `apps/web/lib/work-orchestration/autonomous-backlog-deps.ts` | Resposta inválida na leitura de histórico falha fechada como no Supervisor; reutiliza recusa Codex do core |
| `apps/web/lib/work-orchestration/autonomous-backlog-deps-preflight.test.ts` | Codex recusado antes de SQL/compute/Supervisor |
| `docs/arquitetura/single-item-governed-execution-v0.md` | Adendo de fronteiras atuais, ACL/history/auth, instrumentos e pendências reais |
| `docs/planos/043-single-item-governed-execution-v0.md` | Adendo de preparação, resultados e próximos gates; histórico mantido |
| `anima-prd.md` | Adendo de estado tático atual, testes e fronteiras humanas |

Três arquivos novos:

| Arquivo | Responsabilidade |
|---|---|
| `supabase/tests/single_item_proof_preflight.py` | CLI --static: valida arquivos declarativos, sem chamar Docker/rede/DB |
| `docs/registros/2026-10-08-divergencia-orcamento-local-externo.md` | Diagnóstico separado da divergência histórica; sem correção de orçamento |
| `docs/registros/2026-10-08-single-item-v1-hardening-provas-sql.md` | Este registro recuperável da sessão e manifesto |

Fora do delta: WIPs CLI/V0 restantes, Host Turn/CLI execute-one e seus testes,
tipos provisórios, Plano 008, planos 009–040, demais registros, `%SystemDrive%/`,
`.tmp/`, `.worktrees/`, `apps/web/scripts/_session/`, watch4 e worktrees externas.
PRD compartilhado foi apenas acrescido, sem remover hunk preexistente. A entrega
V1 de 22 arquivos permanece documentada no registro anterior; este manifesto é
somente do hardening, não substitui aquela entrega. Arquivos .pyc criados durante
uma checagem de sintaxe foram removidos; nenhum artefato temporário novo permanece
no repositório. Não houve mudança em INV-09/10/11.

## Correções e decisões

O teste anterior media advisory já adquirido por acquire_work_claim no mesmo
BEGIN. Agora usa alvo inédito, primeiro exige ausência do lock e depois sua
presença após acquire_single_item_work_claim. Retenção real segue não observada.

A RPC proposta mantém composição/locks/contratos canônicos e não altera a RPC
global. O REVOKE agora abrange service_role, concedido pelas default privileges de
postgres. pgTAP mede EXECUTE efetivo de anon/authenticated/service_role/PUBLIC e
search_path; herança real de roles e RLS ainda dependem de catálogo PostgreSQL.
O comentário não equipara mais a ordem de locks de aquisição à ordem do início.

O runner remove o erro configurável, exige quatro conjuntos independentes,
valida owner/estado/versão/classificação/histórico/ocupação/claims/rotas/quotas,
verifica todos os cenários antes da primeira aquisição e faz controls reais
futuros com ROLLBACK. Não aceita B que falhe por fixture inválida como prova de
concorrência. Mede exatamente o lock previsto e A como blocker; depois exige
SQLSTATE+mensagem específicos. Compara fatos fora de A e ledger completo; exige
claim/attempt correlacionados de A. O cenário de orçamento é deliberadamente
restrito à política atualmente composta V1-supervision, sem exceções.

Readers usam Queue e deadlines, sem join bloqueante de executor. Comandos/clientes
são limitados; servidor recebe statement/lock/idle-transaction timeouts. Cleanup
termina backends somente no banco/application_name com nonce de A/B, inclusive
quando marker PID não chegou, e exige ausência posterior. Esses mecanismos foram
simulados deterministicamente; funcionamento Docker/backend real não é comprovado.

Supervisor não infere ausência de attempts das fontes de retomada: lê starts
diretamente, como o adapter, antes de orçamento/mutações. A restrição não modifica
o caminho global. Codex sem auth comprovada é recusado no core em ambos os caminhos.
Nenhuma variável configura auth fictícia ou abre gate. API paga/remote/router/cloud,
retomada e fallback continuam fora da fronteira.

Divergência de orçamento local/externo [registrada separadamente](2026-10-08-divergencia-orcamento-local-externo.md).
Não foi corrigida, encoberta por fixture ou contornada por trigger desabilitado.

## Evidências determinísticas

- Web: **343 testes, 14 suítes verdes**, Node Windows/npm.cmd, Jest runInBand.
  Inclui Supervisor, adapter preflight, Host Turn, gate, CLI, backlog e regressões
  globais de Router/on-demand/executor. Primeira rodada 342; depois da regressão
  Codex no adapter, rodada final 343, sem falhas. Providers/SQL/executores simulados.
- Core: **16 testes verdes** no arquivo single-item-execution.test.ts.
- Python: **25 testes offline verdes**, incluindo subcenários de validação estática,
  fixtures inválidas, locks esperados, erros específicos, mutação estrangeira ou de
  autorização, deadlines e drenagem/encerramento de processos Python simulados.
  Não chamou Docker nem PostgreSQL; não executou o CLI real concorrente.
- Typechecks: core, types, packages/supabase e web com config temporária em `/tmp`
  excluindo somente scripts/_session verdes. Não foi declarado typecheck web
  integral com scratch WIP; esse WIP não foi tocado.
- Git diff --check: exit 0. Avisos LF/CRLF conforme configuração preexistente do
  Git Windows; nenhuma normalização geral ou staging. Untracked SQL/Python têm
  checagens locais de conteúdo/sintaxe; isso não valida semanticamente o SQL.

Não houve build, pgTAP, teste concorrente efetivo, migração aplicada, schema
descartável, geração factual de tipos, chamada paga ou prova operacional. Não
houve flake/falha de código nos gates desta sessão. Testes verdes não demonstram
atomicidade, isolamento PostgreSQL, ACL/RLS real ou visibilidade após espera.

## Riscos, aceite e próxima retomada

**GO para revisão humana do hardening; NO-GO para execução SQL nesta autorização.**
O gate single_item_atomic_claim_unavailable permanece incondicional e intacto.

Pendentes: imagem/dependências para schema Supabase completo e pgTAP disponíveis;
identidades/metadados reais independentes; ACL/herança/RLS; semântica das 55
asserções; disputas reais e visibilidade STABLE do orçamento; cleanup real;
ordem inversa scoped/global, início comandado concorrente, corrida de versão e
interleavings/deadlocks herdados. A assinatura em packages/types/src/database.ts
continua manual/provisória. A divergência histórica de quotas pode reprovar a
regressão correspondente e exige outro escopo; não liberar produto por skip.

Próximo passo mínimo: humano revisar este manifesto/migration/instrumentos e o
[protocolo vigente](../../supabase/tests/single_item_concurrency.md). Autorizar
especificamente criação/start/initdb de um único container independente e coleta
real de identidade/metadados. Depois validar ausência de volumes/rede/portas/
creds residentes e banco nonce; só então autorizar bootstrap/migrations/fixtures/
TAP/runner nesse destino identificado. Não usar defaults do projeto residente.

Aceite futuro: TAP completo sem falhas e triggers habilitados; controles individuais
admitidos com rollback integral; espera no lock específico com PID de A; apenas A
admitida; recusa específica de B e ausência de efeitos nos demais itens/claims/
eventos/autorizações; consumo único de concessão; isolamento por usuário e versão;
regressões globais; cleanup confirmado; tipos gerados do schema descartável e
revisados. Guardar os logs/metadata/observações e receber revisão humana antes de
qualquer liberação do gate. Banco residente, Host, INV-11 e commit continuam atos
separadamente autorizáveis. Parada nesta entrega após implementação/testes.

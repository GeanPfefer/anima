# 043 — Single-Item Governed Execution V0

Base: `dev` @ `6bc4aadef9414d655600c2ea37c6be436b3628c8`.
Autorização: implementação supervisionada local e testes determinísticos; sem
migration, acesso ao banco, aprovação/execução INV-11, Host real ou providers.

## Estado

Preparação local e recusas implementadas; **objetivo operacional não concluído**.
CLI `work execute-one <UUID> --version N`, escopo explícito, uma volta, sem fallback,
manutenção/classificação globais omitidas, versões conferidas antes de efeitos.

Bloqueio adicional encontrado: claim canônico pode liberar claim vencido de outro
item; início comandado não possui enforcement atômico de orçamento sob claim.
Modo single-item recusa antes de qualquer escrita. Ver
[contrato e mapa de efeitos](../arquitetura/single-item-governed-execution-v0.md).

## Aceite

- [x] UUID/versão obrigatórios, sem seleção implícita ou fallback.
- [x] Recusas por item inexistente, não aprovado, versão divergente ou inelegível.
- [x] Nenhuma manutenção/classificação global ou efeito pago no novo caminho.
- [x] Regressões determinísticas do caminho single-item e global.
- [ ] Primitiva SQL de claim estritamente scoped com orçamento atômico.
- [ ] Execução efetiva de uma única attempt sem tocar outros itens.
- [ ] Prova SQL de exclusividade/concorrência e prova viva separadamente autorizadas.

## Retomada

Autorizar uma fatia de migration para o contrato scoped, sem mudar o caminho
global; provar atomicidade antes de conectar execução. INV-11 permanece como
contexto humano `proposed v1/zero attempts`, sem nova leitura residente nesta sessão.
INV-09/INV-10, WIPs e worktrees preservados. Nenhuma fase operacional concluída.


## Incremento V1 — fronteira SQL preparada (2026-10-08)

Nova autorização: migration aditiva, integração e testes determinísticos. O humano
exigiu parada antes de aplicar migrations, executar produto ou criar commit.
Prova SQL descartável requer isolamento comprovado e autorização específica.
O estado V0 acima e seus resultados permanecem históricos.

Implementado: `20261008000000_single_item_work_claim.sql` compõe guarda de claims
alheios com `acquire_work_claim` na mesma transação, mantendo item → alvo;
Supervisor seleciona a RPC scoped e conserva `start_claimed_work_attempt`.
Retomadas/checkpoints/history de attempts e compute pago são recusados; Router,
node remoto e on-demand ficam fora do caminho single-item. Cancelamento antes
ou depois do claim impede início e libera somente a posse própria quando preciso.
O fluxo global continua usando a RPC original.

**Execução continua bloqueada** por `single_item_atomic_claim_unavailable` no
adapter e no Supervisor. Gate em código, sem env/flag para bypass; os testes de
integração simulam sua revisão exclusivamente pelo Jest. Não há prova PostgreSQL.

- [x] Migration proposta sem reescrever RPC global/índices/budget.
- [x] Integração preparada e recusas determinísticas, com regressões globais.
- [x] Suíte pgTAP preparada (29 asserções), runner concorrente e protocolo de isolamento.
- [ ] Ambiente independente criado, isolamento comprovado e autorizado.
- [ ] Migration aplicada exclusivamente nesse ambiente e pgTAP executado.
- [ ] Concorrência SQL efetiva (claims, budget, visibilidade após espera) comprovada.
- [ ] Tipos regenerados factualmente; assinatura nova atual é provisória manual.
- [ ] Revisão humana para liberação do gate de produção.

Gates locais: 339 testes web em 14 suítes no Node Windows 24.16.0; 16 testes core;
7 testes Python das recusas do runner; core/types/Supabase e web sem scripts
scratch typechecks verdes. Revalidação focal pós-consulta dedicada de attempts
registrada no novo diário. Falhas iniciais de runtime/config de teste corrigidas;
sem mudança de política para passar testes. Build não executado.

Retomar pelo [protocolo de prova](../../supabase/tests/single_item_concurrency.md)
e pelo [registro V1](../registros/2026-10-08-single-item-governed-execution-v1-sql.md).
INV-11 não consultada/aprovada/executada; WIPs, checkpoint e 46 worktrees preservados.


## Adendo — hardening dos instrumentos SQL em 08/10/2026

Autorização restrita a código/documentação e provas determinísticas, sem bancos,
Docker, migrations aplicadas, providers ou Host. O estado V1 anterior é histórico.

- [x] Teste de lock com alvo inédito: ausência antes e presença após a RPC scoped,
  sem aquisição global anterior desse alvo na transação.
- [x] Suíte preparada ampliada de 29 para 55 asserções: classificação ausente e
  revogada antes de claim e entre claim/início; expiração própria; ocupação alheia
  sem claim; owners distintos; ACL efetiva; consumo único/replay/recusa de token.
- [x] Runner valida relações e os quatro cenários antes de aquisição, controls com
  ROLLBACK, lock/XID/chave/PID específicos, mensagens+SQLSTATE fixos, deadlines,
  cleanup verificável e snapshots de itens/claims/eventos/autorizações.
- [x] Preflight offline fail-closed implementado; sem coleta Docker ou DB.
- [x] Migration proposta revoga também concessão default de `service_role`, sem
  tocar em privilégios globais nem na RPC canônica. Herança efetiva exige pgTAP real.
- [x] Supervisor consulta todos os starts do item antes de orçamento/escritas,
  mesmo se a fonte de retomada disser new_execution. Fluxo global preservado.
- [x] Codex sem autenticação comprovada recusa no contrato compartilhado; compute
  pago continua recusado. Nenhuma flag substitui prova/autorização.
- [x] Divergência preexistente local/externo registrada separadamente, sem correção.
- [ ] Executar as 55 asserções e as disputas reais após autorização/isolamento.
- [ ] Provar metadados/ACL/RLS/locks/cleanup reais, ordem inversa global/scoped,
  início comandado concorrente e corrida de versão. Tipos continuam provisórios.

Resultados: 343 web/14 suítes, 16 core e 25 Python offline verdes; typechecks
core/types/supabase e web excluindo scripts/_session verdes. Não houve PostgreSQL,
pgTAP, concorrência efetiva, build, commit ou aplicação de migration. Execução de
produto continua recusada por `single_item_atomic_claim_unavailable` incondicional.

Revisão humana pendente. Retomar pelo [registro de hardening](../registros/2026-10-08-single-item-v1-hardening-provas-sql.md)
e [procedimento vigente](../../supabase/tests/single_item_concurrency.md). Não
reinterpretar os checks de preparação como aceite de atomicidade/isolation SQL.


## Recuperação bootstrap — compatibilidade 247 (2026-10-08)

- [x] Correção mínima/idempotente da 247 com allowlist de corpos completos;
  nenhuma mudança na 246, quotas ou budget policies.
- [x] 12 provas determinísticas novas e 25 existentes offline verdes.
- [x] Inventário histórico de 272 etapas recuperado e compositor offline revisável.
- [x] Procedimento de rebuild/ledger/reconciliação documentado, não executado.
- [ ] Recuperar/verificar 72 fontes ausentes e revisar duplicação da etapa 248.
- [ ] Revisão humana e autorização específica de NOVO container/SQL.

Não há prova PostgreSQL, reconstrução, fixture, pgTAP ou concorrência nesta sessão.
O gate continua incondicional. Retomada pelo
[procedimento](../../supabase/tests/bootstrap_reconstruction.md) e
[registro](../registros/2026-10-08-bootstrap-247-compatibilidade.md), sem reutilizar
a prova anterior ou tocar no residente. WIPs/worktrees preservados; sem commit.


## Pré-requisitos bootstrap reproduzível — fechamento offline (2026-10-08)

- [x] Recuperar 69 Auth oficiais e três pré-requisitos com hashes históricos exatos.
- [x] Congelar/verificar 272 fontes, roles e ordem em pacote durável, sem segredos.
- [x] Auditar 247 (owner/ACL/catalog lookup) e tornar 248 idempotente/fail-closed.
- [x] Preparar 272 payloads com rendering estrito/terminadores/ledger Auth+audit.
- [x] 25 testes do bootstrap e 25 existentes offline verdes; sem prova PostgreSQL.
- [ ] Revisão humana e autorização explícita de novo container/init/bootstrap.
- [ ] Isolamento e prefixos/ACL/atomicidade/runtime observados factualmente.

GO técnico condicionado só para reconstrução diagnóstica; sem execução Docker/SQL
ou liberação de Single-Item/INV-11/Host. Nenhuma migration aplicada, schema
residente tocado, compute pago, staging/commit/push ou limpeza de WIPs.
Retomar pelo [pacote](../../supabase/bootstrap/README.md) e pelo
[registro](../registros/2026-10-08-bootstrap-prerequisitos.md).


## Bootstrap — execução autorizada interrompida por identidade (2026-10-08)

- [x] Corrigir somente allowlist de ambiente; socket e defaults/overrides exatos.
- [x] 57 testes offline; 272 payloads/fontes e 556 hashes íntegros.
- [x] Preflight factual e criação de um container com os limites anteriores.
- [ ] Identidade efetiva: bloqueada por labels OCI herdados, guarda não relaxada.
- [ ] Inicializar cluster/aplicar 272 etapas/provar ledgers/inspecionar schema.

NO-GO: container `8d76d3358c55a155f5824c7a65d2c28ab8afad600ddd8baa1d430896ae600402`
permanece created, nunca iniciado; cluster ID ausente, zero SQL. Residente intacto.
Gate Single-Item/INV-11/Host preservados; sem prova PostgreSQL ou testes comportamentais.
Revisão humana antes de corrigir labels ou decidir start/remoção/nova criação.
[Registro, diff e bug do executor](../registros/2026-10-08-bootstrap-preflight-parada-identidade.md).


## Bootstrap — recuperação autorizada e parada de mounts (2026-10-08)

Labels OCI herdados validados exatamente contra imagem por digest; logging
append-only/fsync corrigido. 61 testes offline PASS; 272 payloads/556 hashes íntegros.
Container exclusivo `8d76d3358c55a155f5824c7a65d2c28ab8afad600ddd8baa1d430896ae600402`
passou pré-start e foi iniciado. NO-GO pós-start: inspect retorna Mounts=[] para
os tmpfs; diagnóstico OS confirmou mounts isolados, mas guarda não foi relaxada.
Sem initdb/cluster/SQL/ledgers: 0/272. Container running aguardando marcador.
Residente saudável e inalterado; antigo intocado, gate Single-Item preservado.
Revisão humana antes de corrigir coleta de mounts ou retomar.
[Registro, diff e retomada](../registros/2026-10-08-bootstrap-recuperacao-parada-mounts.md).


## Bootstrap — tmpfs efetivos e prova SQL (2026-10-08)

GO somente para bootstrap/inspeção estrutural: coleta kernel tmpfs estrita corrigida; 66 testes offline PASS.
Container exclusivo 8d76d3358c55a155f5824c7a65d2c28ab8afad600ddd8baa1d430896ae600402, cluster 7694431622913864120.
272/272 etapas confirmadas; 0 falhada(s), 0 pendentes.
Audit ledger prefixo/hashes exatos; Auth 69 oficiais + 7 legadas exatas.
Residente healthy/inalterado; antigo intocado; pacote 556 hashes preservados.
Sem fixtures/pgTAP/concorrência/INV-11/Host ou liberação do gate Single-Item.
Revisão humana antes de qualquer próximo efeito ou teste comportamental.
[Registro e evidências](../registros/2026-10-08-bootstrap-tmpfs-execucao-real.md).


## Single-Item V1 — provas reais bloqueadas no preflight de destino (2026-10-08)

Autorizadas fixtures/pgTAP/concorrência no cluster 7694431622913864120,
mas banco explícito postgres não contém ledger/RPC/schema migrado. Bootstrap
reside em anima_single_item_proof_396f38b1036a47ba92d51890cdf252ba. NO-GO antes
de testes; esclarecimento de destino pendente, sem troca implícita/rebootstrap.
Identidade/isolamento/556 hashes e residente healthy confirmados; nenhum SQL
de escrita. 334 asserções e quatro cenários concorrentes não executados.
Atomicidade/orçamento/rollback/deadlocks comportamentais ainda não provados;
gate Single-Item, INV-11 e Host preservados.
[Registro e retomada](../registros/2026-10-08-single-item-provas-preflight-destino.md).


## Single-Item V1 — provas SQL/concorrência reais, NO-GO (2026-10-08)

Cluster/container nonce anterior confirmado; 272 ledgers/556 hashes íntegros.
Sete suítes canônicas PASS; Single-Item original 27 ok e erro 42501 de introspecção.
Diagnóstico OID: 47 ok/22023 de release; fixture temporária corrigida: 55/55 ok.
Canonical não alterado; 123 asserções de cinco regressões guardas-unsafe não executadas.
Quatro disputas demonstraram espera, A único commit/B recusada, inclusive P0001
user_attempt_budget_exhausted; três resultados formais FAIL por cleanup EPIPE.
Primeira passagem quatro FAIL de parser t/f; todas as falhas preservadas.
Prova negativa de ordens item→claim/claim→item causou deadlock 40P01 com rollback,
sem retry. Gate ainda bloqueado: corrigir/revisar fixtures/runner, regressões com
guardas ativas e ordem de locks/cobertura adicional. Fixtures removidas, baseline
restaurado; residente healthy/intocado. Sem INV-11/Host/pago/commit/push.
[Relatório, falhas e evidências](../registros/2026-10-08-single-item-provas-reais.md).


## Correções pós-provas reais — 2026-10-09

- [x] Recuperar resultados brutos e verificar 281 hashes das três pastas de prova.
- [x] Corrigir ACL por OID/release b2 e decoder t/f/cleanup EPIPE do harness.
- [x] 42 testes offline PASS, incluindo 31 do runner e reprodução local de EPIPE.
- [x] Preservar 55 asserções, migrations/política/execução/gate e WIPs/worktrees.
- [x] Propor diff SQL separado e matriz baseline/candidato/deadlock negativo.
- [ ] Reformular cinco regressões com guardas ativas (123 expectativas); não trocar
  expectativas local/externo por política V1 para esconder divergência.
- [ ] Revisar/auditar ordem única, aprovar implementação em nova migration e perfil
  de observação de locks; rascunho atual não cobre todos os caminhos mutantes.
- [ ] Autorizar ambiente independente e revalidar SQL real, rollback e cleanup.

NO-GO para promoção permanece. [Plano 044](044-single-item-lock-order-proposta.md)
e [registro](../registros/2026-10-09-single-item-correcoes-offline.md) contêm retomada.


## Revisão de locks e fixtures históricas — 2026-10-09

- [x] Inventariar 139 definições vigentes textuais e 12 triggers, incluindo FKs,
  foco, recovery, retomadas, conclusão e fronteira paga.
- [x] Rever candidato: prefixo B de owner antes do primeiro recurso em 59 corpos;
  diff separado, sem alterações a migrations ou política; sem validações antecipadas.
- [x] Reformular cinco fixtures (123 propriedades), triggers sempre ativos; manter
  as 55 Single-Item e runner da sessão anterior byte a byte.
- [x] Preparar renderer fechado/helpers e gates/modelo offline; matriz C1–C8.
- [ ] Revalidar PostgreSQL, catálogo, interpretação PL/pgSQL, waits/timeouts/lease e
  cleanup no ambiente independente, somente após revisão e autorização.
- [ ] Resolver divergência de contrato local/externo em escopo próprio, sem skips.

Ciclos de espera do modelo desaparecem apenas para entradas participantes de um
owner fixo, sem pré-lock; grafo estático não vira DAG. Sem prova viva ou liberação.
[Plano 045](045-single-item-lock-review.md) ·
[Registro](../registros/2026-10-09-single-item-lock-review-cobertura.md).

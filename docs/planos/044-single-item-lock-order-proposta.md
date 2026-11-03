# 044 — Single-Item V1: proposta de ordem de locks, não aplicada

09/10/2026. Base dev `6bc4aadef9414d655600c2ea37c6be436b3628c8`, com WIPs.
Escopo atual: fixtures/runner e análise offline. Produção continua NO-GO.
[Prova original](../registros/2026-10-08-single-item-provas-reais.md).

## Fatos e classificação

1. Fixture ACL: `has_function_privilege` por assinatura resolve `private` sob
   authenticated sem USAGE: 42501 após 27 ok. Resolver OID exato como postgres
   antes do SET ROLE e medir EXECUTE para authenticated por OID. Não conceder USAGE.
2. Fixture release: b2 teve início recusado pelo orçamento e attempt_id=NULL;
   `attempt_finished` é inválido (22023 após 47 ok). Usar
   `released_without_attempt`. Guardas, 55 asserções e recusa de orçamento mantidas.
3. Runner: SELECT EXISTS em psql -At produz t/f, não JSON. Decoder aceita somente
   esses dois literais além de JSON válido; não converte strings por truthiness.
4. Runner: close de stdin bufferizado pode fazer flush após psql ON_ERROR_STOP
   encerrar o peer. Ignorar exclusivamente errno EPIPE em stdin após poll confirmar
   saída. Fechar todos os streams; demais erros e cleanup de backend continuam FAIL.

Os quatro são defeitos de fixture/harness. Nenhum altera resultados históricos:
7 suítes PASS, Single-Item original FAIL, 5 não executadas; concorrência 1 PASS e
7 FAIL em duas passagens; diagnóstico 55/55 não substitui canonical.

40P01 é risco real dos contratos SQL, reproduzido com staging em linhas sintéticas:
A bloqueia item e tenta claim; B bloqueia claim e tenta item. O staging controla
interleaving, não autoriza dizer que toda chamada normal deadlocka. Rollback foi
provado; ausência de deadlock não foi. Nenhum retry deve ocultar essa falha.

Outra inversão por inspeção (não reproduzida): start toma item→orçamento enquanto
`authorize_work_resume(uuid,integer,jsonb)` toma orçamento→item. Mover somente
claim para depois do item não elimina esse ciclo.

## Ordem candidata

`autonomous_work_budget:<owner>` → linha do item → `work_target:<owner>:<target>`
→ linhas de claims → linha da autorização consumida → eventos.

Locks ausentes em um caminho são omitidos, não invertidos. Reaquisição do mesmo
lock transacional já detido é reentrante, não nova dependência. Budget advisory
vem primeiro inclusive aquisição de claim, início comandado e liberação: serializa
operações participantes do mesmo owner antes de qualquer linha. Autorizações,
block/readmit/interrupt que já usam orçamento→item ficam compatíveis nesse prefixo.
O trigger mantém a chave e o enforcement: ao inserir execution_started, orçamento
já deve estar detido; consumo do token continua sob esse lock, sem mudar quotas.

Para start_claimed: lookup sem lock apenas para localizar item; orçamento primeiro,
item FOR UPDATE, alvo derivado do item bloqueado, advisory alvo, claim FOR UPDATE
novamente; só então validar/associar attempt e delegar begin_work_attempt. Não usar
snapshot do lookup para decidir released/expired/attempt. A relação claim→item é
imutável no contrato; auditar triggers/ACL contra mudança concorrente dessa relação.
Release adquire orçamento→item→claim; não precisa adquirir alvo se não o consulta.
Begin privado toma orçamento antes de item; no caminho claimed esses locks já foram
adquiridos. Replay continua sem eventos/consumo novo, mas pode esperar no novo prefixo.

[Diff de corpos para revisão](044-single-item-lock-order-proposta.diff) é um
**rascunho**, NÃO migration executável aprovada. Os caminhos históricos identificam
onde cada corpo vigente foi definido; NÃO aplicar patch às migrations históricas.
Depois da aprovação, compor nova migration aditiva CREATE OR REPLACE das funções
vigentes completas, preservando grants, owner, search_path, assinatura e comentários.
Inclui scoped/global, start/release, início privado/comandado e retomada de orçamento.

### Compatibilidade e limites do rascunho

- Mesmo retorno, assinatura, grant, índices, eventos e decisões de orçamento.
  Scoped continua recusando claim alheio vencido; global conserva sua liberação.
- Serialização **mais ampla por owner**, inclusive entre alvos diferentes: impacto
  de latência, starvation, timeout e expiração de lease precisa medição. now() é
  timestamp da transação; revisar especificamente lease após longa espera, sem
  alterar sua semântica silenciosamente neste patch.
- A validação antecipada do alvo no start pode mudar precedência de erros em
  inputs simultaneamente inválidos e replay de intent inválido; definir/retestar
  contrato antes de aprovar, não alegar equivalência total do rascunho.
- O runner atual mede transactionid em same_item e work_target nas outras disputas.
  Após essa proposta, espera inicial será no advisory de orçamento em todos os
  pares do mesmo owner. Criar perfil de medição separado e pinado ao hash da nova
  migration; conservar perfil antigo. Não aceitar qualquer lock como suficiente.
  Alvo deve ter prova específica de retenção e owners distintos.
- Budget-first previne o ciclo reproduzido **entre caminhos aderentes**, não
  deadlocks gerais de PostgreSQL. DML arbitrário que pré-bloqueia item/claim antes
  da RPC pode recriar inversão. Múltiplos owners na mesma transação exigem ordenação
  explícita ou recusa no contrato, sem ampliar autorização/RLS.
- Auditar antes da migration: reconcile_supervised_work (reconciliation→item→claim,
  eventos com FK de item), begin_resumed_work_attempt, retomadas humanas, operações
  de classificação/routing/terminal, readmissões em lote, supervision leases,
  triggers de integridade/FKs e gravações diretas. O diff NÃO completa essa auditoria.
  Esses caminhos não podem adquirir orçamento depois de locks inferiores; entradas
  mutantes pertinentes devem tomar o prefixo antes de suas linhas. Nunca resolver
  por trigger que só pega advisory depois de UPDATE já ter bloqueado linha.
- Claim alheio global exige atenção: libera linha de outro item e insere evento com
  FK desse item. Prefixo comum serializa participantes do owner; fora dele auditar
  locks implícitos/FKs. A prova deve incluir claim alheio expirado/reconciliation.

## Cinco regressões: bloqueios e reformulação, sem alterar expectativas

| Suíte | Asserções | Guardas desabilitadas hoje | Reformulação necessária |
|---|---:|---|---|
| work_budget | 15 | inteligência attempt/claim e routing | Classificar itens aprovados; route por attempt/executor antes de cada start sintético, inclusive tentativa esperada de recusa; claims correlacionados; created_at histórico no INSERT, sem UPDATE do ledger |
| work_budget_local_vs_external | 12 | inteligência/routing/budget | Aprovar/classificar helpers, route/claim por start histórico; dividir starts em itens dentro dos limites e preparar 6 starts admissíveis; conservar expectativas V2 local/externo, registrar incompatibilidade com V1-supervision como falha de contrato separada |
| budget_blocked_human_resume | 16 | inteligência/routing; budget no setup | Substituir classificação fictícia por contrato completo; seis starts históricos distribuídos em itens admissíveis (não seis no mesmo item); claims/routes reais sintéticos; token e recusa posterior via início sob claim; preservar 16 expectativas |
| work_budget_interruption_resumption | 15 | inteligência attempt/claim e routing | Classificação atual e routes correlacionadas para attempt antiga e retomada; start antigo com created_at histórico; checkpoint completo; exercitar janela sem editar ledger append-only (fixture histórica equivalente em transação independente) |
| supervisor_reconciliation | 65 | budget | Isolar usuários por bloco para não acumular quotas; histórico/tempos legítimos com guardas ativas, route e terminal correlacionados; manter todos os 65 resultados esperados e casos negativos |

São 123 asserções não executadas, **não 123 PASS nem falhas SQL observadas**.
Os cinco arquivos históricos não foram reformulados nesta etapa: retirar DISABLE
isoladamente produziria precondições inválidas. Esta matriz é backlog concreto,
não declaração de cobertura. A divergência local/externo é de produto/contrato
versionado por inspeção, não novo efeito da RPC scoped; correção de política exige
outra autorização. [Diagnóstico](../registros/2026-10-08-divergencia-orcamento-local-externo.md).

## Matriz de revalidação real (só após autorização)

| Caso | Baseline/candidato | Critério e efeitos |
|---|---|---|
| 55 TAP corrigidas | ambos | 55/55, finish completo, zero erro SQL, ROLLBACK, ACL/RLS/triggers intactos |
| 7 regressões já PASS | ambos | 156 asserções; nenhum bypass; comparar resultados |
| 5 regressões acima | fixtures reformuladas | 123 expectativas mantidas; registrar divergência de política, sem skip promocional |
| same_item | ambos, perfil de locks pinado | A commit; B 55000 active claim; nenhuma escrita de B |
| same_target | ambos | A commit; B 55000 foreign claim; snapshots alheios iguais |
| global→scoped e scoped→global | ambos | erro canônico específico de cada B; não exigir foreign_claim_open da RPC global |
| budget em alvos distintos | ambos | controls A/B admitidos com rollback; uso 5→6, B P0001, sem 7º start; token ledger intacto |
| scoped/global acquire × claimed start | baseline negativo e candidato | Baseline com staging item/claim reproduz 40P01, rollback integral, zero retry; candidato sem staging invertido não deve produzir 40P01 |
| start × authorize/block/interrupt/readmit | candidato | Ordem orçamento→item; espera e blocker corretos; replay/token/rollback e motivos canônicos |
| commanded × scoped/global | candidato | mesmo alvo, ocupação/claims preservados, nenhum início indevido |
| versões/classificação/expiry/replay/owners | candidato | versão após espera, classificação revogada, claim expirado/alheio, owners distintos, replay sem consumo extra |
| cleanup negativo | ambos | psql já encerrado EPIPE tolerado só em stdin; EIO/timeout/daemon indisponível/backend persistente continuam FAIL |

Procedimento: revisar corpus/hashes e completar fixtures guard-safe; aprovar ambiente
independente e identidade antes de SQL; separar baseline e candidato em destinos
pinados/isolados. Não reusar tmpfs após reboot sem identidade/cluster/ledgers válidos.
Nunca aplicar rascunho ao residente. Todos os transportes reais precisam manter o
preflight factual da campanha (imagem, CID completo, env-i, usuário/socket/banco
explícitos, kernel tmpfs, cluster/postmaster/ledger/ACL/triggers antes de cada acesso).
O Environment genérico por si só não substitui essas guardas adicionais.

Deadlock negativo de controle: staging antigo pode continuar produzindo 40P01 mesmo
com candidato, pois locks artificiais podem violar a ordem antes da RPC; separar esse
controle adversarial da regressão de entradas normais. Orquestrar concorrência normal
com barreiras observacionais/locks externos sem pré-bloquear recursos fora da ordem
nas próprias sessões RPC. Registrar ambos PIDs/XIDs, SQLSTATE, lock/blocker, vítima,
rollback/snapshots, cleanup=0 e nenhum retry. Não elevar ausência de 40P01 em uma rodada
à prova universal. Deadlock não esperado, lock timeout ou cleanup inconclusivo = FAIL.

Depois: gerar tipos pelo schema aprovado, regressões e revisão humana antes de discutir
gate. INV-11/Host/compute pago/residente continuam fora do escopo. Próximo passo atual:
revisão das correções offline e deste rascunho; não implementar SQL de produção agora.


## Revisão posterior — 09/10/2026

O [Plano 045](045-single-item-lock-review.md) substitui a recomendação técnica
deste rascunho sem apagar seu histórico. A ordem linear anterior antecipava checks
e não cobria FKs/foco/recovery. Candidato revisado: prefixo comum de owner antes
do primeiro recurso em 59 corpos, sem reordenar validações; 139 definições/12
callbacks inventariados. Cinco fixtures agora reformuladas com guardas ativas,
123 propriedades preservadas; nenhum PASS PostgreSQL novo ou correção de política.

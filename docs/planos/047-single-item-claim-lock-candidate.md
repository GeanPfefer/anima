# 047 — Candidato localizado item → claim

2026-10-09. Implementação offline autorizada; aplicação SQL não autorizada.
[Decisão arquitetural](../arquitetura/single-item-lock-strategy-decision.md),
[matriz comparativa 046](046-single-item-lock-strategy-proof.md).

## Artefatos e escopo

- [Migration candidata](../../supabase/migrations/20261009000000_claim_item_lock_order_candidate.sql).
- [Diff dos dois corpos efetivos](046-single-item-claim-lock-candidate.diff).
- [Contrato congelado](../../supabase/tests/fixtures/single_item_claim_lock_candidate.json):
  hashes das 154 migrations históricas COM WIPs, definições efetivas baseline e hash
  da migration nova. Scanner percorreu todas as fontes, renames/drops/overloads.
- [Testes offline](../../supabase/tests/single_item_claim_lock_candidate_test.py).
- [Compositor sem executor](../../supabase/tests/single_item_claim_lock_bundle.py).

As definições efetivas baseline das duas funções vêm de
`20260721000001_work_claims.sql`; a nova migration substitui somente
`start_claimed_work_attempt(uuid,uuid,text)` e `release_work_claim(uuid,text)`.
Nenhuma alteração em acquire scoped/global, begin comum, orçamento, classificação,
RLS, triggers, tabelas, grants ou gate. Nenhuma migration histórica editada.

Usar CREATE OR REPLACE com nomes/argumentos/retornos e atributos originais conserva
owner e permissões de funções existentes; isso depende da existência das duas
funções no destino e precisa de inspeção factual antes da aplicação. Não aplicar
sobre schema incompleto, onde CREATE OR REPLACE poderia criar uma função nova.
[Semântica oficial PostgreSQL 15](https://www.postgresql.org/docs/15/sql-createfunction.html).
Tipos gerados não precisam de alteração de contrato: assinatura e retorno são
idênticos; regeneração factual sem banco não foi executada.

## Ordem e semântica

Em ambos os corpos: auth/allowlist/input originais → descoberta sem lock do claim
próprio → item próprio FOR UPDATE → releitura claim próprio FOR UPDATE → identidade/
owner/item correlacionados → rechecagem auth.uid()/allowlist → regras originais.
A descoberta NÃO valida attempt/released/expiry/version. Todas essas decisões usam
a releitura bloqueada; start delega estado/aprovação/versão/execution_spec/alvo ao
begin canônico existente. Release mantém reason e idempotência sem introduzir uma
nova restrição de estado do item: liberar após terminal continua legítimo.

Escritas de claim permanecem limitadas ao id validado/bloqueado; eventos referem-se
apenas a seu item. Claim redirecionado não causa segundo lock nem escrita em outro
item. Atualizações de outros claims não foram introduzidas. A guarda scoped contra
claim estrangeiro, inclusive expirado, permanece integralmente fora do diff.

| Condição após espera | Comportamento candidato |
|---|---|
| Item ausente ou deixou de ser do owner | P0002 `claim item not found`, antes de lock C |
| Claim ausente ou deixou de ser do owner | P0002 `claim not found`, sem efeito |
| id/owner/item não correlacionados à descoberta | 55000 `claim identity changed while acquiring locks`, sem seguir outro item |
| Identidade auth mudou | 42501 `authentication changed while acquiring locks` |
| Allowlist revogada, inclusive durante espera/replay | 42501 original `work orchestration is not enabled` |
| Estado do claim/replay/expiry/reason válido ou inválido | Regras originais sobre releitura bloqueada |

As duas leituras da allowlist não tomam lock de linha: revalidação observa o snapshot
permitido pelo isolamento. Não oferece revogação instantânea após a checagem nem
corrige todos os casos REPEATABLE READ; esses riscos já pertencem ao protocolo de
autoridade e precisam de prova. Não inserir lock tardio de allowlist que gere outra
ordem transversal. O item fica bloqueado antes e durante replay/release; medir latência.
`now()` e v_now permanecem timestamps transacionais originais, sem mudança silenciosa
para clock_timestamp; lease após transação longa é risco existente a medir.

## Deadlocks que continuam possíveis

Alvo/claim entre itens (incluindo limpeza global de estrangeiro expirado e FK do
item estrangeiro), item/budget em start/retomada versus authorize/block/interrupt/
readmit, foco/item-FK, recovery H/root/successor, FKs parent/admin/pago, DML sem
protocolo e pré-locks inversos. Candidato não adiciona mutex global por owner.
A prova negativa histórica com pré-locks I/C pode continuar produzindo 40P01;
ela é controle adversarial e não teste de ausência universal. Dois corpos são o
fechamento do domínio mesmo-item proposto, não fechamento de todos os writers.

## Roteiro exato para comparação futura

Etapas 1–2 são offline; etapas 3–9 dependem de nova autorização de ambiente/SQL.

1. Revisar a migration/diff e erros adicionais acima. Executar somente offline:

   ```bash
   PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s supabase/tests -p 'single_item*_test.py'
   PYTHONDONTWRITEBYTECODE=1 python3 supabase/tests/single_item_claim_lock_bundle.py --output /tmp/anima-claim-lock-proof-reviewed
   ```

   O output deve ser inexistente; o compositor recusa sobrescrita e qualquer hash
   divergente. Dois diretórios independentes `baseline/` e `candidate/`, manifests,
   hashes de fonte e prosrc esperado, identidades ainda NULL. Não há executor.
2. Guardar os pacotes/hashes em evidência durável. Baseline é o corpus pre-candidato
   congelado, não `git HEAD`; harness corrigido comum em ambos. Reconciliar spec de
   bootstrap congelado com migrations do pacote: não repetir todas as migrations
   depois do bootstrap nem presumir que seus corpos são iguais. Se divergirem,
   parar e revisar a receita/manifesto antes de qualquer execução. O compositor
   empacota fontes e avisa essa limitação, não inventa plano de aplicação.
3. Autorizar dois novos ambientes descartáveis por nonce, IDs completos distintos,
   sem rede/portas/mounts/env residentes e com tmpfs/labels revisados. Usar preflights
   existentes revisados para cada destino; não usar supabase start/local/reset.
4. Antes de DDL: verificar isolamento por inspect, identidade por read-only (database,
   cluster system_identifier, versão e role), e preencher os dois manifests de
   evidência com IDs independentes. Proibir destino residente ou cluster antigo.
5. Aplicar receita baseline revisada igualmente em ambos; confirmar ledgers/hashes
   e ambas as funções existentes. Capturar catálogo antes, incluindo prosrc integral:

   ```sql
   SELECT p.oid, p.oid::regprocedure::text AS signature,
          pg_get_userbyid(p.proowner) AS owner, p.proacl,
          p.prosecdef, p.proconfig, p.provolatile, p.proparallel,
          p.proisstrict, p.proleakproof, p.procost, p.prorows,
          pg_get_function_arguments(p.oid), pg_get_function_result(p.oid),
          p.prosrc, pg_get_functiondef(p.oid)
   FROM pg_proc p
   WHERE p.oid IN (
     'public.start_claimed_work_attempt(uuid,uuid,text)'::regprocedure,
     'public.release_work_claim(uuid,text)'::regprocedure
   ) ORDER BY signature;
   ```

   Capturar prosrc sem escape/truncamento e calcular SHA256 em UTF-8 no host para
   comparar expectedProsrcSha256. `pg_get_functiondef` formata DDL; não comparar
   cegamente seu hash com hash do scanner. Comparar OIDs dentro de cada cluster;
   OIDs entre clusters não precisam coincidir. Comparar owner/ACL normalizados.
6. Aplicar SOMENTE a migration candidata no destino candidate em uma transação
   com ON_ERROR_STOP e evidência bruta. Baseline não recebe a migration. Capturar
   catálogo posterior: só prosrc/definição dos dois corpos podem diferir; OIDs,
   ownership, ACL, assinatura, RLS/guards/triggers/política e demais funções iguais.
7. Executar a matriz 046 em ambos, mesmas seeds, mesmos fixtures/harness e limites
   previamente aprovados. Obrigatórios: natural acquire/start/release mesmo item,
   start/release nos dois sentidos, replay/erros, foreign claim/owner, redirecionamento
   privilegiado durante espera, revogação durante espera e snapshots sem efeitos.
   Rodar quatro disputas originais e negativo de orçamento P0001
   user_attempt_budget_exhausted, consumo único e rollback integral. Não mascarar
   40P01 com retry; controle negativo e testes de ciclos residuais separados.
8. Renderizar/rodar 13 suítes canônicas com guardas ativas usando renderer revisado;
   334 planejadas, 123 históricas e 55 Single-Item conservadas. Registrar emitidas,
   SQLSTATE, TAP FAIL/aborto/skip/cleanup e server logs independentemente de wrapper.
   Divergência local/externo permanece comparação de política separada, sem bypass.
9. Aplicar critérios 046 de segurança/contrato e performance, declarar inconclusivo
   quando amostra ou reprodução baseline forem insuficientes. Resultado localizado
   PASS não libera gate/produto. Revisão humana dos logs antes de qualquer promoção.

## Resultado desta sessão

84 testes Single-Item offline PASS (11 novos contratos/cenários/bundle + 73 anteriores).
Léxico e scanner aceitam duas definições completas; não compilam PL/pgSQL nem provam
ACL/RLS/locks/MVCC em PostgreSQL. O teste do inventário 045 foi ajustado para tratar
seus dois corpos como baseline congelado e auditar candidato separadamente; todos
os outros hashes continuam exigidos. Inventário histórico não foi reescrito.

Migration escrita e não aplicada; nenhuma alteração factual de schema/tipos residente.
Retomada: revisão humana desta migration/Plano 047; depois autorização separada da
receita bootstrap e dos destinos/provas. Gate Single-Item permanece ativo.

## Tentativa comparativa autorizada — parada operacional (2026-10-09)

Usuário autorizou criação/bootstrap/aplicação/provas somente após preflight.
Docker Desktop sem processos e daemon indisponível impediram inspeção de imagem,
containers, isolamento/capacidade e residente. Nenhum ambiente criado ou SQL usado.
[Registro/JSON](../registros/2026-10-09-single-item-comparativa-preflight.md) contém
Git, recursos, 556 hashes/272 etapas e 109 testes offline PASS. As 154 migrations
baseline coincidem exatamente com fontes congeladas, fechando a verificação de
bytes prevista no passo 2; identidade/catálogo/aplicação real seguem pendentes.
Retomar pelo preflight quando Docker estiver disponível; autorização condicional
continua registrada, sem promoção automática do gate ou prova fictícia.

## Docker iniciado sob mandato — residente degradado (2026-10-09)

Desktop iniciado e daemon disponível. DB/Auth healthy, mas Vector unhealthy em
restart loop e edge runtime anteriormente encerrado. Preflight integral parou
antes de create/SQL; nenhum container individual alterado pelo agente.
[Registro sanitizado](../registros/2026-10-09-single-item-docker-retomada.md)
conserva estados, 272/556 hashes e 84 testes offline. Retomada exige saúde/gate
operacional revisados, sem manutenção residente implícita neste mandato.

## Comparação real executada — 2026-10-09

[Relatório/artefatos](../registros/2026-10-09-single-item-comparativa-vector-prova.md).
GO operacional com exceção Vector independente; dois clusters/sequenciais com
272/272 cada, candidata aplicada uma vez somente no segundo. Schema/atributos
equivalentes salvo dois corpos. PG TAP ambos 330/334 (55 Single-Item PASS; quatro
FAIL local/externo idênticos). Quatro disputas originais PASS em ambos. Quatro pares
item/claim baseline 40P01 versus candidato sem deadlock; controles de pré-locks
opostos e item/budget ainda 40P01. Revogação após espera 42501 no candidato.
Replay p95 +29,4% no microbenchmark limitado; não houve 100 repetições por disputa
ou teste de 1000 transações/admissões novas. Falhas de adaptadores conservadas.
NO-GO promoção: revisar ciclo budget/item, impacto de revalidação/replay e prova
com harness congelado. Dados residentes não acessados; snapshots DB/Auth estáveis.
Novos encerrados, tmpfs perdido previsto, nenhum antigo removido/reiniciado.
Gate não liberado; próxima etapa é revisão humana, sem integração automática.


## Revisão offline do ciclo item/orçamento — 2026-10-09

[Plano 048](048-single-item-budget-lock-order.md) recupera o 40P01 e propõe quatro inserções do advisory de orçamento antes de locks de item nas admissões conhecidas. Migration 20261009 item/claim permanece byte-idêntica; não há nova migration aplicada/criada. SQL/diff separados para revisão, 97 testes Single-Item offline PASS. Próxima comparação usa essa candidata item/claim em ambos os slots como baseline comum, com alteração de orçamento só no segundo, após nova autorização. Pré-lock manual do cenário histórico permanece adversarial; controle natural por barreira independente no claim é obrigatório. Quatro FAIL de política histórica e contenção continuam separados. [Registro](../registros/2026-10-09-single-item-budget-lock-order.md); gate ativo e promoção NO-GO.

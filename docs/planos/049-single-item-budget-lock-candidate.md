# 049 — Migration candidata localizada item/orçamento

2026-10-09. Implementação offline autorizada dos quatro corpos do [048](048-single-item-budget-lock-order.md).
**Não aplicada nem compilada em PostgreSQL.** Gate Single-Item continua ativo.

## Artefatos e ordem efetiva

[Migration incremental](../../supabase/migrations/20261009000001_budget_item_lock_order_candidate.sql),
[diff completo contra corpos efetivos](049-single-item-budget-lock-candidate.diff),
[contrato/hashs](../../supabase/tests/fixtures/single_item_budget_lock_candidate.json).
Depende da candidata item/claim `20261009000000`, que não foi editada.
Somente start_claimed_work_attempt, begin_resumed_work_attempt,
begin_human_decision_resumed_attempt e begin_budget_interruption_resumed_attempt
recebem CREATE OR REPLACE. Signatures, argumentos, retornos, securityDefiner,
search_path e demais headers preservados; nenhum GRANT/REVOKE/ALTER/DROP/schema.
Ownership/ACL/OID reais precisam ser capturados antes/depois da aplicação futura.

A revisão confirmou definições efetivas nas 155 fontes anteriores, 161 funções.
private.begin_work_attempt continua com somente dois chamadores SQL textuais:
start_claimed e start_commanded. O segundo usa claim NULL e não toma B no trigger;
nenhum corpo dessas funções auxiliares, release, acquire/global, recovery, budget
ou código governado foi alterado. Retomadas inserem eventos diretamente.

B = advisory transacional de orçamento owner já existente; I = item próprio;
C = claim próprio; T = advisory alvo owner/reference.

| Caminho | Ordem candidata | Limite |
|---|---|---|
| Nova tentativa sob claim | pré-leituras sem locks → B→I→C→T→helper/trigger B reentrante | quota decidida/consumida somente pelo trigger original |
| Retomada nova, três RPCs | pré-leituras sem locks → B→I→T→INSERT C→trigger B | nenhuma autorização/routing/checkpoint relaxado |
| Replay start visível antes de locks | I→C→releitura evento→regra original de correlação→retorno | não toma B/T, não duplica evento; original pode preencher attempt_id nulo do claim correlacionado |
| Replay retomada visível antes de locks | I→releitura evento→predicado original→retorno | não cria claim/evento e não toma B/T |
| Replay só fica visível durante espera de admissão | B já adquirido→I/C→retorno original | corrida inevitável: a pré-leitura não podia prever o evento ainda não visível |
| Pré-leitura de replay seguida de desaparecimento | I/C→55000, sem admissão | nunca converter replay em novo início adquirindo B tardiamente |
| release, conclusão, legado/comandado sem claim | corpos originais | nenhum prefixo novo de owner nesses caminhos |

Não é uma ordem total B→I→T→C. Start preserva C antes de T; retomadas inserem C
após T. Serialização pelo item próprio evita a inversão entre esses caminhos no
mesmo item. O grafo entre itens mantém riscos existentes do 048.

## Mudanças semânticas justificadas

A proposta 048 literal de quatro PERFORM incondicionais foi refinada dentro dos
mesmos quatro corpos para atender replay, autorização e esperas deste mandato.
Os arquivos `.diff`, `-candidate.sql` e `-inventory.json` do 048 permanecem intactos;
o diff 049 registra integralmente a implementação que será comparada.

1. **Replay sem orçamento:** pré-leitura identifica evento execution_started do
   próprio item/attempt. Essa leitura não autoriza efeito: owner/item/claim/correlação
   são relidos sob locks e autoridade revalidada. Start reproduz exatamente as três
   comparações do replay do helper efetivo (proposal_version aprovado no claim,
   executor normalizado, work_item_id). Mantém retorno antes de validar estado atual
   approved e versão atual do item. As retomadas conservam seus próprios predicados
   de checkpoint/source/input/interruption, sem acrescentar comparação nova de
   versão ou executor a seus replays históricos.
2. **Desaparecimento do replay:** 55000 `attempt correlation changed while acquiring
   locks`, sem efeitos, quando evento antes observado some. Antes, DML privilegiado
   poderia induzir nova admissão; agora falha fechado. Não há upgrade I→B. Escritores
   normais respeitam I e eventos append-only; alteração direta/admin não é certificada.
3. **Recusas sem B:** auth/allowlist/argumentos, claim inexistente, item próprio
   inexistente e claim já iniciado em outra tentativa, liberado sem tentativa ou
   expirado sem tentativa são detectados sem orçamento. Expiry/released não recusam
   replay de claim com attempt correspondente, como antes. Em start as recusas
   antigas são também mantidas sob C para capturar mudanças durante espera.
   Erros de claim podem agora preceder espera em I/C; em races com DML privilegiado,
   revogação ou remoção posterior, precedência temporal pode mudar. É uma recusa
   observada sem efeitos, não nova política ou garantia de snapshot serializável.
4. **Autoridade após espera:** start preserva a rechecagem original após I/C;
   retomadas ganham rechecagem auth.uid/allowlist após I. Todos também revalidam
   após T e após a operação que pode esperar em FK/índice/L; revogação observada
   gera 42501 e aborta os efeitos da chamada. Replays também são rechecados após I/C.
   Não é revogação instantânea nem garantia REPEATABLE READ de enxergar commit
   posterior; testes reais por isolamento são obrigatórios.
5. **T antecipado no start dentro da ordem existente:** preparação de estado,
   versão, execution_spec e target replica os checks do helper vigente, com mesma
   chave de alvo. C já está bloqueado. Adquire T explicitamente para revalidar
   autoridade após a espera; chamada ao helper reaproveita I/T reentrantes. Helper
   preserva ocupação/exclusividade, estados e eventos. Essa pequena duplicação é
   um risco de manutenção: teste fixa o helper e exige identidade dos predicados.
6. **Recusas tardias ainda podem tomar B:** checkpoint/decisão/identidade/routing/
   autorização/ocupação e quota precisam de estado relido sob I/T e triggers ativos.
   Tomar I primeiro para evitar B nessas recusas restauraria o ciclo comprovado.
   Portanto chamadas inicialmente sem replay que acabam recusadas após locks tomam
   B até rollback. Não acrescentar decisão de quota antecipada nem recusar replay
   porque a quota atual está esgotada. Quota/human grant/supervisão/local/externo
   permanecem no trigger e política originais; B sozinho não é consumo.

`now()`/v_now continuam timestamps transacionais. Reler orçamento no trigger depois
de I/C/T não muda janela/caps/política: B já está detido e a decisão original lê os
fatos atuais permitidos pelo isolamento antes de inserir a tentativa e consumir L.
Consumo após UPDATE de L continua condicionado à guarda original; não reavaliar
quota depois de inserir a própria tentativa, o que recusaria incorretamente o
último slot. I bloqueado mantém owner/estado/versão estáveis durante espera de T;
claim bloqueado mantém sua identidade; inserts retomada usam v_item.id/v_uid.
Transação externa que capture uma exceção precisa preservar rollback do sub-bloco
PL/pgSQL; roteiro não deve converter a falha em commit de efeitos independentes.

## Testes e preservação

[Novos testes](../../supabase/tests/single_item_budget_lock_candidate_test.py):
corpos permitidos, preservação de todos os statements por diff explícito, headers,
fonte efetiva/helper, replays/contraexemplos, ordem B/I/C/T, autoridade após esperas,
claims próprios, políticas/now, pacote de três slots e renderização fechada.
Nenhum destes testes executa SQL, subprocesso Docker, ACL real ou MVCC.

Testes anteriores de 045/047/048 passam a analisar explicitamente seu corpus
histórico pinado (sem ler equivocadamente o novo override como baseline antigo).
Scanner recebe filtro de fontes com recusa de arquivo ausente. Auditoria nova lê
**todas** as fontes efetivas e exige que só os quatro corpos mudem, com hashes de
cada migration. Bundle antigo de dois slots conserva suas receitas e expected
prosrc; novo compositor de três slots é separado. Não alterar assertions SQL.

Quatro FAIL reais anteriores de work_budget_local_vs_external (1,2,6,10) continuam
em todos os manifests: 8/12 nessa suíte, 330/334 no total, expectativas de quota só
externa versus política atual v1 supervisionada. Não são novos resultados desta
sessão e não se tornam PASS/skip. Revalidação real terá relatório separado dessa
divergência; o candidato não deve introduzir qualquer quinta falha.

## Pacote e comparação reproduzível

[Compositor offline](../../supabase/tests/single_item_budget_lock_bundle.py),
[renderizador de escalonamento sem executor](../../supabase/tests/single_item_budget_lock_proof.py).
Criar destino novo, jamais sobrescrever pacote:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s supabase/tests -p 'single_item*_test.py'
PYTHONDONTWRITEBYTECODE=1 python3 supabase/tests/single_item_budget_lock_bundle.py --output /tmp/anima-budget-proof-reviewed
```

O segundo comando **só copia fontes e calcula hashes**. Recusa qualquer migration
ou artefato 048 divergente; verifica 272 etapas e 556 hashes; congela harness igual
nos três slots. Manifests contêm expected prosrc/headers das 161 funções e identidade
live NULL/execução não autorizada. Não podem ser usados como preflight live aprovado.

| Slot | Receita depois das mesmas 272 etapas congeladas |
|---|---|
| baseline | nenhum DDL adicional; 154 migrations já incluídas no bootstrap |
| claim_candidate | somente 20261009000000_claim_item_lock_order_candidate.sql |
| combined_candidate | somente 20261009000000 e depois 20261009000001 |

Não reaplicar 154 migrations após bootstrap. Pacotes independentes; image/hash/role
recipe/fixture/harness idênticos. Arquivos compartilhados de testes podem referenciar os
contratos dos três slots: executar seus gates offline na workspace completa, não
tratar suites de Python de outro slot como prova SQL de um baseline reduzido.

Após **nova autorização de SQL/ambientes**, executar sequencialmente três novos
clusters, limites/identidade/isolamento dos planos 047/048 e imagem pinada:
sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b.
1 CPU/1 GiB sem swap extra/64 PIDs, PGDATA tmpfs512 MiB/socket16 MiB, network none,
sem binds/volumes/portas/env residente, rootfs RO/cap-drop ALL/no-new-privileges.
Não ampliar limites, reutilizar antigos ou iniciar/parar residente. Preflight real
com host/daemon estáveis e DB/Auth saudáveis. Vector só admite exceção novamente
comprovada de independência; nenhuma manutenção implícita autorizada.

1. Conferir pacote/hash, nonce/container ID/cluster/database/socket/isolation antes
   de cada SQL, bootstrap ledger 272/272 e catálogo. Aplicar extras só no slot certo.
   Capturar OIDs dentro de cada cluster antes/depois, owner/ACL/headers/atributos,
   functions/prosrc/FKs/índices/triggers/RLS/policies. original→claim muda 2 corpos;
   claim→combined muda 4; original→combined união de 5. Release é idêntico entre
   claim/combined e nenhuma política/trigger/RLS/ACL deve mudar.
2. Fixture sintética committed própria, aprovada/classificada/roteada, claim aberto
   sem attempt, lease suficiente, quota disponível e sem grants/supervisão artificial.
   Target deve coincidir com intent derivado no servidor. Snapshot oito tabelas
   (incluindo autorizações e leases) antes/depois de cada transação.
3. **Controle natural de orçamento em todos os slots, barreira T:** S BEGIN adquire
   apenas `work_target:owner:target`. A invoca start_claimed naturalmente e espera
   T de S. B chama block naturalmente. baseline/claim: B detém orçamento e espera
   XID do item de A; combined: A detém orçamento e B espera esse advisory de A.
   Confirmar ownership/resources/blockers pelo observer antes de liberar S.
   ROLLBACK S. baseline e claim devem fechar 40P01; combined deve terminar sem
   esse ciclo. RPCs A/B são idênticas, sem pré-lock I/C. Depois de A terminar,
   ROLLBACK A para B concluir; ROLLBACK B. Se pré-condições não observadas ou controle
   positivo não reproduzido, INCONCLUSIVO/NO-GO, sem inferir sucesso de log vazio.
   A barreira T permite o controle no baseline antigo que ainda bloqueia C antes
   de I; a barreira C do 048 fica complementar em claim versus combined.
4. **Controle adversarial conservado:** A BEGIN pré-lock I; B block espera I de A;
   A start. 40P01 continua esperado em todos, inclusive combined: prefixo dentro da
   RPC não corrige locks externos já detidos. Testar também C inverso, acquire+start
   na mesma transação, global claim estrangeiro expirado/FK, recovery multi-item e
   foco. Nenhum retry ou reclassificação desses cenários para PASS_NO_DEADLOCK.
5. Reproduzir pares item/claim (acquire/start/release nos dois sentidos) e quatro
   races originais. Natural pares orçamento com interrupt, authorize_work_resume
   de 3 argumentos, readmit e três retomadas, fixtures/checkpoints/decisões válidos.
   Pelo menos 100 repetições por disputa principal, relatório por tentativa/SQLSTATE.
6. Replay de cada RPC com B deliberadamente retido por outra sessão: deve progredir
   sem esperar orçamento se evento já committed/visível e I/C livres. Replay após
   release/expiry/terminal e quota esgotada retorna conforme baseline; mismatch
   executor/correlação conserva 55000. Replay que surge durante espera de B e replay
   removido privilegiadamente durante espera de I são testes separados; último
   exige 55000 e zero efeito. Não manipular expectativa para passar.
7. Revogar allowlist durante espera por B/I/C/T e lock implícito L/índice nas quatro
   admissões; exigir 42501 e rollback integral onde commit é visível sob READ COMMITTED.
   REPEATABLE READ/SERIALIZABLE devem registrar snapshot/40001 ou limitação, sem
   alegar observação impossível. Revogação posterior à última leitura não é coberta.
8. Quota entre itens: último slot, sétima tentativa P0001; limite item/runtime/reserva
   interativa, grant humano consumo único e rollback, supervisão atual; classification/
   routing recusas sem bypass. ACL anon/authenticated/service/private helper, RLS
   foreign-owner, redirected claim, snapshots foreign claims/items/autorizações.
9. 13 suítes pgTAP/334 propriedades (55 Single-Item e 123 históricas). Emitidas/FAIL/
   aborto/SQLSTATE/rollback/cleanup separados, quatro FAIL conhecidos visíveis.
   Não declarar PASS global dessas 334; zero novas falhas é condição localizada.
10. p50/p95/p99/throughput/tempo e recurso de espera com ≥1000 transações reais de
    admissão e replay separados, mesmo item, mesmo owner/targets independentes,
    owners distintos, esperas prolongadas I/C/T e lease. Critérios 046: p95 +≤10%,
    throughput ≥95% na carga válida; não aceitar o microbenchmark anterior de dois
    blocos com 500 replays como 1000 transações. Medir fairness/timeout sem prometer
    ausência de starvation. Cotas exigem owners sintéticos suficientes para carga.
11. Guardar stdout/stderr/SQLSTATE/pg_locks/blockers/server logs/tempos/catálogos/
    hashes/identidades/ledgers antes/depois, final backends=0, snapshots rollback e
    cleanup iguais. Sem alterações no candidato para conseguir PASS durante prova.
    Verificar residente/recursos antes/depois por metadados; nenhum dado residente.

## Riscos residuais e fronteira

Pré-lock I/C e composição na mesma transação, alvo/claim/FK estrangeiro, recovery
R/H/root/successor, foco F/FK, parent/admin/pago/multiowner permanecem fora da
segurança localizada. Mesmo-owner novas admissões retêm B durante waits I/C/T,
criando head-of-line blocking maior; replay estável o evita. Mutex cooperativo não
prova justiça nem ausência universal; modelos finitos mostram contraexemplos,
não certificam MVCC/PLPGSQL/PostgreSQL. Duplicação pequena dos checks/prelock T
no start deve acompanhar evolução do helper; hashes/tests barram drift silencioso.

NO-GO para promoção/aplicação: candidato apenas offline. Próximo passo é revisão
humana desta migration/diff e autorização separada da prova comparativa nos três
clusters. Nenhum SQL, Docker, residente, INV-11, Resident Host ou compute usado.


## Resultado offline

112 testes Single-Item PASS (15 novos; 55,616 s no conjunto). Bootstrap: 272 etapas/556 hashes verificados sem divergência pelo compositor; tipos não regenerados porque nenhum banco foi alterado e assinaturas/schema permanecem iguais. Typecheck/build TypeScript não executados por não haver alteração TS nesta sessão. PostgreSQL/pgTAP/ACL/RLS/compilação PLPGSQL e contenção permanecem pendentes.

30 testes bootstrap offline PASS (16,303 s). Preflight futuro deve excluir explicitamente todos os IDs anteriores, incluindo dc4be077b3559a61d42122671669a412af2de59fe5096cad06895747fead93a5 e 7d878a682ca9c66f495e10bd239b8830d119d279ae42b32c52743aa78033d86c, além dos descartáveis antigos já listados no preflight. Scripts live da campanha anterior são evidência histórica e não devem ser executados sem adaptar/revisar destino e verificações para os novos slots; o renderizador 049 separa preparação de sessão e ações RPC, sem executor embutido.

Pacote offline desta sessão: `.tmp/single-item-budget-lock-proof-20261009-ba6404a7ae634e9c9ab0002308405658`. [Manifests/logs/checks](../registros/2026-10-09-single-item-budget-lock-candidato-evidencias/). Destino criado novo, nunca sobrescrito; identidades live não preenchidas.


## Prova real autorizada — parada de integridade (2026-10-09)

[Registro e matriz](../registros/2026-10-09-single-item-combinada-prova.md). Pacotes 2.469 hashes e bootstrap556 íntegros; Vector independente admitido operacionalmente, DB/Auth healthy. Baseline novo 272/272, mas expectedProsrcSha256 de 53 corpos está em LF e PostgreSQL preservou CRLF das fontes; strings de assinatura também exigem resolução canônica de tipos/OID. Diagnóstico arquivado confirma raw fontes sem alterar expectativas. NO-GO do harness/manifests antes de pgTAP/concorrência: demais variantes não criadas, candidatas não aplicadas. Único novo encerrado, sem remoção; tmpfs perdido previsto. Próxima etapa é correção offline/revisão de metadados e novos pacotes, sem editar SQL/asserções/política nem sobrescrever evidência. Adicionar container2073d5af7365cb6a37d99df2a87f7505a63e2489f9d10062b295c540ec738305 e cluster7694595591914635392 à lista de não reutilização. Gate ativo; combinado não validado em PostgreSQL.


## Retomada offline do comparador (2026-10-09)

[Plano 050](050-single-item-catalog-comparator.md): compositor revisado raw CRLF, identidades por tipos/OIDs, três domínios de hash e novos pacotes sem sobrescrever originais. Próxima prova exige revisão do executor live e preflight integral; nenhuma aplicação SQL nesta etapa.

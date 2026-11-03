# 053 — Sessões naturais item/claim com resultado preservado

2026-10-09; correção localizada do harness, offline. Continua
[052](052-single-item-full-catalog-contract.md) e a
[campanha parcial](../registros/2026-10-09-single-item-guard-prova.md).
Não aprova SQL, novas provas ou promoção das migrations.

## Causa e sequência preservada

O transporte efetivo era live_common.py → fixture_helpers.EvidenceSession →
single_item_concurrency.Session congelado. S segura apenas advisory do alvo;
A acquire RPC espera S, B start/release RPC espera A. Waits de pg_blocking_pids
são observados, pg_locks capturado e S libera o alvo. Não há pré-lock de linha
nas RPCs em disputa. O fixture setup e as expressões de RPC/sincronização são
preservados por comparação AST com o arquivo da campanha, não por teste espelho.

No candidato, A recebeu55000 e psql ON_ERROR_STOP terminou exit3. O cenário
antigo tentou ROLLBACK no stdin fechado antes de coletar A. Broken pipe desviou
para finally, que terminou B com-15. Seu resultado é indeterminado. O except
registrou FAIL_HARNESS_OR_PRECONDITION, mas o processo saiu0 e o dispatcher seguiu.
Os dois resultados anteriores não foram substituídos ou convertidos em PASS.

## Rota canônica revisada e alcance

Somente claim_acquire_start e claim_acquire_release usam os novos módulos:

- single_item_natural_session.py: stdin com poll antes do envio; corrida poll/write
  com EPIPE confirma exit sem retry. Readers preservam stdout/stderr completos,
  EOF separado dos marcadores e coleta repetível. Erro de reader/coleta incompleta
  não é PASS. Timeout exige encerramento delimitado, terminate/kill e flags forced.
- single_item_natural_pairs.py: mesma barreira S e mesmas RPCs; espera marcador
  de fim ou EOF esperado de A, libera/rollback somente se vivo, coleta A e depois
  B independentemente. Falha A não pula coleta B. Resultados anteriores à limpeza
  e posteriores à limpeza persistidos separados por sessão. Só depois classifica.
- single_item_natural_campaign.py: chama somente esse subconjunto e confere também
  result.json, não apenas exit code. FAIL/INDETERMINADO/TIMEOUT, documento ausente,
  PASS desconhecido ou child exit não zero bloqueiam o próximo cenário.

Os helpers e runners antigos continuam intactos como evidência e para cenários
já comprovados; não executar seu natural_pairs.py/run-functional.py antigo como
rota aprovada para esses dois cenários. Não há segundo comparador ou transporte
SQL: reutiliza check/sql/read_json/snapshot/write do contexto revisado052.
Importar módulos novos não cria processos, acessa Docker ou executa SQL.

Coleta inclui stdout, stderr, exitCode, SQLSTATE, complete, forced, timedOut,
readerErrors e comandos enviados.55000 é recusa esperada com exit3;40P01 é
deadlock comprovado somente com duas respostas completas e nenhuma terminação
forçada/timeout.40P01 inesperado é FAIL.57014/55P03 são timeout. Outras recusas
não são automaticamente aceitas. EOF sem resultado da RPC é INDETERMINADO.
Timeout/instrumental e rollback/cleanup divergente sempre retornam não zero.

Antes de qualquer snapshot SQL, ctx.check valida CID/cluster/socket. CLI exige
--execute, contexto novo e review/hash externo. Review rejeita drift e os20 CIDs
históricos conhecidos. Não altera pacotes052r2 nem manifests antigos; overlay do
runner é pinado separadamente. O prefixo de diretório/nonce do live_common deve
ser adaptado para o novo contexto conforme transporte já validado, nunca antigo.

Cleanup fecha todas as sessões mesmo se uma falhar; identifica backends próprios
por PID quando disponível + application_name nonce/side + banco de prova atual.
Se PID não foi obtido, só o nome exato previamente emitido e banco atual permitem
cleanup. Não usa terminação global. DELETE limita-se ao auth.user sintético do
fixture, seguido de comparação do snapshot original e contagem zero de sessões.
Falha de qualquer etapa é FAIL_CLEANUP; não há garantia falsa de limpeza do OS
caso terminate/kill/coleta falhem. A identidade SQL continua exigida pelo transporte.

## Provas offline e pin

[Logs/diffs/review](../registros/2026-10-09-single-item-runner-sessoes-evidencias/).
Testes usam processos simulados e contexto SQL fake: exit precoce55000,
deadlock40P01, peer vivo, EPIPE em corrida, stdin fechado, timeout/kill, reader
incompleto, signals, coleta idempotente, cleanup divergente, erro de cleanup,
propagação de FAIL interno mesmo com exit0, missing result, tamper/hash e CID
histórico. Os registros reais anteriores são lidos, mantendo seu FAIL intacto.
Esses testes não recuperam o resultado que B não produziu na campanha antiga.

Review `runner-review.json` pin
`998098fabe9cc6810994e2afbf51b02b59d7b06a8f38627c0c7631e121bbb206`.
Fontes de produto/fixtures/334expectativas/quatroFAIL históricos preservados.

## Retomada mínima — somente após autorização posterior

1. Revisão humana dos quatro fontes/diffs/pin053. Preflight integral: Git Windows,
   índice/WIPs/46worktrees,2484pacotes,156migrations,556bootstrap, guard corrigido,
   adapter/contrato052, Docker/imagem/recursos/DB/Auth/Vector e todos históricos.
2. Criar contextos e bancos NOVOS, sequenciais, mesmos limites052. Bootstrap272
   e gate integral279/membership118 antes de qualquer fixture; candidatos só após
   GO do catálogo baseline. Não reutilizar qualquer dado/CID/cluster/nonce anterior.
3. Priorizar os dois controles naturais: baseline como controle positivo40P01,
   item/claim e combinado com coleta completa das duas sessões. Cada ambiente
   encerrado depois de preservar logs e hashes. Interromper em FAIL/INDETERMINADO.
4. Não repetir as26 suítes baseline/item-claim só para reparar o runner: suas668
   asserções e deltas de catálogo já têm evidência, condicionada a fontes/hashes
   inalterados. Novo gate em cada cluster continua obrigatório. Combinado nunca foi
   validado real:334pgTAP e matriz orçamento/revogação/replay/retomada/rollback/ACL/
   RLS/cleanup e contenção continuam necessários antes de avaliá-lo. Não declarar
   GO combinado só com os dois cenários item/claim. O runner orçamento existente
   não foi corrigido neste escopo; verificar sua prontidão offline antes de usá-lo
   no combinado, sem aceitar Broken pipe ou suprimir qualquer recusa.

Com NOVO contexto identificado/preflight aprovado, executar da raiz:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 supabase/tests/single_item_natural_campaign.py --execute --context "$ANIMA_PROOF_CONTEXT" --review docs/registros/2026-10-09-single-item-runner-sessoes-evidencias/runner-review.json --review-sha256 998098fabe9cc6810994e2afbf51b02b59d7b06a8f38627c0c7631e121bbb206 --slot baseline
```

ANIMA_PROOF_CONTEXT deverá apontar exclusivamente o contexto novo aprovado;
depois repetir com --slot claim_candidate/combined_candidate em contextos novos
de suas variantes, após respectivos gates. Este comando não provisiona nem aplica
migrations, e não está autorizado para execução nesta sessão.

Pendências reais: interleaving/EOF de docker exec versus psql, SQLSTATE das duas
sessões, tempo de espera/coleta, cleanup/backend termination reais, orçamento
combinado e diferenças de replay/retomadas. Offline não exclui starvation/deadlocks
globais. Gate Single-Item ativo, sem promoção ou trabalho governado.

## Resultado final offline

170Single-Item PASS (209,063s),33bootstrap PASS (11,896s),17novos no subsetfinal PASS.2484pacotes/156migrations/556bootstrap/6051evidências antigas intactos. Git dev/HEAD6bc4aade/índice vazio/46worktrees preservados. Registro de encerramento e próxima fronteira: [sessão](../registros/2026-10-09-single-item-runner-sessoes.md). GO offline, nenhuma autorização SQL inferida.


## Prova PostgreSQL focada

[Registro](../registros/2026-10-09-single-item-053-prova.md): runner053 preservou itemclaim2naturaisPASS(A55000/B0), e no combinado coletou integralmente23514 em work_items_check e propagouFAIL/exit1. Catálogo279GO ambos,272/272; combinado330/334 com4FAIL históricos. GO real do runner; NO-GO combinado por SQL temporal(updated_at<created_at), atribuição produto/infra não estabelecida. Novos a6bcf32f.../b00839da... encerrados, IDs completos/cluster no registro; nunca reutilizar. Investigação temporal offline e autorização posterior antes de novas provas.


## Investigação temporal offline

[Registro temporal](../registros/2026-10-09-single-item-temporal.md):23514 comprovado no helper histórico, idêntico entre variantes. Espera/now() isolados não explicam a fixture confirmada antes de B; causa específica indeterminada, relógio regressivo não comprovado.11 modelos PASS e contraexemplo de transação antiga; proposta de mutação monotônica e prova discriminante aguardam revisão/autorização. Nenhuma SQL/migration alterada.


## Prova temporal discriminante real

[Registro](../registros/2026-10-09-single-item-temporal-prova.md): um novo cluster272/272 e catálogo279GO. Original reproduziu23514 com regressões de relógio WSL/PostgreSQL diretamente medidas contra monotonic_ns. Controle B anterior à fixture reproduziu23514 com now() histórico. Causa da nova reprodução explicada, agente do ajuste de relógio ainda não identificado; ocorrência053 anterior não tem medição retroativa. Cleanup completo e novo container encerrado sem remoção; DB/Auth/históricos preservados. Delta de timestamp somente proposto, combinado continua NO-GO para promoção; revisão antes de produto/nova campanha.

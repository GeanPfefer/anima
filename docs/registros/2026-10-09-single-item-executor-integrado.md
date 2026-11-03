# Single-Item — integração offline do executor PostgreSQL

2026-10-09; desenvolvimento e validação offline. Resolve o NO-GO instrumental do
[registro anterior](2026-10-09-single-item-retomada-bloqueio-executor.md), sem
aprovar campanha ou produto. [Plano051/checkpoint](../planos/051-single-item-executor-catalog-integration.md),
[evidências/diff](2026-10-09-single-item-executor-integrado-evidencias/).

Branch Windows dev; HEAD inicial/final 6bc4aadef9414d655600c2ea37c6be436b3628c8.
Índice vazio, nenhum commit/staging/push/reset/clean/prune. WIPs preservados;
46 worktrees devem permanecer iguais ao snapshot inicial arquivado.

Adapter corrente `supabase/tests/single_item_postgres_executor.py` reutiliza o
transporte full-ID/socket check/read_json/sql/write e chama diretamente o comparador
050; não há implementação concorrente de matching por assinatura. Adapter antigo
apply_variants/live_common continua evidência imutável, nunca destino da retomada.
Detalhes e procedimento de bind/pins no051; não importar launcher histórico.

Corpos raw, identidades canônicas de entrada/retorno, OIDs, ownership/ACL/grants,
atributos completos e RLS/policies/triggers são gates obrigatórios antes/depois
das extras. Somente2/4 mudanças de corpo autorizadas; nenhuma alteração de outros
campos. Source e wrapper payload têm hashes separados registrados antes de dispatch.
Pins externos de código/manifests, bootstrap272/556, variantes iguais e recusa dos
cinco containers históricos antes de qualquer transporte. GO_CATALOG_ONLY não
aprova execução funcional nem permite retirar o gate.

Resultados finais:144 testes Single-Item PASS (159,613s;19 testes novos de executor),
30 bootstrap PASS (11,140s). A primeira rodada do executor falhou porque o teste
negativo atribuía secdef=false a função jáfalse. Correção foi inverter valor
observado; log inicial preservado. Nenhum SQL de produto ou expectativa pgTAP
alterado para obter PASS. Rodada intermediária143 PASS precedeu a guarda de
containers; a rodada final144 cobre a implementação pinada.

Integridade:2475 arquivos dos três pacotes050 PASS,156migrations PASS,556bootstrap
hashes PASS,3253 arquivos protegidos idênticos ao snapshot. Originais e revisados
preservados; overlay/pins do adapter separado. As334 asserções SQL e quatro FAIL
históricos local/externo não alterados ou reexecutados.

Replay CLI usa o mesmo executor/comparador com transporte fake. Baseline recebe
corpos/atributos/ACL e guardas reais arquivados; informações de tipos ausentes são
sintéticas e after snapshots candidatas modelados de fontes, explicitamente
marcados. Isso demonstra fluxo de integração GO/NO-GO offline, não compila SQL nem
constitui evidência real dos tipos/candidatas/deadlocks/MVCC. Query e semântica
PostgreSQL permanecem pendentes da campanha autorizada, como definido no051.

Nenhum Docker/SQL, container/rede/volume, banco/dado residente, INV-11, Resident Host,
compute/API paga executado ou alterado. Estado atual residente não inspecionado.
Políticas/migrations/código governado/gate single_item_atomic_claim_unavailable
intactos. Typecheck/build TS não executados pois alterações são harness Python/docs.

Fronteira: revisão humana do adapter/pins antes de repetir preflight integral.
Retomar com o entrypoint051 em contexto NOVO do transporte, pacotes050 e referências
pinadas. Só após GO_CATALOG_ONLY executar matriz049 completa, preservando SQLSTATE,
locks/tempos/334pgTAP e FAIL históricos. Não promover migrations ao residente nem
liberar Single-Item. Parada após validação offline.


Replay final: baseline/item-claim/combinado GO_CATALOG_ONLY offline; corpo/ACL/trigger divergentes NO-GO. JSON/logs e pins em evidências. Git final: dev no mesmo HEAD, índice vazio,25 tracked modificados preexistentes,153 untracked agregados e46 worktrees com metadados idênticos ao início. Nenhuma migration ou expectativa SQL alterada.

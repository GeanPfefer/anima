# 046 — Comparação PostgreSQL do baseline com candidato localizado

2026-10-09. Plano preparado; NÃO executado e sem autorização para iniciar ambiente.
Decisão proposta: [ADR de locks](../arquitetura/single-item-lock-strategy-decision.md).
Baseline é o corpus original da campanha COM os WIPs identificados, não simplesmente
HEAD: a migration Single-Item e parte do corpus não estão commitadas. O diff de
59 corpos do Plano 045 não é candidato aprovado.

## Pré-condições e evidência independente

1. Revisão humana aprova primeiro o diff exato dos dois corpos, mensagens/SQLSTATE
   fail-closed, e esta matriz. Ainda falta escrever/revisar a migration nova.
2. Outra autorização explícita permite reconstrução descartável e aplicação SQL.
   Docker estava parado no diagnóstico anterior; esta sessão não consultou/iniciou.
   Não reutilizar cluster antigo nem presumir preservação de tmpfs.
3. Congelar manifesto de arquivos/hashes do baseline original e de candidato.
   Harness corrigido idêntico em ambos; mudanças de fixture não são mudanças de
   produto. Bootstrap original 272 etapas e ledger/hash servem como referência,
   mas compatibilidade do corpus congelado deve ser verificada antes de executar.
4. Construir dois destinos descartáveis isolados, sem publicar portas ou volumes
   residentes, com IDs completos, mounts/tmpfs/labels/database exclusivos e
   cluster IDs distintos. Não reutilizar banco/cluster de residente. Validar
   identidade por inspect e SQL read-only antes de qualquer DDL/prova autorizada.
5. Registrar versão PostgreSQL, extensão pgTAP, migrações aplicadas, OIDs/ACL/triggers,
   hashes de corpos do catálogo e baseline de dados. Candidato difere exclusivamente
   nos dois corpos aprovados; comparar catálogo e ledger, não apenas arquivos.
6. Salvar dois diretórios independentes de evidências duráveis, fora do tmpfs,
   contendo manifestos, comandos, stdout/stderr brutos, exit code, SQLSTATE, PID,
   tempos monotônicos e UTC, server log de deadlock, pg_locks/pg_stat_activity,
   snapshots por owner/item/claim/authorization/evento e SHA256. Não sobrescrever
   campanha antiga, não inferir PASS de ausência de logs. Gates falhos permanecem.

Limites sugeridos para revisão: 100 repetições por disputa funcional, 1000 operações
para latência em itens independentes; mesmas sementes/dados/reset transacional em
ambos. Fixar antes da execução concorrência, lease, timeout e método de percentil.
Proposta inicial: lock_timeout 5s, statement_timeout 15s, lease 60s; confirmar que
não censuram deadlock_timeout nem provocam falha artificial de lease. Instrumentar
barreiras de forma idêntica, nunca alterar a ordem de locks que se pretende medir.
Nenhuma dessas configurações foi aplicada nesta sessão.

## Matriz comparativa obrigatória

| Cenário | Baseline e candidato: coleta/critério |
|---|---|
| Controle negativo antigo, I/C pré-bloqueados opostos | Baseline 40P01 recuperado; candidato pode ainda 40P01. Exigir rollback integral, backend limpo, sem retry; não usar como PASS da nova ordem |
| Acquire/start do mesmo item por RPCs naturais | Capturar ordem/esperas sem pré-locks inversos. Se baseline reproduzir, candidato deve eliminar 40P01 nessa matriz. Se não, conclusão empírica limitada |
| Start/release, ambos sentidos | Reproduzir barreiras após I/C nos caminhos reais; candidato não pode criar ciclo novo. Start-only serve contraexemplo offline, não candidato a aplicar |
| Acquire/release e dois starts do mesmo item | Idempotência, reason, attempt único, transições e eventos exatamente correlacionados; zero mutação extra |
| Replay start e release | Mesmo retorno e erros canônicos; medir espera adicional do item-first; sem execução/consumo duplicado |
| Claim ausente/estrangeiro, args inválidos, revoked allowlist | 42501/22023/P0002 e precedência canônica preservados; sem revelar/alcançar item de outro owner |
| Claim liberado, expirado, attempt divergente e version stale | SQLSTATE/mensagem da regra original; rechecagem após espera obrigatória; budgets/eventos sem consumo indevido |
| Dois itens do mesmo owner, alvos independentes | Medir throughput, p50/p95/p99 e overlap real dos recursos; orçamento continua serializado onde já era exigido |
| Dois owners independentes | Chaves T/B, dados e snapshots isolados; investigar qualquer espera compartilhada de índice/FK antes de atribuir ao protocolo |
| Mesmo alvo, itens distintos; claim ativo e expirado | Controle dos ciclos T/C e I_foreign/FK residuais. Single-Item recusa foreign claim aberto, inclusive expirado, sem liberar/modificar nenhum deles |
| Global versus Single-Item, ambos sentidos | Guardas canônicas e coexistência; global pode limpar expired conforme contrato, scoped não. Qualquer 40P01 residual bloqueia GO global |
| Start versus authorize/block/interrupt/readmit | Controle I/B residual, concessões e consumo exato. Não mudar política para eliminar o ciclo |
| Recovery, successor/root, retry e reconciliação | Ordenação UUID, idempotency H, R, rollback e preservação de siblings; pré-condições válidas antes de alegar ciclo real |
| Terminal versus set_work_focus | Ciclo F/I e FK; confirmar locks reais, sem classificar como resolvido pelo candidato |
| Falha de sessão/cancelamento/timeout | Rollback, locks liberados, nenhum claim/lease/concessão órfã; sem retry automático mascarando 40P01 |
| Transações longas/contendidas | Cauda de espera, expiração de lease e progresso de todos os participantes; amostra não prova ausência universal de starvation |
| Multiowner composto e DML privilegiado/parent FK | Controle de fronteira separado, nunca promessa de cobertura canônica; todos os fixtures descartáveis, sem banco residente |

Não executar operações pagas/API/Host/INV-11 para exercitar a fronteira P. Validar
catálogo e modelar seu risco; qualquer prova de DML nessa família exige autorização
separada. O modelo offline não autoriza a operação.

## Cobertura canônica e orçamento histórico

Executar as 13 suítes canônicas após preflight, preservando todos os planos e
assertions. As cinco históricas recuperaram 123 propriedades no harness; mais 55
Single-Item conservadas por hash. Essa recuperação NÃO é pgTAP PASS. Registrar
334 planejadas versus emitidas, skip, erro SQL e assertion FAIL separadamente.
Introspecção OID e reason do fixture usam correções anteriores; decoder t/f e
cleanup EPIPE também são idênticos em ambos os destinos.

A suíte histórica local/externo (12 propriedades) preserva expectativa V2 enquanto
política atual é V1; catalogar divergências por assertion em ambos, com SQLSTATE e
resultado real. Essa questão não justifica alterar política/guardas e não serve
para aprovar/rejeitar a ordem de locks se a divergência é idêntica no baseline.
Qualquer diferença nova em orçamento é regressão e bloqueia candidato.

## Critérios objetivos e retomada

- Aceitar o candidato **no domínio localizado**: zero 40P01 novo no conjunto
  acquire/start/release mesmo item, zero mutação estrangeira, retorno/SQLSTATE e
  consumo canônicos equivalentes, todo teste emitido com evidência independente.
- Limites propostos a aprovar ANTES da prova: regressão de p95 em itens independentes
  ≤10%, throughput ≥95% do baseline sob carga igual, zero expiração adicional de
  lease/timeout atribuível ao novo lock; reportar dispersão e amostra. Se baseline
  for instável, não declarar diferença estatisticamente resolvida.
- Rejeitar se start/release introduzir ciclo, se snapshot/ACL/gate mudar, ou se
  prefixo atingir outro owner/item. Rejeitar garantia global se ciclos residuais
  persistirem, mesmo que os dois corpos cumpram o objetivo localizado.
- Retirar candidato do destino de provas e preservar seus logs em caso de falha;
  rever estratégia por ciclo demonstrado. Não avançar para os 59 corpos por
  conveniência. Se alguma implantação futura precisar rollback, preparar migration
  compensatória revisada, sem reset/edição de histórico.
- GO de produto requer prova real dos ciclos relevantes do domínio suportado e
  decisão separada sobre orçamento histórico. Gate permanece até essa aprovação.

Próximo passo exato: revisão humana do escopo de dois corpos e desta matriz; depois,
se autorizado, elaborar a migration candidata e revisá-la ANTES de execução real.
Bloqueios presentes: diff executável ainda não escrito/aprovado; ordem global não
provada; prelocks do caso real não reproduzem entradas naturais por si; catálogo e
ambientes baseline/candidato não validados; performance desconhecida; cobertura
histórica ainda sem nova prova SQL; divergência de política fora deste trabalho.

## Candidato implementado offline — 2026-10-09

Autorização posterior permitiu escrever a migration incremental de dois corpos,
sem aplicar SQL. [Plano 047](047-single-item-claim-lock-candidate.md) aponta migration,
diff completo, contrato congelado e roteiro exato. Os bloqueios “diff ainda não
escrito” e “implementação não autorizada” acima são históricos; aplicação e prova
real continuam sem autorização. Baseline/candidato empacotados offline com mesmo
harness e uma única migration adicional; recipe bootstrap ainda exige reconciliação.

## Evidência comparativa real — 2026-10-09

[Registro](../registros/2026-10-09-single-item-comparativa-vector-prova.md):
272/272 por cluster, 334 TAP emitidas/330 ok/quatro FAIL históricos por ambiente,
quatro disputas originais PASS por ambiente. Quatro pares item/claim corrigidos
no interleaving controlado; controle original e item/budget permanecem 40P01.
Amostra de 1000 replays em duas transações por ambiente, p95 +29,4%, sem campanha
de 100 repetições por disputa ou benchmark de admissões independentes. Não
confundir comparação executada com aceite integral deste plano. NO-GO promoção.

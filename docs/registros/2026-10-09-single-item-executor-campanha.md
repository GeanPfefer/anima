# Single-Item — campanha com executor integrado parada antes da criação

2026-10-09; preflight operacional e offline. **NO-GO instrumental comprovado**,
sem criação de ambientes ou execução SQL. [Plano051](../planos/051-single-item-executor-catalog-integration.md),
[049/matriz prevista](../planos/049-single-item-budget-lock-candidate.md),
[evidências](2026-10-09-single-item-executor-campanha-evidencias/).

Branch Windows dev; HEAD inicial/final6bc4aadef9414d655600c2ea37c6be436b3628c8,
índice vazio,46worktrees preservadas. Nenhum staging/commit/push/reset/clean/prune.

## Causa confirmada

O SELECT integrado coleta todas as funções de public/private. Catálogo real
arquivado baseline contém **279 funções**, manifesto contém **161 definições de
migration**. As118 adicionais incluem array_to_halfvec/array_to_sparsevec e outras
funções do ambiente. `validate_catalog` exige no final igualdade de OIDs resolvidos
pelas161 fontes com todas as funções coletadas; recusa o inventário legítimo completo
com ValueError `NO-GO: unexpected function outside manifest`.

O replay/teste051 montava snapshot.functions somente pelos161 mappings da campanha
antiga, descartando as118 adicionais. Os144 testes passam, mas essa filtragem
mascara o erro de integração. O gate não deve ser enfraquecido nem executar nova
campanha sabidamente destinada à mesma falha. Esta é falha do adapter/fixture de
snapshot, não defeito comprovado das migrations nem regressão de produto.

Contraexemplo reproduzido offline com o MESMO validate_catalog/comparador e
manifest051/050. Acrescenta as118 observações arquivadas, incluindo OID/nome/body/
atributos reais, ao fixture de replay. Metadados de tipos faltantes são sintéticos
e explicitamente declarados; não são usados para resolver essas funções extras.
Erro ocorre na igualdade final dos conjuntos. `catalog-inventory-counterexample.json`
registra todas as adicionais e a recusa; nenhum PostgreSQL consultado.

## Preflight comprovado

- Git Windows dev/HEAD autorizado/índice vazio/46worktrees; snapshots arquivados.
-2475 arquivos e pins dos pacotes050 íntegros,156migrations e556bootstrap hashes
  sem drift; revisão051/arquivos e referências conferidos com pin externo
  ded715741ef32fae556a0c566f9068ba21c2ede8fc6cfc8abf5883e049d7804a.
-144 testes Single-Item PASS nesta sessão (158,494s). Replay051 arquivado conferido;
  não reclassificado como prova SQL nem replay do catálogo completo.
-Docker Desktop daemon29.8.2 estável, ID18caadf3-1887-45ef-857e-4e71fcef77e9,
 16CPUs/8259190784bytes; imagem pinada af083ef... presente/validada, sem pull.
 Host livre4952964KiB; containers aproximadamente1681928487bytes. Headroom dentro
 dos limites anteriores de1GiB sequencial, sem ampliar CPU/RAM/PIDs/privilegios.
-DB/Auth saudáveis antes/depois, metadados completos sanitizados idênticos.
-Cinco descartáveis históricos conferidos por IDs completos, encerrados/networknone;
 nenhum iniciado, reutilizado, modificado ou removido. Identidades antigas negadas.
-Vector preexistente unhealthy/restarting,89 restarts no snapshot inicial; logs
 NetworkUnreachable/OS101 nos sources docker_host/docker_logs. Sem mounts, rede
 supabase_network_anima distinta de networknone, sem pressão relevante no snapshot.
 Exceção operacional independente admitida; não classificado saudável nem reparado.

A decisão operacional favorável não supera o NO-GO do gate. Três nonces e wrappers
fresh preparados offline com o compositor existente em destinos novos; nenhuma
imagem/container/cluster foi criado. Fontes e272payloads canônicos originais intactos.
Cópias de scripts/contexto para futuro destino são instrumentos arquivados, não
executores aprovados automaticamente. Não lançar a partir desta preparação sem
corrigir/revisar o novo bloqueio e repetir preflight.

## Matriz da campanha

| Prova | Baseline | Item/claim | Combinado |
|---|---|---|---|
| Ambiente/cluster novo | não criado | não criado | não criado |
|272bootstrap real | não executado | não executado | não executado |
| Extras aplicadas | nenhuma | nenhuma | nenhuma |
| Catálogo PostgreSQL novo | não coletado | não coletado | não coletado |
|334pgTAP |0 executadas |0 executadas |0 executadas |
| RPCs naturais/deadlocks | não executados | não executados | não executados |
| Pré-locks adversariais | não executados | não executados | não executados |
| Replay/retomada/revogação/orçamento/ACL/RLS | não executados | não executados | não executados |
| Waits/latência/starvation | não medidos | não medidos | não medidos |

Nenhum SQLSTATE novo: erro Python ValueError, sem SQL. Quatro FAIL históricos
local/externo mantidos, sem reexecução/mudança de expectativas ou mistura com esta
matriz. Correção combinada indeterminada em PostgreSQL; não declarar segurança global.

## Estado final e retomada mínima

IDs dos17containers, redes e volumes exatamente iguais; DB/Auth saudáveis e
inalterados; daemon ID estável. Somente Vector State/RestartCount mudaram pela
policy automática preexistente. Nenhuma ação de manutenção residente ou criação
Docker/SQL, INV-11/Resident Host/compute pago. Gate Single-Item ativo. Migrations,
políticas, fixtures SQL/334asserções e código governado não alterados.

Recomendação **NO-GO da campanha e da promoção**. Próxima etapa é correção offline
instrumental do inventário: distinguir161 funções derivadas das fontes e118 funções
adicionais legítimas, mantendo todas protegidas por identidade canônica/OID/body/
atributos/ACL/proveniência validada. Não simplesmente ignorar extras ou aceitar nome
por prefixo. Corrigir fixture de snapshot para conter o catálogo completo arquivado
sem filtragem; provar recusa de funções extra ilegítimas e de modificações das
legítimas. Revisar/pinar adapter e snapshot completo, preservar evidência da falha,
e só então repetir preflight integral para novos ambientes. Não criar outro
comparador nem alterar SQL de produto para resolver este erro.

Parada após diagnóstico, sem executar a etapa afetada. PRD/plano051 recebem
ponteiros; registro/evidências novos preservam o estado apenas pelo repositório.


Git final: dev/mesmo HEAD, indice vazio,25 tracked modificados preexistentes,155 untracked agregados,46 worktrees com metadados identicos ao inicio. Estado/evidencias em git-final.json e SHA256SUMS.

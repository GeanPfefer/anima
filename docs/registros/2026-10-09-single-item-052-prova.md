# Single-Item052 — prova parada no isolamento kernel, antes de PostgreSQL

2026-10-09; preflight e criação parcial autorizada. **NO-GO instrumental no guard
de mounts, antes de initdb ou SQL.** [Plano052](../planos/052-single-item-full-catalog-contract.md),
[evidências duráveis](2026-10-09-single-item-052-prova-evidencias/).

Branch Windows dev; HEAD inicial/final6bc4aadef9414d655600c2ea37c6be436b3628c8,
índice vazio,46worktrees preservadas. Nenhum staging/commit/push/reset/clean/prune.

## Preflight e autorização exercida

2484arquivos/pins052r2,156migrations,556bootstrap e fontes/review pin
47598d6c75d4aab9541180e3fb521a955b6644a7d4a581ab37cc04161b064018 conferidos.
153 testes Single-Item PASS nesta sessão (288,164s); ensaio offline integral
279funções/272bootstrap previstos/334assertions preparados,3GO modelados e10NO-GO.
Nenhum resultado modelado foi apresentado como catálogo/membership real.

Docker29.8.2, daemon18caadf3-1887-45ef-857e-4e71fcef77e9 estável,16CPUs,
8259190784bytes; imagem af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b
pinada, presente, plataforma/env conferidos, sem pull. Host livre3661232KiB,
uso estimado containers1690777420bytes; headroom dentro dos limites anteriores.
DB/Auth healthy antes/depois e metadados sanitizados exatamente iguais.

Vector unhealthy/restarting preexistente; fontes docker_host/docker_logs falham
NetworkUnreachable/OS101, sem mounts e em supabase_network_anima. Exceção operacional
admitida por independência/headroom; não reparado nem classificado saudável. Cinco
históricos de prova por ID completo, todos encerrados/networknone, preservados.
Os demais containers também foram registrados, sem início/restart/removal.

## Identidade nova e ponto exato da parada

Único novo container:26d5e1d5599d1baee3dda2b8777240b499118a449f3d08ee4f4e0af909407e10.
Nonce66e7b31c180442f8880540069312f652. Nome de banco PREVISTO
anima_single_item_proof_66e7b31c180442f8880540069312f652 — **não criado**.
Cluster ID:null; initdb nunca executado; diretório pgdata/proof_ready ausentes.

Declarações Docker conferidas:networknone, sem portas/binds/volumes persistentes,
rootfsRO, usuário postgres/cap-dropALL/no-new-privileges,1CPU/1GiB sem swap extra/
64PIDs, tmpfsPGDATA512MiB/socket16MiB. Após start somente shell de espera do container
ficou ativo; validator kernel falhou antes de qualquer inicialização PostgreSQL.

Erro ValueError `unexpected kernel mount: /etc/hostname`, phase preflight-running.
Guard pinado `bootstrap_tmpfs_preflight.py` exige literalmente `/dev/sde` como fonte
dos mounts Docker de hosts/hostname/resolv.conf. Kernel observado usa `/dev/sdd`.
Os três mounts são ext4, ro/relatime, com root exato
/data/docker/containers/<NOVO_CID>/<arquivo>. PGDATA/socket tmpfs com flags/tamanhos/
UID/GID/modes corretos e overlay rootRO também conferem. O nome do device diverge
mesmo com esses atributos; não demonstrado compartilhamento indevido ou alteração
de orçamento/catálogo. A garantia de isolamento não foi relaxada durante a campanha.

Mountinfo bruto e diagnóstico arquivados. Contraexemplo **offline diagnóstico**,
substituindo apenas os3tokens/dev/sdd→/dev/sde em memória, faria o guard passar.
Esse texto não foi usado para execução, não alterou mountinfo ou código, não
transformou o NO-GO real em PASS. Demonstra precisamente a dependência literal do
guard; não certifica identidade física do disco ou autoriza nomes arbitrários.

## Matriz — sem inferências de campanhas anteriores

| Prova | Baseline | Item/claim | Combinado |
|---|---|---|---|
| Container | um novo, encerrado | não criado | não criado |
| Cluster/PostgreSQL | não inicializado | não criado | não criado |
| Bootstrap |0/272 aplicadas | não executado | não executado |
| Extras | nenhuma | nenhuma | nenhuma |
| Catálogo real279/membership118 | não coletado | não coletado | não coletado |
|334pgTAP |0 executadas |0 executadas |0 executadas |
| RPCs naturais/pré-locks/deadlocks | não executados | não executados | não executados |
| Replay/retomada/revogação/orçamento/ACL/RLS | não executados | não executados | não executados |
| SQLSTATE/waits/desempenho | não medidos | não medidos | não medidos |

Não houve SQLSTATE ou40P01: falha Python anterior ao SQL. Quatro FAIL históricos
local/externo continuam preservados, sem reexecução nem alteração de expectativas.
Contrato052 continua sem confirmação de membership/módulo/coleta PostgreSQL real;
correção combinada funcionalmente indeterminada, nenhuma garantia global.

## Encerramento e residente

Antes do stop: mountinfo/logs/metadata persistidos, ausência de inicialização
confirmada pelo OS. Docker stop --time5 aplicado **somente ao ID novo**; parado,
exit137 devido ao encerramento forçado do shell de espera, OOMKilled=false,
RestartCount0. Sem remoção/reutilização; tmpfs descartado sem banco/dados criados.
Não houve pg_ctl porque não existia postmaster ou cluster.

Históricos preservados, nenhuma rede/volume criado ou modificado; único ID
adicionado foi o novo agora encerrado. DB/Auth healthy e metadados iguais;
somente Vector State/RestartCount mudou pela policy automática preexistente.
Nenhum dado/SQL residente acessado. Sem migrations/políticas/fixtures modificadas,
INV-11/Resident Host/compute pago/gate removido. Scripts novos apenas parametrizam
contexto/nonce/raízes52, reutilizando bootstrap/transporte/comparador existentes.

## Retomada mínima e recomendação

**NO-GO para prosseguir e promover.** Corrigir offline o contrato do guard de
isolamento frente à identidade de device variável do WSL/Docker, sem simplesmente
substituir sde por sdd nem aceitar mounts arbitrários. Exigir proveniência dos
três arquivos gerados para o próprioCID, identidade consistente/provada da fonte,
read-only e ausência de binds/volumes/dados externos; preservar tmpfs/UID/GID/rootRO/
recursos/capabilities e testes adversariais. Revisar/pinar essa correção e repetir
preflight em ambiente novo, só então baseline272→catálogo279/membership118→334pgTAP
→candidatos/matriz049 se gate passar. Não reiniciar investigação de locks/comparador
nem alterar SQL de produto para resolver falha do guard.

Adicionar26d5e1d... completo à lista de nunca reutilizar/iniciar/remover; não existe
cluster ID correspondente. Não retomar os scripts/contextos/nonces desta sessão;
wrappers preparados são evidências de uma campanha interrompida.
Parada após preservação/encerramento autorizado, aguardando revisão humana.

## Git e integridade finais

Git Windows: branch `dev`, HEAD inicial/final
`6bc4aadef9414d655600c2ea37c6be436b3628c8`, índice vazio e as 46 worktrees
idênticas ao snapshot inicial. Permanecem 25 arquivos tracked modificados e
160 entradas untracked agregadas (158 inicialmente); WIPs preservados.
Mudanças desta sessão: checkpoint no PRD e plano 052, este registro e suas
evidências. Nenhum arquivo de implementação/comparador/migration/fixture alterado.
Snapshots completos em `git-before.json` e `git-final.json` nas evidências.
Verificações finais e SHA256SUMS acompanham as evidências; testes offline:
153 PASS e ensaio integral simulado das três variantes GO, com dez controles
negativos NO-GO. Esses resultados offline não substituem o gate PostgreSQL real.

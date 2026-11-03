# Single-Item — guard Docker com dispositivo variável

2026-10-09; desenvolvimento e validação exclusivamente offline. Corrige a
[parada antes de initdb](2026-10-09-single-item-052-prova.md), mantendo o
[contrato 052](../planos/052-single-item-full-catalog-contract.md).

## Causa, correção e fronteira

O guard confundia o nome volátil `/dev/sde` com uma propriedade de isolamento.
O snapshot arquivado usa `/dev/sdd`, major:minor `8:48`. A mesma origem Docker
por CID/arquivo e flags RO estava presente. Nenhum snapshot foi reescrito.

Somente `bootstrap_tmpfs_preflight.py` e seus testes foram alterados. O parser
conserva major:minor e recusa identidade malformada. Os três mounts gerados são
obrigatórios e exclusivos: `/etc/hosts`, `/etc/hostname`, `/etc/resolv.conf`.
Cada um exige inspect `<Key>Path=/var/lib/docker/containers/<CID64>/<arquivo>`
e kernel root `/data/docker/containers/<mesmo CID>/<mesmo arquivo>`, conforme
o mapeamento de namespaces observado no Docker Desktop. Exige ext4, fonte
`/dev/sd[a-z]+`, major 8, mesma dupla major:minor/fonte nos três mounts,
flags exatas `ro,relatime` e superOptions `rw` (filesystem de suporte gravável,
view do arquivo RO). Nenhuma origem arbitrária, filesystem ou outro padrão de
dispositivo é aceito. Compatibilidade com NVMe/mapper/outro layout não aprovada.

Essa checagem reconcilia evidências do daemon e do kernel confiáveis; não prova
identidade física do disco nem resistência a um daemon/host comprometido.
Namespacing do CID e arquivos, ausência de binds declarados, allowlist e RO são
as garantias pertinentes; fixar uma letra do disco não acrescentava isolamento.

TMPFS exatos (tamanho, modos, UID/GID, nosuid/nodev/noexec), root overlay RO,
ausência de mounts adicionais, binds/volumes/VolumesFrom continuam exigidos.
O executor existente continua validando network none, portas/volumes ausentes,
imagem/ambiente/identidade, 1 CPU/1 GiB sem swap extra/64 PIDs, cap-drop ALL,
no-new-privileges e demais controles antes/depois do guard. Nenhum outro guard,
executor, migration, fixture, orçamento ou comparador alterado.

## Provas e evidências

[Diff e logs](2026-10-09-single-item-guard-docker-evidencias/).
Replay offline utiliza inspect e mountinfo integrais arquivados, sem substituir
tokens ou sintetizar a origem. Testes aceitam dispositivos sdd/sde/sdaa coerentes
e recusam arquivo RW, rootfs RW, origem falsa, CID errado, path inspect falso,
tipo/device inesperado, backing device inconsistente, arquivo obrigatório ausente,
mount extra, tmpfs ausente/divergente, permissões e binds/volumes indevidos.

## Retomada exata após revisão humana

1. Revisar o diff e o pin novo do guard registrado nas evidências. Os pacotes
   052r2/manifests/payloads continuam congelados; não repinar migrations ou
   comparador nem usar uma cópia antiga do guard. O bootstrap transportador
   deve importar este guard revisado e registrar seu hash no novo contexto.
2. Fazer o preflight integral 052: Git Windows, 46 worktrees/WIPs, 2484 arquivos,
   156 migrations, 556 hashes, imagem pinada, recursos, DB/Auth e exceção Vector
   somente se novamente comprovada. Nenhuma saúde atual foi inferida nesta sessão.
3. Identificar e excluir de reutilização todos os históricos, incluindo
   `26d5e1d5599d1baee3dda2b8777240b499118a449f3d08ee4f4e0af909407e10`.
   Criar nonce/contexto/container novos; não executar scripts com IDs antigos.
4. Baseline único: validar declarações e mountinfo real com guard novo ANTES
   de initdb; qualquer divergência NO-GO. Só então bootstrap 272, coleta integral
   279 e membership individual 118 por pg_depend. Gate real deve preceder pgTAP.
5. Se gate baseline passar, matriz 049/052 com até dois candidatos independentes
   sequenciais, 334 asserções por variante e quatro FAIL históricos visíveis,
   RPCs naturais/pré-locks separados, orçamento/revogação/replay/rollback/cleanup.
   Preservar evidências e encerrar apenas os novos. Não promover nem liberar gate.

Nenhum Docker, container, SQL, residente, serviço pago, INV-11 ou Resident Host
executado nesta sessão. Gate `single_item_atomic_claim_unavailable` preservado.
Sem staging/commit/push/reset/clean/prune. Parada para revisão humana antes de
qualquer ambiente PostgreSQL; GO offline não equivale a GO operacional/funcional.

## Reprodução offline e Git

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s supabase/tests -p 'bootstrap*_test.py'
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s supabase/tests -p 'single_item*_test.py'
PYTHONDONTWRITEBYTECODE=1 python3 docs/registros/2026-10-09-single-item-guard-docker-evidencias/verify-frozen-offline.py
```

Git Windows antes/depois: `dev`, HEAD
`6bc4aadef9414d655600c2ea37c6be436b3628c8`, índice vazio, as 46 worktrees
idênticas; snapshots completos nas evidências. WIPs preservados. Sem commits.
Arquivos alterados nesta sessão: guard e seu teste, checkpoint PRD/plano052,
novo registro e diretório de evidências. Logs/pins/diffs/SHA256SUMS são duráveis.
Integridade PASS: 2484 arquivos052r2,156 migrations,556 bootstrap,3253protegidos;
review e evidências antigas052 intactas. Bootstrap:33PASS (20,437s na execução
arquivada). Replay real arquivado é teste offline; não é nova observação do host.

Single-Item: **153PASS (236,121s)**. Resultado **GO offline** do guard;
NO-GO para criação automática nesta sessão, aguardando revisão humana.
Os gates operacionais e funcionais continuam pendentes de PostgreSQL real.

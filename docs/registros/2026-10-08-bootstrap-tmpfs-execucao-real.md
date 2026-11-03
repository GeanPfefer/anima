# Bootstrap — tmpfs efetivos e execução real (2026-10-08)

Tipo: desenvolvimento e prova. Branch dev; HEAD inicial/final
`6bc4aadef9414d655600c2ea37c6be436b3628c8`; nenhum commit/staging/push/limpeza.
Mandato humano: corrigir exclusivamente coleta/validação tmpfs, continuar somente
no container autorizado running sem cluster; parar na primeira falha.

## Correção e testes

[Diff exato de helper/testes/executor](2026-10-08-bootstrap-tmpfs-preflight.diff).
HostConfig.Tmpfs exige os dois destinos e opções exatos, HostConfig.Mounts vazio,
sem Binds/VolumesFrom; Mounts Docker ausente só aceito com prova kernel independente.
Mountinfo exige caminhos canônicos (socket /var/run→/run/postgresql), tmpfs raiz /,
tipo/origem tmpfs, size 512/16 MiB, modos 700/770, uid105/gid106,
rw/nosuid/nodev/noexec/relatime; stat e readlink confirmam caminhos e permissões.
Overlay raiz obrigatoriamente ro. Mount adicional desconhecido recusado;
somente pseudo-filesystems privados e arquivos Docker de host/hostname/resolv
read-only do próprio ID são conhecidos. Mounts normalizados são derivados da
prova kernel depois dessas validações, nunca só da configuração declarada.
Guardas de ambiente/labels por digest/rede/ports/UID/privilégios/namespaces/limites/
restart e identidade preservadas. 1 CPU, 1 GiB, 64 PIDs; nenhum aumento.
66 testes offline PASS (16 preflight, sendo 5 novos tmpfs; 25 fronteiras existentes;
25 bootstrap). Nenhum teste offline constitui prova PostgreSQL.
Sem typecheck/build: escopo Python/preflight/documentação.

## Prova PostgreSQL e ledgers

**GO somente para bootstrap/inspeção estrutural**. Container existente exclusivo
`8d76d3358c55a155f5824c7a65d2c28ab8afad600ddd8baa1d430896ae600402`; nenhum create/remove/start/restart nesta sessão.
Imagem `sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b`.
Nonce 396f38b1036a47ba92d51890cdf252ba. Cluster novo **7694431622913864120**, diferente do perdido
7694231349084414139. Initdb manual com auth-host reject, auth-local trust,
UTF8/locale C; postmaster só socket interno, listen_addresses vazio.
Conexões env -i/psql -X, host/socket/user/database/ID completos explícitos.
Git/fontes/recursos/isolation baseline PASS antes de initdb; 272 payloads e
556 hashes verificados antes e depois; migrations/payloads/budget não alterados.
Plan SHA256 `6ffde5c0bd689c4473c9c1186c97853fb07c5c5d9dcaa8d254d41a0f5596ee13`.

Etapas 246/247/248: confirmadas no PostgreSQL e no ledger.
Esta prova exerce a sequência fresh do bootstrap, não todos os ramos de replay
ou definição desconhecida dos testes offline.

Progresso real: 272/272 etapas confirmadas, 0 pendentes além de
0 etapa falhada. Ledger audit com 272 linhas, prefixo
exato/roles/run/hashes reconciliados antes/depois de cada payload.
Ledger Auth com 76 versões: 7 legadas + 69 oficiais,
comparadas exatamente com o plano. Payload/corpo e ambos os ledgers (Auth quando
aplicável) no mesmo BEGIN/COMMIT, sem ON CONFLICT ou retry.
Nenhuma falha SQL/identidade/ACL/hash/isolamento.

Nenhum retry de etapa, patch SQL improvisado ou bypass de segurança.
Catálogos estruturais coletados somente se bootstrap completo; funções/assinaturas/
owner/search_path/hash/prosecdef/ACL, schemas, RLS/policies/triggers e extensões.
Não foi invocada RPC de aplicação ou prova comportamental. Evidência de execução
não demonstra deadlock-freedom, replay adversarial, orçamento dinâmico ou
concorrência. Inspeção estrutural completa permanece pendente se houve falha.

## Residente, efeitos e fronteira humana

Residente supabase_db_anima healthy, antes/depois exatamente igual no snapshot
sanitizado, sem restart/configuração/SQL. Antigo 750bde88... parado/intocado.
Sem containers/volumes/redes criados/removidos. Sem fixtures/pgTAP/concorrência,
INV-11, Resident Host, compute pago ou segredo residente reutilizado.
Gate single_item_atomic_claim_unavailable mantido. WIPs/worktrees preservados;
PRD/plano por apêndice. Próximo ponto é revisão humana da prova/primeira falha;
nenhum teste comportamental ou correção canônica automaticamente autorizado.

Evidências duráveis sem credenciais:
`G:\anima-provas\bootstrap-396f38b1036a47ba92d51890cdf252ba-tmpfs`: executor, plano, logs por etapa,
identidade/cluster, tmpfs kernel, ledgers audit/Auth, resultado/falha se houver,
catálogos se completo, recursos antes/depois, Git, diffs e SHA256SUMS.
[Plano](../planos/043-single-item-governed-execution-v0.md) ·
[Procedimento](../../supabase/tests/bootstrap_reconstruction.md) ·
[Parada anterior](2026-10-08-bootstrap-recuperacao-parada-mounts.md).


## Complemento factual da inspeção e dos recursos

Single-Item: assinatura uuid/integer/uuid/text/integer, owner postgres, SECURITY
DEFINER, search_path=pg_catalog e hash prosrc exatamente igual ao corpo canônico
`9ebad7ff52309bf9da3a1877fd454313856aec542b0ea17b30d68a6d5f8bf8d4`.
EXECUTE authenticated=true, anon=false, service_role=false; ACL sem PUBLIC.
RLS ativo em work_items/work_claims/work_events; triggers relacionados habilitados,
incluindo enforce_autonomous_intelligence_on_claim e
enforce_autonomous_work_budget_before_start. Isso não prova seu comportamento.

Vector apresentava restarting/unhealthy antes e depois; RestartCount passou de
87 para 93 (+6), com novos StartedAt/FinishedAt, sem OOM. Sua configuração ficou
inalterada; não houve operação do executor sobre ele. É instabilidade observada
preexistente com reinicializações automáticas durante a janela, não alteração
configurada pela prova. Não se atribui causa ao bootstrap sem evidência.
O banco residente supabase_db_anima permaneceu healthy e inteiramente igual no
snapshot sanitizado, inclusive StartedAt/PID/RestartCount; nenhum recurso
persistente foi adicionado/removido ou teve configuração alterada.

# Bootstrap — recuperação do container e parada de mounts (2026-10-08)

Tipo: desenvolvimento e tentativa de prova. Branch dev; HEAD inicial/final
`6bc4aadef9414d655600c2ea37c6be436b3628c8`. Sem commits/staging/push/limpeza.
Mandato: corrigir labels OCI/logging, reutilizar somente o container autorizado;
272 payloads pinados, parada na primeira falha, sem alterações canônicas.

## Correções e testes

[Diff exato da sessão](2026-10-08-bootstrap-recuperacao-preflight.diff).
Preflight aceita somente os dois labels OCI conhecidos quando a Config.Labels da
imagem por digest corresponde exatamente; prova exige os dois labels/nonce exatos.
Sem metadados da imagem, OCI extras são recusados. Outros labels, valores ou imagem
errados falham fechado. Rede/storage/privilégios/limites/identidade preservados.
Pré-start valida estado created, StartedAt zero/PID zero/restarts zero e destinos
HostConfig.Tmpfs; pós-start continua exigindo mounts tmpfs efetivos em inspect.
Config.Volumes null é ausência de volumes, mantendo recusa de volumes inesperados.
Logging extraído em bootstrap_event_log.py: append/flush/fsync, utc reservado do
host, nenhuma duplicação de campo ou mutação do objeto de primeira falha.

61 testes determinísticos PASS: 7 ambiente + 4 recuperação + 25 fronteiras
existentes + 25 bootstrap. Testes de labels exatos/ausentes/alterados/extras,
imagem divergente, created vs running e registro de primeira falha incluídos.
São somente offline; não provam PostgreSQL, ACL, RLS ou rollback.
272 fontes/payloads e 556 hashes revalidados antes da execução, sem alterações.
Plan SHA256 `6ffde5c0bd689c4473c9c1186c97853fb07c5c5d9dcaa8d254d41a0f5596ee13`.
Imagem digest `sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b`.
Sem typecheck/build, escopo exclusivamente Python/preflight/documentação.

## Progresso factual e primeira parada

Container exclusivo `8d76d3358c55a155f5824c7a65d2c28ab8afad600ddd8baa1d430896ae600402`,
nonce `396f38b1036a47ba92d51890cdf252ba`. Comparação com inspect anterior comprovou
Config/HostConfig/Imagem/ID/nome/estado/Created/Mounts/restarts inalterados.
Labels por imagem efetiva, ambiente, Git/fontes/recursos e pré-start PASS.
Iniciado somente esse ID, sem criação/remoção/restart ou alteração de configuração.
Mantidos 1 CPU, 1 GiB, memory-swap 1 GiB, 64 PIDs, rede none/sem portas,
rootfs read-only, dois tmpfs privados, usuário postgres, drop ALL/no-new-privileges,
restart no e entrypoint manual aguardando marcador .proof_ready.

**NO-GO** pós-start, antes de initdb: `tmpfs only, including PGDATA, required`.
Docker inspecionado retorna Mounts=[] mesmo com tmpfs configurados. Diagnóstico
somente leitura de /proc/self/mountinfo confirma tmpfs efetivos:
PGDATA /var/lib/postgresql/data 512 MiB, modo 700 uid105 gid106;
socket /run/postgresql 16 MiB, modo770 uid105 gid106, ambos rw/nosuid/nodev/noexec;
rootfs efetivo ro. /var/run/postgresql resolve ao destino /run/postgresql na imagem.
A evidência de OS confirma os mounts; o validador corrente depende de outra
representação. Isso é limitação de coleta/validação, não ausência comprovada de
isolamento. Guarda não relaxada, nenhum retry/SQL ou correção improvisada.

Estado final running, entrypoint aguardando marcador; **initdb nunca executado**.
Cluster ID inexistente. 0 etapas aplicadas, 272 pendentes, zero falhas SQL;
SQLSTATE não aplicável. Nenhum ledger SQL criado; atomicidade não observada.
Inspeção estrutural do schema não realizada porque não existe cluster.
Logging corrigido registrou primeira parada no events.jsonl; failure/result,
executor e snapshots foram persistidos sem erro secundário.

## Segurança, efeitos e retomada

Residente supabase_db_anima healthy antes/depois, mesmo ID/estado/configuração,
sem reinicialização ou mudança observada. Só o container autorizado mudou estado
(created→running) e seu endpoint none; sem volumes/redes/containers adicionados ou
removidos. Container antigo 750bde88... permanece parado e byte-a-byte igual no
snapshot sanitizado. Sem conexão SQL residente, credenciais herdadas, fixtures,
pgTAP, concorrência, INV-11, Resident Host, compute pago ou alteração de gate.
Gate single_item_atomic_claim_unavailable mantido; WIPs e worktrees preservados.
PRD/plano atualizados por apêndice; bytes anteriores mantidos.

Evidências sem segredos em
`G:\anima-provas\bootstrap-396f38b1036a47ba92d51890cdf252ba-recovery`:
result/failure/events, imagem por digest, baseline/inspect, recursos antes-depois,
mountinfo/diagnóstico OS, executor original da sessão/diff, hashes, Git e testes.
Ver [plano](../planos/043-single-item-governed-execution-v0.md),
[procedimento](../../supabase/tests/bootstrap_reconstruction.md) e
[parada anterior](2026-10-08-bootstrap-preflight-parada-identidade.md).

BLOCKED_BY_HUMAN_DECISION: revisar a parada e autorizar eventual coleta de mounts
via evidência OS integrada ao preflight, com validação estrita dos caminhos,
symlinks, tipo/origem, opções/limites/owner e recusa de definições desconhecidas;
não sintetizar Mounts a partir apenas da configuração declarada. Reutilização
só deste container exige novo preflight de running sem cluster/marcador existente;
sem novo start/restart/criação/remoção presumidos. Bootstrap continua pendente,
nenhuma prova comportamental ou gate liberado.

# Bootstrap — correção estrita de ambiente e parada de identidade (2026-10-08)

Tipo: desenvolvimento e tentativa de prova. Branch `dev`; HEAD inicial/final
`6bc4aadef9414d655600c2ea37c6be436b3628c8`. Nenhum commit, staging, push ou limpeza.
Mandato: corrigir somente allowlist de ambiente e criar exatamente uma prova;
parar na primeira falha SQL/ACL/identidade/integridade. WIPs/worktrees preservados.

## Correção e testes

[Diff exato desta sessão](2026-10-08-bootstrap-preflight-ambiente.diff).
Preflight distingue defaults públicos da imagem e overrides explícitos da prova.
Locale/PATH só nos valores pinados; POSTGRES_HOST só `/var/run/postgresql`;
USER postgres, DB nonce, trust local. Recusa duplicatas, ausências, desconhecidas,
credenciais/libpq e destinos TCP/remotos. Guarda de labels/identidade não relaxada.
Teste antigo usa o novo ambiente exato; sete novos casos determinísticos.
7 preflight + 25 fronteiras existentes + 25 bootstrap = 57 testes offline PASS.
Nenhum deles prova semântica PostgreSQL, ACL, rollback ou concorrência.
272/272 fontes/roles/ordem e 556/556 hashes PASS; pacote/payloads/migrations intactos.
Plan SHA256 `6ffde5c0bd689c4473c9c1186c97853fb07c5c5d9dcaa8d254d41a0f5596ee13`.
SHA256SUMS SHA256 `1ecb76f006b1ee0f17b2ca9922f8f2a4727479ea1180c01e8d7a26f3ec82f1ab`.
Sem typecheck/build: mudança exclusivamente Python/preflight/documentação.

## Efeito externo e primeira falha

Preflight de Git/fontes/imagem/daemon/recursos PASS. Imagem digest
`sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b`.
4.29 GiB físicos livres; Docker total 7.69 GiB e uso estimado 1.54 GiB.
Criado exatamente um container:
`8d76d3358c55a155f5824c7a65d2c28ab8afad600ddd8baa1d430896ae600402`.
Nome `anima-single-item-proof-396f38b1036a47ba92d51890cdf252ba`.
Estado `created`, nunca iniciado. Rede none, sem portas/volumes/binds; dois tmpfs,
rootfs read-only, usuário postgres, cap-drop ALL, no-new-privileges, restart no,
1 CPU, 1 GiB, sem swap adicional, 64 PIDs. Entrypoint manual substitui auto-init.
Ambiente efetivo passou no validador corrigido em inspeção diagnóstica.

**NO-GO**: `proof labels mismatch` antes de start/initdb/SQL. Docker herdou da
imagem pinada os labels `org.opencontainers.image.ref.name=ubuntu` e
`org.opencontainers.image.version=20.04`, além dos dois labels explícitos.
A guarda existente exige igualdade exata apenas com os labels da prova. Não foi
relaxada ou contornada. Não houve outra criação, start, remoção ou retry.
Cluster ID inexistente; 0 etapas concluídas, 272 pendentes, 0 falhas SQL;
SQLSTATE não aplicável. Ledgers SQL não criados; atomicidade não foi observada.
Inspeção estrutural do schema não realizada porque não existe cluster.

Bug secundário do executor temporário: ao registrar a parada, o objeto failure já
contém utc e `dict(utc=stamp(), **failure)` causa TypeError. O finally persistiu
failure/result/comparação/executor; suplemento diagnóstico append-only registra
parada também no events.jsonl. Não houve fallback SQL ou perda da primeira falha.
Corrigir/auditar isso antes de qualquer nova execução; executor original preservado.

## Residente, fronteiras e retomada

Supabase residente saudável, mesmo ID/StartedAt/PID/RestartCount e configuração.
Snapshots comparados: zero mudanças em containers existentes, volumes ou redes;
somente o novo container adicionado. Vector tinha instabilidade preexistente,
sem atribuição causal ou intervenção. Antigo `750bde88...` segue parado e intocado.
Nenhuma conexão SQL residente, segredo reutilizado, fixture, pgTAP, concorrência,
INV-11, Resident Host ou compute pago. Gate `single_item_atomic_claim_unavailable`
preservado. Sem alteração canônica ou tipos factual/regeneração.

Evidências duráveis sem credenciais: diretório host
`G:\anima-provas\bootstrap-396f38b1036a47ba92d51890cdf252ba-exec`:
result/failure/diagnostic-supplement, imagem/contexto/recursos antes-depois,
create-request/ID, inspect criado, eventos e executor original; SHA256SUMS.
Baseline/diff anterior preservados. Ver [plano](../planos/043-single-item-governed-execution-v0.md)
e [procedimento](../../supabase/tests/bootstrap_reconstruction.md).

BLOCKED_BY_HUMAN_DECISION: revisar a parada. Próximo ponto exato: autorizar eventual
correção restrita do contrato dos labels herdados e a destinação do container
criado, sem presumir permissão de start/remoção/nova criação; revisar executor,
metadados pré-start (tmpfs só aparece após montagem) e geração de eventos antes
de qualquer retomada. Não há GO PostgreSQL ou liberação comportamental.

# Single-Item V1 — preflight das provas interrompido por destino (2026-10-08)

Tipo: preparação de prova, sem testes SQL ou escritas. Branch dev; HEAD inicial/final
`6bc4aadef9414d655600c2ea37c6be436b3628c8`; nenhum commit/staging/push/limpeza.
Mandato: fixtures sintéticas/pgTAP/concorrência só após preflight íntegro; destino
literal informado pelo usuário é banco postgres no container/cluster anteriores.

## Identidade, isolamento e divergência

Container exclusivo `8d76d3358c55a155f5824c7a65d2c28ab8afad600ddd8baa1d430896ae600402`;
cluster `7694431622913864120`, PostgreSQL 15.8, conexão env-i/socket interno.
Imagem por digest/labels, tmpfs Docker+kernel/stat/readlink, Config/HostConfig/State,
limites/privilégios/rede/ports/namespaces/restarts comparados com baseline da prova
anterior; inalterados. Pacote 272 fontes/payloads e 556 hashes íntegros.
Banco residente healthy, antes/depois mesmo ID/estado/StartedAt/PID/RestartCount
/configuração (hash sem exportar credenciais); nenhuma conexão SQL residente.
Nenhum container foi modificado/iniciado/reiniciado/removido/criado.

**NO-GO antes de fixtures/testes**: query read-only no banco explicitamente
informado, postgres, retorna to_regclass(bootstrap_audit.steps)=NULL e
acquire_single_item_work_claim=NULL; apenas public/information_schema além de pg_*.
A evidência durável do bootstrap anterior identifica o banco realmente migrado
como `anima_single_item_proof_396f38b1036a47ba92d51890cdf252ba`, no mesmo cluster.
Seus 272 registros foram comprovados anteriormente, não novamente nesta sessão:
o destino exclusivo informado impede redirecionamento implícito das provas.
Não copiar/reaplicar schema no postgres nem trocar database silenciosamente.
Consulta não gerou erro SQL: SQLSTATE não aplicável. Falha de configuração do
destino/preflight, não falha RPC, orçamento, baseline comportamental ou pgTAP.

Disponibilidade empacotada real em pg_available_extensions: pgTAP 1.2.0 e vector
0.8.0; não se afirma instalação/funcionamento de pgTAP neste banco sem prova.
Pergunta de esclarecimento enviada: usar banco com nonce ou manter postgres e
interromper. Resposta ainda pendente; nenhuma ação dependente executada.

## Auditoria estática e contagem

Inspecionados single_item_work_claim.test.sql, helpers, protocolo e runner
single_item_concurrency.py. 13 suítes indicadas pelo protocolo, 334 asserções
planejadas, todas terminam em ROLLBACK; Single-Item tem 55 asserções. Executadas 0,
aprovadas 0, falhadas 0, não executadas 334. Não houve pgTAP, fixture, limpeza ou
sessão concorrente; não se classifica desconhecimento como PASS.

| Cenário | Evidência nesta sessão |
|---|---|
| same_item | não executado — preflight de destino bloqueado |
| same_target | não executado — preflight de destino bloqueado |
| mixed_global | não executado — preflight de destino bloqueado |
| budget | não executado — preflight de destino bloqueado; nenhuma falha conhecida ocultada |

Atomicidade/isolamento entre usuários/classificação/orçamento/rollback/deadlocks
comportamentais continuam não provados. Isolamento físico verificado não substitui
esses testes. O runner exige banco nonce e ainda coleta inspect.Mounts/labels via
validate sem imagem/kernel; transporte real deve integrar guardas efetivas já
comprovadas e usar docker.exe explícito/env-i/ID+cluster, sem afrouxá-las.
Fixtures concorrentes não existem em arquivo executável preparado: requerem UUIDs
sintéticos com verificação de ausência/escopo e fatos correlacionados no schema
correto; cleanup só nesse escopo, preservando todo estado preexistente.
Nenhum código/teste/migration/payload foi alterado para verde; apenas documentação.

## Fronteira e retomada

WIPs/worktrees preservados; PRD/plano por apêndice. Gate
single_item_atomic_claim_unavailable mantido; sem INV-11/Resident Host/compute pago.
Evidência host `G:\anima-provas\single-item-7694431622913864120-preflight`:
catálogo read-only postgres, controle cluster, mountinfo, resultado, residente
antes/depois sem segredos, hashes e Git. Ver
[prova bootstrap](2026-10-08-bootstrap-tmpfs-execucao-real.md),
[plano](../planos/043-single-item-governed-execution-v0.md) e
[protocolo](../../supabase/tests/single_item_concurrency.md).

BLOCKED_BY_HUMAN_DECISION apenas para definir o banco de destino. Após resposta
que confirme banco migrado, retomar preflight atualizado, ledger/identidade/extensões
naquele banco, transporte/fixtures/cleanup revisados; somente então executar as
suítes e quatro disputas, guardar falhas reais e não liberar gate/INV-11.

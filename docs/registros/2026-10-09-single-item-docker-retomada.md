# Single-Item V1 — Docker iniciado, preflight residente degradado

2026-10-09. Diagnóstico/retomada operacional autorizada.
[Snapshot sanitizado](2026-10-09-single-item-docker-retomada-snapshot.json).
[Parada anterior](2026-10-09-single-item-comparativa-preflight.md),
[matriz 046](../planos/046-single-item-lock-strategy-proof.md),
[roteiro 047](../planos/047-single-item-claim-lock-candidate.md).

## Resultado

**NO-GO operacional antes de criar descartáveis.** Docker Desktop iniciado por
Start-Process conforme autorização explícita. Nenhum comando de start/restart/
stop/remove dirigido a container existente. O daemon restaurou automaticamente
serviços residentes conforme restart policies; esses efeitos do início do Desktop
foram observados, não ocultados como “nenhum serviço iniciado”. Nenhum SQL executado.

Docker Desktop 4.94.0, daemon 29.8.2, context desktop-linux,
ID 18caadf3-1887-45ef-857e-4e71fcef77e9, 16 CPUs, 8.259.198.976 bytes RAM.
Limites RAM/CPU/PIDs suportados. RAM física Windows livre final 5.570.200 KiB.
Stats iniciais dos oito serviços running somavam cerca de 1,61 GiB (aproximação de
valores arredondados; não equivale à memória livre do kernel do daemon).
Proposta permanece sequencial, 1 CPU/1 GiB/64 PIDs, tmpfs PGDATA 512 MiB/socket 16 MiB.
Nenhum limite de container foi modificado.

Supabase DB (`252bbef3…`) running/healthy, restartCount 0, postmaster/container
iniciado 07:15:38 UTC. Auth healthy após estabilização, restartCount 7. Studio,
pg_meta, realtime, kong e analytics reportaram healthy. REST running sem healthcheck.
**Vector (`aa6e4d0e…`) restarting/unhealthy**, contador 9→10→11 nas verificações,
policy unless-stopped, healthcheck com connection refused 127.0.0.1:9001. Logs de
healthcheck já registravam falhas em 08/10, antes desta prova. Não inferir causa raiz
nem atribuir ao candidato, que não foi aplicado. Edge runtime exited desde 04/10,
policy no, sem tentativa de inicialização pelo agente.

A autorização de criação era condicional ao preflight completo passar. A saúde
integral do residente não passou; o agente não promoveu silenciosamente “DB healthy”
a “Supabase saudável”, nem modificou o residente para corrigir esse bloqueio.
Integridade de dados/esquema residente não foi certificada por uma consulta SQL;
snapshot de metadata não prova equivalência de catálogo/dados.

Os dois anteriores full IDs 8d76d3358c55a155f5824c7a65d2c28ab8afad600ddd8baa1d430896ae600402
e 750bde88fb3bb87ed9e1892e9c6323974a42ab0526f95ef12954c988694b134e estão exited,
restartCount 0, network none, ports {}, binds null, tmpfs declarados, Mounts[].
Estado encerrado não permite provar tmpfs efetivo/dados preservados. Não foram
iniciados/reutilizados/removidos; não se tenta recuperar cluster deles.

## Integridade e testes

Imagem local confirmada pelo ID
sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b;
labels OCI ubuntu/20.04 esperados; nenhum pull. Plataforma/ambiente completo da
imagem não chegaram a ser revalidados neste preflight incompleto; ID local confirmado
não é por si validação integral do protocolo de criação.
Bootstrap: 272/272 fontes/ordem/payloads conferidos e 556 hashes sem divergência.
154 fontes Anima equivalem ao baseline congelado do contrato. Plan SHA256
6ffde5c0bd689c4473c9c1186c97853fb07c5c5d9dcaa8d254d41a0f5596ee13.
Candidato SHA256 0fdb36b28c7bacfb534a943bea2bbb5a812938295ad5c185cb7faadbe0df8b72
coincide; somente dois corpos, histórico/headers/regras e harness preservados.

84 testes Single-Item offline PASS, exit 0, 6,919 s. Não repetidos os 25 bootstrap
compatibility desta retomada; 272 etapas e 556 hashes foram revalidados agora.
Nenhum flake offline observado. Consultas Go-template auxiliares tiveram erros por
health ausente no edge runtime e por CpuCfsQuota não disponível como campo Go;
substituídas por leitura JSON sanitizada, sem omitir serviços nem relaxar guardas.
Isso não é falha SQL/harness concorrente.

## Matriz desta retomada

| Prova | Baseline | Candidato |
|---|---|---|
| Ambiente novo/cluster | Não criado | Não criado |
| Bootstrap real | 0/272 | 0/272 |
| Migration candidata | Não aplicável | Não aplicada |
| Catálogo/assinaturas/owner/grants/ACL/RLS/triggers PostgreSQL | Não consultados | Não consultados |
| pgTAP 334 planejadas, incluindo 55 + 123 | 0 emitidas | 0 emitidas |
| Mesmo item: acquire/start/release/replay | Não executado | Não executado |
| Foreign owner/claim/expiry/simultaneidade | Não executado | Não executado |
| Controle positivo original 40P01 | Não executado | Não executado |
| Negativos deadlock e orçamento P0001/rollback | Não executados | Não executados |
| Lock waits/p95/throughput | Não medidos | Não medidos |

SQLSTATE novos: nenhum. Histórico 40P01 não conta como controle positivo desta
comparação. Não há evidência para GO ou rejeição técnica da migration; riscos
residuais e orçamento local/externo seguem distintos, conforme ADR/046/047.

## Git, efeitos e retomada

Windows branch dev, HEAD inicial/final 6bc4aadef9414d655600c2ea37c6be436b3628c8.
Inicial 24 tracked modificados, 118 entradas untracked, índice vazio, 46 worktrees.
Final 24 tracked modificados, 120 entradas untracked, índice vazio, 46 worktrees.
Sem commits; mudanças desta sessão apenas registro/snapshot e adendos PRD/047.
WIPs/worktrees, migrations, fixtures/runners, orçamento e gate preservados.

Efeito externo autorizado: início do Docker Desktop. Nenhum create/remove/reuse de
container, SQL, credencial residente, migration aplicada, Resident Host, INV-11,
compute pago, staging/commit/push/reset/clean/prune. Docker foi deixado disponível;
não foi encerrado para evitar efeitos adicionais nos serviços residentes.

Próximo ponto exato: resolver/revisar a condição residente Vector unhealthy sob
mandato separado, ou obter decisão humana explícita sobre se essa degradação
preexistente pode ser excluída do gate operacional desta prova SQL. Não ampliar
a autorização desta prova para manutenção de containers residentes. Repetir Fase 1
com snapshot estável antes de criar os dois destinos sequenciais. Autorização de
comparação e início do Desktop já registrada; não solicitar repetição dos atos
já autorizados. Gate Single-Item ativo; produto permanece NO-GO.

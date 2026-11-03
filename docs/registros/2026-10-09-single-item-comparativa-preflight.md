# Single-Item V1 — prova comparativa parada no preflight

2026-10-09. Tipo: diagnóstico/preflight e verificação offline.
Autorização do usuário: criar/provar baseline e candidato somente se preflight
operacional passar, sem modificar residente ou containers anteriores.
**NO-GO antes de criar ambiente. Nenhuma prova PostgreSQL executada.**
[Dados individuais do preflight](2026-10-09-single-item-comparativa-preflight.json).
[Roteiro 047](../planos/047-single-item-claim-lock-candidate.md) e
[matriz 046](../planos/046-single-item-lock-strategy-proof.md).

## Bloqueio e estado operacional

Docker Desktop/backend sem processos encontrados; cliente Windows 29.8.2,
context desktop-linux, Server=null. `docker version` e `docker ps -a --no-trunc`
falharam ao abrir `dockerDesktopLinuxEngine`, erro “O sistema não pode encontrar
o arquivo especificado”, exit 1. Nenhum daemon iniciado automaticamente.
Sem Docker não foi possível confirmar imagem local por ID, inspecionar containers
anteriores, memória/CPU disponíveis ao daemon, mounts efetivos ou saúde residente.
Não declarar residente healthy, parado ou modificado a partir desse erro.
Nenhuma credencial residente usada, nenhuma consulta SQL ou alteração de seus recursos.

Host Windows: RAM total 16.643.156 KiB, livre 10.343.888 KiB (cerca de 9,86 GiB).
WSL: RAM total 8.065.624 KiB, disponível 7.356.440 KiB (cerca de 7,02 GiB).
Esses valores não validam capacidade do daemon Docker. Protocolo anterior limita
cada descartável a 1 CPU/1 GiB/64 PIDs, PGDATA tmpfs 512 MiB e socket tmpfs 16 MiB;
execução sequencial permanece recomendada, com headroom residente a verificar.
Imagem esperada af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b;
nenhum pull. Antigo full ID 8d76d3358c55a155f5824c7a65d2c28ab8afad600ddd8baa1d430896ae600402
não foi iniciado, reutilizado nem removido; estado atual não inspecionável.

## Integridade e cobertura offline

- Verificador: 272/272 fontes/ordem e payloads PASS; somente 247/248 têm diferenças
  históricas intencionais já documentadas. Plan SHA256 no JSON.
- SHA256SUMS: 556 hashes conferidos, zero divergências.
- As 154 migrations históricas pinadas do candidato correspondem exatamente às
  154 fontes Anima do bootstrap congelado. A lacuna de reconciliação de bytes
  baseline versus bootstrap do Plano 047 foi verificada; não repetir migrations.
- Hash candidato 0fdb36b28c7bacfb534a943bea2bbb5a812938295ad5c185cb7faadbe0df8b72
  coincide com contrato. Somente duas funções OR REPLACE; baseline íntegro,
  assinaturas/headers/regras originais e restrição de alterações passaram offline.
- 84 testes Single-Item PASS, exit 0, 6,758 s; 25 bootstrap compatibility PASS,
  exit 0, 15,919 s. Nenhum flake offline observado.

Comandos: `PYTHONDONTWRITEBYTECODE=1 python3 supabase/bootstrap/verify_sources.py`,
`python3 -m unittest discover -s supabase/tests -p 'single_item*_test.py'` e
`python3 -m unittest discover -s supabase/tests -p 'bootstrap_compatibility_test.py'`,
ambos unittest também com PYTHONDONTWRITEBYTECODE=1. Scanner/testes não compilam SQL
nem provam catálogo, isolamento operacional, RLS/ACL, concorrência ou desempenho.

## Matriz baseline versus candidato desta sessão

| Prova | Baseline | Candidato |
|---|---|---|
| Bootstrap real | 0/272 executadas | 0/272 executadas |
| Aplicação corretiva | Não aplicável | Não aplicada |
| Catálogo/RLS/grants/triggers real | Não consultado | Não consultado |
| Controle positivo 40P01 | Não executado | Não executado |
| Acquire/start/release/foreign/expiry | Não executados | Não executados |
| Orçamento e rollback | Não executados | Não executados |
| pgTAP 334 planejadas (55 Single-Item + 123 históricas incluídas) | 0 emitidas | 0 emitidas |
| Lock wait/tempo/throughput/p95 | Não medidos | Não medidos |

SQLSTATE coletados nesta sessão: nenhum; falha de transporte Docker não é SQLSTATE.
40P01/55000/P0001 históricos permanecem no registro de 08/10 e não são novos resultados.
Divergência de orçamento local/externo continua separada. Nenhuma falha de fixture
ou runner SQL nova observada, porque estes não foram executados.

## Git, efeitos e ponto de retomada

Git Windows: branch dev; HEAD inicial/final
6bc4aadef9414d655600c2ea37c6be436b3628c8. Inicial 24 tracked modificados,
116 entradas untracked, índice vazio, 46 worktrees. Final 24 tracked modificados,
118 entradas untracked, índice vazio, 46 worktrees. WIPs preservados; nenhum commit.
Mudanças da sessão somente este registro/JSON e adendos PRD/Plano 047.
Migrations, orçamento, harness e execução governada sem edições nesta sessão.

Sem create/start/remove/reuse de container, SQL, residente, Host/INV-11, compute
pago, staging/commit/push/reset/clean/prune. Gate single_item_atomic_claim_unavailable
mantido. Autorização condicional de criação/provas não foi usada, pois preflight falhou.

Retomada mínima: tornar Docker Desktop disponível sob operação humana e repetir
Fase 1: daemon/context/imagem local, inventário/snapshot sanitizado do residente e
anteriores, recursos, identidade/isolamento. A autorização de comparação já existe
nesta sessão e continua condicionada a esse preflight; não solicitar novamente
para atos já autorizados. Só então criar baseline e candidato sequencialmente,
com nonces/clusters/ledgers/evidências distintos e as mesmas 272 etapas, acrescentando
somente a migration no candidato. Negativos de deadlock e orçamento permanecem
obrigatórios. Esta parada não rejeita nem aprova a correção: recomendação NO-GO
operacional e produto ainda NO-GO, sem garantia global contra deadlocks.

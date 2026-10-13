# 2026-10-13 — Promoção do Single-Item V1 ao Supabase residente

Tipo: desenvolvimento e prova. Planos [054](../planos/054-single-item-first-attempt-sql.md) e [055](../planos/055-single-item-codex-wsl-integration.md).
Branch dev; HEAD inicial 6bc4aadef9414d655600c2ea37c6be436b3628c8. Sem push.

## O que foi promovido

Uma única execução de `supabase migration up --local --workdir <pacote congelado>` aplicou, em ordem,
exatamente as três migrations focais ao residente (`supabase_db_anima`, PostgreSQL 15.8, imagem
`sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b`), de 2026-10-13T01:17:51Z:

| Versão | SHA-256 |
|---|---|
| `20261008000000_single_item_work_claim` | `08fc05c35574188c6fcb495c330a44392f3367fcf53f50c980c6968fdcf08541` |
| `20261010000000_single_item_first_attempt_candidate` | `f233e2f7098a873fcfe1781ae4075968078d0cc74c0c30090bd95ecee2d94925` |
| `20261010000001_single_item_terminal_temporal_candidate` | `5c486b7395e729201c320ff8cf9e8eb808277174dcdf9754d722341931d797c6` |

As candidatas `20261009000000` e `20261009000001` ficaram **fora** do pacote e do residente. Ledger:
153 -> **156** versões (md5 `b470c474cbeced445e85b4e3ea874779`). Catálogo: 274 -> **275** funções
(`public.acquire_single_item_work_claim` nova) e **cinco corpos substituídos**
(`public.release_work_claim`, `public.start_claimed_work_attempt`, `private.begin_work_attempt`,
`public.record_commanded_work_terminal`, `private.release_mandated_result`). Owner, ACL,
`SECURITY DEFINER`, `search_path`, retorno e todos os agregados estruturais (tabelas, colunas,
constraints, índices, políticas, triggers, ACL de tabelas, enums, extensões) inalterados.
`work_items` 187 / `work_claims` 165 / `work_events` 2848 com hashes idênticos aos de antes.
A promoção sobreviveu a um reinício do Docker Desktop (ledger 156, 275 funções após o retorno).

## Gate de validação (pacote, ensaio e recuperação)

Pacote de 156 migrations (153 históricas do Git HEAD + 3 focais), `sha256sum -c` 156/156. Ensaio em
PostgreSQL descartável da mesma imagem restaurado de `pg_dump -Fc` do residente: o CLI listou
exatamente as três pendentes, aplicou-as e o catálogo resultante é idêntico ao do residente
promovido. Cada arquivo é atômico; falha injetada mostrou que arquivos anteriores concluídos
permanecem (ledger 154/155) — **não há atomicidade conjunta**. `compensation.sql` (corpos capturados
+ `DROP FUNCTION IF EXISTS` + remoção das 3 linhas do ledger) foi testado no descartável nos pontos
de parada 153/154/155/156 e em reexecução, com catálogo idêntico ao pré-promoção em todos. Um erro
da primeira versão do script (filtro que removia linhas em branco dentro dos corpos) foi pego pelo
próprio teste e corrigido. `verify_after.py` no residente: 14/14 PASS.

Artefatos fora do repositório, somente leitura, com `SHA256SUMS.ALL`:
`C:\Users\GeanTeco\anima-recovery\single-item-v1-20261012T220113\` (pacote, runbook, backups prévios,
evidências) e `...\exec-20261012T221715\` (backup imediato, log de execução, catálogos antes/depois,
privilégios). Dump pós-promoção em `...\post-promotion-*\`.

## Prova funcional pós-promoção (descartável restaurado do residente promovido)

Dump pós-promoção (1576 entradas) restaurado em banco novo; os 23 órfãos de FK (abaixo) removidos
**apenas** na cópia; catálogo idêntico ao do ensaio e do residente. Nada foi criado no residente.

- Suíte pgTAP existente `supabase/tests/single_item_work_claim.test.sql` (reaproveitada das provas de
  10/10) sobre essa cópia: **55/55 PASS** — claim alheio ativo e vencido recusam, item/versão
  divergente recusa, replay idempotente, início sob claim, orçamento atômico, rollback, RLS,
  `anon` sem EXECUTE, `service_role` sem EXECUTE, `authenticated` com EXECUTE, `PUBLIC` sem,
  `search_path` fixo, revogação de elegibilidade, coexistência de owners.
- Item real `b5f8178a` (usuário allowlistado, v1, `approved`, `codex-cli`, alvo `anima`), em transações
  sempre revertidas: aquisição OK (alvo `anima`, lease 5 min, sem attempt); replay com o mesmo
  `claim_id` idêntico; outro `claim_id` recusa `55000`; versão errada `55000`; `lease_seconds=0`,
  item nulo ou owner nulo `22023`/`P0002`; item inexistente `P0002`; com claim global aberto de outro
  item real do mesmo alvo, o scoped recusa `55000 single_item_foreign_claim_open`.
  Privilégios medidos: anon false, authenticated true, service_role false, postgres true.
- `start_claimed_work_attempt` sem decisão de roteamento recusa `55000 work routing decision missing`
  (fail-closed, esperado): o consumidor grava `record_work_routing_decision` antes do claim
  (`supervisor.ts`); o caminho feliz com roteamento está coberto pelo pgTAP #15–24.
- Argumentos usados pelo consumidor (`work_item_id`, `expected_proposal_version`, `claim_id`,
  `owner_instance_id`, `lease_seconds`) coincidem com a assinatura instalada.

## Achados e limites (não corrigidos)

- **23 órfãos de FK no residente** (9 `auth.sessions`, 9 `public.profiles`, 5 `public.work_contexts`)
  apesar das FKs validadas — pendência independente; `pg_restore` estrito falha nas 3 FKs; ids em
  `evidence/prepromo/residente-fk-orphans.psv` (diretório de recuperação). Nada foi limpo.
- 18 migrations históricas com conteúdo aplicado diferente do Git, aceitas como risco conhecido sem
  impacto demonstrado nas três focais (análise no diretório de recuperação).
- Quatro falhas históricas de orçamento (asserções 1, 2, 6, 10) seguem falhando; Vector em loop de
  restart; edge runtime parado. O Docker Desktop encerrou sozinho uma vez durante a sessão e foi
  reiniciado; o residente voltou íntegro.
- Uma tentativa de comando com `rm` dentro de `sh -c` foi bloqueada pela verificação de segurança do
  Claude Code e refeita sem remoção (dump enviado direto ao host por stdout); nada foi executado
  nem contornado.
- Esta prova cobre catálogo, privilégios, contrato SQL e dados reais em descartável; não houve
  attempt, claim, evento ou fixture no residente, nem Codex como agente, Host, self-dev ou API paga.

## Estado de continuidade

Gate `single_item_atomic_claim_unavailable` **permanecia fechado** ao final deste registro; sua
integração é tratada em registro próprio. As migrations deste registro são o conteúdo do commit
local correspondente; as candidatas de 09/10 e os demais WIPs seguem fora de versionamento.

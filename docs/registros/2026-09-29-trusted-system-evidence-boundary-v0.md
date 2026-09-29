# 2026-09-29 — Trusted System Evidence Boundary V0

Atravessar a barreira que a [Produce-Change Evidence Projection V0](2026-09-28-produce-change-evidence-projection-v0.md)
expôs (`trustedSystemEvidenceSince = null` ⇒ zero positivas) SEM promover nada. Base: `dev` =
`origin/dev` = `e7140da`. `main` = `99bec54` intacta. US$0. Migração `20260929000000` aplicada só
no Supabase local (`migration up`, nunca `db reset`).

Referências: [Trusted System Writer V0](2026-09-28-mandated-verifier-enforcement-v0.md) (`4ea8505`,
migração `20260928000003`) · [Pending Verification Human Recovery V0](2026-09-28-pending-verification-human-recovery-v0.md).

## Achado da reconciliação

A projeção trata como técnicos quatro fatos (`host_observed_evidence_recorded`,
`host_observed_gate_evidence_recorded`, `host_observed_coder_evidence_recorded`,
`verifier_opinion_recorded`) e usa `created_at` (`occurredAt`) contra a fronteira. O payload não
carrega identidade do writer, então a fronteira temporal é o único critério — e só vale com
EXCLUSIVIDADE de escrita. Auditoria no banco vivo:

| Caminho | Antes desta unidade | Depois |
|---|---|---|
| RPCs do writer (5 sinks) | só `anima_system_writer` (4ea8505) | idem |
| Humano/anon (RPC) | 42501 | 42501 |
| Humano/anon/writer INSERT direto em `work_events` | sem grant (42501) | idem |
| **`service_role` INSERT/UPDATE direto** | **permitido** (grant padrão Supabase): forjaria fato `author=system` com `created_at` arbitrário ou moveria fato legado para depois da fronteira | **recusado** pelo guard |
| Outras funções definer | nenhuma grava os tipos reservados (auditado: `event_type` dinâmico só em 6 RPCs, todos com CASE fechado sem tipo reservado) | guard exige writer do dono em sessão de API |
| Operador (`postgres` dono da tabela / superuser) | tudo | tudo (raiz de confiança: pode desabilitar o trigger) |

## O que mudou

Migração `20260929000000_trusted_system_evidence_boundary.sql` (reusa
`private.trusted_system_writer_owner()`; nenhuma arquitetura nova):

1. `private.guard_trusted_system_fact()` (BEFORE INSERT/UPDATE em `work_events`, SECURITY INVOKER)
   para os CINCO fatos reservados (os quatro técnicos + `integration_completed`):
   (a) escrita por papel efetivo não-operador ⇒ 42501 — o fato só entra por função definer do
   operador (as RPCs do writer); (b) sessão não-operador (todo tráfego PostgREST: `session_user =
   authenticator`) exige writer ATIVO registrado para o DONO do item e `author=system`;
   `created_at` carimbado pelo servidor; (c) fato reservado é imutável fora de sessão de operador.
2. `private.trusted_system_writers`: `created_at` carimbado pelo servidor e imutável; revogação
   irreversível; writer não troca de dono.
3. `private.trusted_system_evidence_guard`: instante de ativação do guard (piso da fronteira).
4. `public.trusted_system_evidence_since()` (authenticated; anon negado): fronteira do DONO chamador
   = `greatest(ativação do guard, created_at mais antigo de writer ATIVO do dono)`; sem writer
   ativo ⇒ NULL.

Web: `apps/web/lib/evolution/produce-change-evidence-read.ts` — `readTrustedSystemEvidenceSince`
e `readProduceChangeOperationalEvidence` (histórico canônico + itens + lineage + fronteira do
banco). A fronteira nunca vem do chamador nem de configuração; falha ao lê-la fecha a leitura
(`trusted_boundary_read_failed`) em vez de virar `null` silencioso; microssegundos do banco são
arredondados PARA CIMA (truncar anteciparia a fronteira).

pgTAP `canonical_resident_contract_stamp`: a fixture que inseria fato reservado como
`service_role` — exatamente o caminho fechado — passa a inserir em sessão de operador; o
propósito (carimbo autoritativo) é o mesmo.

## Provisionamento (ato do operador, autorizado em chat)

Supabase LOCAL: usuário GoTrue dedicado `anima-system-writer@anima.invalid`
(`310b9828-b873-46aa-b71b-d3288333dac3`), `auth.users.role = anima_system_writer`, fora da
allowlist, registrado para o dono residente `e570e43b-0263-43a1-b8e9-63b4eb2b5ba4`
(`reason = 'operator provisioning 2026-09-29 (Supabase local)'`). Credenciais só em
`apps/web/.env.local` (gitignored; `ANIMA_SYSTEM_WRITER_EMAIL`/`_PASSWORD`, já no manifesto de
recovery-config desde 4ea8505), nunca impressas nem commitadas. O runtime
(`trustedSystemWriterFromEnvironment`) passa a `available = true`; o Resident Host precisa ser
REINICIADO para carregar o env.

## Fronteira

- Ativação do guard: `2026-09-29 03:19:31.82352+00` (reaplicada localmente durante o
  desenvolvimento desta unidade, sem reset).
- Registro do writer: `2026-09-29 03:24:34.618679+00`.
- **`trustedSystemEvidenceSince` = `2026-09-29T03:24:34.618679Z`** (lida via RPC; o leitor usa
  `03:24:34.619Z`).
- Persistência: derivada de linhas do banco (`private.trusted_system_writers`,
  `private.trusted_system_evidence_guard`), não de env/config. Monotônica para qualquer caminho
  não-operador: `created_at` carimbado e imutável; revogar/remover writer só ADIA a fronteira ou a
  anula (rebaixa, nunca promove). `supabase db reset` apaga writer e registro ⇒ fronteira NULL e
  sinks fail-closed (reprovisionar gera fronteira POSTERIOR).

## Provas

- pgTAP `trusted_system_evidence_boundary.test.sql` 24/24: service_role não insere nenhum dos 5
  fatos (nem com `created_at` futuro), não promove evento comum por UPDATE, não retrocede
  `created_at` nem altera fato do writer; claim `role` forjado sem registro recusado; humano não
  insere nem chama RPC; writer não insere direto (só RPC); writer revogado recusado; writer ativo
  grava; `created_at` do registro carimbado (pedido `2020-01-01` ignorado) e imutável; fronteira =
  registro do writer, nunca antes da ativação; só-revogado ⇒ NULL; anon não lê. Com os triggers
  desligados, 15/24 falham (os testes discriminam).
- Suíte pgTAP inteira: 65/68 arquivos; as 3 falhas (`budget_blocked_human_resume`,
  `compute_routing_decision`, `work_budget_local_vs_external`) são PRÉ-EXISTENTES — idênticas com
  os triggers novos desligados.
- Prova viva via PostgREST real (`session_user = authenticator`), 19/19: writer provisionado emite
  JWT `role=anima_system_writer` e passa a identidade (P0002 em item inexistente); residente lê a
  fronteira; anon não lê; residente não chama RPC do writer nem insere os fatos; writer não
  insere direto; em dono DESCARTÁVEL: writer não registrado recusado, fronteira NULL antes do
  registro, dono humano não grava evidência do próprio item, writer registrado GRAVA (camada b do
  guard), fato com `author=system` e `created_at` do servidor ≥ fronteira. Tudo descartável
  removido; zero eventos novos no histórico real.
- Jest web (evolution + trusted writer + supervisor + integration + auto-approval) 128/128 (leitor
  novo 9/9); core projeção + capability 212/212; `npm run typecheck` verde.

## Projeção real após a fronteira

Via leitor canônico: 33 elegíveis; `qualified_positive` 0 · `attributed_negative` 8 ·
`inconclusive` 23 · `not_attributable` 2; 0 attempts `system_proven`; 4 cadeias legadas seguem
`technical_evidence_not_system_proven` com `wouldQualifyWithTrustedEvidence`. Comparação por
lineage com a projeção `null` (baseline e7140da): **0 ocasiões mudaram**. Nenhum fato antigo foi
promovido. Gap `trusted_evidence_generation_missing` permanece até existir fato system_proven.

## Premissas e residuais (explícitos)

- Raiz de confiança = operador do banco (`postgres` dono / superuser) + integridade do JWT. O
  Supabase LOCAL usa o segredo JWT PADRÃO da CLI (público) e a API escuta em `0.0.0.0:54321`: quem
  alcança a porta e conhece o segredo cunha um token de writer. Mesmo modelo de todo o RLS local;
  a fronteira é "confiável relativa ao operador da máquina". Endurecer = segredo JWT próprio
  (invalida anon/service keys atuais) e bind em `127.0.0.1` — decisão do operador.
- `result_submitted`/`execution_started` continuam gravados pela sessão residente (executor
  atestado); a positiva depende deles, mas correlacionados com fatos do writer.
- Revogar um writer com outro ativo move a fronteira para o registro do remanescente; fatos entre
  os dois registros não são distinguíveis por writer (payload sem writer_id).
- `record_host_observed_node_lifecycle` segue `authenticated` (fora do conjunto técnico).

## Não feito

Nova attempt, authority paga, provider pago, self-dev, promoção de maturidade, consumo da
projeção em readiness/auto-approval, alteração da projeção.

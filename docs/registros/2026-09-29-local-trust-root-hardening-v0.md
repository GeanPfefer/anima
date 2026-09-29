# 2026-09-29 — Local Trust Root Hardening V0

Tipo: desenvolvimento + prova local. Base: `dev` = `origin/dev` = `549bd39`; `main` = `99bec54` intacta.
US$0 (sem OpenAI/RunPod, sem self-dev attempt, sem paid authority). Nada promovido.
Arquitetura: [`docs/arquitetura/local-trust-root.md`](../arquitetura/local-trust-root.md). Antecessor:
[Trusted System Evidence Boundary V0](2026-09-29-trusted-system-evidence-boundary-v0.md).

## Ameaça concreta (medida antes da mudança)

Supabase CLI 2.105.0 sem `[auth] jwt_secret` ⇒ segredo JWT e chaves opacas **publicados no código da
CLI**; `apps/web/.env.local` usava exatamente as opacas padrão. Sonda contra a API real (só item
inexistente, nada gravado):

| Token/chave | Antes | Depois |
|---|---|---|
| JWT `anima_system_writer` forjado c/ segredo padrão → `rpc/record_host_observed_evidence` | **500 P0002** (passou a identidade, igual ao writer real) | 401 PGRST301 |
| JWT `service_role` forjado c/ segredo padrão → `GET work_items` | **200** | 401 PGRST301 |
| `sb_secret_` padrão como apikey → `GET work_items` | **200** (Kong ⇒ service_role) | 401 (tratado como anônimo, igual a chave aleatória) |
| Realtime com JWT forjado c/ segredo padrão | — | `CHANNEL_ERROR JwtSignatureError` |

Rede: `0.0.0.0:54321` (Kong) e `0.0.0.0:54322` (Postgres) por `com.docker.backend`; regra de firewall
"Docker Desktop Backend" permite TCP entrante em qualquer porta no perfil Público; Ethernet
(192.168.0.x) = Público. Tailscale = Privado (sem regra TCP do Docker).

## Reconciliação (read-only)

- CLI suporta `[auth] jwt_secret` (≥16 chars), `anon_key`, `service_role_key`, `publishable_key`,
  `secret_key`; anon/service_role derivam do `jwt_secret`; `supabase/.env` é auto-carregado para
  `env()`. `SUPABASE_AUTH_JWT_SECRET` em `supabase/.env` **não** é aplicado (testado).
- `env()` ausente **não** falha: a CLI usa o literal ⇒ nome curto `ANIMA_JWT` (literal < 16 ⇒ recusa).
- Sem opção de bind na CLI (portas sem HostIP; a própria CLI avisa "All services bind to 0.0.0.0").
- Nenhuma chave padrão versionada no repo; consumidores: `apps/web/.env.local`, `apps/mobile/.env.local`
  (mobile via Tailscale), clientes finos (PRD §15). `.worktrees/manual-resident-user-test/apps/web/.env.local`
  (histórico, preservado) ficou com chave antiga.

## Mudanças

- `supabase/config.toml` `[auth]`: `jwt_secret = "env(ANIMA_JWT)"`, `publishable_key`/`secret_key` = `env(...)`.
- Recovery Config: env file `supabase` + grupo `local-supabase` (habilitado quando o web aponta para
  Supabase local) com as 3 chaves; `anima recovery-config check` lê `supabase/.env` sem imprimir valores.
- PRD §15 corrigido (anon padrão não serve mais entre máquinas); doc de arquitetura novo.
- Só local/gitignored: `supabase/.env` (gerado, 0600), chaves em `apps/web/.env.local` e
  `apps/mobile/.env.local`. Dump de segurança pré-rotação no scratchpad da sessão (não versionado).
- Stack: `supabase stop` (volumes preservados) + `supabase start -x studio,imgproxy,postgres-meta,mailpit,logflare,vector,supavisor,edge-runtime`.
  **Sem `db reset`.** Contagens idênticas antes/depois (users 25, work_items 124, work_events 1733,
  writers 1, 149 migrations).

## Provas

- `supabase status`: `JWT_SECRET`/`PUBLISHABLE_KEY`/`SECRET_KEY` = valores novos; `ANON_KEY` e
  `SERVICE_ROLE_KEY` assinados com o segredo novo (booleanos; nada impresso).
- Prova viva da fronteira (writer provisionado + descartáveis): **ALL PASS** — writer passa a identidade
  (P0002), residente/humano/anon recusados (42501), writer registrado grava (`recorded`), cleanup 0.
- Residente: `anima status` conectado; Realtime `SUBSCRIBED` em `work_events`; runtime writer `available=true`.
- `trusted_system_evidence_since` = `2026-09-29T03:24:34.618679Z` antes e depois (writer não recriado).
- Projeção produce-change: saída byte-idêntica antes/depois (33 elegíveis, 0 positivas, 0 lineages mudaram).
- Jest: trusted-system-writer, produce-change-evidence-read, recovery-config (+1 teste), cli — 165/165;
  core produce-change-operational-evidence 29/29; `tsc --noEmit` web ok.
- pgTAP: 65/68; boundary/writer/host_observed/verifier/integration ok; as 3 falhas são as pré-existentes
  (`budget_blocked_human_resume`, `compute_routing_decision`, `work_budget_local_vs_external`), idênticas
  ao registro anterior e independentes de assinatura JWT (claims via GUC).
- pgMeta `/pg/*` via Kong: 503 (excluído no start).

## Critério de parada: B

JWT endurecido e validado. Bind loopback **não** é suportável: a CLI não oferece bind, e loopback puro
(`daemon.json` `"ip"`) quebraria mobile/clientes finos via Tailscale. Mitigação = regras de bloqueio no
firewall (Postgres 54322 remoto; 54321/54323 na Ethernet), **ato do operador** como administrador.

## Gaps / próximo ponto

1. **Bloqueante para `qualified_positive` defensável:** Postgres superuser (`postgres`/`postgres`, fixo
   na CLI local) alcançável pela LAN. Operador aplica as regras do doc e valida de um 2º dispositivo.
2. Clientes finos (Nomad) precisam da nova publishable; o `.env.local` da worktree histórica ficou velho.
3. `app.settings.jwt_secret` no banco guarda o segredo padrão antigo (inerte).
4. Resident Host/Next não estavam rodando; ao subir, já leem as chaves novas.
5. Operador local (`postgres`, Docker) continua sendo a raiz de confiança por definição.

# Local Trust Root — raiz de confiança do Supabase local

A fronteira do [Trusted System Writer](../registros/2026-09-29-trusted-system-evidence-boundary-v0.md)
decide QUEM grava fatos de sistema (`author=system`) pelo papel `anima_system_writer` no JWT. Ela só
é tão forte quanto quem consegue **assinar** esse JWT e quem alcança o **banco** diretamente. Este
documento fixa como a máquina servidor (Goma) protege essas duas raízes.

Registro da implantação: [2026-09-29-local-trust-root-hardening-v0](../registros/2026-09-29-local-trust-root-hardening-v0.md).

## 1. Raiz JWT (implementado)

A Supabase CLI local, sem configuração, usa um segredo JWT **publicado no código da CLI** e chaves
opacas também publicadas (`sb_publishable_…`/`sb_secret_…`; o Kong converte a `sb_secret_` em
`service_role`). Quem alcança a API e conhece esses valores cunha qualquer papel — inclusive
`anima_system_writer` — ou age como `service_role` (ex.: GoTrue admin: trocar senha do writer).

Mecanismo suportado pela CLI (≥ 2.105), sem fork nem proxy:

| `supabase/config.toml` `[auth]` | Valor em `supabase/.env` (gitignored, auto-carregado pela CLI) |
|---|---|
| `jwt_secret = "env(ANIMA_JWT)"` | 48 bytes aleatórios (hex) |
| `publishable_key = "env(ANIMA_LOCAL_PUBLISHABLE_KEY)"` | `sb_publishable_<aleatório>` |
| `secret_key = "env(ANIMA_LOCAL_SECRET_KEY)"` | `sb_secret_<aleatório>` |

- `anon`/`service_role` (JWT) são **derivados** do `jwt_secret` pela CLI; GoTrue, PostgREST, Realtime
  (tenant `realtime-dev` é re-semeado no start) e Kong recebem o segredo novo no `supabase start`.
- **Fail-closed:** a CLI não falha quando uma variável de `env()` falta — usa o literal. Por isso o
  nome curto `ANIMA_JWT`: o literal `env(ANIMA_JWT)` tem < 16 caracteres e a CLI **recusa subir**
  (`Invalid config for auth.jwt_secret`), em vez de voltar em silêncio a um segredo conhecido.
- Consumidores (gitignored): `apps/web/.env.local` (`NEXT_PUBLIC_SUPABASE_ANON_KEY` = publishable,
  `SUPABASE_SERVICE_ROLE_KEY` = secret) e `apps/mobile/.env.local` (`EXPO_PUBLIC_SUPABASE_ANON_KEY`).
  Clientes finos (Nomad) precisam da nova publishable — a anon padrão **não** funciona mais.
- `anima recovery-config check` cobre as três chaves no grupo `local-supabase` (habilitado quando o
  web aponta para `127.0.0.1/localhost:54321`).
- Resíduo inerte: `app.settings.jwt_secret` no banco ainda guarda o segredo padrão antigo (gravado
  pela CLI só na criação do volume). Nenhuma função o lê e ele não autentica mais nada.

### Rotação

1. Gerar novos valores em `supabase/.env` (nunca imprimir).
2. `supabase stop` (preserva volumes) e `supabase start -x studio,imgproxy,postgres-meta,mailpit,logflare,vector,supavisor,edge-runtime`.
   **Nunca `db reset`.**
3. Atualizar as chaves nos `.env.local` (web, mobile, clientes finos); reiniciar Resident Host/Next.

Rotacionar **não** recria o writer, não toca `private.trusted_system_writers` e não move
`trusted_system_evidence_since`: identidades vivem em `auth.users` e o segredo só assina tokens de
acesso (1 h). Sessões vigentes precisam relogar; refresh tokens seguem válidos.

## 2. Superfície de rede (limitação documentada; mitigação é ato do operador)

A CLI publica as portas **sem** IP de host ⇒ Docker Desktop escuta em `0.0.0.0`/`[::]` (a própria
CLI avisa: *"All services bind to 0.0.0.0"*). Não há opção suportada de bind na CLI 2.105.

- `54321` (Kong/API) e `54322` (**Postgres, senha `postgres` fixa da CLI local = superuser**).
- A regra de firewall "Docker Desktop Backend" permite TCP entrante em qualquer porta no perfil
  **Público** — a Ethernet da Goma é Pública ⇒ a LAN alcança API e Postgres.
- Bind só em loopback (`daemon.json` `"ip": "127.0.0.1"`) **quebraria a arquitetura**: mobile e
  clientes finos acessam a API pela Tailscale (`anima-prd.md` §15).

Superuser do Postgres alcançável pela LAN anula qualquer fronteira de JWT (desabilita trigger, grava
fato com `created_at` arbitrário). A menor mitigação, reusando o firewall existente, é do operador
(PowerShell **como administrador**; o agente não altera configurações de segurança do sistema):

```powershell
# Postgres só local: bloqueia toda entrada remota (LAN e Tailscale). Loopback não passa pelo firewall.
New-NetFirewallRule -DisplayName 'ANIMA block Postgres 54322 remote' -Direction Inbound -Protocol TCP -LocalPort 54322 -Action Block
# API/Studio fora da LAN física; Tailscale (mobile/Nomad) continua.
New-NetFirewallRule -DisplayName 'ANIMA block Supabase API LAN' -Direction Inbound -Protocol TCP -LocalPort 54321,54323 -InterfaceAlias 'Ethernet' -Action Block
```

Regras de bloqueio vencem a regra de permissão do Docker. Se a Goma usar Wi-Fi, repetir a segunda
regra com o alias do adaptador Wi-Fi. Validação exige um **segundo dispositivo** (tráfego da própria
máquina para o IP da LAN é local e não é filtrado): pela LAN `http://<ip-lan>:54321/auth/v1/health`
deve expirar; pela Tailscale `http://<ip-tailscale>:54321/auth/v1/health` deve responder 200.

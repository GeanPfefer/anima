# Preferência de compute por unidade

Status: implementado (2026-09-25). Contrato mínimo para o humano escolher, **por work item**,
a estratégia de compute que o Compute Router V1 deve tentar — sem confundir essa escolha com
gasto autorizado nem com configuração global de processo.

## Três conceitos distintos

| Conceito | Onde vive | Quem decide | Autoriza gasto? |
|---|---|---|---|
| Capacidade do runtime | env de deploy (`ANIMA_CODER_MODEL`, effort, timeout, output tokens, `ANIMA_CODER_PROVIDER`) | operador | não |
| Preferência da unidade | evento `compute_preference_recorded` | humano, por item (`anima work set-compute`) | **não** |
| Backend selecionado | evento `compute_routing_decided` / decisão entregue ao Supervisor | Compute Router V1 | não |
| Authority paga | `paid_compute_authorizations` | humano (`anima work authorize-compute`) | **sim**, limitada |

`execution_spec.coder_backend` continua existindo porque a elegibilidade autônoma exige um
backend **local** autorizado. O planner agora o carimba com `coder_backend_source:
'runtime_default'`: é a capacidade do deploy no momento do planejamento, não uma decisão sobre
a unidade.

## Contrato

`ComputePreferenceV1` (`packages/core/src/compute-preference.ts`):

- `{ schemaVersion: 1, strategy: 'provider_api', provider: 'openai', model }`;
- `{ schemaVersion: 1, strategy: 'router_default' }` — limpa a escolha explícita.

Sem campos de dinheiro, duração ou validade: esses são da authority.

Persistência: RPC `record_compute_preference(p_work_item_id, p_expected_proposal_version,
p_preference)` (migrations `20260925000000`/`20260925000001`), `SECURITY DEFINER`,
`authenticated` + allowlist, só em `proposed`/`approved` na versão vigente, autoria `user`,
append-only, idempotente (a mesma preferência vigente é replay). Não cria authority, reserva
nem execução (pgTAP `supabase/tests/compute_preference.test.sql`).

## Precedência no Router

`resolveEffectiveComputePreference` decide o `preferred` entregue a `decideComputeRoute`:

1. preferência explícita `provider_api` ⇒ autoritativa (`source: work_item_preference`);
2. preferência explícita `router_default` ⇒ nenhuma (Router padrão, inclusive sobre contrato legado);
3. sem preferência ⇒ compatibilidade: contrato **legado** com `coder_backend: openai` e sem a
   marca `runtime_default` continua preferindo OpenAI (`source: legacy_contract`);
4. caso contrário ⇒ Router padrão (local-first, economia, sinais de lineage como
   `local_no_progress` — inalterados).

Com preferência OpenAI:

- authority compatível (provider, nó `openai-api`, classe `provider_api:<modelo>`, work item,
  duração ≥ a volta do Router) ⇒ `selected` OpenAI, `reasonCode: preferred_candidate`;
- sem authority, ou authority incompatível ⇒ `waiting_for_human_authorization`, `fallbackChain: []`;
- modelo preferido ≠ modelo que o runtime oferece ⇒ `blocked`, `preferred_model_unavailable`;
- sem credencial OpenAI ⇒ `blocked`, `openai_unavailable`;
- Router desligado ⇒ a volta para (`compute_preference_requires_router`); o legado local não a substitui;
- falha ao ler a preferência ⇒ a volta para (`compute_preference_unavailable`).

Nunca há fallback silencioso para Ollama. A decisão registra `preference: { provider, model,
source }` quando existe; decisões sem preferência mantêm a forma anterior, e o `decision_id`
determinístico continua fazendo replay na reavaliação/restart.

## Fluxo operacional

```
chat → plano revisado → anima work approve <id>
     → anima work set-compute <id> --strategy provider_api --provider openai --model gpt-5.6-sol
     → anima work prepare-autonomous <id>
     → Resident Host ⇒ waiting_for_human_authorization (anima work show <id>)
     → anima work authorize-compute <id> --max-usd … --max-minutes … --valid-hours …
     → Resident Host reavalia ⇒ OpenAI/<modelo>
```

`anima work show` projeta a preferência (`explicit` / `legacy_contract` / `router_default`) ao
lado da espera por authority.

## Fora do escopo

Herança da preferência por sucessores de recuperação/correção (hoje o sucessor nasce sem
preferência explícita; o sinal de lineage continua valendo), preferência por modelo local
específico e superfície na UI web/mobile.

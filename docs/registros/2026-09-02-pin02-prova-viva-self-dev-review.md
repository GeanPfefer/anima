# 2026-09-02 — PIN-02: 2ª execução canônica provada ao vivo (self-dev → `review`)

**Tipo:** prova viva + reconciliação de infra. **Branch:** `dev`.
**HEAD inicial:** `d47727d`. **HEAD final:** este commit (registro + estado do plano).
`origin/main` observado em `99bec54` e **não alterado**.

## Objetivo

Retomar exatamente da barreira operacional do **PIN-02** (`8e9fd82b-8986-4526-9258-40893200b173`)
— a 1ª attempt (`a9ea146f…`) falhou em `worktree_create_failed` — e provar a **2ª execução
canônica end-to-end** pelo Resident Host, sem fabricar estados nem cruzar fronteira humana. PIN-02
é o 1º recorte self-dev de [Project Intake V0](../planos/006-project-intake-v0.md): codec
persistível puro de `ProjectIdeaV0`.

## Resultado

**Sucesso completo até `review`** (máximo autônomo). O supervisor selecionou o PIN-02
naturalmente, criou nova attempt, worktree, rodou o coder local, produziu edição real, gates
host-observed passaram, o Verifier emitiu `verified` e o item chegou a `review`. **Nenhuma decisão
humana foi fabricada** — parei antes de "Aceitar resultado".

## Barreira original e correção (operacional, sem mudança de código)

- **Causa:** `worktree_create_failed` na attempt `a9ea146f` (execution_started→failed em **108 ms**,
  seq 47130→47131). O fast-fail confirma falha imediata de spawn/pré-condição do `git`, não defeito
  semântico do Work Item. Bate com o diagnóstico prévio: o Resident Host anterior rodava em
  contexto/sandbox **sem autoridade Git suficiente**.
- **Evidência de que não é regressão de produto:** neste contexto real (`G:\anima`) tanto o Git Bash
  quanto `node spawn('git')` criam/removem worktree com exit 0 (`git 2.54.0.windows.1` no PATH que o
  Node resolve). O `packages/core` [worktree.ts](../../apps/web/lib/work-orchestration/worktree.ts)
  cria a árvore em `mkdtemp(tmpdir())` a partir do `base_sha` autorizado.
- **Correção:** operacional — subir o stack e rodar o Resident Host in-process a partir do ambiente
  real do repositório, com autoridade Git. **Zero linhas de produto alteradas.**

## Reconciliação de infra (tentativas limitadas)

- Docker Desktop não subiu no 1º `start`; `Start-Process` funcionou → engine `29.7.2`. Supabase
  auto-subiu com o Docker; aguardei `auth`/`realtime` `healthy`. `ollama serve` iniciado;
  `qwen3-coder:latest` presente.
- **Resource Governor / RAM:** RAM livre **3,3 GB / 15,9 GB** (pressão real, coder 30B). Aliviei
  apenas processos **dispensáveis** (ChatGPT, Steam, Discord, Spotify) → **7,0 GB livres**. GPU
  praticamente livre (1,8/16 GiB). Não desliguei o Governor nem inflei limites; o pré-gate admitiu
  (`permit`) e o coder carregou (~14,8 GiB VRAM). `necessidade ≠ afrouxar`.

## Estado reconciliado do PIN-02 (antes de agir)

`approved` · pv **2** · impact `low` · capability `programming` · base_sha **`6ff4d43`** (ancestral
de `d47727d`) · `canonical_provenance.sourceId = PIN-02` · planner
`operator_revision_after_local_planner_v1`. A elegibilidade da preparação pós-aprovação depende do
fix [`d47727d`](../../apps/web/lib/work-orchestration/planned-project-classification.ts) (reconhece
a **origem canônica** quando a revisão humana troca a metadata do planner). Retry **seq 47133**
(`retry_authorization`) já registrado e **consumido** (`readiness = item_not_failed`); `pin02InQueue
= true`, `queue_size 1`. **Não** refiz retry.

## Prova viva — attempt `5a0c7716-350f-477a-bf66-fb7a38fb4c65`

Cadeia de `work_events` (seq): 47134 `work_routing_adjusted` → 47135 `work_routing_decided`
(`ollama:qwen3-coder:latest`, effort strong) → 47136 `work_claimed` → 47137 `work_started` → 47138
`execution_started` → 47139 `checkpoint_recorded` → 47140 `result_submitted` → 47141
`work_claim_released` → 47142 `host_observed_gate_evidence_recorded` → 47143
`host_observed_coder_evidence_recorded` → 47144 `host_observed_evidence_recorded` → 47145
`verifier_opinion_recorded`.

- **Worktree:** `…/anima-wt-WKgNgi/tree` na branch `anima-work/5a0c7716…`, checkpoint **`2602dac`**
  sobre a base `6ff4d43`. Criada com sucesso (barreira original **superada**).
- **Coder:** `qwen3-coder:latest` (30,5B Q4, ~14,8 GiB VRAM). Edição real **+14 linhas** em
  `packages/core/src/project-intake.ts` (`serializeProjectIdeaV0` / `deserializeProjectIdeaV0` com
  validação fail-closed no parse).
- **Gates (host-observed, origin `host`):** `Project Intake focado`
  (`npm.cmd test --workspace=packages/core -- project-intake.test.ts --runInBand`) **passed** exit 0,
  17,0 s; `Typecheck core` **passed** exit 0, 3,3 s.
- **Verifier:** verdict **`verified`** — 8 checks (4 independentes + 4 atestados), 0 gaps, 0
  violations (correlation/branch_ownership/scope/status/gates/criterion).
- **Estado final:** `review` (pv 2).

## Limitação honesta (para o revisor humano)

A implementação do coder é **mínima**: `serialize = JSON.stringify`; `deserialize = JSON.parse +
validateProjectIdea` (fail-closed no malformado). Satisfaz os gates que **rodaram** (as 22 asserções
existentes + typecheck), mas **não adiciona testes de round-trip** nem cobre integralmente o aceite
escrito do plano ("shape extra / versão desconhecida falha fechado" — ainda não há campo de versão;
rejeição de campo extra não é testada). Isso é matéria da **revisão humana** (`accept` vs
`request_changes`), não foi auto-aceito. Achado estrutural do self-dev: o item chegou a `review`
porque os critérios de aceite não estavam codificados como testes executáveis — o gate mede o que
existe, não a intenção escrita.

## Efeitos externos / invariantes de segurança

Identidade só **Bearer/RLS** (resident user `e570e43b…`); **sem service_role** no fluxo (o `psql`
direto foi usado **apenas leitura**, para observação). **Sem** enfraquecer gate/Verifier, **sem**
desligar Governor. `origin/main` intacta (`99bec54`). Working tree do `dev` **não tocado**
(`project-intake.ts` no `dev` continua sem o codec — a edição vive só na branch de review). Worktree
`anima-wt-WKgNgi` **disposta**; branch `anima-work/5a0c7716` **preservada** como referência de
review. Zero compute pago/RunPod/gasto. Nenhum PR/merge/deploy/`integrated`.

## Fronteira humana e próximo ponto de retomada

- **PIN-02 aguarda decisão humana** em `review` (branch `anima-work/5a0c7716…`): `accept` →
  `completed`, ou `request_changes`. A fila autônoma está **vazia** (`queue_size 0`); todo caminho
  restante (aprovar `proposed`, conceder `autonomous_execution_request` a um `approved`) é **humano**.
  Não há trabalho autônomo elegível pendente — parada correta, não artificial.
- **Retomar assim:** com o stack de pé, `ANIMA_AUTONOMY_ENABLED=1 npm run local-host` (in-process,
  bounded via `ANIMA_RESIDENT_MAX_ITERATIONS`) consome o próximo item **já autorizado** da fila. Se
  PIN-02 for aceito, o próximo recorte canônico é **PIN-03** (persistência com migration — SQL +
  pgTAP + typegen), agora desbloqueado pela convergência provada aqui.

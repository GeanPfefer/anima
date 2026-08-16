# 2026-08-15 — HostObservedEvidence fechada (git) + Auto Mode como benchmark

**Tipo:** desenvolvimento + direção arquitetural.

**Objetivo:** (A) concluir o recorte de **evidência independente observada pelo
host** — persistir append-only a `HostObservedGitEvidenceV1` e fechar a cadeia viva
até o Verifier; (B) perpetuar a direção arquitetural aprendida ao usar o **Claude
Auto Mode como benchmark** para o futuro modo autônomo do Anima. Continuação direta
dos registros [2026-08-14-verifier-v0](2026-08-14-verifier-v0.md) e
[2026-08-14-verifier-independencia](2026-08-14-verifier-independencia.md).

**Branch:** `claude/integration-application-layer`.
**HEAD inicial:** `25b814d`. **HEAD final:** este commit documental.
**origin/main:** `973ef465acaa3955f8e176c72903975cf3912ac6` — **intacta, SEM push.**

## Commits (semanticamente separados; técnico antes de documentação)

| Hash | Assunto | Camada |
|---|---|---|
| `df10748` | Persista a evidência observada pelo host (append-only, fail-closed) | migration + pgTAP + tipos |
| `b0b742c` | Faça o Verifier consumir a evidência observada persistida | core (projeção + wiring) |
| `d5d7d78` | Fie a observação host-side do git ao caminho vivo (fail-open) | web (composição + rota) |
| `60ca177` | Documente a evidência observada pelo host e o consumo pelo Verifier | doc PARTE A |
| _este_ | Registre o Auto Mode como benchmark + este registro | doc PARTE B + registro |

## PARTE A — o que foi implementado (cadeia fechada para git)

Cadeia viva: **Executor → host observa git → evento append-only → projeção →
Verifier compara observed × attested → humano (gate final).**

- **Persistência** (`supabase/migrations/20260815000000_*`, `..01_*`): evento
  `host_observed_evidence_recorded` + RPC `record_host_observed_evidence`.
  `author=system`/`origin=host` — proveniência que o **sinal do executor não forja**
  (outro evento, outra RPC, outro autor). Correlação a uma **tentativa real**
  (`execution_started` na versão aprovada); régua estrutural SQL espelha
  `buildHostObservedGitEvidence`; **idempotente por tentativa ignorando `observedAt`**
  (reobservação determinística do mesmo git replaya; conteúdo divergente é conflito
  `55000`); índice único parcial por `attempt_id`. Não muda estado, não conclui, não
  aceita, não autoriza, não integra.
- **Projeção pura + Verifier** (`packages/core/.../host-observed-evidence.ts`,
  `work-verification.ts`): `projectHostObservedEvidence` reconstrói do log cruzando a
  correlação contra o envelope do evento; `verifyPersistedWorkResult` passa `observed`.
  Como `presentation` já compõe o Verifier, a comparação observed × attested é **viva e
  sem I/O**.
- **Produtor host-side + fiação viva** (`apps/web/.../host-evidence.ts`,
  `supervisor-turn/route.ts`): `observeAndPersistHostGitEvidence` (porta injetada
  `HostEvidenceSink`; `hostEvidenceSinkFor` traduz para a RPC derivando os parâmetros
  da própria evidência). Fiado na rota `/supervisor-turn` após um terminal `result` no
  caminho worktree — **fail-open**: falha só significa "sem evidência independente nesta
  volta". O Supervisor permanece provider-neutral (a observação vive na rota).
  `worktreeBranchFor` vira fonte única do nome da branch.

### Critério de aceitação (resposta objetiva)

> Se o Executor mentir sobre os arquivos alterados ou o commit, o host possui
> evidência independente suficiente para o Verifier detectar a mentira?

- **Git → SIM.** Provado em `work-verification.test.ts` ("executor mente sobre os
  arquivos"): com o handoff atestado limpo e em escopo, uma evidência observada com
  arquivo/commit divergentes leva o parecer a **rejected** (`attested_contradicts_observed`
  + `change_out_of_included_scope`, proveniência `independent`).
- **Gates → ainda atestados** (`coverage.gates=false`). Reexecução/captura independente
  de gates exigiria re-executá-los em sandbox — **evolução futura**, fora deste recorte.
  Independência real PARCIAL > falsa promessa total.

### Provas / gates

- **pgTAP:** `host_observed_evidence` 20/20; **suíte completa 767 PASS** (31 arquivos).
- **core (jest):** 33 suites / **743 PASS** (+7 desta sessão).
- **web (jest):** `host-evidence` 11/11; `worktree-executor` 16/16; `supervisor-turn
  route` + `worktree-supervisor` 7/7.
- **typecheck:** 5 workspaces limpos. Tipos regenerados **cirurgicamente** (enum +
  função da RPC), sem diff ruidoso de CRLF/ordenação.
- **Flakes:** nenhum observado nesta sessão.

## PARTE B — Auto Mode como benchmark (direção, NÃO implementada)

Perpetuado na arquitetura viva
([orquestração §Benchmark do Claude Auto Mode](../arquitetura/orquestracao-de-trabalho.md))
como **aplicação/refinamento** dos princípios já ratificados no
[Marco 005](../marcos/005-autonomia-progressiva-e-identidade-una.md) (§2, §7, §9, §10,
§11) e [Marco 006](../marcos/006-politica-de-seguranca-como-maturidade-maxima.md) — por
isso **não** se criou marco novo nem se editou o Marco 005 (append-only). O Claude Auto
Mode é **benchmark, não blueprint**: "que mecanismo resolve bem um problema real e
merece ser adaptado?", não "como copiar?".

Direção registrada (toda **bloqueada** para implementação automática):

- Duas independências: `Policy != Executor` (antes da ação, futuro) simétrica ao já
  implementado `Evidence/Verifier != Executor` (depois da ação).
- Policy Gate futuro classificaria ações em `ALLOW`/`REQUIRE_HUMAN`/`DENY` (vocabulário
  não congelado).
- **Hard boundary vs maturity boundary**: segurança limita o estado atual, não a ambição
  final; maturity boundary é conquistável por evidência, não proibição eterna.
- **O componente não concede poder a si próprio**: uma execução não "determina que já é
  M4" e usa o poder; promoções vêm de outra autoridade + evidência acumulada (equivalente
  a "o Executor não fabrica sozinho seu `VERIFIED`"). Políticas que ampliam poder vivem em
  camada que o próprio trabalho não modifica e ativa na mesma execução.
- **Dados estruturados/confiáveis > texto arbitrário** para autorização; **classificador
  semântico útil, nunca autoridade única** (desenho: política determinística + maturidade
  + evidência histórica + classificador + Verifier).
- **Bloqueios como evidência histórica**; maturidade futura orientada por histórico real.
- Diferença central mantida: além de "pode executar agora?", o Anima quer responder "já
  há evidência suficiente para **conquistar** mais autonomia nesta classe?".

## Invariantes de segurança preservadas

- origin/main intacta; **sem push, PR, merge, deploy, efeito externo, credencial real**.
- `.worktrees/` e worktrees existentes preservados; nenhum `git clean`/reset destrutivo;
  nenhuma evidência apagada; `supabase db reset` **não** executado (só `migration up`).
- Nada de política automática de maturidade, autoelevação de permissão ou remoção do gate
  humano. O Verifier permanece **advisory**.

## Fronteiras humanas / não implementado

- **Reexecução independente de gates** (evidência observada de gate) — futuro.
- **Persistência decisória do parecer do Verifier** — investigável, mas o parecer deve
  permanecer ≠ autorização/merge/deploy/maturidade automática (não iniciado nesta sessão).
- **Policy Gate / política de maturidade / promoção automática** — bloqueados.
- A promoção do executor de worktree a backend comandado padrão continua fronteira humana
  pré-existente (a fiação host-side é aditiva e fail-open, não a atravessa).

## Próximo ponto exato de retomada

Cadeia de evidência independente para **git** fechada e provada. Próximo eixo já
autorizado a **investigar** (sem decisão automática): **persistência append-only do
parecer do Verifier**, mantendo-o estritamente advisory. Depois disso, a evolução natural
é a **evidência observada de gate** (reexecução em sandbox). A política automática de
maturidade permanece BLOQUEADA até nova autorização humana.

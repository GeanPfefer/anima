# 2026-08-16 — Independência dos gates: evidência observada de primeira parte do host

**Tipo:** desenvolvimento.

**Objetivo:** fechar a independência dos **gates** conforme a decisão humana desta sessão
— **não** reexecutar gates só para o Verifier; preservar como evidência observada de
primeira parte do host os desfechos que o host JÁ observa ao executar cada gate — e fazer
o Verifier consumi-la como autoridade. Continuação de
[2026-08-16-parecer-verifier-e-investigacao-gates](2026-08-16-parecer-verifier-e-investigacao-gates.md),
que havia deixado o eixo dos gates **investigado, aguardando decisão humana** entre reexecução
e refatoração de fronteira. A decisão desta sessão foi **nenhuma das duas**: capturar o que o
host já mede.

**Branch:** `claude/integration-application-layer`.
**HEAD inicial:** `2127356`. **HEAD final:** este commit documental.
**origin/main:** `973ef465acaa3955f8e176c72903975cf3912ac6` — **intacta, SEM push.**

## Commits (técnico antes de documentação)

| Hash | Assunto | Camada |
|---|---|---|
| `c806670` | Adicione a evidência de gate observada pelo host (primeira parte, sem reexecução) | core + migration + pgTAP + tipos |
| `f328112` | Faça o Verifier consumir os gates observados (observed > attested) | core + migration + pgTAP |
| `1399639` | Capture os gates observados pelo host e fie ao caminho vivo (fail-open) | web (adapter + rota) |
| _este_ | Documente a independência de gates implementada | doc |

## O que foi implementado

Cadeia fechada para gates: **host executa e observa o gate → evidência append-only
(origin=host) → Verifier compara observed × attested → humano.**

- **Contrato puro** `HostObservedGateEvidenceV1` (`packages/core/.../host-observed-gate-evidence.ts`):
  gates `{label, command, exitCode, durationMs, timedOut, cancelled, outcome DERIVADO}` +
  `coverage.gates=true`. O `outcome` é derivado dos fatos (passou ⟺ código 0 sem timeout/
  cancelamento) e **nunca** aceito de fora — um gate que o host viu falhar não pode ser
  marcado passed. build/parse/project fail-closed.
- **Persistência** (`20260816000002/03`): evento `host_observed_gate_evidence_recorded` +
  RPC `record_host_observed_gate_evidence`, `author=system`/`origin=host` (não forjável pelo
  sinal do executor). Régua SQL exige o outcome derivado; correlação a tentativa real;
  idempotente por tentativa ignorando `observedAt`; conflito 55000 em divergência.
- **Verifier consome** (`work-verification.ts`): evidência de gate presente+correlacionada é
  **autoridade**. Achados: `gate_failed` (independent) para observado falho;
  `attested_gate_contradicts_observed` para a mentira (Executor diz passou, host observou
  falhou → rejected); `gates_independently_observed` para tudo passando;
  `observed_gate_correlation_mismatch` para evidência de outra tentativa (recai na atestação).
- **Parecer** (`verifier-opinion.ts` + `20260816000004`): `evidenceBasis.observedGateEventId` +
  `coverage.gates`. A chegada da evidência de gate **muda a base** ⇒ novo parecer versionado
  append-only, **não** conflito com o anterior (a identidade do parecer passou a incluir o
  evento de gate). pgTAP prova isso.
- **Captura host-side + wiring** (`worktree-executor.ts`, `executor-selection.ts`,
  `gate-evidence.ts`, `/supervisor-turn`): `onGateObserved` injetado reporta os fatos brutos
  logo após cada `runGate` (código de host, não o `CoderBackend`), num canal do host separado
  do handoff atestado — inclusive o gate que falhou. A rota coleta e persiste **inclusive em
  terminal de erro** (gate falho é a evidência mais valiosa), ANTES do git e do parecer.
  Fail-open em toda etapa.

## Independência: escopo honesto

- **Relativa ao autor do código.** No caminho worktree, quem escreve o código (`CoderBackend`/
  LLM) é a parte não-confiável; quem roda o gate (`runGate`, TS de host) é confiável. O
  desfecho observado é independente do autor do código → um executor que minta é detectado.
- **Só quando o host executa o gate.** Um executor futuro que rode gates num processo separado
  (contêiner, nuvem) **não** gera esta evidência, e `coverage.gates` é honestamente **false**
  para ele. Não há promessa de independência onde o host não observa.
- **Fora deste recorte (futuro):** captura de gate para executores remotos/não-confiáveis
  (exigiria reexecução ou atestação assinada).

## Provas / gates

- **core (jest):** 35 suites / **785 PASS** (host-observed-gate-evidence 20; gates no Verifier;
  parecer com base de gate).
- **web (jest):** gate-evidence 10/10; worktree-executor 16/16; supervisor-turn route +
  worktree-supervisor 4/4.
- **pgTAP:** host_observed_gate_evidence 16/16; verifier_opinion 22/22; suíte completa **805 PASS**.
- **typecheck:** 5 workspaces limpos. Tipos regenerados **cirurgicamente** (enum + RPC).
- **Flakes:** nenhum.

## Invariantes de segurança preservadas

- origin/main intacta; **sem push, PR, merge, deploy, efeito externo, credencial real**.
- `.worktrees/`, worktrees existentes, `.claude/settings.local.json` e `apps/web/.env.local`
  preservados; nenhum `git clean`/reset destrutivo; nenhuma evidência apagada; `supabase db
  reset` **não** executado (só `migration up`).
- O parecer e a evidência de gate são **advisory**: não aceitam resultado, não decidem
  integração (`integration_decided` é `author=user`), não removem o gate humano, não promovem
  maturidade. Nenhuma política automática de maturidade foi implementada (segue **bloqueada**).

## Deliberadamente ainda não provado / próximo ponto de retomada

- **Prova ao vivo end-to-end** do caminho worktree gerando a evidência de gate (exige um item
  worktree elegível executado pelo Supervisor); os testes cobrem cada elo isoladamente e a
  fiação, mas a prova viva integrada não foi executada nesta sessão.
- **Superfície de UI** para o histórico de pareceres / evidência de gate: `presentWorkItem` já
  expõe `opinionHistory`; nenhuma tela nova foi fiada.
- **Próximo eixo elegível** (autorizado pela visão, sem ampliar autoridade): captura de gate
  para executores remotos, OU avançar outro recorte de evidência/auditoria do modo autônomo.
  A **política automática de maturidade** permanece BLOQUEADA (exige decisão humana explícita).

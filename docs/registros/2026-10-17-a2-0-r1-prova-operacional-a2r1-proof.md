# A2-0 / R1 — prova operacional A2R1-PROOF (execution_mode / actor_kind) — 2026-10-17

Append-only. Tipo: prova viva. Rascunho preparado no worktree do Recorte 2 (`claude/a2-0-r2-acceptance-mandate`); **não commitado nem publicado**.
Complementa [`2026-10-16-a2-0-recorte-1-fatos-de-execucao.md`](2026-10-16-a2-0-recorte-1-fatos-de-execucao.md). Sem segredos.

## Resultado em uma linha

`PASS_EMISSAO` (15/15) e `PASS_ITEM` (14/14) para o item `38e39912-2713-4b86-a524-582b1d98e31f` (v1): uma attempt agendada pelo Windows registrou o fato real
`host_observed_execution_context_recorded` (seq 86832), com Verifier v6 `verified`. **Não é `unattended_verified`.**

## Antecedentes (resumo)

- Recorte 1 publicado em `origin/dev` no commit `2888118de25cd3c226ab35635f092200bb97afa8` (RPC `record_host_observed_execution_context`, só `anima_system_writer`,
  migrations `20261016000000/1` aplicadas no residente após backup restic `e2503ad9…a18f` verificado e restauração isolada idêntica).
- Item `A2R1-PROOF` criado `PROPOSED` (base `2888118d`, `codex-cli` via assinatura, uma attempt de até 35 min, `required_fail_closed`, escopo de 2 arquivos novos do Core).

## Pré-mandato e execução

- Pré-mandato humano: `work_approved` **86823** e `work_intelligence_classified` **86824** (`human_confirmed`, bounded/low/reversible/clear/normal).
- Tarefa única `ANIMA-A2R1-38e39912` (T0 2026-10-17T03:41:34Z); launcher derivado do A1-v2 com guardas novas (aborta se `ANIMA_EXECUTION_*` existir no pai ou no `.env.local`,
  se já houver fato de contexto, se refs/WIPs/worktrees divergirem). Só o **processo filho** recebeu `ANIMA_EXECUTION_MODE=unattended`,
  `ANIMA_EXECUTION_RUNNER_KIND=scheduled_launcher`, `ANIMA_EXECUTION_RUNNER_INSTANCE=ANIMA-A2R1-38e39912`.
- Um único spawn (03:41:38Z), filho com exit 0 (03:43:13Z), sem retry/recovery; sem lease E0, sem API paga, sem Host global, sem migration.

## Eventos (item)

86821 work_proposed · 86822 context_attached · **86823 work_approved (user)** · **86824 work_intelligence_classified (user)** · 86825–86826 roteamento · 86827 work_claimed ·
86828 work_started (user, emitido pelo fluxo) · 86829 execution_started · 86830 checkpoint · 86831 result_submitted · **86832 host_observed_execution_context_recorded (system)** ·
86833–86835 evidência do host · 86836 verifier_opinion_recorded (`work-verifier-v6`, verified; 16 checagens, 0 lacunas, 0 violações) · 86837 work_claim_released.

Fato: `execution_mode=unattended`, `actor_kind=automated_runner`, `runner={scheduled_launcher, ANIMA-A2R1-38e39912, dono do item}`, `authority={human, approved_seq 86823,
classified_seq 86824, leases 0, atos humanos após o mandato 0}`, `recorded_by=trusted_system_writer`, attempt `36918a6b-daf0-41b0-ac16-5f78e6f4fc36`.
Candidato `f546ee69294a1006ff7225cc7b16a55b704dd884`: filho único da base, 2 arquivos novos (+165), sem merges. Item permanece em `review`.

## Auditoria e evidência congelada

`a2r1-audit.mjs` (read-only): 15 predicados de emissão e 14 de item, todos verdadeiros; digest dos 2901 eventos históricos visíveis (seq ≤ 86820) idêntico; 158 migrations;
ACL do writer inalterada; `ANIMA_EXECUTION_*` ausente de `.env.local`, ambiente e Next. Pacote fora do Git (38 arquivos, `verify.sh` sem falhas):
`C:\Users\GeanTeco\anima-recovery\a2r1-evidence-20261017\`, manifesto `SHA256SUMS` = `fa7f019fbec32407b0885948666e9b9203425e08db35de3c791e7842bd5132e2`.

## Limitações (não omitir)

- A prova é por **declaração do launcher validada pelo ledger**; não prova ausência de humano. Pré-mandato humano; `work_started` com autor `user`; a métrica classifica o item como
  `human_observed` (`unattendedVerifiedUntilReview = 0`).
- Aceite, integração e push do candidato **não** ocorreram; o item e `f546ee69` foram preservados em `review` (decisão humana D4: sem aceite retroativo).
  Como a attempt começou sem mandato, este item é o caso negativo do Recorte 2 (`not_anticipated`).
- A tarefa agendada concluída segue `Ready` e se remove sozinha em 12 h; os dumps em texto puro do backup E-0 continuam no scratch até autorização de limpeza.

## Incidente operacional (registrado)

Na preparação do worktree do Recorte 2, um comando de montagem de `node_modules` mal formado fez a limpeza seguinte apagar o conteúdo de `G:\anima\node_modules\.bin`
(165 atalhos; diretório ignorado pelo Git, regenerável). Reparado por `npm rebuild --ignore-scripts` (165 arquivos restaurados; `npx jest` voltou a funcionar; 272 WIPs inalterados).
Lição: nunca limpar um `node_modules` que possa ser junction para o checkout principal; criar links com script, não com `Remove-Item` sobre o alvo.

# A1 / A1-v2 — execução agendada sem intervenção humana após o pré-mandato — evidência congelada — 2026-10-15

Append-only. Tipo: prova viva + desenvolvimento (correção de harness). Estado no congelamento: **item A1-v2 em `review`, Verifier v6 `verified`; nada aceito, integrado ou publicado.**

## Resultado em uma linha

`A1_PASSED` para o item `499b6222-42af-4143-b2b6-c2f32eb01729` (A1-v2), depois de um `A1_FAILED` instrutivo no A1 original `d8b8e7b6-ac86-4629-ba24-7c3151338045` (item `cancelled`). **Não é `unattended_verified`** (ver Limitação epistemológica).

## Objetivo

Demonstrar que o ANIMA executa uma attempt governada, disparada por tarefa agendada do Windows, até um parecer independente do Verifier v6, sem nenhum ato humano entre o pré-mandato (aprovação + classificação) e o parecer, usando o orçamento unattended normal, Codex CLI via WSL (assinatura ChatGPT), sem lease E0, sem API paga.

## Cronologia essencial

1. **A1 original** (`d8b8e7b6`, base `f8dbfecc`): pré-mandato 86787/86788; tarefa `ANIMA-A1-d8b8e7b6` disparou em 06:23Z; attempt única; candidato `cca2d4c5`; Verifier v6 `inconclusive` (1 `test_report_missing` + 3 `acceptance_test_binding_unmet`); item ficou `in_progress` sem claim. Auditoria: `A1_FAILED`.
2. **Causa-raiz demonstrada (harness):** três títulos de teste preexistentes em `gate-test-report.test.ts` (linha 104, `segredo no fullName %s`) continham `password=hidden`, `Bearer hidden` e `sk-hidden`. `deriveGateTestReport` recusa, fail-closed, **todo** o relatório Jest se qualquer `fullName` casar com credencial (`sensitive_data`); sem `testReport` o `test_binding` não é satisfeito. Reproduzido em cópia isolada com a implementação real do host; o defeito já existia no base.
3. **Correção do harness:** commit `ed586e532bd18148e048c1369cafc72788ac510d` ("Neutralizar títulos de teste com padrões de credencial em gate-test-report"), 1 arquivo, +6/−1: os três títulos passam a rótulos neutros via `test.each` com objetos `{label, fullName}`; os quatro valores testados, o corpo do teste e a política fail-closed ficam idênticos. Integrado em `dev` local por fast-forward; **não publicado**.
4. **Encerramento do A1 original:** `resolve-pending cancel` ⇒ evento `work_cancelled` 86801 (autor `user`), item `cancelled`. Semântica lida na migration `20260928000004`: só acrescenta evento e muda estado; candidato, branch, checkpoint e histórico preservados.
5. **A1-v2** (`499b6222`, base `ed586e53`): mesmo objetivo funcional (desambiguar nomes de teste duplicados em `deriveGateTestReport` com ordinal estável), contrato sem `resume_from_checkpoint`, sem reaproveitar `cca2d4c5`, com nota de base proibindo renomear títulos existentes (evita `bound_test_removed`) e títulos novos com padrões de credencial. Criado `PROPOSED` (86802/86803).
6. **Ativação humana (pré-mandato):** `work_approved` **86804** e `work_intelligence_classified` **86805** (`human_confirmed`, bounded/low/reversible/clear/normal). Dry-run `DRY_RUN_OK`. Tarefa única `ANIMA-A1V2-499b6222` para 07:08:30Z (depois da liberação de tentativa de orçamento prevista para 07:07:08Z).
7. **Execução (sem intervenção):** launcher iniciou 07:08:30Z, um único spawn 07:08:34Z, filho encerrou 07:11:07Z com código 0. Eventos 86806–86817.

## Eventos (ledger), item A1-v2

| seq | tipo | autor |
|---|---|---|
| 86802–86803 | work_proposed, context_attached | anima |
| **86804** | work_approved | user (pré-mandato) |
| **86805** | work_intelligence_classified | user (pré-mandato) |
| 86806–86807 | work_routing_adjusted, work_routing_decided | system |
| 86808 | work_claimed | system |
| 86809 | work_started | user (emitido pelo próprio fluxo de execução) |
| 86810 | execution_started | anima |
| 86811 | checkpoint_recorded | executor |
| 86812 | result_submitted (`78dfc780-91ac-4079-bcba-7f7c47d9dfda`) | executor |
| 86813–86815 | evidência do host (gates, coder, host) | system |
| **86816** | verifier_opinion_recorded (`work-verifier-v6`, **verified**) | system |
| 86817 | work_claim_released | system |

Attempt `1cb56817-2057-4ba2-9a5f-ad6fc74821aa`. Candidato `3b8e1cbea95225fa507cf3ce6e26bbc1add640ac` (branch `anima-work/1cb56817-2057-4ba2-9a5f-ad6fc74821aa`, filho único de `ed586e53`, sem merges, 2 arquivos, +104/−6).

## Gates e Verifier

- Gates do host, todos `passed` com exit 0: teste novo (`test_binding`) 3,3 s com **relatório Jest estruturado** (1 suíte, 97 testes, 97 passed, 0 failed) e baseline com relatório; consumidores focados do Core; typecheck Core; typecheck web.
- Verifier v6: `verified`; 18 checagens (6 `independent`, 12 `attested`); 0 lacunas; 0 violações; `test_binding_satisfied` independente.
- Suíte inteira do Core na revisão independente: 123 suítes / 2911 testes passando; `tsc` Core exit 0; 9 mutações da implementação foram detectadas pelos testes novos.

## Auditoria `a1v2-audit.mjs` (reexecutada no congelamento)

`A1_PASSED`; nenhum predicado falhou nem ficou sem avaliar: `A1_` (em review, 1 attempt, v6 verified, test_binding independente, claim liberado depois do parecer), `H1–H6` (nenhum ato humano após o pré-mandato; 0 leases; um único `work_started`), `F1–F6` (sem aceite/integração; candidato filho único da base; sem merges; escopo exato; refs intactas; nada depois do parecer exceto a liberação), `L1–L5` (log do launcher presente, um spawn, sem retry, desfecho `REVIEW_VERIFIED`).

## Limitação epistemológica (não declarar `unattended_verified`)

- A prova é **por exclusão de eventos humanos** entre o pré-mandato e o parecer, corroborada pelo log externo do launcher. Ela não prova que nenhum humano observou ou poderia intervir.
- O pré-mandato (aprovar, classificar, autorizar janela e agendar) foi **ato humano**. Não é um ciclo integralmente autônomo.
- O host não registra `execution_mode` nem `actor_kind` (`limitations`: `execution_mode_fact_absent`, `actor_kind_not_recorded`); `work_started` sai com autor `user`. A métrica de autonomia da `/evolution` classifica o item como `human_observed` (1) e `unattended_verified` = 0, e **assim deve continuar** até existir evidência correspondente.
- Reexecutar o auditor **depois** do aceite reportaria `F1`/`F6` falsos; o pacote congelado é a evidência canônica do `A1_PASSED`.

## Evidência congelada (fora do Git)

Pasta protegida (somente leitura) `C:\Users\GeanTeco\anima-recovery\a1v2-evidence-20261015\` com `EVIDENCE.json`, cópias do A1-v2 e do A1 original (comandos, configs, launcher, auditor, ativação, logs, resultados), eventos exportados do ledger, refs/diff/log do candidato e `SHA256SUMS` (59 arquivos; verificar com `verify-sha256.ps1`). Hash do manifesto `SHA256SUMS`: `14d5d54e179ca2c46300826d1b9b89730bfabcf625b4c37c965fd5291d676ddc`. Originais em `anima-recovery\a1` e `anima-recovery\a1v2` não foram alterados. O pacote **não** é versionado (contém caminhos e configuração locais); este registro é a versão sanitizada, sem credenciais, tokens ou configuração sensível.

## Invariantes preservadas

Uma attempt, sem retry nem recovery; sem lease E0; sem Host global; sem API paga (Router e `OPENAI_API_KEY` desligados no launcher); sem migrations; `origin/main` = `99bec54e3ab42bfe882a8686cd1385d8058b916e` intacta; `origin/dev` = `f8dbfeccff40af7fb7abd608741cbab79697c67a`; 272 entradas de WIP e 47 worktrees preservadas; candidato histórico `cca2d4c5` e o A1 original preservados; fail-closed de credenciais não enfraquecido.

## Efeitos externos

Realizados: tarefas agendadas locais do Windows (`ANIMA-A1-d8b8e7b6`, `ANIMA-A1V2-499b6222`, ambas de execução única), Ubuntu-24.04 (WSL) iniciada, uso do Codex CLI com assinatura. **Não realizados:** aceite, integração, push, PR, merge em `main`, migration, nova attempt, lease.

## Transição futura prevista (cada passo um ato humano separado)

1. `work accept` do resultado `78dfc780…` ⇒ `result_accepted`, item `completed`.
2. Integração governada `ff_only` em **clone dedicado** (o alvo `refs/heads/dev` em checkout em `G:\anima` seria negado com `target_checked_out`), esperando `integration_effect_authorized` e `integration_completed` pelo Trusted System Writer; alvo esperado `ed586e53` → resultado `3b8e1cbe`.
3. Sincronização do checkout principal por `merge --ff-only`, com WIPs intactos.
4. `git push origin dev` (publica `ed586e53` e `3b8e1cbe`; `origin/dev` `f8dbfecc` é ancestral).
Nenhum desses passos altera a classificação deste registro: `A1_PASSED`, `human_observed`, não `unattended_verified`.

## Próximo ponto exato de retomada

Decisão humana de aceitar o resultado do A1-v2 (GO condicionado à evidência já congelada). Ledger no seq 86817.


---

## Adenda (2026-10-15, posterior ao congelamento) — aceite, integração governada e sincronização

Append-only. Nada acima foi reescrito: as seções anteriores descrevem o estado **no momento do congelamento** (item em `review`, nada aceito, integrado ou publicado). Os fatos abaixo aconteceram **depois** e são a execução da "Transição futura prevista" daquele texto, passos 1 a 3. Onde o texto acima diz "não realizados: aceite, integração", leia-se "não realizados até o congelamento".

### Aceite humano

- `work accept` (mecanismo oficial, ato humano) ⇒ **`result_accepted` seq 86818** (autor `user`, id `358d1281-fbe4-48f0-91fd-a3a5b4beade2`, 2026-10-15 07:33:58Z), `accepted_result_event_id` `78dfc780-91ac-4079-bcba-7f7c47d9dfda`; item `completed` v1. Pré-condições conferidas antes: item em `review`, parecer `work-verifier-v6` `verified` correlacionado ao resultado, pacote congelado íntegro, `dev` inalterado, nenhuma integração anterior, nenhum aceite duplicado.

### Integração governada `ff_only` (clone dedicado)

- Clone isolado `anima-recovery/anima-integration-499b6222` (sem hardlinks, push desabilitado, HEAD destacado em `ed586e53`, `dev` do clone na base e fora de checkout; o alvo `refs/heads/dev` não pode ser integrado dentro do checkout em uso, `target_checked_out`). Wrapper adaptado fora do repositório; inspeção prévia com 29/29 guardas verdes (lane `required_fail_closed`, parecer correlacionado ao resultado e à attempt com 0 gaps e 0 violações, aceite único no seq 86818, base e escopo de 2 arquivos, refs do repositório principal inalteradas).
- Execução única com autorização humana explícita:
  - **`integration_effect_authorized` seq 86819** (autor `user`, id `00b7cbd5-b640-49a4-b883-536d2dd05ce9`, 07:40:30Z), autorização `499b6222-c0de-4e00-8f21-499b6ffee001`.
  - **`integration_completed` seq 86820** (autor `system`, **Trusted System Writer**, id `9923d53a-c23e-4839-927f-de0ad78baac6`, 07:40:31Z).
  - Recibo: modo `ff_only`, `effected`, `observed` verdadeiro, alvo `refs/heads/dev` de `https://github.com/GeanPfefer/anima`, `previousTargetSha` `ed586e532bd18148e048c1369cafc72788ac510d` → `resultingTargetSha` `3b8e1cbea95225fa507cf3ce6e26bbc1add640ac`, `mergeCommitSha` nulo (compare-and-swap, sem force e sem merge commit).

### Sincronização do checkout principal

- `git fetch --no-tags` a partir do clone dedicado e `git merge --ff-only 3b8e1cbe` em `G:\anima` (sem reset, clean, stash, force, cherry-pick ou merge commit). `dev` passou de `ed586e53` a `3b8e1cbe`; os dois arquivos ficaram idênticos aos do candidato (mesma árvore); `git diff --check` limpo; Jest focado de `gate-test-report.test.ts`: **97/97**. As 273 entradas de WIP e as 47 worktrees foram preservadas (a única diferença foi o próprio SHA do `dev`), `origin/dev` (`f8dbfecc`) e `origin/main` (`99bec54e`) inalteradas, ledger sem eventos adicionais.

### Publicação

- A publicação de `origin/dev` é o ato seguinte, por `git push origin dev` sem force, depois de `git fetch origin` e conferência da ref remota real, sem tocar `main`. O SHA publicado e o commit deste registro constam no `git log` de `origin/dev`; este texto não afirma a publicação antes de ela ocorrer.

### Limitação epistemológica (mantida)

- **`A1_PASSED` não equivale a `unattended_verified`.** O aceite (86818) e a autorização de integração (86819) são **atos humanos posteriores**, fora da janela auditada (pré-mandato 86804/86805 → parecer 86816). A prova do A1 continua sendo por exclusão de eventos humanos nessa janela, mais o log do launcher; o host segue sem registrar `execution_mode` nem `actor_kind`; a métrica da `/evolution` continua classificando o item como `human_observed`, não como `unattended_verified`.
- O auditor `a1v2-audit.mjs`, se reexecutado depois do aceite, reportaria `F1`/`F6` falsos; **o pacote congelado `a1v2-evidence-20261015` (59 arquivos, `SHA256SUMS` com hash `14d5d54e…6ddc`) é a evidência canônica** e continuou íntegro após cada etapa.

### Invariantes e efeitos desta adenda

- Sem migrations, sem nova attempt, sem recovery, sem outra integração; `origin/main` = `99bec54e3ab42bfe882a8686cd1385d8058b916e` intacta; candidato histórico `cca2d4c5` e o A1 original (`cancelled`) preservados.
- Próximo ponto de retomada: nenhum item pendente deste ciclo além da publicação; trabalho futuro sobre `unattended_verified` exigiria o host emitir `execution_mode`/`actor_kind` (mudança de código fora deste registro).

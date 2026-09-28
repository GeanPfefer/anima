# 2026-09-28 — Completed → Integrated V0: integração canônica de resultado aceito em dev

- **Tipo:** desenvolvimento (SQL + core puro + executor web). US$ 0, sem provider, sem PR, sem push,
  sem merge real de work item existente. Provado só com repositórios Git **temporários**.
- **Branch:** `dev`. **HEAD inicial:** `7573aba` (Mandated Verifier V0.1). `main`/`origin/main`
  intactas (`99bec54`); `refs/heads/dev` real intacto.
- **Migrações:** `20260928000001_integration_effect_vocabulary.sql` (enum, em arquivo separado) e
  `20260928000002_integration_effect.sql`, aplicadas **só no banco local** (`migration up`, sem reset).
  Tipos regenerados (`packages/types/src/database.ts`; diff = só as adições).
- **Antecedente:** auditoria independente read-only do Codex sobre `59eb37e`: havia Verifier → aceite
  humano → `completed` → `integration_decided` → publicação de branch → PR, mas **nenhuma** primitive
  persistida para `completed + autorização específica de merge → efeito Git em dev → observação →
  integration_completed`.

## Princípios

```
completed ≠ integrated
Verifier ≠ aceite humano ≠ autorização de merge ≠ execução da integração
```

Aceitar um resultado não concede permissão para alterar `dev` nem `main`. `work_items.state` continua
`completed`. `integrated` é projeção do receipt `integration_completed`, como os outros receipts
externos. Nenhum `WorkState` novo.

## Por que `integration_decided` (V1) não foi reutilizado

`integration_decided` é a segunda aprovação genérica (authorize/refuse) que alimenta branch publication
e PR (ADR-002). Ele não congela alvo, SHA-alvo nem modo. Reinterpretá-lo como autorização de merge em
silêncio daria a uma decisão antiga um efeito que ela nunca autorizou. Testes provam que ele não serve:
`planIntegrationEffect` → `authorization_not_found`, e `record_integration_completed` com um
`decision_id` → `integration effect authorization not found`.

## Reuso (ADOPT/WRAP/BUILD)

- **ADOPT:** correlação item/versão/attempt/resultado, `parseWorktreeHandoff`, padrão
  inspect → mutate → inspect → persist, padrão SQL de `record_branch_published` (fatos persistidos +
  índice único + replay/conflito), `runProcess`, normalização de repositório, allowlist.
- **WRAP:** env `ANIMA_INTEGRATION_REPOSITORY_ID` / `_REMOTE_NAME` / `_REPO_ROOT` (mesmas da publicação),
  `createWorkOrchestrationService`.
- **BUILD:** autorização de merge específica, executor dev-only, receipt `IntegrationEffectReceiptV1`,
  persistência `integration_completed`, reconciliação.

## Contrato da autorização (`integration_effect_authorized`, author=user)

RPC `authorize_integration_effect(work_item_id, expected_proposal_version, accepted_result_event_id,
authorization_id, repository_id, target_ref, expected_target_sha, mode)`:

- item `completed` e versão vigente; `accepted_result_event_id` = último `result_accepted`;
- **commit do resultado e attempt DERIVADOS** do handoff persistido do resultado aceito. O chamador não
  fornece SHA do resultado, branch, caminho, remote, refspec nem comando;
- `target_ref` = `refs/heads/dev` exato e `mode` = `merge_no_ff`. `main`, `origin/main`,
  `refs/heads/main` e qualquer outro alvo ⇒ `integration target not allowed`;
- `expected_target_sha` é SHA; item já integrado ⇒ recusado;
- congela `operation_key = integration-effect:<auth>:<resultado>:<repo>:<ref>:<esperado>:<commit>:<modo>`;
- idempotente por `authorization_id`; mesma id com dados diferentes ⇒ conflito.

O comando humano `authorizeIntegrationEffect({ workItemId, authorizationId })` (web) deriva o resto:
resultado aceito dos eventos, repositório da configuração, alvo e modo constantes, e SHA-alvo esperado
lido do Git no momento da decisão (o que o humano vê). Wiring em UI/CLI: não feito (V0 = primitive +
testes).

## Identidade da integração / API pública

`executeAuthorizedIntegration({ workItemId, integrationAuthorizationId })`: o chamador fornece só
identidades opacas. Campos extras (ex.: `targetRef: 'refs/heads/main'`) são ignorados (teste).
`planIntegrationEffect` (core, puro) revalida: autorização `author=user`, item, `completed`, versão,
último aceite = autorizado, resultado e handoff, attempt, commit, alvo, modo, repositório = configuração
confiável e chave de operação recomputada.

## Proteção do alvo

- Alvo = constante `refs/heads/dev`, não configurável. `isAllowedIntegrationTargetRef` compara
  exatamente; SQL recusa qualquer outro alvo no nível da autorização e do receipt.
- Repositório: `git remote get-url <remote>` precisa bater com `ANIMA_INTEGRATION_REPOSITORY_ID`.
- **Alvo em checkout em qualquer worktree ⇒ `target_checked_out` (human_required).** Mover uma branch em
  checkout dessincronizaria a árvore de trabalho do operador. Consequência prática: no checkout atual do
  Anima (`G:\anima`, com `dev` em checkout) o executor recusa. Operar exige um clone de integração
  dedicado (`ANIMA_INTEGRATION_REPO_ROOT`).

## TOCTOU

Autorização: `expectedTargetSha = X`. Execução: `rev-parse refs/heads/dev` precisa ser `X`. Se o alvo
mudou, não há rebase, recálculo, troca de fonte nem atualização da autorização: o resultado é
`authorization_stale` (human_required), e nova base exige nova decisão humana. O avanço final é
**compare-and-swap** (`git update-ref refs/heads/dev <merge> <X>`).

## Execução

1. revalidar fatos + configuração;
2. repositório; commit existe; commit descende do `baseSha` do handoff;
3. inspecionar o alvo e classificar: `ready` | `already_effected` (alvo é o merge exato com pais
   `[X, commit]`) | `ambiguous` (contém o commit sem ser o merge exato) | `stale`;
4. alvo não pode estar em checkout;
5. preparar **sem tocar o alvo**: `git merge-tree --write-tree X commit` (conflito ⇒ `merge_conflict`,
   alvo intacto);
6. `git commit-tree <tree> -p X -p commit` (merge `--no-ff` do commit EXATO); pais conferidos;
7. CAS; 8. observar de novo; 9. persistir o receipt.

Não usa worktree nem a branch de origem: só o commit exato (integra mesmo com a branch removida).

## Receipt observado (`integration_completed`, author=system)

`IntegrationEffectReceiptV1`: `operationKey`, `authorizationId`, item, versão, attempt, resultado
aceito, commit do resultado, repositório, `targetRef`, modo, `previousTargetSha` (= esperado),
`resultingTargetSha` (= merge), `mergeCommitSha`, `mergeParents [esperado, resultado]`,
`observed: true`, `disposition` (`effected` | `reconciled`). `record_integration_completed` recusa
qualquer campo que não reproduza a autorização (pais, alvo, SHA anterior…). É append-only: um receipt
por autorização e no máximo uma integração por item (V0).

## Idempotência

- Mesma operação: índice por autorização e por item. Replay aceito por **identidade do efeito**
  (a disposição pode diferir entre execução e reconciliação); efeito divergente ⇒ `integration receipt
  conflict`.
- Já integrado: sucesso (`already_persisted`) **só** se o Git ainda comprova (merge existe, pais
  batem, merge é ancestral do alvo atual). Senão ⇒ `integrity_violation`.
- Receipt com chave de operação divergente ⇒ `integrity_violation` (`receipt_conflict`).

## Reconciliação Git × Postgres

Protocolo: autorização persistida → revalidar → inspecionar → preparar → efeito → inspecionar →
persistir. O receipt **nunca** é gravado antes do efeito observado.

- Git feito e DB falhou ⇒ `reconciliation_required` (com o receipt). A próxima chamada vê o alvo como
  `already_effected`, persiste `reconciled` e **não repete o merge**.
- Alvo contém o commit sem receipt exato ⇒ `ambiguous_target` (não conclui sucesso).
- Receipt + drift no Git ⇒ `integrity_violation`.
- Concorrência: os dois executores preparam, só um vence o CAS. O perdedor reobserva e, se o alvo é o
  merge exato, reconcilia o MESMO receipt (replay); nunca há um segundo merge.

## Semântica de falha

| Situação | Resultado |
|---|---|
| alvo avançou | `human_required: authorization_stale` |
| conflito | `human_required: merge_conflict` (alvo intacto) |
| commit ausente | `human_required: result_commit_missing` |
| autorização/resultado/versão errados | `denied: <defeito>` |
| falha Git antes do efeito | `retryable` |
| resultado incerto / erro não-Git | `reconciliation_required` |
| DB falha após Git | `reconciliation_required` → replay por inspeção |
| receipt + Git compatíveis | `integrated: already_persisted` |
| receipt/Git divergentes | `integrity_violation` |
| cleanup falha | `integrated` com `cleanup: failed` (hook opcional; integração válida) |

## Fronteira humana

Nunca `completed → merge` automático. O humano aceita o resultado (`completed`) e, **separadamente**,
autoriza o efeito exato. O sistema só executa o que foi autorizado. Nenhum LLM decide. Sem
integração com Autonomy Readiness, sem `agency.integrate-change`, sem herdar autoridade de
produce-change (registry intacto).

## Testes

- pgTAP `integration_effect.test.sql` (23): sem aceite ⇒ recusa; aceite sozinho não autoriza nem integra;
  `refs/heads/main`, `origin/main` e alvo fora da allowlist recusados; modo e SHA inválidos recusados;
  resultado/versão divergentes; commit derivado do handoff; `author=user`; replay; conflito;
  estado inalterado; `integration_decided` não serve; receipts com pais invertidos, com `main` ou com
  SHA anterior ≠ esperado recusados; receipt exato gravado como `system`; replay com disposição
  diferente; efeito divergente ⇒ conflito.
- Core `integration-effect.test.ts` (27): allowlist (8 alvos negados); plano ok; sem autorização;
  `integration_decided`; `author≠user`; outro resultado; versão/attempt/commit; sem aceite/não
  concluído; alvo/modo/repo; chave de operação; item errado; classificação ready/stale/already_effected/
  ambiguous/pais inesperados; receipt exato; receipt recusado; igualdade por efeito independente de
  disposição e ordem de chaves.
- Web `integration-effect.integration.test.ts` (18, **Git real temporário**): 1/15 integra com merge
  `--no-ff` exato e `main` intocada; 2/13 zero Git sem autorização; 5 stale; 6 commit ausente;
  7 conflito com alvo intacto; 8/9 DB falha → replay reconcilia sem novo merge; 10 duplicata;
  21 concorrência (um merge, um receipt); 17 ambíguo; 18 drift ⇒ integridade; 22 pais inesperados;
  23 chave divergente; 19 branch de origem removida; 20 cleanup falha; alvo em checkout; 11 repo
  divergente; 26 payload com `main` ignorado; autorização humana deriva tudo.
- Core 2297/2297; typecheck OK; `git diff --check` OK. Web 1974/1977: `project-context-builder` e
  `worktree-executor` são flakes de carga conhecidos (4/4 e 56/56 isolados). Suíte SQL: as mesmas 3
  falhas pré-existentes da unidade anterior (`compute_routing_decision`, `budget_blocked_human_resume`,
  `work_budget_local_vs_external`), nenhuma relacionada.

## Limitações / próximo passo

- Efeito **local** em `refs/heads/dev` do repositório configurado; sem push para o remote.
- Exige um clone de integração sem `dev` em checkout (o checkout principal é recusado por construção).
- Sem superfície UI/CLI para os dois atos (autorizar / executar); só a primitive.
- Uma integração por item (V0).
- Readiness/authority próprias de integração: trabalho futuro.

---

## Authorship hardening (2026-09-28, Trusted System Writer V0)

Achado de auditoria independente: `record_integration_completed` era executável por `authenticated`.
Uma sessão humana podia fornecer um receipt internamente coerente e a função gravava `author=system`
sem que o Git tivesse sido executado. A validação SQL prova **consistência dos campos com a
autorização**; ela não prova existência do merge commit, pais reais, avanço de `refs/heads/dev`,
ancestralidade nem observação Git.

**`author=system` é fronteira de confiança, não rótulo de payload.**

- `record_integration_completed` agora só executa para o papel `anima_system_writer` (a mesma boundary
  do Verifier; ver `2026-09-28-mandated-verifier-enforcement-v0.md` §V0.2). Humano/anon: recusados pelo
  GRANT e pela função.
- `executeAuthorizedIntegration` (inalterado: dev-only, `main` protegida, `expectedTargetSha`,
  `merge_no_ff`, CAS, inspect → mutate → inspect, reconciliação, idempotência) persiste pelo
  `TrustedSystemWriter.integrationReceipt`. `executeAuthorizedIntegrationWithSupabase` exige o sink do
  writer explicitamente; o `client` humano só lê estado.
- `authorize_integration_effect` **permanece humano** (`author=user`).
- Projeção endurecida (defesa em profundidade, não substitui a identidade): `projectIntegrationCompleted`
  só considera `author=system`; `integrationReceiptMatchesAuthorization` valida integralmente o receipt
  (autorização, item, resultado aceito, attempt, commit, repositório, alvo, SHA esperado, SHA resultante,
  pais, modo, operationKey, observado). `projectIntegrationStatus` devolve `integrated` só com receipt de
  sistema válido e autorização humana correspondente (senão `invalid_receipt`/`not_integrated`).
  O plano marca `persistedMismatch` e o executor o trata como `integrity_violation`.

**O banco sozinho não prova Git.** A prova é a composição: executor confiável → observa o Git →
TrustedSystemWriter → receipt persistido. O SQL não recomputa o Git.

`integration_completed` passa a significar "receipt produzido pela identidade sistêmica após observação
pelo executor", e não "um usuário chamou uma SECURITY DEFINER". Maturity/readiness de integração não
mudam nesta unidade.

### Corrida checkout × CAS

Entre `targetCheckedOut()` e o `update-ref` CAS há uma janela: alguém pode dar checkout em `dev` numa
worktree desse repositório. O CAS garante que o **ref** não seja corrido (nenhum merge silencioso sobre
outro valor), mas não impede mover uma branch recém-checada. Com o **clone de integração dedicado** (sem
operador humano trabalhando nele), a propriedade é aceitável para o V0. Backlog explícito: reconferir o
checkout depois do CAS e reportar `integrity_violation`, ou travar via `git worktree lock`. Não
implementado.

### Testes

pgTAP `trusted_system_writer.test.sql` (autorização humana ok; humano não grava receipt, nem um falso
e coerente; writer grava e faz replay). Core `integration-effect.test.ts` +11 (receipt de sistema válido
⇒ integrated; `author=user` não conta; 7 receipts que não reproduzem a autorização ⇒ `invalid_receipt`;
sem autorização humana ⇒ `invalid_receipt`; `persistedMismatch`). Git real temporário +1: sem writer o
efeito fica `reconciliation_required` sem receipt; com o writer reconcilia sem novo merge; `main`
intacta; replay idempotente.

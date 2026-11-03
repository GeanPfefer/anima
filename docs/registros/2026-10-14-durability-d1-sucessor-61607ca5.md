# 2026-10-14 — Durability D1: sucessor 61607ca5, attempt 3a8ef24d (candidato com gate vermelho)

Registro append-only. Antecedentes: `2026-10-14-durability-d1-attempt-05d54bb2.md` (item 4dd96db2, falhou por instrução > 24000), `docs/planos/070-d1-preparacao-e0-v2.md`. US$0. Nenhum dado real do ANIMA foi lido pelas ferramentas ou testes; nenhum dump, backup ou restore.

## Resultado

**`execution_failed`** (seq 86744): `[gate_failed] … lib/restore-proof/restore-proof-gate.test.ts terminou com código 1`. Há **candidato preservado**: checkpoint `f3cb77aea981387ca26da1e6635acc45f10e6014` (filho único de `b6d2dda`, 1 commit, 0 merges), branch `anima-work/3a8ef24d-c786-4a8d-9cf5-c3959155dec9`, exatamente os 6 arquivos do escopo (+572 linhas), blobs em LF. Nada foi aceito, integrado ou publicado.

## Item, contrato e preflight

| Fato | Valor |
|---|---|
| Item sucessor (independente, não é retry/recovery) | `61607ca5-a818-496b-9553-f2a5b290bc36`, v1, base `b6d2dda`, mensagem fonte `f5914f61-c5db-413d-9988-683919654afc` |
| Contrato | `acceptance_contract:2`, sem `resume_from_checkpoint`, `max_attempts:1`, 40 min; 3 critérios (test_binding `min_new_tests:5` em `lib/restore-proof/restore-proof-gate.test.ts`; typecheck web; escopo) |
| Lint / elegibilidade / allowlist / Codex readiness | v2 sem achados; elegível sem lacunas; ambos os gates na allowlist; `singleItemCodexRefusal=null` (com `ANIMA_CODEX_*` só no processo) |
| **Instrução final medida (sem iniciar attempt)** | **15594 caracteres** (limite 24000; margem 8406; meta < 18000). Método: `measure_prompt.mjs` reproduz `buildExecutorRequest` → `validationCommands` → `buildNativeCliPrompt` e foi **calibrado contra a falha real**: com o contrato antigo reproduz exatamente **25547** |
| Objetivo | 10133 caracteres (era 20027); critérios, aceites, escopo incluído/excluído e restrições preservados; sem blocos SQL embutidos, só especificação e snippets de sintaxe |
| Referências | O prompt do host manda o Codex trabalhar só na worktree; `G:\anima-durability` não é acessível ao executor, então nenhuma referência externa foi usada |
| Aprovação / classificação | `work approve` → `approved`; classificação humana seq 86737 (`bounded/low/reversible/clear/normal`) |
| Orçamento | única recusa `user_attempt_budget_exhausted` (18 attempts/24 h; o runtime 7749 s ≥ 7200 s é da mesma cota interna); item 0/1 |
| Lease E0 | `ae642ca7-a650-4f00-a238-a9de36c9e1cc`, 07:16:13–07:46:13Z, concedido só por essa recusa; **expirou durante a attempt e foi revogado/confirmado após o resultado** (0 leases vigentes) |

### Execução

Duas invocações de `execute-one` foram recusadas com `resource_pressure` **antes de qualquer evento** (RAM livre oscilando 20–26 %, limiar ≈ 25 %). Foram tratadas como a mesma tentativa ainda não consumida, e o `execute-one` foi relançado esperando `permit` (RAM 26 %). A attempt `3a8ef24d-c786-4a8d-9cf5-c3959155dec9` rodou 07:41:50–07:47:14Z (Codex 4 min 52 s até o checkpoint). Eventos 86738–86748: roteamento, claim, `work_started`, `execution_started`, `checkpoint_recorded` (86743), `execution_failed` (86744), evidências do host (gates, coder, resumo), `work_claim_released`.

## Gates do host

| Gate | Resultado |
|---|---|
| `npm test --workspace=@anima/web -- lib/restore-proof/restore-proof-gate.test.ts` (test_binding) | **failed**, 30,4 s, exit 1; 3 de 5 testes Jest falharam, “interpretador Python” e “sem arquivos novos” passaram |
| Typecheck web | não avaliado após a falha do 1º gate |
| Verifier | `execution_failed` sem resultado submetido ⇒ **não há parecer do Verifier** (o item não vai a `review`) |

Saída-chave do gate: `RuntimeError: Synthetic SQL fixture failed (exit 3)` em `setUpClass`, `Ran 0 tests`.

## Revisão independente (containers sintéticos, scratch apagado)

**Causa-raiz exata**: na fixture do teste Python, a tabela `private.memory` tem uma coluna chamada **`binary`**, palavra reservada do PostgreSQL → `syntax error at or near "binary"` → `setUpClass` falha → nenhuma das 24 verificações roda. O coder não pôde executar o teste (sem Docker no WSL).

**Prova de que é o único defeito funcional**: com o diff mínimo abaixo (renomear `binary` → `blob_col` em 2 linhas do teste; evidência em `G:\anima-durability\evidence\d1b\fixture-binary-keyword.diff`), a suíte do candidato roda **24/24 OK em 37,5 s** (containers `anima-restore-proof-test-*` removidos; 0 containers residuais). Num checkout com autocrlf (CRLF no working tree) o teste `test_format_and_readme` falha porque lê bytes do working tree; os **blobs commitados são LF** (CR=0 nos 6 arquivos). Isso é fragilidade do teste, não do conteúdo.

**Sondas independentes das ferramentas SQL** (minhas referências validadas × candidato, mesma fixture):

| Ferramenta | Comparação |
|---|---|
| `memory-snapshot.sql` | 15 linhas; 14 idênticas (todos os digests de tabela, constraints, índices, colunas, órfãs, cobertura). Única diferença: sequência `500:t` (candidato) × `500:true` (minha referência); o candidato segue a gramática pedida (`<t|f>`) |
| `roles-projection.sql` | Idêntica, salvo 3 linhas `membership|pg_*|member=pg_monitor` adicionais (mais completa; inofensiva) |
| `quiescence-gate.sql` | Saída **idêntica** à minha referência; claim vigente ⇒ FAIL `claims_live` exit 3; evento recente ⇒ FAIL `recent_events` exit 3; `-v min_quiet_seconds=0` ⇒ PASS |
| Estático | Nenhum DML/DDL, `rolpassword` ou `pg_authid` (a única ocorrência de INSERT/DELETE é a lista `VALUES ('SELECT'),…` de privilégios) |

Limites desta revisão: não rodei o Jest wrapper no scratch (sem `node_modules` ali), então o gate completo com o conserto não foi observado; a prova do conserto é a suíte Python (24/24) mais a leitura do wrapper (47 linhas).

## Estado final

- Git: `dev = origin/dev = b6d2dda`, `origin/main = 99bec54`; sem commits novos em `dev`; `git status` só ganhou documentos de registro (untracked); worktree da attempt já removida; branch do candidato preservada.
- Supabase: 156 migrations; seq **86748**; item `failed` v1; 0 claims vigentes, 0 leases vigentes; a claim histórica de julho segue aberta e inalterada.
- Sem retry do item FAILED, resume, work accept, integração, push, migration, dump/backup/restore reais, API paga ou alteração manual de código.

## Lacuna de governança e guard proposto (NÃO implementado)

**Lacuna**: o lint do contrato (`lintItemAcceptanceContract`), a elegibilidade, a aprovação e a classificação aceitaram uma proposta cuja instrução final (25547) excedia o limite real do Codex CLI (`NATIVE_CLI_PROMPT_MAX_CHARS = 24000`, `apps/web/lib/work-orchestration/native-cli-coder.ts`). A recusa só ocorreu dentro da attempt (`runNativeCliTurn`), depois de consumir claim, lease E0 e uma das 6 attempts diárias.

**Guard proposto** (futuro item governado):
1. Função pura `measureCoderPromptChars(item, spec, contextReferences)` que reutiliza `buildExecutorRequest` + os `validationCommands` do `worktree-executor` + `buildNativeCliPrompt`, para o backend escolhido (`codex-cli`/`claude-code`); calibrada pelo caso 25547.
2. Executada (a) na criação/aprovação da proposta (achado novo do lint, p.ex. `coder_prompt_over_limit`, com margem de segurança de 10 %), (b) em `work executors`/`prepare-autonomous` e (c) no admission antes de `work_claimed`/de gastar lease, de modo que a recusa ocorra sem consumir attempt.
3. Para a margem, considerar também o tamanho das referências de contexto e do `hostValidationFeedback`.
4. Testes de contrato: caso 25547 (recusa), caso 15594 (aceita) e prompt exatamente no limite.

## Próximos passos possíveis (exigem novo mandato)

1. **Sucessor** só para corrigir o defeito da fixture (o contrato sucessor atual cabe nos limites); ou
2. **Revisão humana do candidato** `f3cb77a` com o conserto de 2 linhas aplicado fora do ledger (isso é alteração manual de código, fora do mandato atual); ou
3. Tratar o conserto como item governado minúsculo sobre `f3cb77a` (base) com escopo apenas em `supabase/tests/restore_proof_snapshot_test.py` e `restore-proof-gate.test.ts` se necessário.
A cota de 24 h só libera a partir de ~2026-10-14T21:03Z; antes disso, novo lease E0 também precisa de autorização.

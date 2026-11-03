# 2026-10-13 — Verifier I2a (Core): item `8013c5e2`, attempt `9351a91d` — verified (v4), em review

Branch dev, HEAD `3c7aab87` inicial e final (= origin/dev). Sem commit, push, migration, Host contínuo, retry, recovery, aceite ou integração; sem API paga. Plano: [058](../planos/058-verifier-v4-i2-test-binding.md).

## Item e governança
`8013c5e2-80a4-4aaa-be4e-25545a408684` v1, base `3c7aab87…`, `acceptance_contract:2`, sem `resume_from_checkpoint`, 5 arquivos Core (`gate-test-report(.test).ts` NOVOS, `host-observed-gate-evidence(.test).ts`, `index.ts`), 1 tentativa/35 min (menos que o máximo de 40: a janela autônoma de 60 min tinha 2229 s), codex-cli/default via WSL. Gates path-restritos: `work-orchestration/gate-test-report work-orchestration/host-observed-gate-evidence`, typecheck core, suíte core + escopo. Lint v4: 0 achados; elegibilidade 0 lacunas.
Medições empíricas do Jest 29 incorporadas à especificação: `pending` cobre skip e filtrado; suíte quebrada = `failed` com 0 asserções (`numRuntimeErrorTestSuites`); suíte `focused`; **retry em `invocations>1` (`retryReasons` vem vazio — corrige o plano 058)**; total = passed+failed+pending+todo.
`work_proposed` 86466, `context_attached` 86467, `work_approved` 86468, classificação humana 86469. Preflight PASS: HEAD==base==origin/dev, 3 arquivos limpos e 2 novos inexistentes, permit/RAM 8,6 GB (54%), orçamento 0/1 (tentativa 6 de 6 nas 24 h; próxima liberação 2026-10-14T03:28:50Z), import nativo do Core v4 OK, Codex WSL null, sem codex/node.

## Attempt única `9351a91d-f688-40f6-8b3c-4bcac627075d`
22:22:10Z–22:28:32Z (6 min 22 s; Codex 346 s), `execution_completed`, eventos 86470–86481, claim `59f317d1` liberada `attempt_finished`, item **review** v1. Gates do host: focado passed 6,7 s; typecheck core 4,4 s; suíte core 21,6 s. Verifier `work-verifier-v4`: **verified**, 14 checagens, 0 lacunas, 0 violações, 5 independentes; 4 aceites cobertos.
Checkpoint `828f2d180100e9c13d2b15003a71353dfc330d2b` (filho único de `3c7aab87`), branch `anima-work/9351a91d-f688-40f6-8b3c-4bcac627075d`, 5 arquivos (gate-test-report +232, teste +198, evidência +13 reais, teste +56, index +2). NÃO integrado.

## Revisão independente (worktree em `.worktrees`, layout do host; removida; 0 junções restantes; node_modules principal 742)
- Gate focado 2 suítes/140 testes; typecheck core limpo; core completo **120 suítes/2740 PASS**; web `tsc` 0 erros (consumidor com o novo core).
- Sonda `i2a_probe.mjs` (66 verificações) com JSON REAL do Jest (suíte mista, e 37 testes do core) + adversariais: **65/66 PASS**. Cobriu: forma real (relativização, status, retried por invocations, runtimeError, focused, totais), sanitização (ANSI, caminhos, senhas, Bearer, sk-, URL com credencial, chave privada, `/home/...`), todas as inconsistências de contadores, `success` contraditório, truncamento, duplicatas, path fora da raiz/`..`, segredo no nome, vazio, limites 2000/2001/400, `__proto__`, nunca lança, determinismo (embaralhado = mesmo digest; raiz com barras invertidas/caixa diferente), adulteração no parse (status, digest, campo extra, retried, ordem, failure não sanitizada) ⇒ null, SHA-256 == `node:crypto` em amostras UTF-8/4 bytes/limites de bloco/surrogate solto, evidência (sem testReport = sem a chave; inválido omitido sem invalidar o gate; roundtrip; shadow decisions inalteradas; outcome só por exitCode; teto 4000 testes por evidência). Relatório sem campos de git/gate/raiz.
- Replay Verifier/evidências (157 itens, 50 pareceres): **0 deriva** (veredito/achados/contagens/humanReview); `d795e414` segue rejected; nenhuma evidência real emitiu `testReport` (o único match textual é o escopo do contrato).

## Achados / ressalvas
1. **FAIL da sonda (limitação da especificação, não do candidato):** o relatório real de `acceptance-contract-lint` + `verifier-opinion` ⇒ `indeterminate:duplicate_test` (`test.each` com títulos idênticos, p.ex. `%s` de `'2'` e `2`). Medido no core inteiro: 2 de 120 suítes (2%) têm nomes repetidos (16 testes). Fail-closed (nunca prova), mas torna essas suítes não-vinculáveis. Tratar no I2c (p.ex. manter as duplicatas desambiguadas por ordinal e exigir que TODAS passem) ou num follow-up.
2. **Churn de EOL:** `host-observed-gate-evidence.ts` tinha EOL misto (301 CRLF + 183 LF) e o Codex (WSL) o regravou 100% LF: diff bruto +314/−301, mas ignorando EOL a mudança real é **+13/−0** (conferida linha a linha). Semanticamente inócuo; `git diff --check` limpo. Ruído de histórico/blame; possível risco recorrente para arquivos CRLF editados pelo Codex WSL.
3. O arquivo-base contém 1 byte NUL preexistente (idem no candidato).
4. Orçamento: sem tentativas restantes nas 24 h até 2026-10-14T03:28:50Z.

## Estado final
Item `review`; claim liberada; 0 claims válidas; ledger 156; max seq 86481; sem codex/node; HEAD/status Git idênticos (+docs untracked); 46 worktrees; origin/dev `3c7aab87`, origin/main `99bec54e` inalterados; sem outro item I2 criado.
GO/NO-GO aceite humano: **GO com ressalvas 1–2** (semântica correta e fail-closed; EOL é só ruído). Integração em clone dedicado (procedimento I1) só após o aceite.

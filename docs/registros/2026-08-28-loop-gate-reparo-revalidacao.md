# Loop gate → reparo → revalidação do coder local

- **Data/tipo:** 2026-08-28 — desenvolvimento + prova viva local.
- **Objetivo:** fechar um reparo estreito dirigido por falha de gate, sem nova
  attempt, sem ampliar autoridade e sem consumir a tentativa canônica.
- **Branch / HEAD inicial:** `dev` / `6594136`.
- **HEAD final:** commit documental que contém este registro.

## Mudanças e decisões

- O `WorktreeExecutorAdapter` admite um único reparo interno para Ollama e
  DeepSeek Harness; OpenAI permanece com limite zero.
- O feedback efêmero inclui gate, diagnóstico sanitizado, arquivos alterados e
  SHA-256 do diff sem expor o diff.
- Falhas ambientais, timeout, cancelamento, preparação, escopo e segurança não
  entram no reparo. Diff idêntico encerra antes de reexecutar gates.
- O prompt do Ollama explicita a fase de reparo e exige leitura do estado atual,
  correção da implementação existente e prova determinística.
- `tools/coder-evidence/repair-harness.ts` reproduz a prova em worktree/branch
  únicas com patch inicial quebrado determinístico e reparo Ollama real.

## Provas

- Typecheck web: passou.
- Testes focados: 66/66 passaram em quatro suítes selecionadas pelo Jest.
- Gates amplos: typecheck dos cinco workspaces passou; mobile 51/51, core
  1191/1191 e Supabase 9/9 passaram; build web passou. Web terminou 992/993 no
  lote porque `project-tools.test.ts` excedeu 5 s sob carga e passou isolado
  imediatamente (4/4; busca em 80 ms), classificado como flake conhecido.
- Prova conclusiva `repair-live-smoke-9`: invocações `initial, repair`; gates
  `typecheck=0, testes=1, typecheck=0, testes=0`; terminal `result`;
  `achieved=true`.
- Smokes 2–6 falharam antes dos gates por schema/read budget/âncora; smokes 7–8
  chegaram ao reparo, mas falharam na revalidação strict. Não contam como sucesso.

## Segurança, efeitos externos e limites

- Mesmo attempt, mesma worktree, no máximo um reparo e sem auto-integração.
- Nenhum work item, claim, attempt canônica, evento de banco ou budget foi
  criado/alterado. A attempt 2 do Successor A permanece intacta.
- Nenhum PR, merge, deploy, `origin/main`, provedor pago ou segredo foi usado.
- Consulta autenticada à API oficial do GitHub confirmou `GeanPfefer/anima`,
  `PushPermission=true`, mas `Visibility=public`. Como o mandato condiciona o
  envio ao repositório privado/autorizado esperado, nenhum push foi feito;
  `origin/dev` permaneceu em `62d205d` e os quatro commits seguem locais.
- Branches/worktrees de evidência e `.worktrees/`, `.claude/settings.local.json`
  e `watch4-sensors.txt` foram preservados.
- Relatórios brutos em `tools/coder-evidence/runs/2026-08-28-repair-*` são
  ignorados pelo Git. A prova não ratifica R2 nem garante toda edição inicial.

## Próximo ponto exato

Resolver humanamente a divergência entre remoto público e a condição de remoto
privado antes de push. A decisão de consumir a attempt 2 continua humana.

## Continuação canônica no mesmo dia

- O banco autoritativo distinguiu o original `0cedae21…` do Successor A
  `27c8d1ba…`: o successor tinha somente a attempt 1 `311ec98b…`; sua attempt 2
  estava disponível.
- O ato autorizado usou `request_work_retry` como o usuário proprietário e uma
  volta do Resident Host in-process. Foram persistidos `retry_authorization`,
  routing, claim e `execution_started` da attempt
  `de724bcb-2a55-4d1e-b432-989e62d064c6`.
- Terminal real: `worktree-create-failed`, `not a git repository`, antes do
  coder. O invocador ad hoc foi executado por `node -e` na raiz; `projectRoot()`
  pressupõe o cwd `apps/web` do script npm e resolveu `G:\` em vez do repo.
- Não houve modelo executado, reads, edits, gates, repair, evidência de coder/gate
  ou Verifier. O claim foi liberado e o item terminou `failed`, 2/2.
- A falha ambiental não acionou repair, coerente com o envelope. Nenhuma attempt
  3, reset de banco, mutação manual do item, successor, push, PR, merge ou deploy.
- **Conclusão:** o loop permanece comprovado isoladamente, mas **não** foi
  comprovado pelo caminho canônico nesta tentativa. A próxima prova exige nova
  decisão/unidade governada; a attempt 2 é irrecuperável sem violar append-only.

## Recovery autorizado após a falha ambiental

- Commit `71a1aff`: `projectRoot` descobre a raiz no cwd/ancestrais por marcadores
  do Anima; root configurado inválido e cwd fora da árvore falham fechados.
  Regressões 41/41, typecheck web e diff-check verdes.
- Successor `f7d50d04-b41d-4da8-bae9-6fedfea12335`; lineage
  `9ea51dcf-f7e0-470f-8411-be080abee5ee`, seq 1 do Successor A; escopo estrito
  somente em `work-routing.ts` e razão ambiental explícita.
- Attempt `3850dc97-5651-49cd-9777-926a7e6caeef`, modelo
  `qwen3-coder:latest`, digest `06c1097efce0…`: worktree criada, initial edit no
  source, gate focado falhou (exit 1, 4.902 ms), repair na mesma attempt/worktree
  e terminal `ollama_no_effective_edits`.
- Persistidos checkpoint do edit, gate host-observed falho e coder host-observed
  `failed`/64.551 ms. Sem re-gate, Verifier ou `result_submitted`; item 1/2.
- Recovery policy: `unknown`, `normalizedCode=null`,
  `human_required/failure_not_classified`. A attempt restante foi preservada.
- Efeito não planejado preservado: antes da classificação válida do alvo, o host
  selecionou `26f3c07f…`; com Ollama desligado, attempt `1453f735…` falhou em
  7 ms com `ollama_transport_error`, sem edit/gate. O histórico não foi limpo.
- Nenhum push, PR, merge, deploy, integração, reset ou mutação de `origin/main`.

**Conclusão:** o caminho canônico provou recovery → autorização → routing →
claim → worktree → coder → edit → gate → um repair. Ainda não provou re-gate,
Verifier ou terminal de sucesso; a policy vigente exige fronteira humana.

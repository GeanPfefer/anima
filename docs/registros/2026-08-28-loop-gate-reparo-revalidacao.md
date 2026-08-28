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

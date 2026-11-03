# 2026-10-02 — Akita Baseline V1: primeira prova viva técnica Codex CLI

Tipo: registro de prova relatada pelo humano + reconciliação de desenvolvimento.
Fonte dos fatos da execução: relatório humano recebido em 2026-10-02 nesta tarefa.
A execução não foi repetida nem observada novamente nesta sessão. Sem transcript
interno, segredos ou artefatos `.tmp` versionados.

## Prova técnica — PASS, NÃO GOVERNADA

- Base integrada do backend: `9404bd4039738c4fbfabd414db4d11ffd83383db`
  (sobre `6eb2dee4971ed7ae649b1bba795d572a2dfb8665`). O SHA exato da worktree
  usada na prova e um hash do resultado não foram fornecidos; não os inferir.
- Cadeia: ANIMA → WorktreeExecutorAdapter → CodexCliCoderBackend → Codex CLI
  nativo real → alteração TPC-01 → gate focal observado pelo host.
- CLI: preflight anterior identificou `codex-cli 0.159.0-alpha.12.1`, executável
  `C:/Users/GeanTeco/AppData/Local/OpenAI/Codex/bin/be3fd7e5c1969ff6/codex.exe`.
  Versão não reconsultada na prova nem nesta reconciliação.
- Autenticação da prova: ChatGPT/assinatura; Qwen não envolvido.
- Modelo reportado pelo CLI: `gpt-6.1-sol`; reasoning `low`.
- CoderTaskSpec: completa, conforme relatório humano; payload original não
  fornecido aqui e não reconstruído como se fosse a entrada executada.
- TPC-01: recusar posicionais extras e `--reason` ignorado no parser da CLI work.
  Contrato/aceites canônicos no [backlog TPC-01](../planos/008-primeira-prova-trusted-produce-change-backlog.md).
- Somente `apps/web/cli/args.ts` e `apps/web/cli/args.test.ts` alterados; mudança
  substantiva. E1/E2/E3 satisfeitos: recusa de IDs extras, recusa de `--reason`
  onde não permitido e preservação das formas válidas, conforme relatório.
- Gate focal host-side: PASS. Comando canônico do plano:
  `npm test --workspace=apps/web -- cli/args.test.ts`; argv/log brutos da prova
  não fornecidos nesta tarefa. Ausência de `contract_violation` relatada.
- Duração aproximada: coding 47,9 s; prova total 70,6 s.
- Sem push/integração da mudança; checkout principal e origin/main intactos.
- **Não houve work item governado, attempt, authority, Verifier ou review
  governada.** Não existem IDs dessas entidades para registrar nesta prova.
  O PASS técnico não conclui o backlog trusted/governado TPC-01.

## Representação e decisão epistemológica

`agency.codex-cli`: CURRENT FOCUS, WRAP, `reuse.status=integrated`.
Evidência real de escopo limitado registrada em `history.proof_added`, com refs
para o commit do adapter e este registro. O commit do adapter não é commit da
mudança produzida na prova. Claude Code e ai-memory continuam NEXT/candidate.
A categoria composta `agency.external-harness` permanece candidata: a integração
de Codex não realiza a composição com Claude.

Maturidade declarada Codex permanece **projected**, sem promoção manual. O
[Proof Engine](../arquitetura/capability-proof-engine.md) não tem regra para esta
capacidade: avaliação `not_evaluated`, derivedMaturity=null. Não foram criadas
regras ou observações canônicas para fazer a prova técnica parecer governada.
A ausência de promoção não apaga integração/PASS: ambos ficam visíveis na
sequência do objetivo e no painel, separados da maturidade. Próximo avanço:
prova governada e critério específico ratificado. Sem operational/autonomous.

## Sessão de reconciliação

- Branch/worktree: `codex/evolution-ux-v2`, `G:/anima/.worktrees/evolution-ux-v2`.
- HEAD inicial: `f87621ffa81715e72b39b58ddf8607d6038c92c4`.
- Rebase autorizado sobre `9404bd4039738c4fbfabd414db4d11ffd83383db`, sem conflitos;
  commit Evolution reaplicado como `f532c07fc9dc7b41266c17a4d70c19d0ce24afbd`.
- HEAD final: commit que introduz este registro, recuperável por `git log -1 --`
  seguido do caminho deste arquivo. Commit: Reconcilie a evolução com a prova
  técnica viva do Codex CLI.
- Mudanças: registry/história, testes do registry e avaliação, painel Evolution
  e teste, PRD, Plano 009 e status da arquitetura Akita. Backend preservado.
- PRD de origin/dev não foi modificado por 9404bd4: não houve conflito. Atualizado
  somente o bloco Evolution desta branch. WIP histórico externo não disponível
  nesta worktree foi deliberadamente deixado pendente para integração humana.
- Origin/main preservada: `99bec54e3ab42bfe882a8686cd1385d8058b916e`.
- Nesta sessão: nenhuma inferência/prova nova, banco, authority, provider call,
  execução Codex, push, merge em dev/main ou integração do resultado TPC-01.
  `.tmp` e WIPs de terceiros preservados; nenhum arquivo de backend alterado.
- Gates finais: core focal **8 suítes / 232 PASS** (`capability-map`, registry,
  proof e autonomy-readiness); Evolution/read model **4 suítes / 70 PASS**;
  typecheck de todos os workspaces **PASS**; build **PASS** (68 páginas);
  `git diff --check` **PASS**. Teste específico verifica not_evaluated e ausência
  de maturidade derivada para Codex apesar do PASS técnico registrado.
- Regressão extra de backend: suíte unitária existente **15 PASS** fora do
  sandbox, somente mocks/processos Node falsos, sem inferência. Duas suítes
  vizinhas (worktree e selection Codex) também passaram no lote inicial.
- Flake/ambiente: no sandbox, cleanup Windows da fixture fake falhou duas vezes
  com EBUSY em rmdir e deixou Jest aguardando handles; os testes individuais
  passaram na repetição. Comandos presos desta sessão interrompidos; repetição
  fora do sandbox passou com encerramento normal. Backend não alterado.
- Correção focal de teste UI: consulta de texto Reuso integrado tornou-se
  ambígua (legenda + painel); usar getAllByText preserva o aceite da UI. Lote
  Evolution completo repetido e verde. Sem regressão de implementação observada.
- Build: warning preexistente de múltiplos lockfiles/tracing root inferido em
  G:/anima; build concluído. Sem script de lint na raiz. Nenhuma falha de código
  pendente nos gates finais.

## Retomada

Integração depende de decisão humana explícita. Revisar esta branch e preservar
WIP documental externo quando integrar. Executar prova governada separada apenas
sob novo mandato; não fabricar histórico canônico a partir deste relato.

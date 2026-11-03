# Checkpoint de continuidade — 2026-10-08

Encerramento documental autorizado. Este arquivo é o ponto de retomada; os detalhes
permanecem no [contrato](../arquitetura/single-item-governed-execution-v0.md), no
[Plano 043](../planos/043-single-item-governed-execution-v0.md) e no
[registro de implementação e testes](2026-10-08-single-item-governed-execution-v0.md).
Não substituir esses documentos nem duplicar seu procedimento técnico completo.

## Estado local confirmado neste encerramento

- Branch `dev`, HEAD inicial/final `6bc4aadef9414d655600c2ea37c6be436b3628c8` (`6bc4aad`).
- Upstream local `origin/dev`: quatro commits à frente, zero atrás. São referências
  locais consultadas sem fetch; não representam uma verificação remota atual.
- Índice vazio. Nenhum commit criado durante Single-Item V0 ou este checkpoint.
- Entrega no working tree; sem staging, push, reset, clean ou prune.

Commits já existentes, do mais recente ao mais antigo:

```text
6bc4aad Corrija fase de investigações read-only concluídas
a9b95aa Adicione revisão nativa de investigações ao CLI
8548f6a Registre o Marco 009 Resiliência por Substituição
fcb8243 Adicione transporte WSL opt-in ao investigation-v1 e readiness do Codex via WSL
```

## Investigações — fatos conhecidos, sem nova consulta residente

| Item | Último estado conhecido | Fonte/limite |
|---|---|---|
| INV-09 | review v1 | Preflight anterior, leitura autenticada; preservada |
| INV-10 | completed v2, resultado partial | Leitura anterior pelo CLI e registro da revisão; concluída não significa auditoria total/conclusiva |
| INV-11 | proposed v1, zero attempts, sem aprovação ou execução | Criação única pelo CLI oficial e leituras show/evidence/budget no preflight anterior |

INV-10: UUID `6de8e0eb-0be2-486e-9c2c-16f1c2931331`, uma attempt conhecida,
26 findings/7 gaps; recuperação do relatório, parecer técnico e aceite humano
correlacionados descritos em [Investigation Review V1](2026-10-08-investigation-review-v1.md).
O aceite humano não prova disponibilidade atual nem verdade/completude de todos os findings.

INV-11 (INV-10b — Domínio pessoal e interfaces): UUID
`aa6b3d64-1e0b-414d-984d-5264b9c89968`; snapshot
`8548f6af5b7059039cec465bb92102ed22f49574`; contrato conhecido `read_only`,
`investigation-v1`, `codex-cli/default`, `workspace_read`, Verifier advisory,
uma attempt/30 minutos. Memória narrativa, Prisma, jornadas/projetos/objetivos,
web/mobile/CLI, persistência/RLS e divergências manifesto/PRD/registry.
Não repetir o inventário da INV-10. Nenhuma execução autorizada neste encerramento.

No preflight anterior a fila canônica estava vazia, mas havia seis itens approved;
Resident Host parado; Codex WSL 0.161.0 autenticado por ChatGPT; Governor permit/low.
São observações anteriores, **não reconfirmadas aqui**, e não garantem saúde/quota
ou isolamento futuros. Não iniciar o Host global só porque a fila parecer vazia.

## Single-Item V0 — entrega parcial, não operacional

Implementados localmente: `work execute-one <UUID> --version <N> [--json]`, mandato
explícito no core, leitura por item/dependências completed, checks de estado/versão,
um ciclo/uma volta, sem fallback ao backlog, sem classificação automática ou
manutenção global. Host Turn, driver e Supervisor existentes foram reutilizados;
nenhum segundo harness. SIGINT/SIGTERM propagam cancelamento.

O adapter e o Supervisor recusam `single_item_atomic_claim_unavailable` antes de
compute, eventos mutantes, claims ou attempts. **Não há caminho de execução real
concluído**, flag de bypass, recuperação implícita ou proof-of-operation desta fatia.
Os critérios pendentes continuam desmarcados no Plano 043.

Dois bloqueios identificados por **inspeção do SQL versionado**, não por prova viva:

1. `acquire_work_claim` pode liberar claim vencido de outro item do mesmo alvo e
   escrever evento nele (`20260721000004_target_exclusivity.sql`). Um filtro ou
   pré-checagem TypeScript não fecha a corrida até o lock transacional.
2. `start_commanded_work_attempt` evita essa liberação alheia, mas o enforcement
   atômico do orçamento aplica-se a execution_started com claim_id
   (`20260905000000_budget_blocked_human_resume.sql`). Trocar para início comandado
   enfraqueceria a governança; essa alternativa não foi conectada.

Preservar claim exclusivo, locks/ocupação de alvo, aprovação/classificação vigente,
UUID/versão, replay, orçamento atômico e event log append-only. Não contornar a
recusa usando Host global, início comandado, service_role ou work supervise
(este último chama readmissão global). Ver mapa completo de efeitos na arquitetura.

## Evidência realizada versus trabalho futuro

- Na implementação anterior: **298 testes PASS em 12 suítes Jest determinísticas**;
  parser/CLI, recusas por versão/estado/inelegibilidade, ausência de fallback,
  seleção SQL divergente, nenhum efeito cloud/compute/evento e regressões globais.
- Typecheck core/Supabase PASS; web excluindo scripts/_session PASS. Web completo
  tem erros preexistentes nos scripts scratch; não corrigidos/removidos. Sem build.
- Testes com doubles comprovam as recusas locais, **não execução single-item real**,
  isolamento RLS entre usuários, atomicidade SQL concorrente ou quota do Codex.
- Neste encerramento: somente leitura local de documentos/Git/diffs e gravação
  deste checkpoint. Nenhum teste, CLI autenticado ou consulta ao banco foi repetido.
- Intenções futuras: primitiva SQL scoped, provas de concorrência/budget e posterior
  attempt governada. Não foram implementadas, aplicadas ou executadas.

## Retomada concreta — exige nova autorização humana

BLOCKED_BY_HUMAN_DECISION: obter autorização específica para uma fatia de migration
que introduza aquisição de claim estritamente por UUID/versão, sob os mesmos locks,
recusando claims alheios inclusive vencidos **sem liberá-los**. Preservar o início
sob claim e sua guarda atômica de orçamento, sem alterar o fluxo global.

Antes de conectar/remover a barreira: testes SQL de isolamento, versão/estado,
claims ativos/vencidos de outros itens, corridas no mesmo alvo, replay e orçamento
concorrente/esgotado; depois regressões TypeScript do Host Turn/Supervisor/global.
Aplicação de migration, regeneração de tipos e prova com banco precisam fazer parte
da autorização futura. Não inferir que o schema vivo corresponde ao repositório.

Somente após os gates e autorização separada para INV-11: reconferir v1/snapshot,
zero attempts, Host parado, contrato, fila, orçamento e login WSL; aprovar e preparar
classificação pelo CLI e executar uma única volta por UUID/versão. Recuperar
show/evidence/investigation e parar em review/terminal; erro ambíguo não autoriza retry.
Os comandos exatos condicionais estão na arquitetura. **Nada dessa retomada é
uma autorização de execução atual.**

## Manifesto exato da entrega local

14 arquivos versionados com diff, integralmente pertencentes à fatia Single-Item:

```text
apps/web/cli/README.md
apps/web/cli/anima.ts
apps/web/cli/app.ts
apps/web/cli/args.test.ts
apps/web/cli/args.ts
apps/web/cli/render.ts
apps/web/lib/work-orchestration/autonomous-backlog-deps-preflight.test.ts
apps/web/lib/work-orchestration/autonomous-backlog-deps.ts
apps/web/lib/work-orchestration/autonomous-backlog-read.ts
apps/web/lib/work-orchestration/backlog-host-turn-run.test.ts
apps/web/lib/work-orchestration/backlog-host-turn-run.ts
apps/web/lib/work-orchestration/supervisor.test.ts
apps/web/lib/work-orchestration/supervisor.ts
packages/core/src/work-orchestration/index.ts
```

Cinco arquivos novos da implementação/documentação Single-Item:

```text
apps/web/cli/execute-one.test.ts
packages/core/src/work-orchestration/single-item-execution.ts
docs/arquitetura/single-item-governed-execution-v0.md
docs/planos/043-single-item-governed-execution-v0.md
docs/registros/2026-10-08-single-item-governed-execution-v0.md
```

Arquivo compartilhado, com inclusão **somente parcial**:

- `anima-prd.md`: incluir apenas o hunk final cujo título é
  `## Estado local — Single-Item Governed Execution V0 (2026-10-08)` e os separadores
  imediatamente anteriores. Não incluir o hunk inicial preexistente descrito abaixo.

Novo arquivo deste encerramento:

```text
docs/registros/2026-10-08-checkpoint-continuidade.md
```

Total: **21 caminhos** (20 da entrega anterior + este checkpoint).
O manifesto é fronteira de conteúdo para revisão futura, não autorização de commit.
Nenhuma migration, types gerados, configuração de ambiente ou item histórico pertence
à entrega. O patch em /tmp da sessão anterior é auxiliar e não é fonte durável;
a fonte de continuidade é este repositório.

## WIPs preexistentes — fora de qualquer commit desta entrega

- `anima-prd.md`: **todo o hunk inicial +16 linhas**, entre o título do PRD e
  `> Ollama Coder Error Observability V1`: blocos Akita Baseline V1 (2026-10-02),
  TPC-01 prova local do successor e TPC-01 recovery operacional (2026-10-01).
  No arquivo atual, linhas 2–17; use o conteúdo/hunk como identidade, não apenas números.
- `docs/planos/008-primeira-prova-trusted-produce-change-backlog.md`: **todo seu diff
  +22 linhas**, seções `Atualização operacional — 2026-10-01` e
  `Resultado da attempt autorizada — 2026-10-01`, posteriores à linha 33.
  O arquivo inteiro está fora do manifesto desta entrega.
- Todos os demais untracked preexistentes listados abaixo, incluindo scratch,
  artefatos, planos/registros de outras sessões e diretórios de worktrees.
  Não incorporar por um add abrangente; não apagar para limpar o status.

Inventário Git prévio à gravação deste checkpoint, excluindo os caminhos da entrega:

```text
 M docs/planos/008-primeira-prova-trusted-produce-change-backlog.md
?? %SystemDrive%/
?? .tmp/
?? .worktrees/
?? apps/web/scripts/_session/
?? docs/planos/009-akita-baseline-primeira-prova-governada-backlog.md
?? docs/planos/010-akita-baseline-prova-governada-codex-backlog.md
?? docs/planos/011-akita-baseline-prova-governada-codex-v2-backlog.md
?? docs/planos/012-akita-baseline-prova-governada-claude-code-backlog.md
?? docs/planos/014-self-dev-cli-v1-executor-discovery-backlog.md
?? docs/planos/015-self-dev-cli-v1-referencias-legiveis-backlog.md
?? docs/planos/016-self-dev-cli-v1-recovery-de-candidato-backlog.md
?? docs/planos/017-self-dev-cli-v1-rework-estruturado-backlog.md
?? docs/planos/018-self-dev-cli-v1-reabrir-escopo-preservado-backlog.md
?? docs/planos/019-self-dev-cli-v1-preservacao-multinivel-backlog.md
?? docs/planos/020-self-dev-cli-v1-finalizar-referencias-legiveis-backlog.md
?? docs/planos/021-self-dev-cli-v1-finalizar-referencias-auditado-backlog.md
?? docs/planos/022-evolution-reconciliation-v2-sdc09-backlog.md
?? docs/planos/023-investigation-sessions-v0-core-backlog.md
?? docs/planos/024-investigation-sessions-v0-control-plane-wiring-backlog.md
?? docs/planos/025-inv01-investigation-sessions-self-audit-backlog.md
?? docs/planos/026-investigation-evidence-line-range-robustness-backlog.md
?? docs/planos/027-inv02-investigation-sessions-self-audit-reproof-backlog.md
?? docs/planos/028-inv03-operator-dependence-audit-backlog.md
?? docs/planos/029-first-class-investigation-preparation-backlog.md
?? docs/planos/030-first-class-investigation-preparation-corrected-scope-backlog.md
?? docs/planos/031-checkpoint-relative-candidate-recovery-evidence-backlog.md
?? docs/planos/032-investigation-failure-diagnostics-backlog.md
?? docs/planos/033-post-approval-classification-resident-host-backlog.md
?? docs/planos/034-native-cli-external-failure-diagnostics-backlog.md
?? docs/planos/035-native-cli-json-regression-alignment-backlog.md
?? docs/planos/036-investigation-large-file-range-robustness-backlog.md
?? docs/planos/037-evolution-reconciliation-v3-backlog.md
?? docs/planos/038-post-approval-classification-resident-host-v0-backlog.md
?? docs/planos/039-evolution-reconciliation-v4-post-approval-classification-backlog.md
?? docs/planos/040-inv10-total-capability-audit-backlog.md
?? docs/registros/2026-10-01-tpc01-ab-modelo-qwen25.md
?? docs/registros/2026-10-01-tpc01-attempt-local-flash-off-failed.md
?? docs/registros/2026-10-01-tpc01-recovery-operacional-flash-off.md
?? docs/registros/2026-10-02-tpc01-replay-ab-pos-codertaskspec.md
?? docs/registros/2026-10-02-tpc01-replay-ab-runtime-vs-dsh.md
?? docs/registros/2026-10-02-tpc01-runpod-coder-remoto.md
?? docs/registros/2026-10-05-sdc02-candidate-recovery-diagnostico.md
?? docs/registros/2026-10-05-sdc10-candidate-recovery-diagnostico.md
?? docs/registros/2026-10-05-sdc14-candidate-recovery-diagnostico.md
?? docs/registros/2026-10-05-sdc15-candidate-recovery-diagnostico.md
?? docs/registros/2026-10-06-sdc16-candidate-recovery-diagnostico.md
?? docs/registros/2026-10-06-sdc19-cumulative-acceptance-evidence.md
?? docs/registros/2026-10-07-inv10-handoff-claude-codex.md
?? docs/registros/2026-10-07-sdc23-candidate-recovery-diagnostico.md
?? watch4-sensors.txt
```

Os diretórios aparecem agregados como em git status; não houve inspeção recursiva de
scratch/env/artefatos para evitar exposição de dados e alterações de terceiros.

## Worktrees e limites de segurança

46 entradas registradas consultadas pelo Git Windows. Apenas a lista/metadata
foi lida; existência/integridade de cada pasta, HEAD remoto e estado interno dos
worktrees de terceiros não foram auditados. Caminhos Windows não interpretáveis pelo
Git Linux não justificam prune. Todas as entradas permanecem preservadas:

| Caminho registrado | HEAD | Branch/estado |
|---|---|---|
| `G:/anima` | `6bc4aadef9414d655600c2ea37c6be436b3628c8` | `refs/heads/dev` |
| `C:/Users/GeanTeco/.codex/worktrees/scope-verification-path/anima` | `be7ff711766a3627d4e8a763efc0f3ddd4d346b0` | `refs/heads/codex/scope-verification-path` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-c2-red-21184-1787222688586` | `07dd11ac08a85e41352f383512880dea44c5f888` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-converge-17788-1787306880103` | `c09aa01a6a864ad03d0921c87ae5df258a4cfc81` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-dsh-failed-branch-702dd965b8f54cbab43394b7c25bae3b` | `d3de6e482c850180da72ee26b5f6f19c375053bb` | `refs/heads/anima-work/df6d8492-9620-4297-9a43-e760880bea70` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-dsh-realrepo-b9b24ea076da4388a371a3f068fd32d0` | `d3de6e482c850180da72ee26b5f6f19c375053bb` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-eval-16052-1787314438481/wt-16052-1787314438487-K5-append-0` | `7600f365ba0d1a7f799618c5f9a4406db5ef5d38` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-eval-16052-1787314438481/wt-16052-1787314481529-K5-append-1` | `7600f365ba0d1a7f799618c5f9a4406db5ef5d38` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-eval-16052-1787314438481/wt-16052-1787314576993-K30-append-0` | `7600f365ba0d1a7f799618c5f9a4406db5ef5d38` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-eval-16052-1787314438481/wt-16052-1787314666083-K30-append-1` | `7600f365ba0d1a7f799618c5f9a4406db5ef5d38` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-eval-16052-1787314438481/wt-16052-1787314727633-K100-append-0` | `7600f365ba0d1a7f799618c5f9a4406db5ef5d38` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-eval-16052-1787314438481/wt-16052-1787314831659-K100-append-1` | `7600f365ba0d1a7f799618c5f9a4406db5ef5d38` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-eval-16052-1787314438481/wt-16052-1787314847661-K195-append-0` | `7600f365ba0d1a7f799618c5f9a4406db5ef5d38` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-eval-16052-1787314438481/wt-16052-1787314886862-K195-append-1` | `7600f365ba0d1a7f799618c5f9a4406db5ef5d38` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-eval-16052-1787314438481/wt-16052-1787314919085-K195-anchor-0` | `7600f365ba0d1a7f799618c5f9a4406db5ef5d38` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-eval-16052-1787314438481/wt-16052-1787314950576-K195-anchor-1` | `7600f365ba0d1a7f799618c5f9a4406db5ef5d38` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-gate-repro-d4c441cbd4084154b30d832adfa45933/tree` | `94095db99c83396e6a0a674cb182cf2585cbc1ea` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-live-append-23040-1787306363160` | `2b109e3c90adcd133d1eb023d3330bb5de74a1b3` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-live-append-23132-1787306177997` | `2b109e3c90adcd133d1eb023d3330bb5de74a1b3` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-live-append-4476-1787306289400` | `2b109e3c90adcd133d1eb023d3330bb5de74a1b3` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-live-scratch-16632-1787306710976` | `2b109e3c90adcd133d1eb023d3330bb5de74a1b3` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-live-scratch-19324-1787306658773` | `2b109e3c90adcd133d1eb023d3330bb5de74a1b3` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-live-scratch-6404-1787306718851` | `2b109e3c90adcd133d1eb023d3330bb5de74a1b3` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-live-stall-12368-1787305587844` | `2b109e3c90adcd133d1eb023d3330bb5de74a1b3` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-live-stall-2468-1787305964410` | `2b109e3c90adcd133d1eb023d3330bb5de74a1b3` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-model-proof-qwen2.5-14b-20064-1787224065126-2` | `2b109e3c90adcd133d1eb023d3330bb5de74a1b3` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-model-proof-qwen2.5-coder-14b-20064-1787224029884-0` | `2b109e3c90adcd133d1eb023d3330bb5de74a1b3` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-model-proof-qwen2.5-coder-7b-20064-1787224051259-1` | `2b109e3c90adcd133d1eb023d3330bb5de74a1b3` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-next-typegen-proof-20260821-124010` | `aff75d6f7c9281ca661dad0bb06994c63d3e1c61` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-noop-proof-696-1787199674513` | `a01ad387f1b8eae9fb6d5291a98fb70be7f4eb77` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-proxy-15992-1787297154194` | `2b109e3c90adcd133d1eb023d3330bb5de74a1b3` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-proxy-19196-1787297349493` | `2b109e3c90adcd133d1eb023d3330bb5de74a1b3` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-read-edit-proof-14864-1787224348330` | `2b109e3c90adcd133d1eb023d3330bb5de74a1b3` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-recovery-base` | `af313c3e8580c64ca54df2c77bf6b9c269cf2a4d` | `detached` |
| `C:/Users/GeanTeco/AppData/Local/Temp/anima-repro-18452-1787296761293` | `2b109e3c90adcd133d1eb023d3330bb5de74a1b3` | `detached` |
| `G:/anima/.worktrees/ai-memory-wrap-v1` | `2e153ed05dac21a4ef67f001fa9c4543be1ff195` | `refs/heads/claude/ai-memory-wrap-v1` |
| `G:/anima/.worktrees/claude-code-coder-backend` | `cd73276b1e18eda70f5a65338d744cca9634addc` | `refs/heads/claude/claude-code-coder-backend` |
| `G:/anima/.worktrees/compute-economics-observations-v1` | `5103c5ddb66fed82aa02a92d32e4c7318dd8c4c6` | `refs/heads/codex/compute-economics-observations-v1` |
| `G:/anima/.worktrees/compute-economics-v1` | `f54c52bdf7e3e95837214e38c2d8255ecd814396` | `refs/heads/codex/compute-economics-v1` |
| `G:/anima/.worktrees/evolution-ux-v2` | `480c8507cf3eca59ceef15862f0a81afbc4feca7` | `refs/heads/codex/evolution-ux-v2` |
| `G:/anima/.worktrees/integration-ff-only` | `52a745ef269e40bd3fce14fd1e4be663a80e9514` | `refs/heads/claude/integration-ff-only` |
| `G:/anima/.worktrees/manual-resident-user-test` | `266c68cf80bb6544ab204a4fde1448a47600d652` | `detached` |
| `G:/anima/.worktrees/mobile-completed-result` | `5f5f1f3e1c6b09ac3a3460f7f7c89a9b9e487a43` | `refs/heads/fix/mobile-completed-result` |
| `G:/anima/.worktrees/native-cli-observation-fix` | `f518d0d6bad60ebe8f301bfcfeca21b2ee42b2cb` | `refs/heads/claude/native-cli-coder-observation-fix` |
| `G:/anima/.worktrees/roadmap-003-006` | `e88472bcb1770fc525af35514e452466ce8f94ee` | `refs/heads/codex/roadmap-003-006` |
| `G:/anima-local-test` | `44785fb139b652aa620710f9114323df76b4e7b6` | `detached` |

Sem start/stop de serviços, Resident Host, INV-11, approvals, claims, attempts,
migrations, alteração de banco, API paga, RunPod, Git refs/índice ou credenciais.
A gravação autorizada foi somente este documento; implementação/PRD/plano/registro
anteriores não foram alterados neste encerramento.

Isolamento de work items é distinto de confinamento absoluto de filesystem.
WSL read-only não garante leitura limitada ao snapshot; sandbox, worktree e
verificação host-side são fronteiras separadas. No futuro validar schema real,
concorrência, quotas e configuração de operador; não extrapolar disponibilidade
operacional de código, logs históricos ou mocks. Budget e autoridade financeira
continuam gates separados da autenticação pela assinatura.

## Direção de longo prazo — visão, sem autorização nova

O Anima permanece a identidade e interface principal. Memória narrativa e
continuidade cognitiva devem preservar contexto, decisões, limites e evidências
para retomar trabalho e reflexão sem depender de um executor ou chat privado.
Prisma é Reflexão Crítica interna, não uma frente paralela.

[Manifesto](../../anima-manifesto.md), [Marco 005](../marcos/005-autonomia-progressiva-e-identidade-una.md)
e [Marco 009](../marcos/009-resiliencia-por-substituicao-versatilidade-infinita.md)
orientam autonomia progressiva por evidência e resiliência por substituição.
Alternativas de modelo/harness/ambiente só preservam continuidade quando compatíveis,
comprovadas e autorizadas; trocar instrumento não amplia autoridade nem orçamento.

Investigações próprias e self-development governados são meios para evolução do
produto pessoal em qualquer jornada. Resultados e incidentes devem virar memória
recuperável, testes e decisões; promover autonomia requer provas, review e rollback.
Roteamento universal e continuidade cognitiva plena são direção de longo prazo,
**não capacidades operacionais comprovadas por esta entrega nem backlog autorizado**.

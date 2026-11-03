# Retomada de self-dev supervisionado — diagnóstico

2026-10-09. Somente leitura operacional e checkpoint documental. Git Windows dev, HEAD inicial/final6bc4aadef9414d655600c2ea37c6be436b3628c8, índice vazio,46 worktrees,203 entradas status/WIPs preexistentes preservadas. Sem commits.

**NO-GO para partida agora.** Supabase DB/Auth healthy, Docker disponível, CLI funcional com Node Windows24.16.0. Vector continua restarting; descartáveis encerrados, sem intervenção. CLI:36 itens retomáveis,6approved/9proposed/3review/18changes_requested. INV-11proposed/v1/sem attempt, não aprovado/executado. Dry-run existente `scripts/_session/inv10-queue-dryrun-readonly.ts`:queue=[],stop awaiting_human_or_recovery,running0.

Disponibilidade: Ollama unreachable, Claude version_check_failed, DeepSeek parked_not_operational; nenhuma API paga consultada. Codex inicialmente version_check_failed porque o caminho nativo antigo não existe. Executável já instalado `C:\Users\GeanTeco\AppData\Local\OpenAI\Codex\bin\9691020b546a15b2\codex.exe`, definido somente no processo da sondagem, fez `work executors SDC-19` retornar Codex ready/eligible/contract_declared. O launcher interativo WSL é distinto do executável governado Windows; não reutilizar wrappers como se fossem backend nativo.

| Fluxo existente | Situação e limites |
|---|---|
| Host-turn supervisionado limitado, requestedWorkItemId | Historicamente comprovado; worktree isolada, gates/Verifier e eventos, cancelamento cooperativo/checkpoints conforme executor. Seleção filtrada não elimina reconcile_supervised_work, readmit_budget_interrupted_work e caminhos globais de claims; não satisfaz garantia estrita de nenhum efeito em outros itens. HTTP backlog-host-turn não expõe o filtro. Scripts históricos têm UUID/base/versão e preflight antigos: não reutilizar cegamente. |
| Work item aprovado + execute-commanded | Endpoint existente identifica UUID/versão/attempt, revalida, registra início/terminal e recusa replay em andamento. Usa LocalRunnerAdapter, não o backend worktree Codex; Ollama não disponível. Abandonar HTTP não cancela a attempt; não equivale ao pipeline completo de self-dev worktree/Verifier. Não comprovado operacional nesta retomada. |
| Single-ItemV1/execute-one | Continua recusando single_item_atomic_claim_unavailable; nenhuma liberação sugerida. |

Tarefa candidata: **“Adicionar diagnóstico puro da configuração do Project Work Planner”**, aprovada v1, id interno b34d4561-3884-47b5-b0ba-35a8a62d2555. Dois arquivos: apps/web/lib/ai/project-work-planner.ts e seu teste; sem banco/cloud/work orchestration. Orçamento admitido,0/2 attempts usadas, mas classificação ausente e contrato deepseek-harness estacionado. Há resultado relacionado “Diagnóstico puro da configuração efetiva do Project Work Planner” em review, id cde9684e-cdb3-4164-86a6-5395fc403db1; relação exata/necessidade de novo trabalho não foi auditada. Conferir esse resultado antes de duplicar execução. SDC-19não é alternativa pronta:changes_requested/v2,attempt anterior e Verifier verified; requer decisão/correção governada, não restart direto.

**Ação mínima recomendada:** decisão humana sobre o diagnóstico já em review; se resta trabalho, revisar/repropor pelo fluxo existente o pequeno contrato para codex-cli disponível, mantendo escopo e aprovação, sem substituir backend silenciosamente. Depois revalidar classificação, gates, base e seleção de uma única unidade. Uma partida pelo fluxo legado exigirá autorização explícita para seu alcance global de manutenção/claims; não apresentar esse fluxo como Single-Item seguro. Se tal alcance for inadmissível, não há caminho operacional comprovado com as restrições atuais.

Comandos somente de diagnóstico, PowerShell da raiz:

```powershell
$env:ANIMA_CODEX_CLI_PATH='C:\Users\GeanTeco\AppData\Local\OpenAI\Codex\bin\9691020b546a15b2\codex.exe'
npm.cmd run anima -- work show b34d4561-3884-47b5-b0ba-35a8a62d2555 --json
npm.cmd run anima -- work show cde9684e-cdb3-4164-86a6-5395fc403db1 --json
npm.cmd run anima -- work executors b34d4561-3884-47b5-b0ba-35a8a62d2555 --json
npm.cmd run anima -- budget status b34d4561-3884-47b5-b0ba-35a8a62d2555 --json
```

Após contrato governado válido e autorização posterior, os comandos existentes approve/prepare-autonomous podem preparar o item; não foram chamados e não constituem comando de partida. Não há comando de execução recomendado agora. Codex permanece supervisor; alterações futuras deverão ser produzidas pelo executor ANIMA, não pelo supervisor.

Sem execução, Resident Host, INV-11, providers pagos, mudança de banco de domínio, código, migrations, gates, política, configuração persistente ou Git. Leituras oficiais da CLI envolveram autenticação normal; não se alegam zero efeitos internos de sessões de autenticação. Investigação temporal e candidatos congelados. Próximo ponto: revisão humana deste NO-GO e do contrato/resultado do pequeno diagnóstico. Referências: CLI README, ADR-003, arquitetura Single-Item e registro temporal-prova.

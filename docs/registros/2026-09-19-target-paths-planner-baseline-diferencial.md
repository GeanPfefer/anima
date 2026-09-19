# `target_paths` do planner e baseline diferencial real

- **Data/tipo:** 2026-09-19 — desenvolvimento e prova automatizada.
- **Objetivo:** fazer o Project Work Planner persistir a superfície material por
  gate e conectar essa superfície à produção real do baseline diferencial no
  executor worktree.
- **Branch:** `dev`.
- **HEAD inicial:** `28e00f8f4b1a4e7f043502b210165ab3aea2b2be`.
- **HEAD final:** commit que contém este registro (ver histórico de `dev`).

## Mudanças e decisões

- O contrato provider-agnostic do planner ganhou `validation_target_paths` no gate
  principal e `target_paths` em cada validação adicional. O modelo declara somente
  paths sustentados pela investigação e usa `[]` quando não há evidência precisa.
- O host reutiliza a régua segura de paths, rejeita entradas malformadas e normaliza
  vazio/ausência para omissão. Não infere paths do texto do comando e não cria tipo
  paralelo ao `AutonomousValidationCriterion.targetPaths` do core.
- `planExecutableProjectWork` persiste cada superfície em
  `execution_spec.validation_criteria[*].target_paths`; parsing posterior já é feito
  pelo contrato canônico introduzido no commit `28e00f8`.
- Antes do coder, o executor roda no `base_sha` somente gates com `targetPaths`,
  captura exit/timeout/cancelamento e existência dos targets, restaura a árvore ao
  estado inicial (base ou checkpoint) e depois executa normalmente. No gate final,
  deriva a interseção entre arquivos alterados e targets e a entrega ao canal
  host-observado já existente.
- Baseline permanece evidência advisory. Gates legados sem paths continuam sem
  baseline e nenhuma varredura do repositório inteiro foi adicionada.

## Provas

- `npm.cmd test --workspace=apps/web -- project-work-planner-shared.test.ts project-work-planner.test.ts worktree-executor.test.ts --runInBand`
  — **3 suítes, 68 testes, PASS**.
- `npm.cmd run typecheck --workspace=packages/core` — **PASS**.
- `npm.cmd run typecheck --workspace=apps/web` — **PASS**.
- `git diff --check` — **PASS** (somente avisos de normalização LF→CRLF do Git).

## Segurança, efeitos externos e WIP

- Nenhum navegador, Work, Claude, compute pago, rede externa, banco, push, merge,
  deploy ou alteração de `origin/main`.
- WIP preexistente não rastreado preservado integralmente:
  `.claude/settings.local.json`, `.worktrees/`, `watch4-sensors.txt`.
- A execução testada ocorre em repositórios/worktrees temporários descartáveis; o
  workspace original não é aplicado nem integrado.

## Limitação e próximo ponto

O baseline só existe para planos novos que declarem `target_paths`; planos antigos
continuam honestamente `inconclusive`. Próximo passo técnico possível: consumir o
status diferencial na política de suficiência/enforcement somente após uma decisão
explícita sobre quais classes de claim podem depender dele; este slice não promove
evidência advisory a autoridade de bloqueio.

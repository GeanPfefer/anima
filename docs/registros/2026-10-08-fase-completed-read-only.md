# Correção da fase completed/read_only

- Data/tipo: 2026-10-08, desenvolvimento e testes locais.
- Objetivo/decisões: [plano 042](../planos/042-fase-completed-read-only.md).
- Branch: dev; HEAD inicial/final a9b95aa3de89622356384393a85ad96dafbba161.
- Commits/staging: nenhum. Sem push ou alteração de origin/main.

## Causa comprovada e mudanças

projectWorkIntegration oferecia integração a qualquer resultado aceito correlacionado,
sem distinguir read_only; deriveWorkProgressPhase priorizava essa integração e a
attempt submitted_for_review sobre completed. O defeito já existia no HEAD autorizado.

presentation.ts agora usa readEffectClass para suprimir a affordance de integração
read_only e apresentar completed/read_only como Concluído/terminal. Review continua
em revisão. O leitor histórico integration-decision.ts não mudou; o aceite permanece
recuperável. Testes novos em presentation.read-only.test.ts cobrem a composição com
eventos, imutabilidade, projeção obsoleta e programação com integração governada.

## Gates

- Core: `npm run test --workspace=@anima/core -- --runInBand presentation integration-decision integration-boundary protected-integration investigation-review`: 6 suítes, 167 testes PASS.
- Web: `npm run test --workspace=@anima/web -- --runInBand cli/investigation.test.ts cli/render.test.ts`: 2 suítes, 23 testes PASS.
- Total: 190 testes distintos PASS, dez novos. Nenhum teste vivo/RLS.
- Typechecks core e supabase PASS. Web completo: 85 erros, todos em scripts/_session
  preexistentes/untracked. Config temporária em /tmp excluindo somente esse diretório:
  PASS; tsconfig do repositório não foi editado. Sem build: mudança pura no core.
- A primeira execução encontrou TS2322 na fixture de programação do teste novo;
  corrigido com tipagem WorkItem['intent']. Reexecução verde. Nenhum flake demonstrado.
- Diff e whitespace conferidos com Git do Windows; nenhuma normalização de EOL.

## Preservação e efeitos

Branch/HEAD foram confirmados antes de editar. Alvos de código sem WIP; hunk inicial
preexistente de 16 linhas do PRD e WIP do Plano 008 preservados, assim como demais
untracked e worktrees. PRD recebeu somente atualização ao final. Plano 042 e este
registro são novos; documentação histórica da entrega anterior preservada.

Nenhuma consulta ou escrita no banco, alteração de INV-09/INV-10, evento histórico,
schema SQL, gate ou decisão humana. Sem Resident Host, attempts, recovery, API paga,
migration, serviço, publicação, integração, staging, commit, push, reset, clean ou
prune. A correção é de projeção, não certificação semântica nem autorização.

## Retomada

Revisar o diff contra a9b95aa e decidir commit separadamente. Prova viva da nova fase
não realizada; se desejada, exige autorização própria. A prova viva da leitura do
Investigation Review V1 anterior não é reaproveitada como prova desta correção.

# Investigation Review V1 — implementação local supervisionada

- Data/tipo: 2026-10-08, desenvolvimento e verificação local (sem prova viva).
- Objetivo e decisões: [plano 041](../planos/041-investigation-review-v1.md).
- Branch: dev. HEAD inicial/final: 8548f6af5b7059039cec465bb92102ed22f49574.
- Commits criados: nenhum. Sem staging, push ou alterações de origin/main.

## Mudanças e bugs corrigidos

Projeção pura de investigação no core, comando CLI nativo com texto/JSON,
apresentação de checks/resultado/revisão humana separada da cobertura de programação
e paginação de listEvents. Contratos e testes detalhados no plano/README do CLI.

Causas comprovadas antes da implementação: presentation só oferece verificação ao
vivo quando há worktreeHandoff; CLI só contabiliza findings de cobertura de aceite
de programação. Investigações não possuem esses fatos; o 0/1 não era uma avaliação
automática válida do atendimento da pergunta. Não foi corrigido fabricando cobertura.

## Provas e gates

- Core: `npm run test --workspace=@anima/core -- --runInBand investigation-review investigation-result presentation verifier-opinion work-verification`: 5 suítes, 229 testes PASS.
- CLI: `cli/investigation.test.ts`, `cli/args.test.ts`, `cli/render.test.ts`,
  `lib/work-orchestration/work-reference.test.ts`: 4 suítes, 87 testes PASS.
- CLI app/entrypoint: 49 testes PASS, incluindo dois novos dispatches nativos
  com identidade injetada, REF e UUID, sem banco. Rodados pelo Jest com Node
  22.23.3 já instalado e PATH do processo correspondente; subprocessos locais
  permitidos após escalonamento da ferramenta. Não instalou runtime/dependências.
- Supabase: repository.test.ts e repository-pagination.test.ts, 15 testes PASS.
- Total: 380 testes distintos verdes, 41 novos. São testes locais; mocks não são
  prova de isolamento RLS com usuários reais.
- Typecheck core e supabase PASS. Typecheck web completo: 85 erros, todos em
  `scripts/_session/**` preexistentes/untracked. Nenhum script scratch foi editado.
  Typecheck web com config temporária em /tmp excluindo esse diretório: PASS,
  sem mudar tsconfig do repositório. Sem build, pois o recorte não altera UI/rotas.
- Compatibilidade offline: cópia `inv10-v2-result-raw.json` lida por projeção pura,
  sem env/identidade/rede; available, partial, 26 findings, 7 gaps, verified.
  Isso não prova recuperação pelo banco; CLI de produção não lê esse arquivo.
- Check de whitespace com `core.whitespace=cr-at-eol` por comando: PASS;
  configuração Git persistente e EOL do repositório não foram reparados.

Falhas iniciais corrigidas: tipagem de doubles e timestamp da fixture REF (o parser
exige milissegundos). Falhas de ambiente separadas: Node 18 padrão não suporta o
entrypoint TS nativo; spawnSync EPERM no sandbox. Reexecução local com Node 22 e
permissão de subprocessos passou. A primeira config de typecheck em /tmp precisou
typeRoots absoluto para resolver os tipos Jest; não era erro do produto.
Nenhum flake demonstrado; os erros iniciais não foram classificados como flakes.

## Preservação e invariantes

Antes de editar, os alvos de código não tinham diff semântico com EOL ignorado.
PRD tinha WIP de 16 linhas no início; preservado, estado desta entrega acrescentado
ao final. Untracked, demais WIPs e worktrees preservados. Git WSL lê checkout
principal; worktrees com caminhos Windows aparecem prunable por incompatibilidade
de caminhos, sem prova de abandono. Nenhum repair/prune/clean/reset realizado.

Identidade GoTrue/Bearer e RLS reutilizadas; nenhum service_role/bypass. Não houve
consulta viva ao banco, criação de evento, alteração de INV-09/INV-10, start de
Resident Host/Docker/Supabase, attempt, recovery, modelo/API paga, migration,
integração, publicação, push ou efeito externo de produto. Verifier/gates de
programação e resultado histórico permaneceram intactos. Sem interface web nova.

## Fronteiras humanas e retomada exata

BLOCKED_BY_HUMAN_DECISION: autorização separada para prova viva INV-10, prova RLS
com dois usuários e eventual commit. Implementação local concluída; não iniciar
esses passos automaticamente. Revisar o diff de conteúdo, distinguindo EOL e o
WIP anterior do PRD. Com autorização de prova viva, usar o comando oficial e
conferir fonte seq 86353, dados originais e vínculo de aceite, sem gravações.


## Atualização — prova viva de leitura em 2026-10-08

Registro append-only do fechamento documental autorizado após a auditoria favorável
do manifesto. O checkpoint anterior descreve a sessão de implementação sem prova
viva; a pendência de recuperação da INV-10 indicada acima foi cumprida posteriormente.

### Fonte da evidência e referências verificáveis

A evidência desta prova foi fornecida pelo humano nesta sessão. O fechamento não
reexecutou comandos contra o banco e não possui captura de stdout ou comparação
antes/depois do banco. Não atribuir ao Codex uma auditoria viva independente.
O banco/event log permanece a fonte de verdade, consultável pela identidade residente.

| Consulta informada | Observação da prova |
|---|---|
| `anima work investigation INV-10` | Recuperação direta do banco; item completed, proposta v2; resultado partial; 26 findings e 7 gaps |
| Evento-fonte | result_submitted seq 86353; evento original, não um novo resultado |
| Parecer registrado | verified, cinco checks; não equivale a verdade semântica ou completude |
| Revisão humana | Decisão de aceite corretamente correlacionada ao resultado original |
| `anima work show INV-10` | Cobertura automática de programação não aplicável |
| `anima work evidence INV-10` | Cobertura automática não aplicável, separada dos checks técnicos |

Para reconferência futura autorizada: resolver INV-10 pela identidade residente,
localizar work_events seq 86353 e conferir o payload persistido em
`data.executor_signal.investigation`, a correlação do parecer e o vínculo do evento
result_accepted ao resultado original. O ID do evento de aceite e os horários exatos
não foram fornecidos; não são inventados neste registro. Arquivos `_session` não são
fonte da prova viva nem dependência do comando oficial.

### Separação das provas e limites

- Testes locais: os 380 testes/41 novos e typechecks registrados acima permanecem
  evidência local. Nenhum teste foi novamente executado neste fechamento documental.
- Prova viva de leitura: cumprimento informado pelo humano do critério de recuperar
  o resultado original da INV-10 pelo caminho canônico com identidade residente.
- Prova RLS com dois usuários: pendente de autorização; a leitura por uma identidade
  e os mocks não demonstram negação de acesso cruzado entre usuários.
- Os três caminhos CLI inspecionados consultam items/events/contextos e projetam
  dados, sem RPC mutante ou persistência de parecer. Não há comprovação independente
  antes/depois do banco neste registro; não inferir uma auditoria global de ausência
  de eventos ou de alterações concorrentes em INV-09/INV-10 a partir do relato.

### Estado do fechamento e próxima fronteira

Branch dev; HEAD inicial/final do fechamento 8548f6af5b7059039cec465bb92102ed22f49574.
Somente README do CLI, hunk final do PRD, atualização append-only do plano 041 e
este registro foram alterados. Hunk inicial do PRD e WIP do plano 008 preservados;
código, testes, fixtures, serviços e banco não foram alterados. Sem novas attempts,
APIs pagas, migrations, staging, commit, push ou alteração de origin/main.

A projeção "Pronto para integrar" em completed/read_only é defeito preexistente,
identificado na auditoria de código, e fica para correção separada; não corrigido
nesta entrega. Próximo passo: humano conferir o manifesto exato e decidir staging
parcial do PRD/commit. A prova viva de leitura está encerrada; RLS com dois usuários
e commit permanecem fronteiras humanas separadas.

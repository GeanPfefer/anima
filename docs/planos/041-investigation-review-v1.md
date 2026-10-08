# Investigation Review V1 — implementação supervisionada

Data: 2026-10-08. Escopo aprovado pelo humano na sessão de continuação Claude → Codex.

## Objetivo e estado

Implementação local e testes concluídos. Consulta viva à INV-10 e prova RLS com dois
usuários continuam pendentes de autorização separada. Não declarar essas provas como
concluídas a partir de fixtures ou da cópia offline do resultado.

O CLI recupera relatórios de Investigation Sessions pelo application service e
event log residente, sem depender de scratch files, reexecutar o Verifier ou criar
eventos. Interface web, executor, migrations e alterações governadas ficam fora.

## Contrato e decisões

- `anima work investigation <id|REF> [--json]`: resolução central de referência e
  identidade residente existentes; payload e review com schemaVersion 1.
- Projeção pura `projectInvestigationReview`: resultado mais recente, envelope e
  sinal correlacionados ao item/proposta/attempt, base e estrutura validadas pelos
  contratos existentes; não retorna resultado antigo quando o último é inválido.
- Preserva identidade do evento-fonte, seq, versões, attempt, outcome, findings,
  evidências, gaps, hostVerification, limitações, referências e handoff.
- Parecer registrado selecionado por item, proposta, attempt e resultEventId;
  envelope e autoria também cruzados. Não é apresentado como recomputado agora.
- Aceite humano só deriva de evento user posterior ligado ao resultado vigente.
  `verified` não implica verdade semântica, completude ou aceite.
- Relatório ausente: not_submitted, exit 0. Partial/inconclusive válido: exit 0.
  Invalid_payload/correlation_mismatch/stale_result: exit 1 com diagnóstico e fonte;
  não investigação: exit 1. Reutiliza exits 2/3 de uso/ambiguidade da CLI.
- `work show`/`work evidence`: investigationReview separado; cobertura automática
  não aplicável (contagens e critérios covered null), sem falso 0/1 ou 1/1 e sem
  sugestão de request_changes baseada na ausência de cobertura de programação.
  Programação mantém as regras, gates e Verifier existentes.
- `listEvents`: paginação keyset sobre seq único, ordem crescente, filtro de item
  preservado; continua até página vazia, inclusive sob cap do servidor menor que
  1000. Erro posterior não retorna histórico parcial; ordem inválida falha fechada.
  `WorkEvent.seq` opcional mantém compatibilidade com fixtures antigas; mapper
  Supabase preserva o seq real.

## Gates e aceite

- Core: 229 testes focais/vizinhos verdes (projeção, resultado, apresentação,
  parecer e verificação de programação).
- Web/CLI: 136 testes verdes, incluindo dispatch nativo REF/UUID com identidade
  injetada, parsing, texto completo, JSON, erros e regressões existentes.
- Supabase adapter: 15 testes verdes; paginação por transporte simulado, sem banco.
- Typecheck core e supabase verdes. Web com exclusão temporária apenas de
  `scripts/_session/**`: verde; typecheck web completo bloqueado por 85 erros
  preexistentes nesses scripts untracked, preservados.
- Cópia offline da INV-10 reprojetada: partial, 26 findings, 7 gaps, parecer
  investigation-verifier-v1 verified. Não é recuperação viva nem prova RLS.

Aceite de código/testes locais cumprido. Aceite operacional pendente: com autorização
separada, consultar INV-10 via CLI/RLS e conferir evento 86353, outcome, findings,
gaps, parecer e aceite humano; depois testar dois usuários sem bypass de RLS.

## Referências e retomada

- [Registro da implementação](../registros/2026-10-08-investigation-review-v1.md).
- [Contrato do CLI](../../apps/web/cli/README.md#investigation-review-v1).
- [Core](../../packages/core/src/work-orchestration/investigation-review.ts).
- [Plano do contrato original](023-investigation-sessions-v0-core-backlog.md).
- [Identidade residente](../arquitetura/adr-003-resident-local-host.md).

Próximo passo: revisão humana do diff local. Sem commit/push nesta sessão; commit,
prova viva e prova RLS exigem suas autorizações posteriores. INV-09/INV-10 e o estado
residente não foram alterados.


## Atualização de estado — prova viva de leitura (2026-10-08)

Esta atualização supera a pendência de consulta viva descrita no checkpoint inicial
acima; o texto anterior permanece como histórico da implementação local.

- Testes locais: 380 testes verdes, incluindo 41 novos; não foram repetidos neste
  fechamento documental. Mocks não constituem prova RLS real.
- Prova viva: conforme evidência fornecida pelo humano, a identidade residente leu
  INV-10 diretamente do banco por `anima work investigation INV-10`: completed,
  proposta v2, partial, 26 findings, 7 gaps, result_submitted seq 86353, parecer
  registrado verified com cinco checks e aceite humano correlacionado. `work show`
  e `work evidence` exibiram cobertura automática não aplicável.
- Fonte e limites: [registro append-only](../registros/2026-10-08-investigation-review-v1.md#atualização--prova-viva-de-leitura-em-2026-10-08).
  A prova não foi reexecutada neste fechamento e não comprova isolamento cruzado.
- Prova RLS com dois usuários: ainda pendente de autorização separada.
- "Pronto para integrar" em completed/read_only: defeito preexistente de projeção,
  reservado para correção separada; nenhum código foi alterado neste fechamento.

Critério de recuperação viva da INV-10 cumprido pela prova humana informada. Próximo
passo: revisão e autorização humana do staging/commit conforme manifesto (17 arquivos
integrais e apenas o hunk final do PRD); manter WIPs anteriores fora do índice.
Nenhum staging, commit, push, alteração governada ou escrita no banco foi realizado
neste fechamento. A pendência RLS não é declarada concluída.

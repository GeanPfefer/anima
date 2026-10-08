# Fase completed/read_only — correção de apresentação

Data: 2026-10-08. Escopo autorizado pelo humano; referência dev/a9b95aa.

## Objetivo e solução mínima

A investigação aceita aparecia como "Pronto para integrar": a apresentação
projetava integração a partir do aceite e priorizava essa projeção sobre completed.
Ao suprimir apenas integração, a attempt submitted_for_review ainda manteria a
fase "Revisando". Ambos os pontos foram corrigidos em presentation.ts.

- projectWorkIntegration retorna null para read_only, sem authorize/refuse.
- deriveWorkProgressPhase trata completed/read_only como done/Concluído/terminal
  antes da fase da attempt; ignora integração obsoleta fornecida para read_only.
- review/read_only continua reviewing, com revisão humana disponível.
- Programação conserva o fluxo existente de integração governada, inclusive
  awaiting_decision, autorização, publicação/review e recusa.
- integration-decision.ts continua lendo os fatos históricos; não é reescrito
  nem passa a conceder integração a investigações.

## Estado e provas

Implementação e provas locais concluídas: 167 testes core e 23 CLI verdes, dez
regressões novas; typechecks core/supabase e web sem scratch verdes. Web completo
tem 85 erros preexistentes em scripts/_session, preservados. Nenhuma prova viva
desta correção, consulta ao banco ou efeito externo foi executado.

Critérios locais cumpridos: completed/read_only terminal e sem integração;
review/read_only preservado; programação e eventos/aceite preservados. Sem alteração
de schema, gates ou decisão humana. Ver [registro](../registros/2026-10-08-fase-completed-read-only.md).

Próximo passo: revisão humana do diff e decisão de commit; nenhum staging/commit/push
nesta sessão. Prova viva da nova fase requer autorização separada, se desejada.

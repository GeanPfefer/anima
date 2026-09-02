# 2026-09-02 — Cobertura explícita do aceite no Verifier v2

**Tipo:** desenvolvimento + prova. **Branch:** `dev`. **HEAD inicial:** `87a3ad8`.
**HEAD final:** commit que contém este registro.

## Objetivo e causa comprovada

Fechar a lacuna revelada pelo PIN-02 sem alterar sua branch, estado ou decisão humana.
A proposal v2 persistida contém três `expected_effects`, mas o `execution_spec` contém apenas
dois gates. O Verifier v1 lia somente esses gates e conferia sua cobertura contra eles mesmos;
`proposal.data.expectedEffects` nunca entrava no cálculo. Antes disso, o parser de backlog
também descartava o corpo `Aceite` ao montar o candidato canônico.

## Mudanças

- o backlog canônico preserva `acceptanceCriteria` e o planejamento recebe o aceite explícito;
- cada gate planejado declara `covers` com textos exatos de `expected_effects`;
- o host rejeita proposta com critério desconhecido ou cobertura N-1;
- o Verifier v2 cruza aceite aprovado, associação e gate aprovado; ausência vira gap e
  `inconclusive`, associação fora do contrato vira violação;
- pareceres v1 e eventos do PIN-02 permanecem intactos e append-only.

## PIN-02

Contrato aprovado observado por leitura do Postgres local: round-trip; fail-closed para shape
ausente/extra/malformado/versão desconhecida; testes focados e typecheck. A branch
`anima-work/5a0c7716-350f-477a-bf66-fb7a38fb4c65`/commit `2602dac` não foi editada.
O caso reconstruído no teste do Verifier cobre apenas os gates executados e expõe os dois
critérios comportamentais sem prova específica. Isso suporta solicitar mudanças para adicionar
provas focadas, mas a decisão continua humana.

## Segurança e efeitos externos

Sem migration, escrita manual no banco, re-verificação canônica, aceite, request_changes,
integração, merge, deploy ou alteração de `origin/main`. Docker foi iniciado em background
somente para leitura dos fatos canônicos. Nenhum aplicativo interativo do usuário foi encerrado.
Artefatos locais `.worktrees/`, `watch4-sensors.txt` e `.claude/settings.local.json` preservados.

## Próximo ponto

Fronteira humana exata: decidir `accept` ou `request_changes` no PIN-02. Pela evidência atual,
`request_changes` mínimo é adicionar testes do codec para round-trip e rejeição de extra,
malformado e versão desconhecida; só depois uma nova attempt/reverificação canônica, se pedida.

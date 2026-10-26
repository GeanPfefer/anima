# Project Builder V1-01: integração externa na CLI oficial — 2026-10-26

Append-only. Tipo: **implementação** (código + testes em repositórios descartáveis; sem schema, sem escrita no residente nem no laboratório original). Formato de [`README.md`](README.md). Antecede: [`2026-10-26-project-builder-v0-fechamento.md`](2026-10-26-project-builder-v0-fechamento.md).

## Dados

- Branch `claude/v1-01-external-integrate-cli`, base `dev` = `origin/dev` = `2e12edfa9c4d274cb8a37c6584fa8c7addf943a2`. Não integrado, não publicado.
- Nenhuma migration. Nenhum work item, claim, lease ou ref foi alterado.

## Comandos

```
anima work external integrate inspect   <UUID> [--json]                 # somente leitura
anima work external integrate authorize <UUID> [--json]                 # só registra a autorização ff_only (id novo e único)
anima work external integrate execute   <UUID> --auth-id <id> [--json]  # só executa a autorização informada
```

Três atos separados; `execute` exige `--auth-id` (o parser recusa a ausência) e nenhum ato encadeia o outro. `authorize` imprime o `authId` e o comando seguinte, mas não executa.

## Reuso (sem segundo pipeline)

`lib/work-orchestration/external-integration-service.ts` é só fiação e leitura: `authorizeExternalIntegration` → `authorizeExternalIntegrationEffect` (RPC `authorize_external_integration_effect`, derivações no banco); `executeExternalIntegration` → `executeAuthorizedExternalIntegration` (identidade física, lease, CAS/ff, recibo) + `trustedSystemWriterFromEnvironment().integrationReceipt`; `inspectExternalIntegration` → `readExternalCandidate`, `evaluateVerifierRequirement`, `externalAcceptanceRefusal`, `verifyExternalTargetForContract`, `ExternalGitIntegrationProvider` (leituras), `projectIntegrationStatus`. O script `scripts/external-integration-run.ts` virou adaptador fino sobre o mesmo serviço e mantém o formato de saída anterior.

## Segurança

- `authorize`: identidade residente (RLS), target externo válido e configurado, SHA do destino lido agora, `ff` possível, item `completed` e aceito; id gerado (`ext-int-<slug>-<uuid>`); RPC grava `ff_only`.
- `execute`: recusa **antes do Git e do lease** se o Trusted System Writer não autentica (login real) ou se o item já foi integrado por outra autorização; depois, o executor T5 (identidade relida sob o lease, destino, candidato, árvore, CAS/ff, recibo). Resultado ambíguo (`reconciliation_required`) orienta inspecionar e reexecutar o **mesmo** `--auth-id` (reconcilia sem repetir o efeito).
- Códigos de saída: sucesso 0; recusas de governança 3; erros operacionais e `reconciliation_required` 1; uso 2.
- `inspect` mostra repositório resolvido, destino, SHA atual, candidato (attempt/base), aceite, Verifier, revisão humana, `ff`, checkout/árvore, estado de integração, autorizações (vigentes/defasadas), prontidão do writer e bloqueios.

## Provas

- 32 testes novos (`cli/external-integrate.test.ts`, Git real + doubles): parsing (10 recusas), `inspect` sem efeitos (reflog/lease/recibo/RPC inalterados), `authorize` sem executar e com id sempre novo, replay/conflito, recusas (antes do aceite, ff impossível, destino/referência não configurados, alvo desconhecido, item inacessível), `execute` (integra; authId ausente/outro/inválido; writer indisponível antes do Git e do lease; lease ocupado; destino divergente; retry idempotente; já integrado; recibo que falhou e reconciliação), contrato do script preservado.
- A fixture de T5 foi extraída para `external-integration.fixture.ts` e reaproveitada: os 26 testes de T5 continuam verdes.
- Fumaça somente leitura da CLI real contra o residente: `inspect` da PROOF-EXT-02 devolve `integrated` e o bloqueio `already_integrated`, sem escrita.
- `anima.ts` não é importável em jest (`import.meta`); o roteamento do `dispatch` foi coberto pela fumaça real e pela tipagem.

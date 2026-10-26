# Project Builder V1-02: registro de targets externos — 2026-10-26

Append-only. Tipo: **implementação** (código + testes em repositórios descartáveis; sem schema; sem escrita no residente nem no laboratório original). Formato de [`README.md`](README.md). Antecede: [`2026-10-26-project-builder-v1-01-integracao-externa-na-cli.md`](2026-10-26-project-builder-v1-01-integracao-externa-na-cli.md).

## Dados

- Branch `claude/v1-02-external-targets-registry`, base `dev` = `origin/dev` = `836540c4b348797a169b4d4464b09b897b1cba73`. Não integrado, não publicado.
- Nenhuma migration; nenhum work item, claim, lease ou ref alterado.

## Formato adotado

Arquivo JSON versionado, local, fora do controle de versão, em caminho absoluto explícito (`ANIMA_EXTERNAL_TARGETS_FILE`; não há caminho padrão; sem credenciais):

```json
{ "version": 1,
  "targets": [ { "reference": "ext:<slug>", "repoRoot": "<abs>", "rootCommitSha": "<40 hex>",
                 "integration": { "targetRef": "refs/heads/<nome>" } } ] }
```

`parseExternalTargetsFile` (puro, `external-targets-registry.ts`) recusa: JSON inválido, versão ≠ 1, chaves desconhecidas em qualquer nível (nenhum campo de comando/ambiente é aceito), referência fora de `ext:<slug>` ou duplicada, `repoRoot` não absoluto ou com `..`, SHA ≠ 40 hex minúsculos, destino de integração fora de `refs/heads/<nome>` (nunca `anima-work/*`, `..`, `.lock`), arquivo > 64 KB.

## Resolução e precedência

Ponto de extensão único: o resolver T1 (`external-target-resolver.ts`). `loadConfiguredExternalTargets` junta as fontes (arquivo + legado `ANIMA_EXTERNAL_TARGET`); `resolveExternalTargetConfig(env, reference)` escolhe pela REFERÊNCIA do work item/pedido. `captureExternalTargetSpec` (propose) e `verifyExternalTargetForContract` (claim, observação pós-volta, revisão, integração) passam a usar esse resolver — não há resolver paralelo. O destino de integração sai de `resolveExternalIntegrationConfig` (registro por referência; legado `ANIMA_EXTERNAL_INTEGRATION` só vale para a SUA referência), usado pelo serviço da CLI (`configFor`).

**Precedência: nenhuma — conflito falha fechado.** Mesma referência em duas fontes ⇒ `external_target_config_conflict` / `external_integration_config_conflict` (mesmo se idênticas); fonte malformada ⇒ falha para TODAS as referências; nenhuma fonte ⇒ `external_target_not_configured`; referência ausente ⇒ `external_target_unknown` (inclusive com um único target: sem fallback); duas referências no mesmo git-common-dir (junction, grafia) ⇒ `external_target_alias_conflict`; com registro configurado, `propose` sem referência ⇒ `external_target_reference_required`.

## Contratos reutilizados

`inspectExternalTarget` e `compareExternalTargetIdentity` (identidade canônica e `rootCommitSha` como parte dela), `trusted-git`, `authorizeExternalIntegrationEffect`/`executeAuthorizedExternalIntegration` (lease, CAS/ff, recibo), Trusted System Writer, RPCs e exclusividade física do banco (inalterados). A CLI ganhou só `anima work external targets [--json]` (somente leitura: lista referência, fonte, repositório, commit raiz, git-common-dir, HEAD, destino e status). `propose`, `integrate inspect|authorize|execute` usam a nova resolução sem mudar a separação authorize/execute.

## Provas

- 47 testes novos (`external-targets-registry.test.ts` puro e `external-targets-multi.test.ts` com Git real): dois targets com identidades distintas; resolução e verificação por referência; desconhecido sem fallback; arquivo inexistente/relativo/inválido/duplicado/legado malformado; caminho incorreto, commit raiz incompatível, diretório inexistente; registro repontado e contrato com referência divergente; legado válido; conflito arquivo×legado e coexistência de referências diferentes; resolução do destino de integração; aliases por junction e grafia; listagem sem escrita; CLI (parsing, execução, render); integração ponta a ponta de DOIS targets pelo serviço (authorize e execute separados, o outro repositório intocado), referência sem destino, identidade revalidada após repontar o registro (nenhum repositório muda, nenhum lease), writer obrigatório.
- Regressão: T1–T5 e V1-01 (external*, cli/*, integration-effect*, trusted-git/writer, Single-Item, executor-selection), `tsc` core e web, `git diff --check`.
- Fumaça real somente leitura contra o residente usando APENAS um arquivo de registro (sem variáveis legadas): `work external targets` lista `ext:proof-ext-02` como `ok`; `integrate inspect` da PROOF-EXT-02 devolve `integrated`/`already_integrated`; registro vazio ⇒ `external_target_unknown`. (Uma chamada isolada falhou com `work_item_unavailable` — instabilidade momentânea de acesso ao banco; duas repetições seguidas passaram.)

## Limitações

- A configuração continua local por host (sem gestão distribuída ou descoberta automática de repositórios).
- A recusa de aliases é por git-common-dir resolvido; um segundo clone independente do mesmo projeto é outro repositório (outra raiz/identidade) e continua permitido.
- O registro é relido a cada operação (sem cache); alterar o arquivo muda a resolução imediatamente — a revalidação de identidade impede efeito sobre repositório trocado.
- As migrations candidatas `20261009000000/01` seguem pendentes (inalterado).

# Project Builder V0 — T2: External Work Item Materializer V0 — 2026-10-25

Append-only. Tipo: **implementação** (código + testes em repositórios descartáveis; sem banco residente, sem prova viva). Formato de [`README.md`](README.md). Antecede: [`2026-10-24-project-builder-v0-t1-target-externo.md`](2026-10-24-project-builder-v0-t1-target-externo.md).

## Dados

- Branch `claude/t2-external-materializer`, base `dev` = `origin/dev` = `1aef76add6575146b27a80ffff1a5b370012cfdd`. `origin/main` = `99bec54e`, intacta. Não publicado, não integrado. Nenhuma migration, nenhum schema novo.

## Comandos (CLI existente)

```
anima work external propose --target ext:<slug> --objective "<texto>"
    --scope <caminho> [--scope …] --exclude <caminho> [--exclude …]
    --accept "<critério>" [--accept …] --gate "<npm …>" [--gate …]
    --backend ollama|codex-cli [--model M] [--base-sha SHA]
    [--max-attempts 1..3] [--max-minutes 1..60] [--json]
anima work external classify <UUID> --version N --complexity C --risk R
    --reversibility V --plan-clarity P --urgency U [--json]
```

- `propose` só PROPÕE: captura a identidade do repositório configurado em `ANIMA_EXTERNAL_TARGET` (T1), monta a proposta de forma determinística (sem LLM), reverifica a identidade sobre o contrato montado e persiste UM work item `proposed` (mesmo caminho `service.createProposal` da investigação). Não aprova, classifica, abre claim/attempt, executa, instala dependências nem publica.
- Fluxo: `propose` → `work approve` (humano) → `work external classify` (humano, `human_confirmed`) → `work execute-one` (Single-Item governado).
- `classify` exige item `approved` na versão informada, produzido por `propose` (`external_work_provenance` + target externo válido), cinco eixos explícitos e nenhum `unknown`; sem padrão. Grava pelo RPC existente `record_work_intelligence_classification` com `classifierId=cli_classify_external_v1`. A classificação automática do Anima (`planned-project-classification`, `prepare-autonomous`) NÃO foi ampliada e continua não se aplicando a `ext:*` (há teste). O envelope de auto-aprovação continua recusando externo.

## Contrato persistido (exemplo, valores ilustrativos)

```json
{
  "impactLevel": "low", "capability": "programming",
  "intent": {
    "external_work_provenance": { "kind": "external_work_proposal", "origin": "cli_propose_external_v1", "reference": "ext:shop", "preparedAt": "2026-10-25T12:00:00.000Z" },
    "execution_spec": {
      "schema_version": 1,
      "target": { "kind": "project", "reference": "ext:shop", "identity": {
        "repo_root_canonical": "C:\\work\\shop", "git_common_dir_canonical": "C:\\work\\shop\\.git",
        "root_commit_sha": "<40 hex>", "base_sha": "<40 hex>" } },
      "executor": "worktree", "coder_backend": "ollama", "coder_backend_source": "operator_explicit", "model": "qwen3-coder:latest",
      "base_sha": "<mesmo base_sha da identidade>",
      "permissions": ["workspace_read", "workspace_write_isolated"],
      "validation_criteria": [ { "label": "npm test", "command": "npm test", "proof": "gate", "claim_kind": "gate_assertion" } ],
      "verifier_requirement": "required_fail_closed",
      "limits": { "max_attempts": 1, "max_duration_minutes": 30 }
    }
  },
  "proposal": { "schemaVersion": 1, "data": {
    "summary": "…", "objective": "…", "includedScope": ["src/cart.ts"], "excludedScope": ["package.json"],
    "expectedEffects": ["total() soma os itens"], "risks": ["Repositório externo: …"] } }
}
```

## Decisões e limites

- Escopo concreto exige também exclusões (regra da elegibilidade, `scope_not_concrete`): `--exclude` é obrigatório.
- `codex-cli` grava `model: default` (exigência do Single-Item); `ollama` exige `--model` explícito. Sem backend/modelo implícitos.
- Gates restritos à allowlist `npm run typecheck|test|build|lint` / `npm test` (a mesma do executor). Aceites viram `expectedEffects`; não há `acceptance_contract: 2` (cobertura por efeito) neste V0.
- Escopo aceita arquivo ou diretório relativo seguro; recusa absoluto, `..`, glob, `.git`, `node_modules`.
- O banco residente não foi tocado: persistência provada por doubles; a verificação de identidade e Git rodam em repositórios descartáveis reais.

## Provas

- core: 128 suítes / 3175 testes verdes; `tsc` core e web limpos.
- Web/CLI nas áreas tocadas e regressões (executor-selection, external-*, investigation-preparation, canonical, planned-project, auto-approval, single-item, post-turn, backlog-deps, cli): verdes; `cli/app.test.ts` passa isolado (27 s) com `@anima/*` mapeado para a worktree (artefato de junction conhecido; no checkout principal resolve nativamente).

## Passos para a primeira execução externa real

1. Repositório descartável simples com `npm test` e `node_modules` já instalados (nada é instalado automaticamente; o `linkNodeModules` do worktree supõe a raiz do alvo).
2. `ANIMA_EXTERNAL_TARGET` com `reference`, `repoRoot` e `rootCommitSha`; Supabase no ar; identidade residente.
3. `work external propose` → `work approve` → `work external classify` → compute/placement local → `work execute-one` (Ollama local ou Codex conforme readiness).
4. Aceite, integração, publicação e recuperação de externo seguem NÃO suportados (recusa explícita `external_target_not_supported_downstream`).

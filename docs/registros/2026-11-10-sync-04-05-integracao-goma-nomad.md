# SYNC-03 a SYNC-06: integração Goma + Nomad em `integration/sync-04` — 2026-11-10

Append-only. Tipo: **integração Git e preservação** (sem código novo além do C3; sem schema, migration, banco, attempt ou ledger). Formato de [`README.md`](README.md). Antecedem: [NOMAD-01-F](2026-11-10-nomad-01-f-claude-code-trabalho-externo.md) e o trabalho da Goma até ACC-01-FIX-04 / ACC-02-A1.

## Dados

- Base comum publicada: `origin/dev` = `21b2af9` (GitHub, conferido ao vivo por `git ls-remote` em 2026-11-10; `main` = `99bec54`, ancestral antigo, fora da integração).
- Origens importadas no Nomad pelo bundle `goma-sync02.bundle` (SHA-256 `d2cd0b23…8878`): `refs/goma/dev` = `506980c`, `refs/goma/claude/acc-02-a1-executors-panel` = `6eadb69`, `refs/goma/claude/cloud-04-native-image` = `666b73f`. Nomad: `nomad/claude-code-external-work` = `79781c8`.
- Branch de integração no Nomad: `integration/sync-04` = `f7aa9d7`, árvore `465be34af9189022d0256fe2b68cd54ae14dfaeb`. Não publicada.

## Análise (SYNC-03)

- Topologia: `21b2af9` → Goma dev (14 commits) → { ACC-02-A1 (+2), CLOUD-04 (+1) }; Nomad (+4) direto sobre `21b2af9`.
- Interseção de caminhos: Nomad × Goma dev = nenhuma; Nomad × ACC-02-A1 = `apps/web/cli/app.ts` (auto-merge); Nomad × CLOUD-04 = nenhuma. Nenhuma mudança de dependências.
- Simulações `git merge-tree --write-tree`: todas limpas. Árvore integrada simulada testada: mesmas falhas pré-existentes do Linux, zero novas.
- Conflito semântico encontrado (não textual): o Chat Dev (`project-read-tools.ts`, ACC-01-E1) fixava `claude-code: singleItem 'not_admitted'`, falso depois da NOMAD-01-F.

## Integração (SYNC-04)

| Checkpoint | Commit | Pais | Árvore |
| --- | --- | --- | --- |
| C0 | `506980c` (Goma dev) | — | — |
| C1 | `e5aae47` merge Nomad | `506980c`, `79781c8` | `52d898a997a26eb0a02443573ad026d558cdb906` |
| C2 | `ab19b51` merge ACC-02-A1 | `e5aae47`, `6eadb69` | `f92ea8f79eeb42f3793d3e2c0e994f45f55cb52d` |
| C3 | `f7aa9d7` correção semântica | `ab19b51` | `465be34af9189022d0256fe2b68cd54ae14dfaeb` |

C3 (patch `sync-04-c3-r1.patch`, SHA-256 `5a6ff429…010a5d`): o Chat Dev passa a distinguir quatro níveis do Claude Code — `singleItemSupport` (lido da barreira do core `singleItemContractRefusal`), `runtimeReadiness: not_checked` (a ferramenta não lança processo), `singleItem` (`unverified_runtime_check_required` | `blocked_executable_invalid` | `blocked_executable_missing` | `not_supported`, reusando só as partes da barreira do `execute-one` que não exigem processo) e `governedProof: absent`. A primeira versão do C3 (`admitted_with_subscription`) foi descartada antes de aplicada por afirmar uma sessão de assinatura que a ferramenta não verifica.

## Regressão Windows (C4)

Script `sync-04-c4-v2.ps1` (SHA-256 `c3dacb03…c3dd`), relatório `C:\dev\logs\sync-04-c4-20261110-163816.txt`:

- `packages/core`: typecheck limpo; 133 suítes, 3343 testes, 0 falhas.
- `apps/web`: typecheck limpo; 3794 testes ok, 7 falhas, 7 pulados. As 7 falhas falham igualmente em `refs/goma/dev` e em `nomad/claude-code-external-work` (pré-existentes: Python ausente no Nomad em `restore-proof-gate`; raiz fixa `G:\anima` em `project-tools` e `project-context-builder`; teste defasado do porto em `backlog-cycle/route`). Candidatas a regressão: 0.
- Refs e worktrees inalteradas pela execução; retorno a `integration/sync-04` na árvore esperada; sem alertas.

## Preservação (SYNC-05/06)

- Bundle de recuperação `anima-sync-04-recovery.bundle` (SHA-256 `43d28cdc232a52e5e850a091fa5130aef6222450eba685e19d494541db21d895`), com 5 refs e pré-requisito único `21b2af9`.
- Prova independente de restauração num clone novo do GitHub: `bundle verify` ok; as 5 refs com os SHAs acima; merges com os pais e as árvores da tabela; Goma dev, ACC-02-A1 e Nomad ancestrais da integração; CLOUD-04 preservado e **fora** da história integrada (0 arquivos `tools/runpod-native` na árvore); 23 commits em `21b2af9..f7aa9d7`, todos do mesmo autor; o C3 restaurado é idêntico byte a byte ao patch auditado.
- WIP da Goma **não** incluído (não é commit): `wip-7-sqls.patch` (`f8ee0a10…5c06`), `wip-7-sqls.files.txt` (`d49dda31…9d92`) e `untracked-inventory.txt` (`ecc3470b…041f`) estão preservados na Goma (SYNC-02) e ausentes do Nomad.

## Pendências (registradas, não implementadas)

1. Painel ACC-02: mostra `execute-one` pela prontidão geral; deve refletir a barreira do Single-Item (`singleItemCodexRefusal`).
2. Chat Dev: `codex-cli: singleItem 'admitted_with_wsl'` afirma admissão só pela configuração; aplicar a mesma separação de níveis.
3. Inspecionar os 7 SQLs WIP da Goma antes de qualquer etapa com banco.
4. Prova governada completa do Claude Code (identidade, banco descartável, aprovação humana, ledger).
5. CLOUD-04 fora da integração até avaliação separada (traz `postgresql.schema.sql` próprio).

## Efeitos externos

Nenhum push, publicação, alteração de `dev`/`origin/dev`, migration, banco, Docker ou Supabase.

## Próximo ponto exato de retomada

Gravar este registro como commit documental na `integration/sync-04`, regenerar o bundle de recuperação, transferir o WIP da Goma ao Nomad com hashes conferidos e, por decisão humana, publicar a branch de revisão e promover `dev` por fast-forward.

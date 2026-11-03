# 2026-10-14 — Durability D1: item e173a267, attempt 733164b7 (candidato com gate vermelho)

Registro append-only. Antecedentes: `2026-10-14-durability-d1-contrato-independente-e173a267.md`, planos 068–070. US$0. Sem dump/backup/restore reais, migration, accept, integração ou push.

## Fatos
- Item `e173a267-aa49-4c59-80eb-1aa85f172cd9` v1: aprovado (86753), classificado bounded/low/reversible/clear/normal (86754). Única recusa de orçamento: `user_attempt_budget_exhausted` (19 attempts/24 h; libera ~21:03Z) → lease E0 `a2e0347e-34fe-4ecc-8845-806c01362231` (até 15:39:54Z), revogado após o resultado. RAM: `permit`.
- Attempt `733164b7-778e-4eb4-88ff-812949f53560`, 15:10:00–15:18:24Z (Codex ~8 min até o checkpoint 86760). `execution_failed` 86761: `[gate_failed]` no test_binding (exit 1, 9,8 s). Sem result_submitted ⇒ sem Verifier. Claim liberada (86765).
- Candidato preservado: `f2bc461eaee341032afba7703e89c9d195779d93` (filho único de b6d2dda), branch `anima-work/733164b7-778e-4eb4-88ff-812949f53560`, 6 arquivos do escopo (+746), blobs LF.

## Causa-raiz
`apps/web/lib/restore-proof/restore-proof-gate.test.ts` calcula `root = path.resolve(__dirname, '../../../../..')` (5 níveis; o correto são 4: apps/web/lib/restore-proof → raiz). O cwd errado faz `unittest discover -s supabase/tests` falhar com "Start directory is not importable" e o `readdirSync` do cache falha com ENOENT; 4 dos 5 testes Jest falham. Defeito só do wrapper.

## Revisão independente (scratch via `git archive`, apagado)
Suíte Python do candidato: **35 testes OK em 37,6 s** (inclui `blob_col`, `crlf_violation` com 6 casos, determinismo, ordem, mutações, órfãs, sequência, cobertura, papéis, claims/leases, privacidade, read-only). Estático: sem DML/DDL/rolpassword/pg_authid nas SQL (1 ocorrência em roles-projection é a lista `VALUES` de privilégios — a conferir na leitura). 0 containers `anima-restore-proof-*` residuais. Jest completo não rodado no scratch (sem node_modules).

## Estado final
dev = origin/dev = b6d2dda; 156 migrations; seq 86765; 0 claims e 0 leases vigentes; stale de julho inalterada; item `failed` (1/1). Próximo: novo mandato (recovery do candidato com correção de 1 linha do wrapper, ou aceite humano/revisão manual).

# Candidato governado de recovery

- **Data/tipo:** 2026-08-26 — desenvolvimento + gates.
- **Objetivo:** ligar a decisão determinística `decompose` ao boundary persistente de lineage sem permitir expansão silenciosa de autoridade.
- **Branch / HEAD inicial:** `dev` / `c47dd35`, igual a `origin/dev`; `origin/main` em `99bec54`, intocada.
- **Domínio:** `validateRecoverySuccessor` exige original `failed`, assessment correlacionado e ação `decompose`; candidato tecnicamente pronto; included scope como subconjunto estrito; mesmo target/capability; permissões e max attempts não ampliados; impacto não elevado; sem dependência no original falho; sem autoridade financeira; inputs de lineage válidos.
- **Boundary web:** `proposeRecoverySuccessor` valida localmente e chama somente `public.propose_recovery_successor`. Resultado máximo é um novo item `proposed` + lineage; não aprova, classifica, cria claim/attempt ou executa. Resposta/erro inválido falha fechado.
- **Provas:** core recovery 24/24 PASS; web recovery 7/7 PASS; core completo 54 suítes/1.191 testes PASS; typecheck dos cinco workspaces PASS; `git diff --check` PASS.
- **Efeitos externos:** nenhum work item real foi criado neste commit; nenhum provider, worktree, approval, classification, claim, attempt, PR, merge ou deploy.
- **Próximo ponto:** após publicar o código, validar a fatia mínima já registrada contra o Item 1 real e materializá-la uma vez como `proposed`, com idempotency key estável; então provar original/attempts/dependências intactos.


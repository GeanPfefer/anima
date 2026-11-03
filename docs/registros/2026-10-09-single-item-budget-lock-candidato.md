# Single-Item V1 — candidata incremental item/orçamento

2026-10-09; desenvolvimento e validação offline, sem prova SQL nova.
Branch `dev`; HEAD inicial/final `6bc4aadef9414d655600c2ea37c6be436b3628c8`.
Nenhum commit/staging/push. WIPs e worktrees preservados.

## Implementação e decisões

[Plano 049](../planos/049-single-item-budget-lock-candidate.md) contém escopo,
mudanças semânticas, matriz/roteiro reproduzível e riscos. Complementa o 048; não
reescreve seu SQL/diff/inventário histórico. Usuário autorizou implementação
incremental de quatro corpos e testes/pacote offline, não aplicação.

Criada [20261009000001_budget_item_lock_order_candidate.sql](../../supabase/migrations/20261009000001_budget_item_lock_order_candidate.sql),
SHA256 `a7c28532b087427bd53c06f8c07876f28041a52fc1d4049400e8e94c35ae2f47`.
[Diff completo](../planos/049-single-item-budget-lock-candidate.diff).
Somente start_claimed e as três begin_*resumed autorizadas são substituídas.
Admissão toma B antes de I/C/T; replays já visíveis não tomam B/T e conservam seus
predicados históricos. Novas rechecagens de auth/allowlist após I/C, T e escrita
com waits implícitos; desaparecimento do replay falha 55000 em vez de buscar B
tardiamente. Estado/owner/versão são relidos sob I, correlação sob C/eventos;
orçamento permanece decisão/consumo do trigger original depois das esperas.

Start antecipa também o mesmo T dentro da ordem C→T já existente para revalidar
autoridade após essa espera; duplica somente checks pre-target e replay do helper,
fixados por contrato. Não altera helper/global/release/claim scoped. Corpo release
é idêntico entre candidato item/claim e combinado. Nova authority recheck pode
produzir 42501 após revogação em retomada onde antes a checagem inicial bastava;
é mudança explicitamente requerida e será prova negativa, não regressão ocultada.
Preflight sem locks permite recusas antecipadas e mantém sua observação; erros
posteriores ainda podem tomar B para evitar inversão. Detalhes/limites no 049.

## Harness e testes

Scanner admite corpus pinado com erro em fonte ausente. Testes/renderer do 045,
047 e 048 inspecionam suas receitas históricas explícitas; novos testes inspecionam
**todo** o corpus efetivo e confirmam diferença de apenas quatro corpos, headers
intactos e hashes de todas as 155 migrations anteriores. Bundle antigo de dois
slots mantém expected prosrc de seu candidato, sem confundi-lo com o combinado.
Os 178 hashes de asserções canônicas (55+123) não mudaram; nenhuma fixture SQL,
assertion ou expectativa histórica foi editada nesta sessão.

Novos [testes](../../supabase/tests/single_item_budget_lock_candidate_test.py),
[compositor](../../supabase/tests/single_item_budget_lock_bundle.py),
[renderizador puro](../../supabase/tests/single_item_budget_lock_proof.py),
[contrato](../../supabase/tests/fixtures/single_item_budget_lock_candidate.json).
Renderizador valida UUIDs/nonce/target sintético e separa BEGIN/preparação de ações
RPC, evitando falsa reprodução com envio prematuro de start. Não possui executor.

- **112 testes Single-Item PASS**, incluindo 15 novos; conjunto em 55,616 s.
- **30 testes bootstrap offline PASS**, em 16,303 s. Total: 142 testes distintos.
- Bootstrap 272 etapas/556 hashes conferidos sem divergência no compositor.
- Corpo de helper/políticas/trigger budget/código governado/gate permanecem intactos.
- Modelos finitos conservam contraexemplos I→B por pré-lock/composição, alvo estrangeiro,
  recovery multi-item e foco; não demonstram ausência universal de deadlocks.

Logs/checks/hashs e roteiros renderizados em
[artefatos offline](2026-10-09-single-item-budget-lock-candidato-evidencias/).
Não houve pgTAP, execução concorrente, aplicação ou compilação PostgreSQL.
Primeiras revisões do gerador rejeitaram âncoras ambíguas e leitura indevida do próprio
novo override como baseline; seleção explícita do corpus resolveu isso offline.
Nenhum SQL foi aplicado e nenhuma migration histórica precisou ser alterada.

Quatro FAIL históricos local/externo (1,2,6,10) permanecem resultados anteriores,
8/12 nessa suíte/330 de 334 no total por slot. Manifests conservam o detalhe bruto;
nenhuma alteração de política, quota local/externa, supervisão ou expectativa para
obter PASS. Testes offline verdes não substituem esses FAIL nem liberam o gate.

## Pacote, integridade e efeitos

Três pacotes independentes: original 272 etapas; item/claim mesmas 272 + 20261009000000;
combinado mesmas 272 + 20261009000000 + 20261009000001. Harness/bootstrap/fixtures
comuns e hashes idênticos; expected prosrc de 161 funções/headers e identidade NULL
por slot. Arquivos não são autorização live; destinos/cluster IDs/isolation exigem
preflight novo antes de cada SQL. Evidência guarda paths, manifests e hashes.
Não reaplicar as migrations originais depois do bootstrap.

Nenhum Docker, container, SQL ou banco residente acessado nesta sessão. Saúde atual
do residente não medida; observações anteriores continuam históricas. Nenhum
Resident Host, INV-11, compute pago, credencial residente ou integração externa.
Somente migration nova, testes/harness offline e documentação. Tipos não regenerados:
sem banco/schema/assinaturas alterados. Typecheck/build TS não pertinentes.

[Checks finais e Git](2026-10-09-single-item-budget-lock-candidato-evidencias/checks.json)
registram índice vazio, branch/HEAD/worktrees, arquivos preexistentes preservados e
mudanças do harness autorizadas. WIPs de migrations 20260905000001/00002 continuam
byte a byte como no início; nenhuma migration existente editada.

## Fronteira e retomada

**BLOCKED_BY_HUMAN_DECISION:** revisar a migration/diff 049 e a otimização do replay,
rechecagens de autoridade e prelock T. Depois, autorizar separadamente aplicação
apenas nos novos descartáveis e prova nos três slots. Controle natural usa S apenas
em T para reproduzir item/budget tanto no original quanto no item/claim; controles
adversariais manuais continuam e podem produzir 40P01 no combinado. Exigir orçamento,
revogação, ACL/RLS, rollback/cleanup e carga de ≥1000 transações, sem retry que oculte
falha. O 049 lista cenários/aceite/NO-GO e receita precisa.

Migração candidata pronta offline, **não aprovada por PostgreSQL**; NO-GO promoção.
Riscos residual global/recovery/FK/multiowner e contenção B não resolvidos. Gate
`single_item_atomic_claim_unavailable` permanece ativo. Parada antes de aplicar SQL.

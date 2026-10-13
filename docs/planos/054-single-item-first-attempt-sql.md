# 054 — Fechamento SQL mínimo da primeira attempt Single-Item

Autorização humana de 2026-10-10: uma migration incremental e provas focais em
PostgreSQL descartável. Não autoriza promoção, execução do ANIMA ou liberação do gate.

## Delta autorizado

- `release_work_claim(uuid,text)`: corpo integral da candidata item/claim.
- `start_claimed_work_attempt(uuid,uuid,text)`: corpo integral da candidata de
  orçamento, somente esta função. Nova admissão orçamento → item → claim → alvo;
  replay não adquire orçamento para uma nova admissão.
- `private.begin_work_attempt(uuid,uuid,integer,uuid,text,text,uuid)`: corpo efetivo
  histórico, alterando somente o `updated_at` da transição para `in_progress` para
  `GREATEST(v_item.created_at,v_item.updated_at,clock_timestamp())`.

Migration: `20261010000000_single_item_first_attempt_candidate.sql`.
Não inclui acquire, RPCs de retomada, DDL, ACL ou política. Assinaturas inalteradas;
não exige regenerar tipos. O helper também serve o início comandado: somente seu
timestamp muda, não sua autorização ou admissão.

## Prova e fronteiras

Reutilizar bootstrap 272 etapas, pacotes 052r2, guard corrigido, comparador integral
279 funções e sessões 053. Um novo cluster: bootstrap baseline + somente esta
migration. Guard antes de initdb; catálogo completo antes/depois; diferenças
permitidas exatamente os três corpos. Evidência de fonte, payload e corpo separada.

Controles focais: 55 asserções Single-Item, claims, classificação e orçamento;
quatro FAIL históricos local/externo visíveis; RPCs naturais de início/liberação e
orçamento; pré-locks adversariais separados; revogação durante espera; transação
antiga e piso temporal persistido; rollback e cleanup sem órfãos.

O piso preserva timestamps previamente persistidos, mesmo à frente do relógio.
Não corrige o relógio nem muda os timestamps de auditoria. Transações compostas
que entram com locks prévios, operações entre itens, início comandado versus
orçamento, recovery e retomadas continuam fora da garantia localizada.

Não promover as duas candidatas anteriores por arrasto: a segunda também altera
três RPCs de retomada excluídas desta autorização. Uma futura promoção requer
inventário residente e pacote explicitamente revisado; não executar migration up
genérico a partir de um diretório com candidatas ainda não promovidas.

Resultado e próximo checkpoint: [registro da sessão](../registros/2026-10-10-single-item-fechamento-sql.md).

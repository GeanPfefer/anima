# Robustez de edição do coder local — âncora ambígua desambiguável por evidência

Continuação da prova viva do PIN-02 (attempt `7802904a` falhou em
`[ollama_ambiguous_replacement]`). Este recorte NÃO tenta o PIN-02 de novo (cadeia
intacta); melhora o PROTOCOLO de edição para que uma âncora ambígua seja desambiguada
por evidência/contexto, sem virar heurística perigosa. dev, HEAD inicial `515800d`;
`origin/main` `99bec54` intacta.

## Causa raiz (reconstruída do transcript persistido, redigido por addf467)

Attempt `7802904a`, coder `qwen2.5-coder:14b` (fallback governado), ~26s:
- **step 1** READ linhas 1–50; **step 2** READ linhas 31–50 (mesmo `readHash`);
- **step 3** `replace_exact` com `before` de 3 linhas; `rawMatchCount:0` (arquivo CRLF vs
  âncora LF) → tolerância EOL → `matchCount:2` → `result: ambiguous_anchor`;
- **step 4** `batch_failed` → `execution_failed`.

O bloco de 3 linhas (setup+asserção genéricos de teste) RECORRE 2× em
`project-intake.test.ts`. O modelo leu o intervalo do alvo (31–50), mas a operação
`replace_exact` de produção **só carrega um `before`/sha** — não há como expressar QUAL
ocorrência. `applyEditOperations` exige ocorrência única GLOBAL e recusa fail-closed
(correto: nada de "escolher a primeira"). Logo a barreira era **expressividade do
protocolo**, não a lógica de recovery. Nota: já existe o experimento R2 host-mediated
(`replace_anchor` por `anchor_id` escopado ao READ) — solução completa, porém OPT-IN e não
ligada na produção; não foi reaproveitado para não trocar toda a vocabulário do editor.

## Correção (mínima, canônica, sem heurística)

**A. `in_lines` — desambiguador determinístico** em `replace_exact` e `insert`
(`ollama-protocol.ts`): `in_lines:[início,fim]` é o intervalo de linhas 1-based OBSERVADO
num READ que contém a ocorrência a editar. `resolveUniqueOccurrence` restringe a contagem
às ocorrências cujo início cai nessa janela (offsets CRUS, agnóstico a CRLF/LF) e exige
**exatamente 1**; 0 ou >1 no intervalo → recusado; intervalo fora do arquivo → recusado.
Sem `in_lines`: mantém a exigência de unicidade GLOBAL. NUNCA escolhe a primeira, nunca
aproxima. Preserva integralmente: `expected_file_sha256` (staleness ANTES de desambiguar),
escopo, EOL, no-op (`before===after`), não-sobreposição. Mensagem de ambiguidade agora
lista as linhas de cada ocorrência e sugere `in_lines`.

**B. Recuperação BOUNDED na MESMA tentativa** (`ollama-coder.ts`): âncora ambígua é
condição RECUPERÁVEL (nenhuma mutação, gate ou perda de integridade). Em vez de terminar a
tentativa, o host devolve ao modelo as ocorrências e pede um `before`/`anchor` mais
específico OU `in_lines`, dentro do orçamento de rodadas e de um teto próprio
(`MAX_AMBIGUITY_FEEDBACKS=2`). Esgotado o teto/as rodadas → terminal. `stale`/`scope`/`no-op`
continuam terminais fail-closed (não são reapresentados). Prompt atualizado documentando
`in_lines`.

## Resposta ao §6 (classificação da falha)

Fica exatamente como pedido, provado por testes:
- **erro de operação corrigível (âncora ambígua)** → feedback ao coder DENTRO do budget
  (nenhuma mutação ocorreu); o modelo reapresenta com `in_lines`/âncora específica e converge;
- **repetição/incapacidade de desambiguar** → terminal (teto de reapresentações OU rodadas
  esgotadas);
- **risco/stale/scope/no-op** → fail-closed terminal apropriado (não recuperável por feedback).

## Resposta ao §8 (semântica de autoridade após o anti-loop)

Lendo `20260903000000_human_recovery_authority.sql` + estado vivo:
1. **Uma 2ª Human Recovery Authority nesta MESMA árvore é ILEGAL** — por DUAS guardas
   independentes: (a) `authorize_work_resume` exige que o predecessor seja successor de um
   replan (`work_replans WHERE successor_id=i`); `2b860033` não é (replan_succ=0) →
   `exhausted_replan_required`; (b) `EXISTS(work_resume_authorizations WHERE
   envelope_root_id=root)` já é verdadeiro (grant `96358464`) → `authority_already_allocated`.
   Além disso o trigger `no_resume_authority_descendants` barra qualquer lineage descendente
   de um successor humano-retomado. Portanto a frase anterior "nova autoridade humana
   explícita (outra concessão)" era IMPRECISA: o substrato atual NÃO admite uma 2ª concessão
   por envelope.
2. **Transição canônica após uma human-resume também falhar:** a unidade fica `failed`
   (budget 1/1), terminal; o anti-loop impede recovery automático. Não há continuação
   automática — **volta ao humano** deliberadamente.
3. **Intenção:** sim, deliberada — a HRA concede EXATAMENTE uma extensão por envelope; falhou
   de novo ⇒ decisão humana, sem mecanismo automático.
4. **O que uma nova prova legal exigiria:** (i) um NOVO work item independente (intenção e
   autoridade próprias — não recovery desta árvore esgotada), OU (ii) endereçar o PIN-02
   ORIGINAL `8e9fd82b` (que segue em `changes_requested`, estado distinto e não esgotado)
   pela sua própria via de correção, OU (iii) uma nova capability de substrato que autorize
   >1 concessão por envelope — DELIBERADAMENTE inexistente e que exigiria decisão de política
   canônica. Não implementado aqui (sem necessidade canônica clara).

## Antes/depois

- ANTES: `before` que recorre no arquivo ⇒ `ollama_ambiguous_replacement` TERMINAL, mesmo com
  o modelo tendo lido o intervalo exato. Nenhuma via de desambiguação na produção.
- DEPOIS: o modelo pode provar a ocorrência com `in_lines` (determinístico, fail-closed); e
  uma primeira âncora ambígua é reapresentável dentro do budget, com as ocorrências no
  feedback. A reprodução do caso `project-intake.test.ts` deixa de falhar por ambiguidade
  quando há evidência suficiente (teste dedicado).

## Testes e gates

`ollama-protocol.test.ts` +11 (61 total): 2 ocorrências sem e com `in_lines`; fora do arquivo;
0 no intervalo; intervalo amplo demais (2 no intervalo) recusado; ocorrência única + in_lines;
CRLF; no-op; stale; parse malformado; `insert` com âncora repetida. `ollama-coder.test.ts` +3
(23 total): ambíguo→feedback→`in_lines`→converge (só a ocorrência certa muda); nenhuma mutação
parcial; reapresentação BOUNDED→terminal. Recalibrado 1 teste de orçamento (SYSTEM +≈91 tokens
pela instrução `in_lines`; cap 1700→1900). Suíte de edição completa 143/143; typecheck web+core
limpos; `git diff --check` limpo. Cadeia PIN-02 NÃO tocada.

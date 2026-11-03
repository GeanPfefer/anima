# Planner P2 — aceite, integração, publicação e sondas do planner real para o P3 (2026-10-14)

Append-only. Sequência de `2026-10-14-planner-p2-attempt-c42ccb12.md`.

- Preflight: item `c42ccb12` review v1; resultado `cdefa0bd` ↔ attempt `6084e96c` ↔ checkpoint `af9c5577fadba8bb0b849f0159c9ead212526947` (1 commit sobre `704e959a`, 0 merges, 7 arquivos); `af9c5577^{tree}` = `d8d405d6d83fddd9eb3203665cf946b425923d20` (= árvores do gate e `observedTreeSha`); parecer 86647 md5 `bdc50a0302b5c8c971cebb22fe828712` (v6 verified, `test_binding_satisfied` independent, 12 testes passed); 0 integrações/claims/leases; índice vazio; status de referência `status-ref-p2.txt` (247 linhas).
- Aceite: seq **86649** `result_accepted`; item `completed`; parecer inalterado.
- Integração (clone `anima-integration-c42ccb12`, sem hardlinks, push desabilitado, HEAD destacado; wrapper `integ/integrate-c42ccb12.mjs`, guard `work-verifier-v6`; 0 guards falsos): **86650** `integration_effect_authorized` (auth `c42ccb12-c0de-4e00-8f21-c42cc0ffee01`), **86651** `integration_completed`; recibo `ff_only`, `effected`, `previousTargetSha` `704e959a`, `resultingTargetSha` `af9c5577`, `mergeCommitSha null`.
- Sync: `refs/anima/integrated/c42ccb12`, `merge --ff-only`; dev=`af9c5577` (árvore `d8d405d6…`); índice vazio; status idêntico; 7 arquivos 100% CRLF.
- Verificações: planner 10 suítes / 244 testes PASS; `tsc` web 0 erros fora de `scripts/_session`; schema recursivo sem `maxLength/minimum/maximum/pattern/format`, objetos fechados e tudo em `required`; host ainda impõe limites; legado com sha256 idêntico (`7128dbcc…`); `diff --check` limpo; 0 segredos; 20 sondas OK.
- Publicação: push comum `704e959..af9c557` em `refs/heads/dev`; `origin/dev`=`af9c5577`; `origin/main`=`99bec54e` intacta.

## Sondas do planner LOCAL real (Ollama, sem custo; isoladas, sem persistir nada)
Ollama não estava em execução; iniciei `ollama serve` (FLASH_ATTENTION=0) só para as sondas e encerrei ao final (estado original restaurado). RAM livre 10,0 de 15,9 GB; GPU 16 GB. `qwen3-coder` (18,6 GB) inviável nesta máquina (barreira de RAM conhecida).
Objetivo usado nas sondas (real e pendente no HEAD): extrair o literal `8 * 1024 * 1024` de `captureJestReport` (worktree.ts:153) para `MAX_JEST_REPORT_BYTES` exportada, com teste NOVO `worktree-report-limit.test.ts`.
- `qwen2.5:14b` (162 s): proposta válida, MAS `test_bindings: []`, `validation_command: "npm test"` (global, sem escopo), `validation_claim_kind: gate_assertion` cobrindo 5 efeitos de comportamento ⇒ legado fraco: o gate verde "prova" comportamentos (rotulagem incorreta); sem `acceptance_contract`.
- `qwen2.5-coder:14b` (61 s): válida, `test_bindings: []`, `npm test`, `substantive` ⇒ no legado vira lacuna `acceptance_substantive_gate_insufficient`; sem binding.
- `llama3.1:8b` (113 s): "não chegou a uma proposta terminal".
- Com pedido EXPLÍCITO de `test_bindings` no texto: `qwen2.5-coder:14b` (364 s) e `qwen2.5:14b` (585 s) falharam com "não chegou a uma proposta terminal". Instrumentando o adaptador: o modelo submeteu, mas o host rejeitou `excluded_scope: required_text_list` (campo omitido) e `validation_covers: unknown_criterion` (`covers` não literal aos `expected_effects`), esgotando turnos/tempo; o adaptador devolve ao modelo a causa de cada rejeição mas a mensagem final ao usuário não a expõe.
- Conclusão: o modelo local viável NÃO produz hoje um contrato `test_binding` válido; nenhuma proposta P3 foi fabricada/persistida (nenhum item criado, 0 eventos novos, ledger 156, último evento 86651).

## Recomendações específicas (próximos itens)
1. P2b (diagnóstico): incluir na falha terminal do adaptador a ÚLTIMA rejeição estruturada (campo/regra) e o nº de turnos; contador de rejeições por regra em telemetria.
2. P2c (qualidade do prompt, sem afrouxar o host): exemplo mínimo completo (few-shot) de submit com `test_bindings` preenchido, regra "covers = cópia literal de expected_effects", "excluded_scope nunca vazio", e instrução de usar `npm run typecheck`/comando escopado — avaliar com os modelos locais viáveis.
3. Prova P3 por caminho alternativo: planner OpenAI (custo, exige autoridade e orçamento humanos; confirmar também o strict-schema real) ou hardware/modelo maior; manter contrato escrito por humano só como prova do EXECUTOR, não do planner.
4. Opcional: o orquestrador pode emitir aviso (nunca erro) quando o planner marca `gate_assertion` num critério cujo `covers` não corresponde a "o gate passa" — hoje é uma rotulagem sem verificação estrutural.

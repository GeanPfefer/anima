# TPC-01 — probe não-governado A/B de modelo

Data: 2026-10-01 (America/Sao_Paulo). Tipo: prova. Executor principal único: Codex.

## Mandato e estado

Comparar somente `qwen2.5-coder:14b` com o controle A já encerrado de
`qwen3-coder:latest`. Fim humano do prompt tuning; nenhuma repetição do qwen3,
terceiro modelo, compactação ou alteração de harness autorizada.
Referências: [backlog TPC-01](../planos/008-primeira-prova-trusted-produce-change-backlog.md),
[contrato do harness](../arquitetura/coding-harness-v3-agentic-runtime.md).

Branch principal `dev`; HEAD inicial/final = dev = origin/dev =
`f8433a418dd3bf2bd6b173aef3a1481556e3bd09`.
origin/main = `99bec54e3ab42bfe882a8686cd1385d8058b916e`, intocada.
Zero commits, push, merge, provider pago, successor, attempt canônica, authority
ou eventos canônicos. Nenhuma chamada Claude, Work, OpenAI ou RunPod.
O identificador scratch `probe-A-1790909148955` não foi persistido como attempt.

## Limpeza e fidelidade

Excluídas somente as branches locais anteriores
`anima-probe/probe-A-1790908305384` e `anima-probe/probe-B-1790908431082`.
Suas worktrees já não estavam registradas; nenhum processo Ollama antigo estava
ativo na inspeção. Scratch/logs anteriores preservados, com cópia em
`.tmp/tpc01-model-ab/previous/`.

Reutilizado o request exportado anterior, sem banco/event log. Base
`f94bc5a2dc8076be40471d5f7810d81518cb8bfa`, mesmo WorktreeExecutorAdapter,
OllamaCoderBackend de controle, prompt, task/scope, tools, progress guard,
validação e gateRetryLimit. Supervised, temperature 0, num_ctx 16384,
num_predict 1536, OLLAMA_FLASH_ATTENTION=0; runner confirmou flash_attn disabled.
Modelo instalado: Q4_K_M, digest
`9ec8897f747e246e970bc5cfdda85d22f1123dc2e3d34978a010a75968716849`.

Primeiras mensagens idênticas byte a byte ao controle A; ambos reportaram
2932 prompt tokens. Primeira ação diferiu: qwen3 READ args.ts; qwen2.5 SEARCH
`work show <id>`. Nenhuma mudança funcional do prompt.

Invocador scratch `apps/web/scripts/_session/probe/tpc01-model-probe.ts`:
modelo substituído, captura integral do corpo HTTP, mensagens e conteúdo bruto.
Para cumprir a proibição de commit, emitCheckpoint=false e a chamada de commit
foi interceptada em memória para salvar diff e recusar. Essa barreira não foi
alcançada; não interferiu na trajetória observada. Nenhum arquivo do harness editado.

## Trajetória (chamadas numeradas a partir de 1)

| Chamada | Ação | Prompt tokens | Eval tokens | Duração ms |
|---|---|---:|---:|---:|
| 1 | SEARCH `work show <id>` | 2932 | 29 | 14833 |
| 2 | READ args.ts 170–180 e args.test.ts 21–30 | 3367 | 96 | 3276 |
| 3 | READ args.ts 170–180 | 4018 | 57 | 2532 |
| 4 | READ args.ts 170–180 | 4096 | 57 | 1912 |
| 5 | READ args.ts 170–180 | 4140 | 57 | 1908 |
| 6 | READ args.ts 170–180 | 4184 | 57 | 2030 |

Termination: `ollama_no_progress`, quatro rodadas consecutivas sem informação
nova; duração host do coder 26612 ms. Cinco ações READ solicitando seis ranges
(dois ranges inéditos servidos, quatro repetições), uma SEARCH, zero EDIT,
EXEC ou SUBMIT. Primeira EDIT e chamadas até EDIT: inexistentes.
Edit aceito/recusado: não aplicável. Diff final vazio (0 bytes).
Teste focal `npm test -- cli/args.test.ts`: não executado, sem candidato.
Nenhum gate candidato ou repair. Parada humana cumprida imediatamente.

| Modelo/arm | Chamadas | READ (ações) | SEARCH | EDIT / EXEC / SUBMIT | Pico prompt | Terminal |
|---|---:|---:|---:|---|---:|---|
| qwen3 controle A anterior | 20 | 6 | 14 | 0 / 0 / 0 | 11490 | ollama_no_progress |
| qwen3 variante anterior | 16 | 13 | 3 | 0 / 0 / 0 | 13062 | ollama_no_progress |
| qwen2.5 controle nesta sessão | 6 | 5 | 1 | 0 / 0 / 0 | 4184 | ollama_no_progress |

Conclusão limitada: a troca de modelo não rompeu a ausência de edição nesta
única execução determinística do protocolo atual. Não prova incapacidade geral
dos modelos nem identifica causa raiz. Não há evidência positiva de vantagem
comportamental do qwen2.5 neste probe.

## Evidência e recuperação

`.tmp/tpc01-model-ab/new/arm-A-calls.jsonl` preserva respostas HTTP completas,
raw model content, requests/messages, tokens e duração por chamada, sem redaction.
`complete-calls.json` deriva ação JSON e feedback host da chamada seguinte;
para a última chamada inclui o terminal host. Os events/transcript observados
originais e `final.diff` também estão preservados. O transcript canônico do
harness continua com sua sanitização original; não substitui os logs brutos.
Logs Ollama: `.tmp/tpc01-model-ab/ollama-{stdout,stderr}.log`.

Worktree `G:/anima/.worktrees/anima-wt-H3pf0m/tree` removida pelo adapter;
branch `anima-probe/probe-A-1790909148955` excluída. Ollama descarregado
(`done_reason=unload`) e todos os processos Ollama parados. Docker reiniciado;
`supabase start` terminou com sucesso, sem db reset/migration.
PostgreSQL healthy e pg_isready accepting connections; auth, realtime, gateway,
studio, pgmeta e analytics healthy. Ressalva: coletor `supabase_vector_anima`
reiniciando por NetworkUnreachable ao acessar Docker logs; CLI avisou sobre
Docker TCP 2375 no Windows. Não foi alterada a configuração do daemon.

Nenhum tracked file alterado nesta sessão; diff inicial/final permanece
11 linhas adicionadas no PRD e 22 no backlog, WIPs prévios. Hashes preservados:
PRD `4FE90A127A682A77FFCD02D7F0F6DBACF87E62B62BA9D6D31C5543B3F97BD857`;
backlog `C7049AE5842E4C3C0C4E4DA6886A76DC79E6AD6704BA8A436338A09251723E55`.
PRD/plano não atualizados em respeito à proibição explícita de tocar WIPs.
Este registro e o scratch são novos arquivos não commitados.

Próxima retomada: decisão humana sobre os dados comparativos. Não repetir
probe ou mudar prompt/modelo/protocolo/guardas sem novo mandato.

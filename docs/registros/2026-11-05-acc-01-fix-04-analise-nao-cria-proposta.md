# ACC-01-FIX-04: análise e consulta não criam proposta — 2026-11-05

Append-only. Tipo: **correção** (código + testes; sem schema, sem escrita no residente). Formato de [`README.md`](README.md).

## Incidente (prova viva da ACC-01-E1)

A mensagem "Quero analisar o desenvolvimento do ANIMA como um todo. Quais trabalhos continuam abertos … Consulte os registros …, explique as prioridades e diferencie fatos confirmados de recomendações." criou o work item **`8193da93-59d4-46c9-9c5e-61be18223a95`** (`programming`, `proposed`, v1, 2026-11-05 20:18:03Z, `planner=openai_project_tools_v1`, mensagem de origem `5a46854e-b53a-41bd-aa07-cc12c3c3aaca`, resumo "Document the current backlog status and the human decision boundary…"). Eventos: apenas `work_proposed` (86944) e `context_attached` (86945). Sem execução, claim, tentativa ou integração. Efeitos colaterais: a proposta virou o **foco** do usuário (`set_work_focus` pelo caminho de criação) e o planner pago (OpenAI) foi chamado.

**A proposta foi mantida intacta.** Encerramento exige decisão específica.

## Causa comprovada

`interpretWorkRequest` só vetava mensagem que **termina** em "?". Esta terminava em ".", logo passou; `analisar` (verbo operacional) + `ANIMA`/`backlog` (objeto) bastaram para `work_candidate`. No Chat Dev a classificação virou `new_work_request` e a rota executou planner e `createProposal`, que também fixa o foco.

## Correção

`packages/core/src/work-orchestration/interpret.ts`: após decidir `isWork`, uma mensagem **informacional** permanece conversa, salvo frase forte de proposta/mandato ou mandato estruturado. Sinais informacionais (qualquer um): interrogação em qualquer ponto; abertura interrogativa ou de consulta ("quais", "como", "devemos", "compare", "explique", "me diga", "consulte"…); desejo de analisar/entender/saber/discutir/priorizar. `workIntentPhrase` passou a incluir "crie/monte/prepare/elabore/redija/gere/abra (uma) proposta|mandato". Mandato estruturado = ≥ 2 campos rotulados (Objetivo, Escopo, Provas mínimas, Invariantes, Critérios de aceite). O viés é conversar: falso positivo só adia uma proposta (o usuário diz "crie uma proposta…"); falso negativo cria registro persistente e gasta o planner. A aprovação humana e as RPCs permanecem inalteradas. Limite honesto: é heurística por sinais, não compreensão semântica; a rede de segurança continua sendo a aprovação humana.

## Formatação de tabelas

`ChatClient` usa `<ReactMarkdown>` (react-markdown 10.1, CommonMark) sem `remark-gfm`, que não é dependência: tabelas GFM aparecem como texto cru. Correção mínima sem nova biblioteca: o prompt do Chat Dev proíbe tabelas Markdown e pede listas. Alternativa futura: adicionar `remark-gfm` (decisão separada).

## Provas

Core: 104 suítes / 2610 testes (inclui `interpret-information.test`, 27 casos). Web: `information-requests-route.test` (consultas reais não geram `new_work_request`, comando de fila ou mutação de foco; `createProposal` e planner só sob `work_candidate`; ramo de leitura sem escrita; prompt sem tabelas); `tsc` core e web limpos. Falhas fora do escopo e sem relação com a mudança: `backlog-cycle/route.test` falha também no `dev` sem a mudança; `mandated-acceptance-run`, `investigation-executor.worktree` e (uma vez) `trusted-git` falharam sob carga ampla com Git real (`trusted-git` passou isolado).

## Próximo ponto de retomada

Decisão humana sobre o item `8193da93…` (cancelar/retirar ou manter) e sobre o foco atual; depois ACC-01-E2.

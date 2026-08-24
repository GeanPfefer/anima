# Project Advisor V0 governado no chat

Data: 2026-08-24
Tipo: desenvolvimento (prova viva pendente)

## Objetivo

Permitir que o Anima responda, no chat real, como está o próprio desenvolvimento
e qual deveria ser o próximo passo sem confundir evidência, classificação,
advisory, decisão ou ação.

## Estado Git

- branch: `dev`
- HEAD inicial: `0f4a3666491adcb31ea9b92258cb32c631dea61c`
- `origin/main` inicial e preservada: `99bec54e3ab42bfe882a8686cd1385d8058b916e`
- `.worktrees/`, `.claude/settings.local.json` e `apps/web/.env.local` preservados

## Mudanças

- contrato puro de contexto, autoridade, proveniência, resposta e validação em
  `packages/core/src/project-advisor.ts`;
- builder server-side allowlisted, limitado e com redação de segredos;
- leitura viva RLS reduzida a metadados de `work_items` e `work_events`;
- porta `ProjectAdvisor` provider-agnostic sobre os providers já existentes;
- bifurcação no chat antes de qualquer detector ou gravador de domínio;
- apresentação separa estado, capacidades comprovadas, fronteiras, direções,
  recomendação, razão e insuficiências.

## Decisões e invariantes

- não é RAG genérico nem agente com ferramentas livres;
- histórico não adquire autoridade canônica;
- claim "comprovado" exige fonte `evidence`; direção exige `canonical`;
- nenhuma ferramenta de repositório é anexada ao provider;
- nenhum payload de evento, pedido original, arquivo de configuração ou segredo é
  incluído;
- a capacidade não cria nem altera backlog, decisão, classificação, item, evento,
  código ou recurso externo.

## Provas automatizadas

- typecheck: cinco workspaces, PASS;
- web: 72/72 suítes, 887/887 testes, PASS;
- core: 46/46 suítes, 1014/1014 testes, PASS;
- mobile: 5/5 suítes, 51/51 testes, PASS;
- Supabase: 1 suíte/8 testes PASS; 1 suíte/2 testes preexistentes skipped;
- build web: 56 páginas, PASS;
- `git diff --check`: PASS (apenas aviso de normalização LF/CRLF).

Warnings preexistentes de `act(...)` em componentes e acesso negado ao ignore Git
global apareceram sem falha de gate.

## Efeitos externos e limites

- nenhum egress novo realizado;
- nenhum RunPod, recurso pago, deploy, PR, merge ou alteração de banco;
- Ollama em `127.0.0.1:11434` estava indisponível;
- a autorização OpenAI de prova anterior não foi reutilizada.

`PROJECT_ADVISOR_V0 = PASS` **não foi declarado**: falta a prova na UI real com
conta legítima e provider autorizado. Próximo ponto exato: obter autorização
específica para o egress mínimo do advisory (ou iniciar runtime local proporcional),
executar a pergunta canônica pela UI, verificar resposta e ausência de mutação;
então documentar o resultado, commitar e publicar em `origin/dev`.

## Primeira meta-prova E2E: NOT_PROVEN

O usuário executou pela UI real a pergunta canônica com uma autorização de uma
única chamada OpenAI. A resposta visível foi o fail-closed:
"Não há evidência governada suficiente para responder com segurança agora."
Não houve retry.

Diagnóstico local, sem egress:

- o builder encontrou nove fontes de arquivo/Git, 20.544 caracteres, as quatro
  classes de autoridade e zero problemas de suficiência;
- nenhuma fonte inteira foi descartada; dentro de cada documento, somente linhas
  fora dos termos governados foram omitidas pelo seletor, e o Git omitiu caminhos
  `.claude`, `.worktrees`, `.git` e `.env`;
- no fluxo real somaram-se duas fontes RLS agregadas (`work_items` e
  `work_events`), sem payload, pedido original ou identificador pessoal;
- a mensagem genérica exclui `ChatProviderError`; portanto a chamada retornou ao
  host e a falha foi no parse/validação estruturada posterior;
- o código anterior não preservou se o erro final foi JSON inválido ou claim sem
  autoridade suficiente. Essa perda é uma falha de observabilidade registrada,
  não uma alegação de insuficiência legítima.

Causa raiz determinística: integração estruturada incompleta — JSON era exigido
só por prompt. Correção local: schema estrito propagado pelo mesmo contrato para
OpenAI (`text.format=json_schema`) e Ollama (`format=schema`); validação semântica
de autoridade foi preservada; o catch passou a registrar apenas o código local,
sem resposta, contexto ou segredo. Regressões dos dois adapters foram adicionadas.

Ausência de mutação após a tentativa: `work_items=60`, `work_events=601`,
`work_focus=2`, `ai_conversations=189`, idênticos ao baseline; HEAD, `origin/dev`
e `origin/main` idênticos; diff rastreado anterior à prova byte a byte idêntico.

Gates após a correção: web focado 4/4 suítes e 16/16 testes; core focado 1/1 e
4/4; typecheck dos cinco workspaces; build web 56 páginas; `diff --check`, todos
PASS. Uma nova meta-prova externa é necessária e requer nova autorização.

## Segunda tentativa E2E: inconclusiva por corrupção do ambiente dev

Uma segunda chamada foi autorizada e o usuário submeteu a pergunta uma vez, mas
a página perdeu CSS/JS imediatamente e não exibiu nem a nova mensagem nem uma
resposta. Não houve retry. Diagnóstico: o `next build` do gate anterior rodou
enquanto `next dev` permanecia vivo e ambos usaram `apps/web/.next`. Os processos
dev não reiniciaram (mesmos PIDs/horário desde 15:22), porém o HTML passou a
referenciar assets de desenvolvimento que retornavam 404 (`layout.css`, CSS do
login, `main-app.js`, `app-pages-internals.js`, `polyfills.js`). Não foi crash do
Advisor, React ou CSS-fonte: foi colisão de artefato gerado entre build e dev.

O stdout do processo iniciado em background não estava recuperável e a rota
read-only não persiste request/resultado. Logo não há evidência honesta para
afirmar se o POST chegou ao backend, se a chamada OpenAI foi consumida ou se uma
resposta estruturada válida existiu. A tentativa permanece inconclusiva, não
PASS. O ambiente foi reparado localmente: somente a árvore exata do Next foi
encerrada, `G:/anima/apps/web/.next` gerado foi removido, e `next dev` reiniciado.
Smoke test posterior confirmou HTTP 200 e tipos corretos para todos os seis
assets CSS/JS da página de login.

Baselines antes/depois da tentativa: banco `60/601/2/189` para
`work_items/work_events/work_focus/ai_conversations`; HEAD/dev/origin-dev
`0f4a366`; origin/main `99bec54`; hash do diff local `BD18736C...`; sete arquivos
novos do incremento — todos idênticos. Nenhuma mutação do Advisor foi observada.
Uma terceira prova externa é necessária e exige nova autorização. Em provas
futuras, nunca executar `next build` sobre um `next dev` vivo no mesmo `.next`;
parar o dev antes do build e reiniciá-lo a partir de `.next` limpo.

## Terceira tentativa E2E: NOT_PROVEN por validação semântica

A tentativa final autorizada atravessou a UI e o backend reais. Marcadores locais
sem conteúdo demonstraram: request OpenAI recebido; contexto governado pronto
(11 fontes, quatro classes, 21.409 caracteres); request estruturado iniciado;
resposta `gpt-5.6-terra` recebida (5.194 caracteres). A rota terminou 503 em
17.324 ms com `project_advisor_answer_invalid`. Portanto o JSON Schema estrutural
e o parse passaram, mas a validação semântica local recusou pelo menos um claim.
O log dessa versão preservava só a classe, não a lista de problemas; a resposta
bruta não foi persistida por minimização, logo não se inventa qual claim falhou.

O fail-closed foi mantido e não houve quarta chamada. Correção local pós-prova:
o schema passou a ser derivado do contexto e restringe IDs por seção — fatos só
`observed_state|evidence`, comprovado só `evidence`, fronteira sem canonical puro,
direção só `canonical`; recomendação/razão continuam podendo combinar fontes.
A validação semântica do host permanece intacta e agora registra apenas códigos
seguros dos problemas. Regressão confirma os enums de autoridade no schema.

Ausência de mutação: banco permaneceu `60/601/2/189`; HEAD/dev/origin-dev
`0f4a366`, origin/main `99bec54`, hash do diff pré/pós tentativa
`E113D801...`, sete arquivos novos. Gates pós-correção: web focado 3/3 suítes,
14/14 testes; typecheck cinco workspaces; `diff --check`, PASS. Sem nova prova,
`PROJECT_ADVISOR_V0 = NOT_PROVEN`; nenhum commit/push/PR/merge/deploy.

## Consolidação semântica local após encerramento das E2E

Sem quarta chamada/egress, o contrato foi endurecido antes de versionar o recorte:

- `ProjectAdvisoryClaim` passou a declarar `authorityClasses`, que o host compara
  com as classes derivadas de `sourceIds`;
- prompt, schema dinâmico e validador agora usam a mesma matriz: fato somente
  estado/evidência; comprovado somente evidência; fronteira sem canonical;
  direção somente canonical; recomendação/racional sem mistura
  canonical+histórico e com racional obrigatório;
- schema exige statement/fonte/classe, unicidade e enums por seção; parser host
  valida a estrutura antes da semântica;
- nenhum conteúdo bruto é logado; só códigos locais seguros.

Foram consolidados 11 casos adversariais de resposta: canonical/histórico como
fato, comprovado sem evidência, fronteira só canonical, direção sem canonical,
recomendação sem racional, fonte inexistente/duplicada, classe inconsistente,
claim sem fonte e conflito canonical×histórico. Três positivos cobrem múltiplas
fontes, recomendação canonical+evidência e resposta mínima sintética atravessando
estrutura+semântica.

Códigos seguros: `empty_claim_statement`, `claim_without_source`,
`duplicate_source_reference`, `duplicate_authority_class`,
`unknown_source_reference`, `authority_class_mismatch`,
`canonical_historical_conflict`, `invalid_fact_authority`,
`missing_evidence_for_proven_capability`, `invalid_open_frontier_authority`,
`invalid_canonical_direction_source`, `missing_recommendation_rationale` e
`project_advisor_structure_invalid`.

Gates desta consolidação: core Advisor 16/16; web pertinente 31/31; typecheck dos
cinco workspaces; build web 56 páginas com `next dev` parado e `.next` limpo;
`diff --check`, PASS. A condição local mínima para futura E2E está satisfeita,
mas o estado continua honestamente `PROJECT_ADVISOR_V0 = NOT_PROVEN` até prova
externa separadamente autorizada.

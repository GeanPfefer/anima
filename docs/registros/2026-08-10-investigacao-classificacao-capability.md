# 2026-08-10 — Investigação e correção: classificação `programming → research`

**Tipo:** desenvolvimento (investigação + correção de bug). **Branch:**
`claude/integration-application-layer`. **HEAD inicial:** `1229410` ·
**HEAD final:** `a92747b` (mais o commit deste registro). Investiga o defeito
registrado na [prova manual](2026-08-10-prova-manual-classificacao-capability.md).

**Commits:** `561e731` (correção da precedência) · `a92747b` (restrição
anti-falso-positivo, da própria passagem adversarial).

## Objetivo

Descobrir por que uma tarefa inequívoca de implementação é classificada como
`capability = research`, comprovar a causa por reprodução automatizada e corrigir
a causa raiz — não o sintoma na UI —, preservando a distinção entre pesquisa,
explicação, planejamento, investigação sem alteração e programação.

## O que foi investigado (cadeia real)

Tracei a cadeia chat → interpretação → proposta → parser → classificação →
persistência → projeção, sem pressupor o modelo:

1. **Chat** (`apps/web/app/api/ai/chat/route.ts:566`) chama
   `interpretWorkRequest(message, …)` e cria a proposta com `command.capability`.
   O texto que o operador viu ("entender/delimitar o pedido", "não executar antes
   da aprovação") é o **template fixo determinístico** de `interpretWorkRequest`,
   não saída do modelo — o que explica GPT ≡ modelo local (o provider de conversa
   não decide a capability). O planejador GPT (`project-work-planner`, que hardcoda
   `programming`) só roda sob `developmentMode && provider==='openai'` e, como o
   operador viu proposta com `research` (não erro), não se aplicou.
2. **Classificador** (`packages/core/src/work-orchestration/interpret.ts`):
   `capabilityFor(message)` era um heurístico por regex que checava os termos de
   **pesquisa antes** dos de programação.
3. **RPC** `create_work_proposal` (`supabase/migrations/20260714000001_*.sql`)
   **insere a capability recebida sem override** — a origem é 100% o classificador.

## Causa raiz (comprovada)

`capabilityFor` testava `research` primeiro. A lista de pesquisa incluía tanto
verbos de investigação (`investig|an[aá]lis|document|revis|diagn[oó]stic`) quanto
substantivos (`bug|problem`). Um pedido inequívoco de **alteração de código** que
descrevia o que seria mexido casava um termo de pesquisa antes de `implement`/
`refator`/`corrig` e virava `research`.

**Reprodução automatizada** (verdade objetiva, antes da correção):

| Mensagem | capability (bug) |
|---|---|
| `Implemente uma função que analisa a prontidão do projeto e checa o banco.` | `research` (+ impact `structural`) |
| `Implemente um endpoint na api que faz o diagnóstico do sistema.` | `research` |
| `Refatore o código do parser que tem um bug.` | `research` |

A primeira linha é **exatamente** o cenário do operador (endpoint de readiness
que checa o banco). As mesmas mensagens sem termos de pesquisa já davam
`programming` — confirmando que o defeito era a **precedência**, não o modelo.

## Correção (no classificador, não na UI)

Correção **mínima e conservadora** em `capabilityFor`: apenas **hoista o verbo de
alteração de código** (implementar/refatorar/corrigir/desenvolver) acima dos
termos de pesquisa — mudar código é `programming` ainda que descreva o diagnóstico
do alvo. O resto do heurístico fica **idêntico ao anterior**: sem verbo de
alteração, investigação/análise/pesquisa/documentação/revisão/diagnóstico
permanecem `research`; nome de código sem verbo de alteração (`arquitetura|banco|
api|c[oó]digo`) cai em `programming` como fallback fraco; pergunta explicativa
continua conversa. Determinístico e independente do provider.

A **passagem adversarial da própria correção** (`a92747b`) descartou uma primeira
versão mais ampla que expandia o vocabulário de código no fallback e somava uma
regra criar+objeto: ela transformava "descreva a rota" e "crie um plano de
migração" em `programming` — falso positivo que viola "não transforme todo pedido
técnico em programming". A versão final não introduz nenhum falso positivo novo:
a única mudança de comportamento vs. o anterior é exatamente o bug corrigido
(verbo de alteração + termo de pesquisa → `programming`).

## Testes

Regressões em `packages/core/src/work-orchestration/interpret.test.ts`:
implementação/refatoração/criação que mencionam diagnóstico/banco/bug →
`programming` (inclui o cenário do operador); análise/documentação/investigação
sem alteração → `research` (inclusive "documente o código da api" → research);
planejamento → `planning`; **guardas anti-falso-positivo** ("crie um plano de
migração" → `planning`, "documente o código" → `research`); pergunta → conversa.

## Gates

typecheck 5 workspaces · core **683** (+10) · web **360** (serial) · mobile **33**
— todos verdes em `561e731`. Flake conhecido do run paralelo de web
(`WorkProposalCard`) inalterado, não é regressão.

## Decisões e questões humanas

- **Revisão ("Pedir correção") não recalcula capability — por contrato.**
  `ReviseWorkProposalCommand`/`RequestProposalRevisionCommand` **não carregam**
  `capability`/`impactLevel` (só `intent`+`proposal`), e `revise_work_proposal`
  não atualiza a coluna. A capability é definida na criação e preservada. Com a
  classificação inicial corrigida, a revisão passa a preservar o valor **correto**.
  **Se a revisão *deveria* recalcular a classificação é uma decisão de produto não
  ratificada → `BLOCKED_BY_HUMAN_DECISION`** (não inventada aqui).

## Observações relacionadas (NÃO corrigidas — registradas)

- **`impactFor` tem a mesma forma de heurístico**: `structural` é disparado por
  `apagar|excluir|migra|produção|segurança|arquitetura|banco`, checado antes de
  `significant`/`low`. Um endpoint **somente-leitura** que menciona "banco"/
  "migração" vira `structural`. **Não corrigido de propósito:** over-classificar
  impacto é **fail-safe** (mais supervisão), enquanto inverter a precedência
  *sub*-classificaria uma migração/alteração de schema real (perigoso). Se a
  intenção somente-leitura deveria reduzir o impacto é uma **questão de produto**.
- **Vocabulário do gate de trabalho (`isWork`) tem lacunas silenciosas**: a
  imperativa "Corrija" não casa `corrig(?:ir|a)` (só "corrigir"/"corriga"),
  "Adicione" não é verbo operacional e "endpoint" não é objeto explícito — então
  pedidos como "Corrija o bug no código" ou "Adicione uma função" viram **conversa
  sem proposta** (fallback silencioso). É a fronteira conversa/trabalho do UX-00;
  ampliá-la é decisão de produto. **Registrado como achado; não ampliado aqui.**

## Efeitos externos

Nenhum. Sem push, PR, merge, `integrated`, deploy. `origin/main` intacta
(`973ef46`). Branch sem upstream. `G:/anima-local-test` (ambiente de prova do
operador) **não tocada**. Nenhum executor/worktree disparado.

## Próximo ponto exato de retomada

A partir de `a92747b`: (1) o operador pode repetir a prova manual no Anima local —
uma tarefa de implementação agora deve nascer `programming`; (2) decisão humana
sobre se a revisão recalcula a classificação; (3) decisão sobre o vocabulário de
`isWork` (aceitar "Corrija"/"Adicione"/"endpoint" como trabalho) e sobre a
conservação do impacto `structural` para tarefas somente-leitura.

# Marcos 006–007 + evidência controlada do coder local

**Data:** 2026-08-12
**Tipo:** ambos (documentação de ratificação humana + prova controlada)
**Branch:** `claude/integration-application-layer`
**HEAD inicial:** `48f6785`
**HEAD final:** `ee62e5d` (2 commits documentais; ver "Commits")
**`origin/main`:** `973ef46` — **intacta, sem push**

## Objetivo

Cumprir um mandato operacional único do Supervisor: (A) reconstruir e confirmar o
estado; (B) corrigir, de forma coerente e append-only, a classificação da
**política de segurança**; (C) perpetuar a capacidade **Interação com o Computador
e Aplicações Locais**; (D) validar coerência documental; (E) continuar por prova
controlada de maturidade do **coder local**, sem afrouxar contratos/gates.

## Correção append-only de registro anterior (regra dos registros)

O registro [2026-08-12 — ratificação da autonomia progressiva](2026-08-12-ratificacao-autonomia-progressiva.md)
afirma (seção final): *"Permanecem fundamentais (não maturidade): alterar a própria
política de segurança…"*. Esse **fato está corrigido** por este registro e pelo
[Marco 006](../marcos/006-politica-de-seguranca-como-maturidade-maxima.md): alterar
a própria política de segurança é **restrição de maturidade de grau máximo**, não
fundamental. O registro anterior permanece íntegro (append-only); esta é a correção
que o aponta.

## Commits (nesta sessão)

- `d7ca835` — *Corrija a classificação: política de segurança é maturidade máxima.*
- `ee62e5d` — *Perpetue a ratificação de interação com o computador e aplicações locais.*

## Mudanças relevantes (documentais)

**B — Correção da política de segurança** (fonte canônica: Marco 006):
- Novo [Marco 006](../marcos/006-politica-de-seguranca-como-maturidade-maxima.md):
  reclassifica "alterar a própria política de segurança" de **fundamental** para
  **maturidade de grau máximo** (capacidade de maior risco, hoje sob governança
  humana/reforçada; bloqueio = dívida de evidência, não teto). Nomeia o processo
  reforçado de eventual promoção (isolamento, testes adversariais, replay/simulação,
  revisão independente, auditabilidade, reversibilidade/rollback, rollout gradual,
  observabilidade, limites explícitos, revogação automática). Preserva como
  fundamentais só as decisões **intrinsecamente do criador da instância** e as de
  **produto ainda não definidas**.
- [Marco 005](../marcos/005-autonomia-progressiva-e-identidade-una.md): nota de
  correção append-only junto à linha errada (texto original intacto).
- [`anima-manifesto.md`](../../anima-manifesto.md): "A exceção é alterar a política"
  → "não é exceção; é o caso extremo" da maturidade, com ponteiro ao Marco 006.
- [`anima-prd.md`](../../anima-prd.md): linha do "Mapa de maturidade" e linha de
  decisão §10 reclassificadas; linha nova de decisão §10 do Marco 006.
- [Plano 002](../planos/002-modo-autonomo-v0.md): seção de continuação que
  supersede a linha da tabela histórica (mantida) + ponteiro na própria linha.
- [`docs/marcos/README.md`](../marcos/README.md): índice do Marco 006.

**C — Interação com o Computador e Aplicações Locais** (fonte canônica: Marco 007):
- Novo [Marco 007](../marcos/007-interacao-com-computador-e-aplicacoes-locais.md):
  capacidade provider-neutral de primeira classe (perceber estado visível de
  apps/OS; operar interfaces locais) como **braço executor sob mandato**, com
  Supervisor/Executor/Reviewer separáveis; cada **classe de efeito** (leitura,
  digitação, envio, alteração, exclusão, publicação, autenticação) tratada e
  amadurecida à parte; garantias (evidência observável, correlação, auditabilidade,
  idempotência quando aplicável, fail-closed, proteção contra prompt injection,
  confirmação para efeitos externos/sensíveis). Estende os nós locais do Marco 004
  à camada GUI. Estado estreito: a entrega deste mandato é só **prova inicial do
  canal**; **sem** agendamento/recorrência sem nova autorização.
- [`anima-manifesto.md`](../../anima-manifesto.md): nova capacidade interna.
- [`anima-prd.md`](../../anima-prd.md): linha de decisão §10 do Marco 007.
- [`docs/arquitetura/orquestracao-de-trabalho.md`](../arquitetura/orquestracao-de-trabalho.md):
  seção direcional (encaixe conceitual + invariantes, **sem** contrato) e exclusões
  em "Fora de escopo desta fundação". **Não** cria adaptador/transporte/taxonomia.
- [`docs/marcos/README.md`](../marcos/README.md): índice do Marco 007.

## Decisões

- **Colocação canônica:** correção de classificação → marco (append-only exige novo
  marco, não reescrita); nova capacidade de direção → marco (como o Marco 004 fez
  com portabilidade). Estado tático vivo (manifesto/PRD/arquitetura) editado no
  lugar; histórico (Plano 002, registros) corrigido por continuação/novo registro.
- **Distinção limpa:** "fundamental" = identidade/vontade do criador **ou** decisão
  de produto não definida; **risco** (mesmo o máximo) é sempre **maturidade**.

## Prova controlada — maturidade do coder local (E)

**Método (não invasivo, isolado, descartável).** A classe `OllamaCoderBackend`
([`apps/web/lib/work-orchestration/ollama-coder.ts`](../../apps/web/lib/work-orchestration/ollama-coder.ts))
foi exercitada **sem modificação**, via cópias descartáveis no scratchpad e um
`fetchImpl` **observador** (seam legítimo de teste), contra um alvo em memória.
Nada tocou o repositório real; nenhum resultado foi aplicado; `maxReadRounds`,
prompt, protocolo, contrato e gates **não** foram alterados no produto. Config de
produção padrão (`operationalContextCap=8192`, `temperature=0`), salvo variação
**experimental** de `maxReadRounds` explicitamente medida. Ollama local no ar com
`qwen2.5-coder:7b`, `qwen2.5-coder:14b`, `qwen3-coder:30b`.

**Fatos observados (reprodutíveis, temp=0):**

| Cenário | Modelo | rounds | Resultado | Causa observada |
|---|---|---|---|---|
| `greet` (1 arquivo trivial) | qwen2.5-coder:7b | 3 | **sucesso** | editou só na rodada FORÇADA (#3); pediu leitura nas rodadas 0–1–2 (read-stalling) |
| `multi` (5 arquivos, 1 bug) | qwen2.5-coder:7b | 3 | **falha** `ollama_ambiguous_replacement` | `before="    return a - b;"` (4 espaços) não casa o arquivo (2 espaços) — indentação alucinada; determinístico em 2 execuções |
| `multi` | qwen2.5-coder:7b | 1 | **sucesso** | 1 leitura → `before="  return a - b;"` (2 espaços, exato) |
| `multi` | qwen2.5-coder:7b | 6 | **sucesso** | read-stalling até a rodada forçada (#6) → `before` = bloco multilinha byte-exato |
| `multi` | qwen2.5-coder:14b | 3 | **sucesso** | 1 leitura, edita na rodada #1, `before` exato — sem read-stalling, sem alucinação |
| `multi` | qwen3-coder:30b | 3 | **sucesso** | lê comparando arquivos, `before` multilinha byte-exato (68s) |

**Leitura dos fatos (o que está comprovado):**
- Duas classes distintas de falha do modelo pequeno: (1) **read-stalling** — adia a
  edição, consumindo rodadas de leitura (é o caminho que, em tarefa suficientemente
  grande, termina em `ollama_read_round_limit`); (2) **`before` não byte-exato** —
  o modelo não reproduz a indentação exata a partir do trecho **numerado** servido,
  e o `replace_exact` falha fechado (`ollama_ambiguous_replacement`).
- O prompt de **edição forçada na última rodada** (commit `e004b2a`) funcionou em
  todos os casos: os modelos trocaram para `edit` quando o orçamento chegou a 0 —
  por isso `ollama_read_round_limit` **não** disparou nestes experimentos; a falha do
  7b migrou para a exatidão do conteúdo.
- **Limiar de capacidade:** no mesmo cenário/config (multi, rounds=3), 7b falha e
  **14b/30b passam**. 14b é o menor modelo que, aqui, leu com parcimônia e produziu
  `before` exato.
- A falha do 7b em rounds=3 é uma **bolsa determinística**: rounds=1 e rounds=6
  passam, rounds=3 falha. O orçamento de rodadas muda a sequência de prompts (texto
  do orçamento + blocos de leitura acumulados), e isso muda deterministicamente a
  fidelidade do `before`. **Não** é monotônico ("mais rodadas = melhor").

**Hipóteses (não comprovadas — a separar dos fatos):**
- H1: o formato de trecho **numerado** (`padStart(6)| `) dificulta a reconstrução
  byte-exata do `before` por modelos pequenos (precisam remover o prefixo e ainda
  preservar a indentação original). Sugerido por: o erro é sempre de
  espaço/indentação no `before`, e some com modelos maiores.
- H2: leituras adicionais com `contextBefore/After` podem **degradar** a fidelidade
  do `before` no 7b (a 2ª leitura precedeu o `before` de 4 espaços). Sugerido pela
  bolsa rounds=3.

**Recomendação (próximo incremento, se e quando priorizado):** **não** alterar
`maxReadRounds`, prompt, protocolo ou gate para "passar" — a evidência mostra que
subir rounds não é fix confiável (rounds=6 ajudou, mas rounds=1 também; rounds=3 é a
bolsa de falha). Dois caminhos legítimos, cada um como **item próprio com evidência
e testes focados**: (a) tratar `qwen2.5-coder:14b` como piso de capacidade do
protocolo atual para roteamento local; (b) investigar uma ergonomia de **âncora de
edição** que não exija `before` byte-exato a partir de trecho numerado (ex.: âncora
por `path`+intervalo de linhas+sha, servindo texto cru para a âncora) — **mudança de
contrato**, portanto exige ADR/plano, testes e provas antes de qualquer aplicação.

## Provas/testes executados e gates

- **Documentação (B–D):** `git diff --stat 48f6785..HEAD` confina tudo a `*.md`
  (nenhum arquivo em `apps/`, `packages/`, `supabase/`, `tools/`). Links relativos
  dos Marcos 006/007 e ponteiros do manifesto/PRD verificados (todos resolvem).
  Não se aplica suíte de código a mudança 100% documental.
- **Coder (E):** experimentos vivos acima; evidência bruta em JSON no scratchpad
  (não versionada — descartável): `evidence-<modelo>-r<rounds>.json`.

## Flakes conhecidos

Nenhum nesta sessão. Os experimentos do 7b foram **determinísticos** (temp=0): duas
execuções de multi/rounds=3 deram falha idêntica.

## Limitações / o que NÃO foi feito

- O alvo `multi` é um **proxy** da dificuldade do repositório real, não o item
  autônomo real; não reproduz o volume/estrutura exatos da falha viva de 2026-08-11.
- `ollama_read_round_limit` **não** foi disparado nestes experimentos (o forçar-edição
  o converteu em tentativa de edit); a falha viva original pode envolver escopo real
  maior e permanece a caracterizar sobre o alvo real, sob revisão humana.
- Nenhuma mudança de produção; nenhuma promoção de capacidade; nenhuma alteração de
  `maxReadRounds`/prompt/contrato/gate.

## Invariantes de segurança preservadas

Nenhuma proteção afrouxada. Nenhum efeito Git externo. Nenhum push/PR/merge/deploy.
`origin/main` intacta em `973ef46`. Nenhuma migration/RPC/enum/tipo tocado. Mudança
de produção = 0 (documentação `.md` apenas). Experimentos confinados ao scratchpad,
sem tocar arquivos rastreados. Política de segurança **não** afrouxada — só
reclassificada (Marco 006).

## Arquivos locais preservados

`.worktrees/` (mobile-completed-result, roadmap-003-006), `.claude/settings.local.json`,
`apps/web/.env.local` e demais não-versionados intactos. Nenhuma operação destrutiva.

## Fronteiras humanas restantes (`BLOCKED_BY_HUMAN_DECISION`)

- Promover qualquer classe de efeito da interação com o computador (Marco 007) além
  da prova inicial do canal; criar agendamento/recorrência/ciclos autônomos.
- Promover a política de segurança (Marco 006) — exige o processo reforçado §3.
- Review request real, `merged`/`integrated`, deploy, UI de auto-desenvolvimento.
- Aplicar qualquer mudança de contrato do coder (ergonomia de âncora de edição).

## Próximo ponto exato de retomada

Ratificações perpetuadas e commitadas (`ee62e5d`). Próximo incremento seguro
candidato: transformar a evidência do coder em item próprio — (a) roteamento local
com piso `qwen2.5-coder:14b` para o protocolo atual, ou (b) ADR/prova de uma âncora
de edição mais robusta que não exija `before` byte-exato de trecho numerado — cada
um com testes focados e sem afrouxar gate. Alternativamente, seguir o backlog
canônico do [Plano 002](../planos/002-modo-autonomo-v0.md). Nada pendente de push;
`origin/main` intacta.

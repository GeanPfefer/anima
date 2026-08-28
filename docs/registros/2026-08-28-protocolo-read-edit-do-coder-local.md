# Protocolo read → edit do coder local

- **Data/tipo:** 2026-08-28 — desenvolvimento + prova viva local.
- **Objetivo:** reconciliar e corrigir a barreira `ollama_read_round_limit` sem
  aumentar rodadas, enfraquecer segurança ou consumir a attempt canônica.
- **Branch / HEAD inicial:** `dev` / `62d205d`, igual a `origin/dev`.
- **Modelo real:** `qwen3-coder:latest`, digest `06c1097efce0…`, Ollama `0.32.15`.
- **Commits de código:** `f03f8c4` (`Preserve a proveniencia das leituras
  servidas`) e `d6dec43` (`Conduza leituras do coder ate a edicao`).
- **HEAD final:** commit documental que contém este registro; hash confirmado no
  relatório final da sessão.

## Mudanças

- `ServedRead Provenance V1` preserva `search`, `lineRange`, parâmetros
  normalizados e modo efetivo; o slice e as guardas existentes não mudaram.
- O prompt deixou de ensinar o híbrido contraditório `search + lineRange`:
  localização e leitura de intervalo agora são modos explicitamente exclusivos.
- O host deduplica conteúdo servido idêntico e apresenta progresso compacto ao
  modelo, sem persistir nem logar conteúdo adicional.
- O modelo recebe orientação para distribuir as poucas rodadas entre arquivos
  existentes e nunca usar `create_file` quando o manifesto declara `exists=true`.

## Evidência

- Unitário do protocolo: 43/43.
- Unitário do backend: 19/19.
- Typecheck web: passou durante os dois recortes.
- Smoke realista inicial com provenance/guard ainda reproduziu quatro reads,
  zero edits e `ollama_read_round_limit`; mostrou que os slices não eram
  idênticos e refinou a causa.
- Após separar os modos de leitura: 3 reads e uma tentativa de edit, recusada
  fail-closed por `create_file` sobre arquivo existente.
- Campanha realista N=3: 3/3 host-aceitas por `append`, 0/3 semanticamente
  corretas. O helper inventou `candidate.location`, não criou testes e não
  cumpriu o objetivo.
- Regressão qwen3-coder N=2: `multi_locate` 2/2, `structural_add` 2/2 e
  `multiline_before` 2/2, todas host-aceitas e semanticamente corretas.
- Gates amplos: typecheck dos cinco workspaces passou; build web passou; mobile
  51/51, core 1191/1191 e Supabase 9/9 passaram. A suíte web passou 989/990 no
  lote; `project-tools.test.ts` excedeu seu timeout de 5 s sob carga e passou
  imediatamente isolado em 105 ms (4/4), classificado como flake de concorrência,
  não regressão. Warnings preexistentes de `act(...)` e teardown permaneceram.

Os pacotes brutos estão em `tools/coder-evidence/runs/2026-08-28-*` e são
ignorados pelo Git; preservam prompts, respostas, tokens, duração e arquivos
finais das fixtures sem tocar banco ou repositório alvo real.

## Segurança e efeitos externos

- `maxReadRounds=3`, contexto, temperatura, modelo, gates e Resource Governor
  permaneceram inalterados.
- Nenhum work item, claim, attempt, evento, budget ou worktree canônica foi
  criado ou alterado. A attempt 2 do Successor A permaneceu intacta.
- Nenhum PR, merge, deploy, integração, `origin/main`, segredo ou provedor pago
  foi usado. `.worktrees/`, `.claude/settings.local.json` e
  `watch4-sensors.txt` foram preservados.
- O push de `dev` foi solicitado ao ambiente e bloqueado pelo revisor de
  segurança porque a privacidade do remoto GitHub não foi verificada nesta
  sessão. Nenhuma tentativa de contorno foi feita; `origin/dev` permaneceu em
  `62d205d` e os três commits ficaram somente locais.
- A preparação de worktree fresca via `next typegen` já existia e estava provada
  no HEAD; não foi refeita.

## Limite e retomada

A transição read → edit está comprovada no alvo realista, mas a conclusão correta
do trabalho não. O próximo ponto exato é provar uma estratégia estreita para
qualidade pós-edit/recuperação por gate observado. O retry interno de gate segue
deliberadamente habilitado apenas no DeepSeek Harness; não foi ampliado para
Ollama sem evidência própria. Não consumir a attempt 2 canônica antes dessa prova.

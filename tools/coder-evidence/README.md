# Harness de evidência do coder local (R3)

Harness **versionável e recomputável** que mede a capacidade dos modelos locais
(via `OllamaCoderBackend`) por classe de tarefa, reconstruindo de forma auditável
a campanha do registro
[`2026-08-12-campanha-coder-e-hierarquia-interacao.md`](../../docs/registros/2026-08-12-campanha-coder-e-hierarquia-interacao.md).

## Por que existe

A campanha anterior rodou por **cópias descartáveis no scratchpad**; os JSONs
brutos **sumiram** e a matriz publicada deixou de ser recomputável (correção de
proveniência registrada em 2026-08-13). Este diretório fecha essa lacuna: o
harness é código versionado que **exercita a classe de produção sem modificá-la**
e pode ser re-executado a qualquer momento; cada execução preserva um pacote
bruto auditável (`runs/<stamp>/`).

## Garantias (o que este harness NÃO faz)

- **Não modifica** `apps/web/lib/work-orchestration/ollama-coder.ts` nem
  `ollama-protocol.ts` — importa os módulos de produção por caminho relativo.
  O único ajuste é um *resolve-hook* de import ([`resolve-ts.mjs`](resolve-ts.mjs))
  que só afeta a resolução deste harness standalone; produção (Next.js/Jest)
  continua com o próprio resolvedor e o mesmo código-fonte, byte a byte.
- **Config de produção** vem dos *defaults do construtor* (não reescrevemos):
  `maxReadRounds=3`, `num_ctx=8192`, `num_predict=1536`, `temperature=0`.
- **Não altera** contrato, prompt, rounds, modelo, roteamento ou gates; **não
  promove** piso de modelo; **não toca** o repositório fora deste diretório.
- Sem rede externa além do **Ollama local**. O `fetchImpl` é um **observador**
  que faz *tee* do fetch real (clona a resposta para medir) sem alterar o payload.

## Como rodar

Requer Node 24+ e Ollama local com os modelos já presentes.

```bash
node --experimental-transform-types \
  --import ./tools/coder-evidence/register.mjs \
  tools/coder-evidence/harness.ts \
  --reps 8 \
  --models qwen2.5-coder:7b,qwen2.5-coder:14b,qwen3-coder:30b
```

Flags: `--reps N` (repetições por célula), `--models a,b,c`, `--classes ...`
(subconjunto das 7 classes), `--seed S` (ordem reprodutível), `--out <dir>`.

## O que mede

Desfecho **primário** por execução: o host **aceitou** a edição ou **falhou**
(com o código específico do protocolo — `ollama_read_round_limit`,
`ollama_ambiguous_replacement`, `ollama_invalid_response_schema`, etc.). Métrica
**secundária**: `achieved` — a mudança pretendida ocorreu de fato (predicado
semântico da fixture). Além disso: nº e padrão de leituras, rodada da edição e
orçamento restante nela, ocorrências de cada `before` no arquivo original
(unicidade da âncora), caminhos tocados, durações e contagens de tokens do Ollama.

Saída em `runs/<stamp>/`: `meta.json` (config + `/api/tags`), `raw.jsonl` (uma
linha de métricas por execução), `matrix.json` e `matrix.md` (agregado por célula).

## Método e limitações

- **Ordem randomizada** (class × rep) por seed **dentro de cada bloco de modelo**;
  blocos de modelo ficam contíguos para não recarregar a VRAM a cada execução
  (18 GB do 30b não coexistem com os demais). Isso remove o viés de *warmup* por
  cenário (hipótese H3 do registro) sem *thrash* de VRAM.
- **N igual por célula** — corrige a crítica de reps desiguais da campanha
  anterior; ainda assim, com poucas reps a estocasticidade a `temperature=0`
  (batching/GPU) impede afirmar taxas exatas.
- **Fixtures são proxies sintéticos** pequenos, não o repositório real — não
  reproduzem o volume/estrutura do alvo autônomo real.
- `raw.jsonl` guarda **métricas derivadas**, não transcrições integrais do modelo
  (tamanho/ruído); a auditabilidade vem da recomputabilidade (re-rodar) somada às
  métricas. As fixtures são sintéticas, sem segredos.

Enquanto a evidência não for reconstruída com N estatístico em alvo realista,
**não se promove piso de modelo nem se altera a âncora/protocolo** — decisão
humana, conforme o registro.


## Comparação experimental R2 (Plano 003)

O harness aceita `--protocols current,r2`.

- `current`: protocolo vigente, sem opt-in experimental;
- `r2`: mesmos defaults do `OllamaCoderBackend`, acrescentando somente
  `experimentalAnchorMode: { kind: 'r2-host-mediated-v1', cycleId }`.

A ordem `fixture × rep` é randomizada uma vez por modelo/seed e reutilizada
identicamente nos tratamentos, permitindo A/B pareado. O `raw.jsonl` registra
`protocol`, além das métricas históricas (resultado, código, reads, rodada,
operações, tokens e duração).

Exemplo:

```powershell
node --experimental-transform-types --import ./tools/coder-evidence/register.mjs tools/coder-evidence/harness.ts --models qwen3-coder:latest --classes multiline_before,structural_add,cleanup --reps 5 --seed 20260825 --protocols current,r2 --out tools/coder-evidence/runs/2026-08-25-r2-ab
```


### Evidência forense por execução

Runs novos também preservam no `raw.jsonl`:

- `callsRaw`: cada chamada observada ao Ollama, incluindo o prompt de usuário,
  resposta textual, duração, `prompt_eval_count`, `eval_count` e
  `done_reason`;
- `finalFiles`: conteúdo final do workspace sintético da fixture.

Esses campos existem para explicar divergências entre `host-accepted` e
`achieved` sem precisar inferir a causa a partir de métricas agregadas.
Eles são aditivos: runs históricos sem esses campos continuam compatíveis com
o analyzer existente.

O observador continua sendo passivo: ele não altera payload, prompt, resposta,
backend, contexto, temperatura, rounds ou decisão do host.


### Variante C2: r2-narrow

A investigação forense de `multiline_before` isolou uma regressão do R2:
todos os oito runs usaram corretamente o mesmo intervalo servido
`decls.ts [1,7]`, mas em 2/8 o modelo gerou um `after` semanticamente
incorreto ao repetir `const`.

`r2-narrow` é uma variante experimental adicional, não um novo default.

Ela preserva integralmente:

- `replace_anchor`;
- binding efêmero por ciclo;
- path, SHA e range definidos somente pelo host;
- validações de stale file, conteúdo, overlap, scope e no-op;
- configuração de modelo/contexto/rounds/temperatura.

A única diferença é uma orientação adicional: após localizar o alvo com uma
leitura ampla, o modelo deve solicitar o menor `lineRange` que contenha
somente o texto que será substituído e preferir o anchor dessa leitura.

Exemplo de comparação:

```text
--protocols current,r2,r2-narrow
```

A variante continua experimental e não promove R2 para produção.


### Variante C3: r2-after-scope

A campanha C2 mostrou:

- `current`: 8/8 achieved;
- `r2`: 6/8 achieved;
- `r2-narrow`: 8/8 achieved;
- porém `r2-narrow` continuou fazendo três leituras `[1,7]` e editando o
  anchor `[1,7]` em todos os oito runs.

Portanto, a hipótese de que o ganho veio de um anchor mais estreito **não foi
demonstrada**.

`r2-after-scope` é uma ablação destinada a isolar a parte textual do guidance
que explica que `after` substitui todo o intervalo do anchor e deve conter
somente o conteúdo final correto desse intervalo.

Ela **não** instrui o modelo a pedir um `lineRange` menor.

Comparação prevista:

```text
--protocols r2,r2-after-scope,r2-narrow
```

Se `r2-after-scope` reproduzir o ganho de `r2-narrow` sem alterar a sequência
de reads/anchors, isso será evidência de que o efeito observado decorre da
explicitação semântica de `after`, e não da redução do range.


### Política de cycleId nas ablações R2

O harness aceita:

```text
--r2-cycle-policy per-protocol
--r2-cycle-policy shared
```

O default é `per-protocol`, preservando o comportamento das campanhas
anteriores: o nome do protocolo participa do `cycleId`.

Para ablações textuais controladas, `shared` gera o mesmo `cycleId` para o
mesmo `model × fixture × rep` em todos os variants R2. Como o `anchorId`
deriva do ciclo/snapshot/range, isso remove a mudança lexical do ID como
confundidor entre `r2`, `r2-after-scope` e `r2-narrow`.

Essa opção existe somente no harness experimental. Ela não altera o coder,
o contrato host-mediated ou o comportamento de produção.

Exemplo C3:

```text
--protocols r2,r2-after-scope,r2-narrow --r2-cycle-policy shared
```

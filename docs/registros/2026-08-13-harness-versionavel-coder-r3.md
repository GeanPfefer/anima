# Harness versionável de evidência do coder + campanha R3 recomputável

**Data:** 2026-08-13
**Tipo:** ambos (ferramenta versionada + campanha de prova controlada)
**Branch:** `claude/integration-application-layer`
**HEAD inicial:** `256ed0b`
**HEAD final:** `0548598` (+ este registro; ver "Commits")
**`origin/main`:** `973ef46` — **intacta, sem push**

## Objetivo

Fechar a lacuna de **proveniência/recomputabilidade** aberta na retomada de
2026-08-13 (os JSONs brutos da campanha anterior sumiram; a matriz publicada
deixou de ser recomputável). Entregar um **harness versionável** que exercita a
classe de produção `OllamaCoderBackend` **sem modificá-la** e repetir a campanha
**R3** de forma auditável: **N igual por célula** e **ordem randomizada** por
seed, medindo determinismo vs. estocasticidade. **Sem** alterar
contrato/prompt/`maxReadRounds`/modelo/roteamento/gates. Nenhum resultado
experimental é aplicado ao alvo real; nenhum piso de modelo é promovido.

## Papéis e proibições confirmadas

Executor sob mandato explícito do Supervisor (Gean: "faz tudo aí"); Reviewer/
Verifier final humano e independente. **Nada** de push/PR/merge/deploy/reset/
limpeza/recorrência. **Não** ratificar "piso" de modelo; **não** implementar
"âncora de edição" (R2); **não** mudar contrato/protocolo/prompt/`maxReadRounds`/
modelo/default/roteamento/gates. O mandato aberto ("faz tudo") foi interpretado
dentro do envelope de segurança do próprio Anima: das quatro direções em aberto,
só esta (evidência recomputável) é executável sem cruzar uma fronteira humana —
provider de PR real, expor UI de auto-dev e *ratificar* permanecem decisão do
usuário.

## Commits

- `0548598` — *Adicione o harness versionável de evidência do coder (R3).*
- (este registro, commit próprio de documentação)

## Ferramenta entregue (versionada)

`tools/coder-evidence/` — ver [README](../../tools/coder-evidence/README.md):

- `harness.ts` — runner: constrói `OllamaCoderBackend` com os **defaults de
  produção** do construtor (`maxReadRounds=3`, `num_ctx=8192`, `num_predict=1536`,
  `temperature=0`), roda cada célula (classe × modelo) com N reps em **ordem
  randomizada por seed dentro do bloco contíguo de cada modelo**, mede tudo por um
  `fetchImpl` **observador** (tee do fetch real, sem alterar payload) e grava
  `raw.jsonl` incremental + `matrix.{json,md}` + `meta.json`.
- `fixtures.ts` — as 7 classes de tarefa como proxies sintéticos, cada uma com um
  predicado semântico `achieved` (métrica secundária).
- `resolve-ts.mjs` + `register.mjs` — resolve-hook que permite **importar os
  módulos de produção sem copiá-los** (eles usam imports sem extensão). Só afeta
  este harness standalone; produção (Next.js/Jest) mantém o próprio resolvedor e o
  mesmo código-fonte byte a byte.

**Recomputabilidade:** a campanha volta a ser re-executável a qualquer momento —
a correção da lacuna de proveniência não depende mais de artefatos efêmeros de
scratchpad. O pacote bruto de uma execução fica preservado em
`tools/coder-evidence/runs/<stamp>/`.

## Método (não invasivo, isolado, versionado)

- Classe de produção exercitada **sem modificação**, importada por caminho
  relativo; alvos em memória; `fetchImpl` observador contra o **Ollama local**.
- **N igual por célula** (corrige a crítica de reps desiguais). **Ordem
  randomizada** por seed dentro do bloco de cada modelo (remove viés de *warmup*
  por cenário — hipótese H3 — sem *thrash* de VRAM, já que 18 GB do 30b não
  coexistem com os demais).
- Modelos já locais: `qwen2.5-coder:7b`, `qwen2.5-coder:14b`,
  `qwen3-coder:30b` (= `qwen3-coder:latest`, mesmo ID `06c1097efce0`, o alias
  default configurado). Nenhum download.
- Métricas por execução (em `raw.jsonl`): desfecho primário (host **aceitou** vs.
  **falhou** com código), `achieved` semântico, nº de leituras, rodada da edição e
  orçamento restante nela, ocorrências de cada `before` no arquivo original
  (unicidade da âncora), caminhos tocados, durações e contagens de tokens.

Parâmetros desta execução: **N=8**, seed `20260813`, Node v24.16.0,
Ollama 0.32.9. Pacote bruto em
[`runs/2026-08-13-r3-n8/`](../../tools/coder-evidence/runs/2026-08-13-r3-n8/).

## FATOS (matriz sucesso/total; config de produção)

Matriz **host-aceito/total** (desfecho primário; N=8 por célula; códigos de falha
entre parênteses). A matriz `achieved`/total (semântica) é **idêntica** a esta:
não houve nenhum caso "aceito porém semanticamente errado" — a exatidão do
protocolo faz aceitar equivaler a fazer certo nestas fixtures.

| Classe | 7b | 14b | 30b |
|---|---|---|---|
| `single_min` | 8/8 | 8/8 | 8/8 |
| `multi_locate` | 8/8 | 8/8 | **0/8** `ambiguous_replacement`×8 |
| `indent_nested` | 8/8 | 8/8 | 8/8 |
| `multiline_before` | 8/8 | 8/8 | 8/8 |
| `create_new` | **0/8** `read_round_limit`×8 | **0/8** `invalid_response_schema`×8 | 8/8 |
| `structural_add` | 8/8 | **0/8** `ambiguous_replacement`×8 | 8/8 |
| `cleanup` | **0/8** `ambiguous_replacement`×8 | 8/8 | 8/8 |

Totais brutos (⚠ comparar por célula, não por total): 7b **40/56**, 14b **40/56**,
30b **48/56**.

**Fatos derivados (comprovados nesta execução):**

1. **Capacidade NÃO é monotônica no tamanho — reconfirmado, com caso forte.** Há
   **duas** classes não-monotônicas: `structural_add` (7b 100% → 14b **0%** → 30b
   100%: o modelo do meio falha entre dois que passam) e, de forma mais chamativa,
   `multi_locate` (7b 100% → 14b 100% → **30b 0%**: o **maior** modelo falha onde
   ambos os menores passam). **Nenhum modelo é superconjunto dos outros:** cada um
   tem um conjunto de falhas distinto — 7b falha `{create_new, cleanup}`; 14b falha
   `{create_new, structural_add}`; 30b falha `{multi_locate}`. "Maior = melhor" é
   **falso** neste conjunto.
2. **`create_new` reproduz exatamente as assinaturas do registro anterior:** 7b
   `read_round_limit`×8 (read-stalling), 14b `invalid_response_schema`×8 (confusão
   de envelope — emite `create_file` como `action`), e **só o 30b resolve** (8/8).
3. **Determinismo total a `temperature=0`: 0/21 células estocásticas.** Todas as 8
   reps de **todas** as células concordaram. Isto **diverge** do fato #4 do registro
   [2026-08-12](2026-08-12-campanha-coder-e-hierarquia-interacao.md) (que observou
   estocasticidade a temp=0). Divergência **reportada honestamente**: com estas
   fixtures sintéticas, ordem randomizada e N=8, não se observou não-determinismo.
   A hipótese de warmup por ordem (H3 do registro anterior) **não se manifestou** —
   a ordem foi randomizada e o resultado por célula foi estável.
4. **Assinatura de âncora:** distribuição global de ocorrências do `before` no
   arquivo original = `{0: 24, 1: 120}`. As 120 âncoras únicas correspondem aos
   aceites; as 24 ocorrências `0` são **`before` alucinado** (texto que não existe
   byte-exato no arquivo) — as 24 falhas de `ambiguous_replacement` (multi_locate
   30b, structural_add 14b, cleanup 7b). **Nenhum caso occ≥2** nesta execução
   (diferente do occ=2 relatado para 14b/`structural_add` em 2026-08-12: aqui o 14b
   falha `structural_add` por `before` inexistente, não por âncora não-única).
5. **Read-stalling quantificado** (rodada da edição, `roundsLeftAtEdit`): 7b
   **sempre** edita na rodada final forçada (`{0: 48}`); 14b às vezes antes
   (`{0: 32, 2: 16}`); 30b em geral na final mas edita já na 1ª rodada em 8 casos
   (`{0: 48, 3: 8}`). Modelos maiores tendem a editar mais cedo; o 7b nunca.
6. **O host/protocolo está correto. Nenhum bug de produção.** Zero falhas
   inesperadas do harness (`harness_unexpected`=0): **toda** falha é saída do modelo
   recusada fail-closed com o código específico. A exceção de correção de bug **não
   se aplica**.
7. **Aceite = correção semântica.** As matrizes host-aceito e `achieved` são
   idênticas: quando o host aceitou, a mudança pretendida ocorreu.

**Comparação com 2026-08-12 (o que se sustenta e o que muda):** a não-monotonicidade
se **sustenta** (e fica mais forte, com o 30b falhando `multi_locate`); a
dificuldade de `create_new` para modelos pequenos e as assinaturas 7b/14b se
**reproduzem**; a **estocasticidade a temp=0 NÃO se reproduz** aqui. As células
específicas divergem porque as fixtures são outras — o que reforça que taxas
absolutas dependem de fixtures e exigem alvo realista.

## HIPÓTESES (não comprovadas — separadas dos fatos)

- **H1 — fixtures pequenas suprimem a estocasticidade.** O determinismo total aqui
  (contra 2026-08-12) pode vir do tamanho/simplicidade das fixtures: arquivos
  curtos, um alvo por tarefa, prompt pequeno e estável entre reps. Alvos maiores
  (mais leituras, mais tokens, batching não-trivial na GPU) poderiam reintroduzir
  o não-determinismo. Não comprovado; exige alvo realista.
- **H2 — a falha do 30b em `multi_locate` é sobre-leitura/âncora, não incapacidade.**
  O 30b editou `multi_locate` já na 1ª rodada (roundsLeft=3) e produziu `before`
  inexistente (occ=0): pode estar reconstruindo a âncora de memória sem reler o
  trecho numerado, um modo de falha de *confiança excessiva*, não de dificuldade.
  Não comprovado.
- **H3 — `create_file` como `action` é atrator do envelope para 14b.** Reproduz a
  hipótese H2 do registro anterior: o 14b falha `create_new` sempre por
  `invalid_response_schema` (envelope errado), determinístico, sugerindo um atrator
  estrutural que o reparo único não corrige.

## LIMITAÇÕES / ameaças à validade

- Fixtures são **proxies** sintéticos pequenos, não o repositório real.
- N=8 é um piso comum e igual, mas ainda modesto para a estocasticidade a
  `temperature=0` (o código não expõe `seed` do modelo; a ordem é seedada, a
  amostragem do modelo não).
- `raw.jsonl` guarda métricas derivadas, não transcrições integrais (as fixtures
  são sintéticas, sem segredos); a auditabilidade vem da recomputabilidade +
  métricas.
- **N=8 igual, mas o determinismo observado torna 8 reps redundantes nesta
  execução** — cada célula deu 8/8 ou 0/8. Isso é forte para *estas* fixtures, mas
  **não** mede a cauda estocástica que só apareceria em alvo realista; não se deve
  ler "0/21 estocástico" como propriedade do coder em geral, só destas fixtures.
- A ordem randomizada foi confirmada (bloco do 30b não agrupa classes), mas como o
  resultado foi determinístico, esta execução **não pôde** testar o efeito de
  warmup por ordem — ausência de efeito observável, não prova de ausência.

## RECOMENDAÇÕES (documentadas, NÃO aplicadas)

Nada é promovido automaticamente. R1 (roteamento por capacidade / piso por
classe), R2 (ergonomia de âncora de edição) e R3 (quantificar estocasticidade com
N alto) permanecem candidatos a **item próprio** sob nova decisão humana, agora
apoiados por um harness que torna R3 repetível. Ajustes à luz dos números:

- **R1 — reforça-se NÃO ratificar piso único.** A evidência agora mostra o
  **maior** modelo (30b) falhando `multi_locate` que os menores passam: um "piso"
  por tamanho seria pior que roteamento por classe. Se um dia houver piso, tem de
  ser **por classe de tarefa**, medido em alvo realista. Não promovido.
- **R2 — a fonte dominante de falha aqui é o `before` byte-exato** (24/24 falhas de
  edição são `before` alucinado, occ=0). Isso **fortalece** a hipótese de que a
  exigência de reconstruir a âncora a partir do trecho **numerado** é a fragilidade
  central. Continua exigindo ADR/plano e A/B isolado antes de qualquer mudança de
  contrato — **não** implementado.
- **R3 — o harness cumpre o pré-requisito de repetibilidade.** Falta só rodar com
  fixtures realistas (repositório real) e, se possível, `seed` de modelo, para
  medir a cauda estocástica que estas fixtures não expõem.

## Gates executados

- **Ferramenta:** `tools/coder-evidence/` é isolado (fora dos workspaces do
  monorepo); não toca `apps/`, `packages/`, `supabase/` nem `tools/local-agent`
  (confirmado por `git status`). Smoke test (1 run) e a execução real completa
  (168/168, exit 0) verdes.
- **`npm run typecheck`** verde nos 5 workspaces (mobile, web, core, supabase,
  types) — baseline antes e depois, confirmando que nenhum código de produção foi
  afetado. O harness não entra em nenhum `tsconfig` de workspace por desenho; sua
  correção é comprovada por ter executado a campanha inteira sem erro.
- **Integridade dos dados:** 168 linhas, 21 células, N=8 exato por célula, reps 0–7
  completos, ordem randomizada confirmada, 0 métricas faltando, 0 falhas
  inesperadas do harness.
- **Campanha:** experimentos vivos; não rodam gates de produção (nada aplicado).

## Invariantes de segurança / efeitos externos

Nenhuma proteção afrouxada. **Nenhum push/PR/merge/deploy.** `origin/main` intacta
(`973ef46`). Nenhuma migration/RPC/enum/tipo/contrato/gate tocado. Nenhum efeito
externo além do Ollama **local**. Código de produção do coder **byte-intacto**
(o harness importa, não altera).

## Arquivos locais preservados

`.worktrees/` (mobile-completed-result, roadmap-003-006), `.claude/settings.local.json`,
`apps/web/.env.local` e não-versionados intactos. Nenhuma operação destrutiva.

## Fronteiras humanas restantes (`BLOCKED_BY_HUMAN_DECISION`)

- Ratificar qualquer "piso" de modelo (R1) — mesmo com este harness, precisa de N
  maior e fixtures realistas.
- Mudar contrato do coder / âncora de edição (R2) — exige ADR/plano.
- Provider de review request (criar PR) — próxima fronteira humana nomeada no PRD;
  efeito Git externo, exige ADR/plano + autorização.
- Expor superfície de UI de auto-desenvolvimento — decisão de produto.
- `merged`/`integrated`, deploy, agendamento/recorrência.

## Próximo passo exato

A lacuna de recomputabilidade está **fechada**: a campanha é agora re-executável e
a matriz é reproduzível pelo repositório (`node tools/coder-evidence/harness.ts` +
`analyze.mjs`), com um pacote bruto auditável preservado. O harness torna R3
repetível; **ampliar N e usar fixtures realistas** (repositório real) para uma taxa
estável por classe permanece decisão humana. Até lá, **não promover piso de modelo
nem alterar a âncora/protocolo**. Nesta sessão, sob o mesmo mandato aberto, o
trabalho seguro seguinte foi para o **substrato local de review request** (peças
puras/fail-closed até a fronteira do efeito externo GitHub) — ver o registro
[2026-08-13-substrato-review-request.md](2026-08-13-substrato-review-request.md).
Sem push; `origin/main` intacta. Nenhuma rotina/recorrência criada.

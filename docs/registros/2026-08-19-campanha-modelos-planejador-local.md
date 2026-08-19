# 2026-08-19 (3ª) — Campanha de modelos locais para o planejador (diagnóstico)

**Tipo:** prova/diagnóstico (sem mudança de produção).

**Objetivo:** com a porta do planejador local já existente ([registro anterior](2026-08-19-planejador-local-selecionavel.md)), medir qual **modelo Ollama já instalado** é o melhor PLANEJADOR e desenhar (sem implementar) uma política de fallback. NÃO baixar modelos, NÃO implementar roteamento, NÃO mudar defaults.

**Branch:** `claude/integration-application-layer`. **HEAD:** `3f12cd6` (inalterado — só documentação nesta fatia). **`main`:** `99bec54` = `origin/main`, intacta.

## Modelos locais encontrados (com suporte a tools)

`qwen3-coder:latest` = `qwen3-coder:30b` (30.5B, código) · `qwen2.5-coder:14b` / `:7b` (código) · `qwen2.5:14b` (14.8B, instrução geral) · `llama3.1:8b` (8B, instrução geral) · `nomic-embed-text` (embedding, não candidato). Há candidatos reais além do `qwen3-coder`, então a comparação NÃO é artificial.

## Campanha (pré-definida antes de rodar)

Mesma porta `LocalOllamaProjectWorkPlanner`, **mesma tarefa** (exigindo um arquivo EXISTENTE, para medir "path existe" à parte), **mesmo prompt** (sem tuning por modelo), **mesma config** (`forceAfterEvidence=3`, `maxTurns=8`). **3 tentativas/modelo.** Modelos: `qwen3-coder:latest` (baseline), `qwen2.5:14b` (hipótese: instrução planeja melhor), `llama3.1:8b`. Métricas por tentativa: chamou tool read-only? · submeteu? · JSON parseável? · schema host válido? · included_scope seguro? · paths existem? · validation_command válido? · nº de chamadas Ollama · duração · proposta host-válida.

## Resultados

| Modelo | Tipo | host-válida | totalmente válida (paths existem) | chamou tool | avg chamadas Ollama | ~duração | modos de falha |
|---|---|---|---|---|---|---|---|
| **qwen2.5:14b** | instrução 14.8B | **3/3** | **3/3** | sim | 2.0 | ~23 s | — |
| qwen3-coder:latest | código 30.5B | 1/3 | 0/3 | sim | 3.0 | ~42 s | `no_submit`, `path_nonexistent`, `schema_invalid` |
| llama3.1:8b | instrução 8B | 0/3 | 0/3 | **não** | 8.0 | ~20 s | `no_submit` ×3 (nunca chamou tool) |

- **`qwen2.5:14b`** submeteu em 1 chamada de ferramenta, JSON válido, schema válido, comando válido e **paths que EXISTEM** — investigou de fato. Melhor por larga margem.
- **`qwen3-coder:30b`** confirma a variância anterior (~1/4): quando submete, às vezes inventa path (host-válido mas inexistente) ou fere o schema; às vezes não submete nem forçado.
- **`llama3.1:8b`** não usa as ferramentas (só conversa) e estoura os turnos — inadequado como planejador com este contrato.

## Separação de modos (mandato) — sinais objetivos que o host já distingue

`provider_error` (HTTP/sem resposta) ≠ `no_submit`/`invalid_json`/`schema_invalid` (**output inválido**) ≠ `path_nonexistent` (**host-válido, mas o caminho não existe**) ≠ `valid` (**proposta host-válida com paths existentes**). Esses sinais já são deriváveis da saída do planejador + `parseProposal` + checagem de existência — base pronta para uma política futura, sem inventar telemetria nova.

## `safePath` ≠ existência (confirmado)

A campanha reproduziu `path_nonexistent`: uma proposta host-válida cujo `included_scope` **não existe no disco** (`safePath` só checa segurança). Um gate ingênuo de "path deve existir" quebraria propostas que **criam** arquivos novos (path legitimamente ausente). A distinção correta é "**existente OU explicitamente criável**", que exige INTENÇÃO — decisão de design, não um gate trivial. **Não implementado neste ciclo.** Recomendação: uma futura função pura `pathExistsInProject(rel)` alimentando um **advisory** (não um gate duro), correlacionada à intenção da tarefa, para sinalizar "modifica arquivo inexistente" sem bloquear criação legítima.

## Política de fallback FUTURA (desenho, NÃO implementar)

```
planejador local (config)
  → tenta até um ORÇAMENTO pequeno B de tentativas
  → cada tentativa passa pela MESMA validação host
  → se nenhuma proposta HOST-VÁLIDA dentro de B  → planejador cloud (OpenAI)
  → cloud passa pela MESMA validação host
```

Restrições guiadas por evidência (não assumir números):
- **B (orçamento) depende do modelo**: com `qwen2.5:14b`, B pequeno (1–2) basta (3/3 na 1ª). Com `qwen3-coder`, B maior e ainda não confiável.
- **Gatilho de fallback = ausência de proposta host-válida** dentro de B (inclui `provider_error`, `no_submit`, `invalid_json`, `schema_invalid`). `path_nonexistent` é caso à parte: é host-válido; tratar como **advisory de qualidade**, não necessariamente fallback.
- Timeout/custo/modelo do cloud **não** assumidos aqui — medir quando houver consumidor.
- Local-first preservado: cloud é opcional e só quando o local não entrega dentro do orçamento.

## Recomendação arquitetural para o próximo ciclo (evidência, NÃO mudança agora)

1. **Trocar o modelo default do planejador LOCAL de `qwen3-coder:latest` para `qwen2.5:14b`** (`ANIMA_PROJECT_PLANNER_MODEL`). Evidência: 3/3 totalmente válidas vs 0/3, menos chamadas, menor duração. **Não aplicado neste ciclo** (mandato: sem mudar defaults). É a maior alavanca de qualidade e quase elimina a necessidade de fallback.
2. Só então avaliar a política de fallback acima, com B calibrado pela taxa medida do modelo escolhido.
3. Advisory de existência de path (`existente OU criável`) como sinal de qualidade, não gate.

## Custo local observado (só chamadas/duração — sem valor monetário)

`qwen2.5:14b`: ~2 chamadas Ollama e ~23 s por proposta VÁLIDA, **0 chamadas OpenAI**. `qwen3-coder`: ~3 chamadas e ~42 s, majoritariamente sem proposta válida. Nenhuma chamada de nuvem em nenhum caso. Não há base para afirmar economia monetária; o dado sólido é a taxa de sucesso e o custo em chamadas/tempo local.

## Invariantes preservadas

Local-first (cloud opcional); host continua autoridade (parseProposal/safePath/safeValidationCommand/base_sha/execution_spec); planejador não edita; sem segredos no local; validações NÃO afrouxadas; local NÃO virou default; sem push/PR/merge/deploy; `origin/main` intacta; `.worktrees/`/`.claude`/`.env.local` preservados; decisão final humana. Scratch da campanha removido (não commitado). Nenhum bug determinístico do host encontrado — as falhas são qualidade do modelo, absorvidas fail-closed.

## Próximo ponto exato de retomada

Ciclo seguinte, menor recorte: **default do planejador local → `qwen2.5:14b`** (com teste do resolver/model e uma prova viva curta confirmando 3/3), depois a **política de fallback** com B calibrado. Manter `qwen3-coder` para o CODER (é bom escrevendo, ruim planejando).

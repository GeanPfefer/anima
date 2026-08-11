# Registros de desenvolvimento e provas

Diretório **append-only**. Cada arquivo é um registro datado de uma sessão
relevante de desenvolvimento ou de uma prova viva do produto. O objetivo é que o
**estado operacional seja recuperável apenas pelo repositório** — sem depender da
memória de nenhum agente (Claude, Codex, GPT, modelo local) nem de nenhum chat.

Este diretório complementa a cadeia documental do [`AGENTS.md`](../../AGENTS.md):
a visão vive no manifesto, o estado tático vivo no PRD, o histórico de planos e
marcos em `docs/planos` e `docs/marcos`, as decisões em `docs/arquitetura`. Aqui
fica o **diário cronológico** que amarra tudo isso a uma sessão concreta: o que
foi feito, provado e decidido, e de onde continuar.

## Quando registrar

Ao final de uma sessão significativa de desenvolvimento ou de prova — quando
houver commits relevantes, uma decisão, um bug encontrado/corrigido, ou uma prova
manual/ao vivo do produto. Correções triviais e exploração sem efeito não exigem
registro próprio.

## Regras

- **Append-only.** Nunca reescreva evidência histórica. Um fato registrado
  errado é corrigido por um novo registro que aponta o anterior, não por edição.
- **Não duplique.** Se ADR/PRD/Plano/marco já detalham algo, **referencie** com
  link em vez de copiar. Este registro amarra e resume; a fonte detalhada
  permanece no seu lugar canônico.
- **Sem burocracia paralela.** Um arquivo por sessão/prova. Se o conteúdo cabe
  melhor num plano ou ADR existente, prefira lá e deixe aqui só o ponteiro.
- **Hipótese não é causa raiz.** Uma prova de defeito registra o observado; só
  chame algo de causa raiz depois de comprová-lo no código.

## Nome do arquivo

`AAAA-MM-DD-slug-curto.md` — a data da sessão e um slug descritivo. Se houver mais
de um registro no mesmo dia, o slug os distingue.

## Campos esperados (quando aplicável)

Nem todo campo cabe em todo registro; inclua os que fizerem sentido.

- **Data** e **tipo** (desenvolvimento | prova | ambos).
- **Objetivo** da sessão.
- **Branch**, **HEAD inicial**, **HEAD final**.
- **Commits** criados (hash curto + assunto).
- **Mudanças relevantes** (o que mudou, em uma linha cada; link para o código/doc).
- **Decisões** tomadas.
- **Bugs encontrados** e **bugs corrigidos** (separados).
- **Provas/testes executados** e **resultados dos gates** (números).
- **Flakes conhecidos**, separados explicitamente de regressões.
- **Limitações** e o que **não** foi feito.
- **Invariantes de segurança** preservadas.
- **Efeitos externos** realizados ou **explicitamente não realizados** (push, PR,
  merge, deploy, `integrated`, credenciais).
- **Worktrees/ambientes** relevantes (inclusive de terceiros/operador, preservados).
- **Fronteiras humanas** restantes (`BLOCKED_BY_HUMAN_DECISION`).
- **Próximo ponto exato de retomada.**

## Automação futura

Esta disciplina será futuramente automatizada pelo próprio Anima local, que
passará a escrever estes registros ao encerrar sessões. **Ainda não implementado**:
por enquanto o registro é escrito manualmente (por humano ou agente) ao final da
sessão. Este README documenta o comportamento esperado para quando a automação
existir.

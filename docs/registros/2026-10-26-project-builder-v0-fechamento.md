# Project Builder V0 — fechamento — 2026-10-26

Append-only. Tipo: **fechamento** (síntese com evidências persistidas; nenhum código). Formato de [`README.md`](README.md). Consolida T1–T5, T5-R1 e as duas provas externas (PROOF-EXT-01, PROOF-EXT-02). Detalhes técnicos de cada etapa estão nos registros `2026-10-24-…` a `2026-10-26-…`.

## Objetivo e escopo

Provar que o ANIMA consegue conduzir, **sob governança humana**, uma alteração de código num repositório Git **externo** (fora do monorepo do ANIMA) do pedido até a integração local: identidade física do alvo comprovada, contrato de aceite com provas explícitas por critério, execução isolada por um executor externo, Verifier, revisão e aceite humanos, autorização humana da integração, exclusividade física do repositório, fast-forward verificado e recibo persistido. Escopo: **um** alvo externo por host, **um** laboratório descartável, destino **local** (`refs/heads/main` do laboratório), sem remoto e sem publicação.

## Capacidades implementadas (T1–T5)

| Etapa | Capacidade | Evidência |
|---|---|---|
| T1 | Target Registry mínimo: `ext:<slug>`, identidade canônica congelada no contrato (raiz, git-common-dir, commit raiz, base), Git confiável (ambiente zerado, `--git-dir`, hooks/fsmonitor desligados), distinção do Anima | `1aef76a`, `fab1895` |
| T2 | Materializador de work item externo (`work external propose`) e classificação humana explícita | `39849f7` |
| T3 | `acceptance_contract` v2: critérios com id estável e prova explícita (gate, teste vinculado, revisão humana) | `c2911bd` |
| T4 | Revisão humana de critérios `human_review` ligada ao diff real (digest), gate do aceite, detecção de conflito físico | `c7be388` |
| T5 | Autorização humana `ff_only` externa (RPC), lease físico por repositório, executor com CAS/fast-forward seguro, recibo pelo Trusted System Writer | `7ef6ae7`; migration `20261026000000` aplicada ao residente; tipos `fe78176` |
| T5-R1 | `core.autocrlf` local do repositório respeitado nas operações de árvore | `2e12edf` |

## Resultados das provas (eventos persistidos)

**PROOF-EXT-01** (`af70498b…`, `ext:proof-ext-01`): gate verde e candidato correto (`2e12825`), porém o contrato original não vinculava os critérios de aceite às evidências ⇒ parecer do Verifier **inconclusive** (evento 86871). O item ficou `in_progress` com o candidato retido, e foi encerrado por **cancelamento humano auditável** (`work_cancelled`, seq 86891, `author=user`, `origin=pending_verification_recovery`, `verifier_status=inconclusive`, justificativa registrada), sem alterar a evidência original nem registrar `verified`/`accepted`.

**PROOF-EXT-02** (`2cf13fc8…`, `ext:proof-ext-02`), mesma correção, mesmo SHA base `3405172`, com Acceptance Contract V2 (gate `npm test`, teste vinculado `src/clamp.test.js` com 4 testes nomeados, revisão humana A4):
`work_proposed` 86873 → `work_approved` 86875 e `work_intelligence_classified` 86876 (humanos) → `work_started` 86880 / `execution_started` 86881 (Codex via WSL, executor `worktree-v1`, backend `codex-cli:default`) → `result_submitted` 86883 → evidências do host (gate 86884, coder 86885, git 86886) → `verifier_opinion_recorded` **verified** 86887 → `context_attached` 86889 (revisão A4 por critério, digest do diff) → `result_accepted` 86890 (humano) → `integration_effect_authorized` 86892 (humano, `ff_only`, esperado `3405172`, candidato `62a1d1e`, identidade congelada) → `integration_completed` 86893 (`author=system`, Trusted System Writer).

## Integração Git

Lease físico `d55c279a…` adquirido e liberado como `completed` em ~0,7 s (chave derivada do git-common-dir, independente da referência textual); identidade relida antes e sob o lease; `main` do laboratório em checkout limpo; `merge --ff-only` com Git confiável (sem hooks); `main` `3405172` → `62a1d1e`, 2 commits, sem merge commit; recibo com `previousTargetSha`=`3405172`, `resultingTargetSha`=`62a1d1e`, `mergeCommitSha=null`; `projectIntegrationStatus = integrated`; `npm test` 4/4 no laboratório.

## Defeito encontrado e corrigido (T5-R1)

O padrão `core.autocrlf` do operador (Git for Windows: `true`) era repassado por `git -c` e sobrescrevia o `core.autocrlf=false` **local** do laboratório, deixando `src/clamp.js` em CRLF no worktree (ref e recibo corretos; só EOL). Corrigido em `2e12edf` (o padrão do operador só vale sem configuração local), com testes que falham no código antigo; o arquivo do laboratório foi restaurado ao blob de `HEAD` sem tocar refs.

## O que o V0 comprovou — e o que NÃO comprovou

Comprovado (uma repetição, um laboratório descartável): o ciclo governado completo acima, com cada ato humano separado e cada fato de sistema escrito só pelo Trusted System Writer; recusa fail-closed em identidade alterada, destino divergente, candidato errado, árvore suja, branch em worktree vinculada, hooks/filtros hostis e concorrência (provas pgTAP e Git real).

**Não comprovado / fora do escopo:** autonomia desassistida; desenvolvimento de projetos completos ou de múltiplos arquivos/etapas; mais de um alvo externo por host; publicação remota (push/PR) de projetos externos; execução simultânea de vários trabalhos externos; segunda repetição independente; repositórios de terceiros reais (só laboratório descartável). Nenhuma capacidade nova é promovida no mapa de capacidades por este registro.

## Limitações atuais

- Revisão humana e identidade física são verificadas pelo **executor**; o banco garante Verifier `verified`, tipo da autorização, destino seguro e exclusividade, não lê mensagens do operador nem o Git. Ações Git humanas fora do ANIMA não passam pelo lease (o CAS e as pré-condições do checkout cobrem a corrida).
- Destino local único por host (`ANIMA_EXTERNAL_INTEGRATION`) e um `ANIMA_EXTERNAL_TARGET` por host (configuração por variável de ambiente).
- As migrations candidatas `20261009000000/01` seguem pendentes por decisão; por isso `supabase migration up` simples não aplica migrations novas (a T5 foi aplicada por procedimento seletivo e transacional, com registro no histórico).
- O campo `statements` do histórico da T5 guarda o arquivo integral em 1 elemento (o CLI fatia por instrução).
- Resíduos pré-existentes do banco: claim expirado de teste (julho) e linhas órfãs de FK em `auth.sessions`/`profiles`.

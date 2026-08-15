# 2026-08-14 — Verifier V0: cross-check adversarial e mapa de proveniência

**Tipo:** desenvolvimento (endurecimento) + análise. **Objetivo:** fortalecer a
**independência real** do Verifier V0 antes de persistir seus pareceres ou
promovê-los a autonomia. Autorizado pelo Gean (opção 3). Continua
[2026-08-14-verifier-v0](2026-08-14-verifier-v0.md).

## Estado Git

- **Branch:** `claude/integration-application-layer` · **HEAD inicial:** `4f66bf3` · **HEAD final:** `7900170` (+ este registro)
- **origin/main:** `973ef465acaa3955f8e176c72903975cf3912ac6` — **intacta, SEM push** · working tree limpa (só `.worktrees/`)
- **Commits:** `bba868f` (núcleo: hardening + proveniência), `7900170` (honestidade de UI web+mobile)

## Mapa de proveniência da evidência consumida pelo Verifier

Para cada informação que influencia o veredito, **quem a produz** e o Verifier
tem **fonte independente** dela? Três classes (pedido do Gean):

| Evidência | Produtor real | Verifier tem fonte independente? | Classe |
|---|---|---|---|
| `expected.workItemId`, `approvedProposalVersion` | item (humano-aprovado, persistido) | sim — o próprio item | **A independente** |
| `authorized.includedScope` / `excludedScope` | proposta aprovada (persistida) | sim | **A independente** |
| `authorized.validationCriteria` | `execution_spec` da proposta aprovada | sim | **A independente** |
| correlação do handoff (`attemptId`/item/versão) | sinal do executor, **mas** `record_commanded_work_terminal` força o sinal a casar com o `attempt_id` real de `begin_work_attempt` | sim — amarrada pela persistência confiável | **B (confiável-amarrada)** |
| ausência de handoff | observada pelo próprio Verifier no log | sim | **A independente** |
| `changedFiles`, `diffSummary` | **sinal do executor** (host observa o git, mas grava no sinal) | **NÃO** | **C atestada** |
| `gates` (`outcome`, `exitCode`) | **sinal do executor** | **NÃO** | **C atestada** |
| `status`, `baseSha`, `commitSha` | **sinal do executor** | **NÃO** | **C atestada** |
| `branch` (valor) | sinal do executor (regra de namespace é independente, o valor não) | parcial | **C atestada** |

**Cadeia verificada no código:** `verifyPersistedWorkResult` → `projectWorktreeHandoff`
lê `data.executor_signal.worktreeHandoff` do último `result_submitted`;
`record_commanded_work_terminal` ([migration 20260726000003](../../supabase/migrations/20260726000003_terminal_sequence_after_checkpoints.sql))
**valida a correlação** do sinal contra os parâmetros (linhas 66–68) e exige um
`execution_started` real (80–83), mas grava o **conteúdo** (`gates`, `changedFiles`,
`status`) **verbatim** em `executor_signal` (138–139) — sem re-observação independente.

**Conclusão central:** a **autoridade** contra a qual o Verifier confere é
independente (contrato aprovado + correlação amarrada), mas **tudo que descreve o
que ACONTECEU** (arquivos, gates, status) é **atestado pelo executor**. O Verifier
estabelece *"o resultado REPORTADO é coerente e consistente com o contrato"*, não
*"o resultado reportado é VERDADEIRO"*.

## Bug reproduzido e corrigido (protocolo estrito)

**Reprodução primeiro:** um gate `outcome:'passed'` com `exitCode:3` retornava
`verified` — o Verifier confiava no `outcome` e ignorava o código de saída
contraditório; `buildWorktreeHandoff` (INT-05) não força a coerência
`passed⟹exitCode 0`. Teste adversarial falhou como esperado; **menor correção**:
achado `gate_exit_code_incoherent` (violação) quando `passed && exitCode!=0` (só
`passed⟹0`, pois um `failed` pode ter código 0 por timeout/cancelamento). Contrato
ratificado INT-05 **intocado** — o Verifier re-deriva a coerência em vez de confiar.

## Endurecimentos adicionais (mesmo eixo)

- **Cross-check das validações autodeclaradas × gates** (input opcional
  `declaredValidations`): discordância de outcome no mesmo rótulo ⇒
  `contradictory_validation_claim`. **Ambas as fontes são atestadas**, então pega
  inconsistência (executor buggy / adversário desleixado), **não** fabrica
  independência — documentado no próprio código.
- **Proveniência por achado** (`independent` | `attested`, default conservador
  `attested`) + `summary.attested/independent` + **`restsOnAttestedEvidence`**. A
  UI (web+mobile) passou a declarar, nesses casos, que o parecer é *"baseado na
  evidência reportada pelo executor… não é prova independente"*.

## Respostas objetivas (critérios de validação, seção 6)

1. **Inputs com proveniência independente:** o contrato aprovado (item, versão,
   escopo incluído/excluído, critérios), a **correlação** do handoff (amarrada por
   `begin_work_attempt` + a RPC de término) e a **ausência** de evidência.
2. **Inputs que ainda NÃO têm:** `changedFiles`, `diffSummary`, `gates`
   (outcome+exitCode), `status`, `baseSha`/`commitSha`, `branch` — atestados pelo
   executor, nunca re-observados pelo Verifier.
3. **Quando pode dizer VERIFIED:** handoff presente + correlação bate + branch do
   namespace + todo arquivo ⊆ escopo aprovado + ≥1 gate, todos `passed` com código
   0 e coerentes + todo critério-com-comando coberto + status coerente + (se dado)
   validações consistentes. **Sempre com `restsOnAttestedEvidence=true`.**
4. **Quando DEVE dizer INCONCLUSIVE:** sem handoff durável; critério-com-comando
   sem gate cobrindo; nenhum gate presente — evidência insuficiente.
5. **Que contradição produz REJECTED:** correlação divergente (versão obsoleta),
   arquivo fora/dentro-do-excluído, `gate_failed`, `gate_exit_code_incoherent`,
   `status_contradicts_gates`, `reported_failure`, `contradictory_validation_claim`,
   `branch_not_owned`.
6. **Um executor mal-comportado fabrica um VERIFIED sozinho?** **SIM.** Não forja a
   correlação (amarrada pelo laço confiável), mas **pode** emitir um handoff coerente
   com `changedFiles⊆escopo` falsos, `gates` todos passados e `status:'succeeded'`
   fabricados → `verified`. Os cross-checks (exitCode, validações) pegam fabricação
   **desleixada/buggy**, não um adversário **cuidadoso** internamente consistente.
   **A mitigação do V0 é HONESTIDADE, não prevenção:** `restsOnAttestedEvidence`
   marca cada veredito assim, impedindo que humano/política o leiam como prova
   independente.

## Recomendação arquitetural — NÃO RATIFICADA (a prevenção real)

Fechar o item 6 (impedir a fabricação, não só declará-la) exige que a evidência de
gate/diff tenha **produtor independente do executor**. Desenho mínimo proposto:
o **laço confiável (host)** — não o sinal do executor — persiste os desfechos de
gate e os arquivos alterados que **ele mesmo observou** (git + processo), num
**evento `system`** separado; o Verifier passa a ler ESSE evento, não os campos do
`executor_signal`. Isso torna a evidência **B (confiável)** para o executor
in-process atual. Para um executor **remoto/não-confiável** futuro, os gates
precisariam rodar num sandbox que o executor não influencia. **Isto é novo
evento/schema = decisão contratual — não implementado.** Apresento o desenho;
aguarda autorização.

## Persistência do parecer (investigada, seção 7 — NÃO implementada)

Persistir o parecer como **evidência histórica** é derivável, mas exige um **novo
tipo de evento append-only** (ex.: `work_verification_recorded`) + RPC — **decisão
contratual**. Parei antes. Além disso, a persistência só é útil se a futura
política de maturidade **ponderar `restsOnAttestedEvidence`**: promover autonomia
com base em `verified` atestado seria promover a autoconfirmação do executor. O
parecer hoje é **recomputado sob demanda** (projeção pura), então nunca diverge da
evidência; persistir agrega auditoria histórica, não correção.

## Gates

typecheck 5/5 · core **32/718** · web `WorkProposalCard` **39/39** (chat
`75/75`; o `project-tools` que falhou 1× na suíte web completa **passa isolado** —
flake de paralelismo pré-existente, alheio a este eixo) · mobile **5/42**.

## Invariantes / fronteiras

Advisory preservado (nenhum efeito, estado ou gate afrouxado; humano intacto).
Nenhum contrato ratificado alterado (a mudança é do Verifier, novo/não-persistido).
Nenhuma reexecução de gate (o Verifier não virou segundo Executor). Zero
push/PR/merge/deploy/token. `.worktrees/`, `.env.local`, `settings.local.json`
preservados.

## Próximo ponto de retomada

De `7900170`. O Verifier V0 é honesto sobre sua própria independência. **Fronteiras
que aguardam decisão humana:** (1) evento `system` de gate/diff observado pelo host
(prevenção real da fabricação); (2) persistência append-only do parecer; (3)
política de maturidade que pondere `restsOnAttestedEvidence`. Nenhuma atravessável
sem autorização (novo schema/contrato). Não reabrir o que está fechado.

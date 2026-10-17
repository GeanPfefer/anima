# Acceptance Mandate V1 — aceite sob mandato humano antecipado

Estado: implementado em worktree isolado e provado em banco descartável; **migrations candidatas, NÃO aplicadas no residente**.
Plano: A2-0, Recorte 2. Depende do Recorte 1 (`host_observed_execution_context_recorded`, commit `2888118d`).

## Problema

Hoje o aceite de um resultado (`review_work_result_versioned`) é executado pela sessão residente `authenticated`, a mesma identidade
que roda o runner. "Humano" é uma convenção de credencial: um mandato gravado por essa sessão não impediria o runner de se passar
por humano. Por isso o mandato exige **uma identidade de concessão dedicada** e **uma identidade de sistema distinta para aceitar**.

## Identidades e autoridade

| Papel | Identidade | Pode | Não pode |
|---|---|---|---|
| GRANTOR | usuário GoTrue dedicado, papel `anima_mandate_grantor`, senha em prompt oculto | `preview_acceptance_contract`, `grant_acceptance_mandate`, `revoke_acceptance_mandate` | executar trabalho, aceitar, integrar, ler o ledger do runner |
| RUNNER | sessão residente (`authenticated`) | executar a attempt | conceder, ampliar, revogar ou consumir mandato; escrever `work_events`/`work_acceptance_mandates` |
| WRITER | Trusted System Writer (`anima_system_writer`) | `accept_work_result_under_mandate` | conceder ou revogar mandato |
| HUMANO | quem opera o grantor | decide: a concessão é o ato humano (evento `work_mandate_granted`, autor `user`) | — |

Registro do grantor: `private.acceptance_mandate_grantors` (um grantor por dono; nunca o dono, nunca da allowlist de trabalho, nunca um writer).
O papel efetivo vem do claim `role` do JWT **e** do registro; as duas coisas são exigidas. Provisionamento do usuário GoTrue é ato do operador.

## Contrato do mandato (política `acceptance-mandate-v1`)

- Um item, uma versão aprovada, hash canônico do contrato (`private.acceptance_contract_sha256`, calculado **pelo banco** sobre impacto, capacidade,
  versão, `execution_spec` e proposta). Quem concede informa o hash que viu; o banco recusa se divergir.
- Janela explícita `not_before`..`expires_at`, **no máximo 24 h**, nunca retroativa nem já expirada.
- Ação permitida: exclusivamente `accept`. Sem integração e sem publicação implícitas.
- Risco: impacto `low`; classificação humana vigente `bounded/low/reversible/clear`; capacidade `programming`.
- Orçamento: uma attempt; executor `worktree`; backend `codex-cli` ou `ollama`; **sem compute pago** (preferência, autorizações, eventos de orçamento); sem `resume_from_checkpoint`.
- Verifier `required_fail_closed` e `work-verifier-v6` no aceite.
- Escopo: 1–20 arquivos, igual ao `included_scope` do contrato, normalizados, fora dos prefixos sensíveis
  (`supabase`, `.claude`, `.git*` — inclui `.github`, `.gitmodules`, `.gitattributes` —, `.env*`, `scripts`, `tools` e os módulos de política/autorização/mandato/writer).
  O host é Windows/NTFS: o prefixo sensível é comparado **sem distinção de caixa** e são recusados caminhos com `~` (nome curto 8.3), `:` (stream), `* ? " < > |`,
  caracteres de controle e segmento terminado em `.` ou espaço, porque todos aliasam diretórios protegidos.
- **Antecipado**: só se concede antes de qualquer attempt (`work_claimed`, `execution_started`, `work_started`, `result_submitted` ausentes) e o aceite
  exige `seq(work_mandate_granted) < seq(execution_started)` da attempt aceita.
- Um mandato ativo por item+versão; `request_id` idempotente (mesmos termos ⇒ replay; termos diferentes ⇒ conflito).

## O que o banco recalcula no aceite (nada do runner é confiável)

mandato (vigência, revogação, consumo, política, ação), item/versão/estado `review`, resultado mais recente, hash do contrato, base, impacto,
anterioridade, attempt única, classificação humana, ausência de compute pago e de integração, `mandated_result_verdict = verified`, parecer `work-verifier-v6`
com `gaps = 0` e `violations = 0`, `test_binding` independente quando o contrato o declara, **fato de contexto de execução (R1)** da mesma attempt
gravado pelo writer (modo `unattended` ou `supervised`) e **integridade do candidato**: relatório Git do writer (`commitSha == handoff == observado pelo host`,
pai único == base, 1 commit, 0 merges, base ancestral, só adições, escopo exato) cruzado com a evidência git **observada pelo host**.
A coleta Git roda sempre com `--no-replace-objects` (um `refs/replace/*` criado pelo runner não pode reescrever o candidato) e só aceita arquivos regulares
(`100644`/`100755`): link simbólico ou submódulo com o nome de arquivo "certo" é recusado (`git_unusual_file_mode`). Publicação (`branch_published`) ou integração prévias recusam o aceite.

Efeito: `result_accepted` com `author = system`, `decided_by = trusted_system_writer` e `authority.kind = human_mandate`
(mandato, evento humano de concessão, hash, política, ids do parecer e do fato de contexto, commit, relatório de integridade); item `completed`;
mandato consumido na mesma transação. **Não integra e não publica** (a integração continua um ato humano separado — Recorte 3).

## Proteções

| Ameaça | Proteção |
|---|---|
| Runner concede/amplia/revoga | ACL só para `anima_mandate_grantor`; checagem de papel+registro dentro da função; tabela sem escrita direta |
| Runner aceita como sistema | ACL só para `anima_system_writer`; trigger aditivo `guard_mandated_acceptance` barra `result_accepted` de sistema sem writer + mandato vigente (até para superuser sem writer) |
| Mandato expirado / revogado | relógio real (`clock_timestamp`) no aceite e no trigger |
| Replay | consumo atômico + índice único de um consumido por item+versão; mesmo resultado ⇒ `replayed`; outro ⇒ `mandate_consumed` |
| Ampliação de escopo / item diferente / base divergente | escopo exato, mandato amarrado a item+versão+hash+base; qualquer `revise` muda a versão/hash |
| Alteração de política | `policy_version` gravada no mandato; divergência recusa |
| Termos adulterados | trigger de imutabilidade (só revogar uma vez e consumir uma vez; nunca apagar) |
| Corrida aceite × revogação | grant, revoke e aceite travam **item → mandato** (mesma ordem); sem deadlock; quem perde recebe `mandate_revoked`/`already consumed` |
| Escopo que aliasa diretório protegido no NTFS | comparação sem caixa, `.git*` sensível, recusa de `~ : * ? " < > |`, controle e segmento terminado em `.`/espaço |
| Candidato reescrito por `refs/replace` / link simbólico / submódulo | `--no-replace-objects` + checagem de modo de arquivo na coleta Git |

## Execução x decisão

Fatos de execução (`host_observed_*`, contexto R1): `author=system`, sem autoridade, descrevem o observado. Decisão de aceite: evento `result_accepted` com
bloco `authority`, que **cita** a decisão humana (concessão) e os fatos que a sustentam, sem criá-los. Funções, papéis e eventos são separados.
O leitor TS `readPersistedMandatedAcceptance` nunca trata aceite humano (`user`) como mandatado.

## Métrica de autonomia

`work_mandate_granted/revoked` entram em `HUMAN_TYPES`: conceder mandato é ato humano e é contado. Um aceite mandatado satisfaz `accepted.author != 'user'`,
mas o ciclo continua `human_observed` (concessão e `work_started` com autor `user` vêm antes do resultado). Nada é reclassificado artificialmente;
`unattended_verified` não é declarado.

## Limites conhecidos

- O caminho de aceite humano existente continua aberto à sessão residente e é registrado como `user` (preexistente; não é ampliado nem fechado aqui).
- `actor_kind`/runner do fato de contexto continuam declarações do launcher validadas pelo banco, não prova de ausência de humano.
- A separação depende de o grantor ser operado com credencial fora do runner (prompt oculto; `cli/mandate.ts` recusa senha no ambiente e e-mail igual ao do residente/writer).
- `service_role` (chave de serviço) mantém INSERT/UPDATE/DELETE em `work_events`/`work_items` por herança do schema; não executa as RPCs do mandato nem toca a tabela de mandatos,
  mas é capaz de forjar o aceite **humano** (`user`). A chave de serviço jamais pode estar no ambiente do runner (preexistente).
- A classificação humana (`human_confirmed`) é gravada pela sessão residente; o mandato não a protege contra um runner malicioso, apenas exige que ela exista e seja `bounded/low`.
- Registrar um grantor em `private.acceptance_mandate_grantors` exige o dono do banco (`postgres`): é o ato de raiz do operador, como o registro de writers.
- Ainda não há composição de produção para `acceptUnderMandate` (leitura do ledger + `runGit` real apontando para o repositório do candidato, com `GIT_DIR`/`GIT_OBJECT_DIRECTORY`/
  `GIT_ALTERNATE_OBJECT_DIRECTORIES` do ambiente limpos); precisa de revisão própria antes da prova viva.
- Redundâncias deliberadas (defesa em profundidade): a falta de identidade do writer também seria barrada pela allowlist; "resultado mais recente" também cai em "resultado inexistente".

## Operação (futura, com autorização própria)

1. Provisionar o usuário GoTrue do grantor (`auth.users.role = anima_mandate_grantor`) e registrá-lo em `private.acceptance_mandate_grantors` (ato do operador).
2. `node … cli/mandate.ts preview <item>` → `grant …` (antes de qualquer attempt) → attempt governada → writer chama `acceptUnderMandate`.
3. Revogação a qualquer momento antes do consumo: `cli/mandate.ts revoke <mandato> --reason "…"`.

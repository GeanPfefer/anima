# 068 — Roadmap de durabilidade operacional (`memory.durability`)

Plano proposto. **Nenhum item está autorizado.** Cada incremento exige
autorização humana própria. Diagnóstico de origem:
`docs/registros/2026-10-14-memory-durability-diagnostico.md`.

## Princípios

- **Backup ≠ Recuperação ≠ Alta disponibilidade.** Esta sequência cobre os dois primeiros e a portabilidade. HA (réplica, failover) fica explicitamente fora.
- Backup sem restauração verificada não conta. Persistência em disco não é backup.
- O conteúdo da memória é privado: nada sai do processo sem criptografia; relatórios só levam contagens e digests.
- Reuse before build: `supabase db dump` + `restic` + `git bundle` + o *gate* já existente em `supabase/restore-proof`.
- Cada degrau tem um critério de prova observável; nenhuma capacidade é declarada sem ele.

## Sequência mínima

| Degrau | Objetivo | Entregável | Prova (aceite) | Autoridade extra |
|---|---|---|---|---|
| **D0** Inventário confiável | Manifesto versionado do estado essencial, só metadados | Script read-only que emite manifesto: tabelas+contagens+digest do ledger, nomes (não valores) de variáveis exigidas, refs Git e commits só-locais, versões de CLI/imagens | Manifesto reproduzível; diff entre duas execuções explica-se por eventos do ledger | Código novo |
| **D1** Backup consistente e verificável | Dump lógico (5 artefatos) + digests de segurança + âncora do ledger, criptografado em repositório restic local | `backup.sh` que: PRE digest → dump → POST digest (PRE==POST) → `restic backup` → `restic check` | PRE==POST; `restic check` ok; manifesto D0 anexado | Código + escrita de disco local |
| **D2** Cópia independente | Segunda cópia fora da máquina (disco externo desligado e/ou B2/S3 via rclone), mais `git bundle --all` e escrow de segredos | Destino escolhido; bundle (após resolver `ce0e8cb`); segredos em cofre humano | Cópia legível a partir de **outra** máquina com só a senha do repositório | **Decisão humana**: destino, custo, quem guarda a senha; push/upload é efeito externo |
| **D3** Restauração isolada | Reexecutar V0.1 a partir do repositório restic em projeto descartável | Script de restore com neutralização de defaults e trigger `auth.users` automatizados | 12/12 digests de segurança; equivalência de dados; restart; teardown limpo | Docker local, projeto isolado |
| **D4** Identidade e memória | Provar que a identidade e a memória voltam | Modo **read-only probe** do host residente (unidade própria); login de teste contra restaurado; contagens por tabela de memória e fingerprint residente | Fingerprint igual; contagens iguais; leitura de memória pela app em modo leitura | Código no host (modo probe) |
| **D5** Portabilidade | Restaurar em **outro nó** (VM/máquina) a partir somente da cópia independente + repositório + segredos | Runbook medido | RTO medido; D4 repetido no nó novo | Segunda máquina; sem cloud paga sem autorização |
| **D6** (opcional, separado) PITR | WAL archiving (WAL-G) se um RPO <24 h for exigido | Config `archive_command` e restore a um instante | Restore a timestamp alvo com digests | Mudança de infra; só com requisito explícito |

Operação contínua (após D3): agendamento diário, rotação de retenção,
verificação semanal com `restic check`, alarme se a última cópia verificada
tiver mais de 48 h (esse alarme é o primeiro passo para o Anima passar a
*detectar* progresso sem cópia, como pede o `target` da capacidade).

## Menor experimento seguro recomendado: E-0

**Hipótese:** um dump lógico do banco atual (schema 156), criptografado em
repositório restic, restaura bit-a-bit equivalente em projeto descartável
isolado.

Passos (todos locais, US$0, sem tocar o banco vivo além de leituras e do
`pg_dump`):

1. `digest.sh` e `data-snapshot.sql` no vivo (PRE).
2. Os 5 `supabase db dump` do procedimento V0.1; novamente digests (POST); exigir PRE==POST (se houver escrita concorrente, repetir; claims/leases vigentes são 0).
3. `restic init` em disco **fora de `C:`** (ex.: `G:`) e `restic backup` dos 5 dumps + manifesto D0; senha gerada e guardada pelo humano, nunca no repositório nem no relatório.
4. **Apagar os dumps plaintext imediatamente**; `restic check --read-data`.
5. `restic restore` em diretório temporário; projeto Supabase descartável (portas/volume novos); restore + neutralização + trigger + gate V0.1.
6. Comparar 12 digests e snapshot de dados; restart; teardown do projeto e do diretório temporário.

**Critério:** 12/12 digests iguais, dados iguais (incluindo âncora do ledger),
`restic check` ok, volume vivo inalterado, nenhum plaintext remanescente.

**O que NÃO prova:** cópia fora da máquina (D2), outro nó (D5), login real e
host residente (D4). Reporta explicitamente a lacuna.

**Riscos e mitigações:** dump contém memória pessoal em plaintext durante o
passo 2→4 (mitigar: diretório no disco local de baixa exposição, apagar logo,
sem logs de conteúdo); `C:` com 58 GB livres é suficiente (dump ≈ 5 MB, projeto
descartável ≈ 1–2 GB); versão do CLI/imagens deve ser a mesma (verificar contra
manifesto V0).

## Pré-requisitos e pendências independentes

1. Investigar `ce0e8cb60a15…` (commit-graph aponta objeto ilegível) antes de qualquer `git bundle`.
2. Humano decide: publicar os 60 commits locais e commitar os docs untracked (ato de push/commit humano); enquanto isso, o `bundle` do D2 os cobre.
3. Reescrever `memory.durability` em três capacidades (Code Durable, Historical, Operational) quando D3 passar — proposta, não alterada.
4. Confirmar na documentação oficial as lacunas marcadas "a confirmar" (restic check, estado do pgBackRest, WAL-G na imagem pinada).
5. Liberar espaço em `C:` (88%) é risco operacional independente.

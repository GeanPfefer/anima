# 2026-10-14 — Diagnóstico de `memory.durability`: o que sobrevive à perda da máquina

Somente leitura. Nenhum código, migration, dump, restore, push, work item,
attempt, lease ou provider foi tocado. Nenhum conteúdo de memória, segredo ou
valor de credencial foi copiado: só contagens, nomes de variáveis e hashes
públicos já versionados. US$0.

Estado de partida: `dev = origin/dev = b6d2dda`, `origin/main = 99bec54`,
ledger 156 migrations (`20261010000001`), `work_events` seq máx 86721,
0 claims/leases vigentes.

## Veredito curto

| Pergunta | Resposta |
|---|---|
| Código vigente sobrevive? | **Sim**, em `origin/dev` (GitHub). Ressalvas abaixo (60 commits e 253 itens só locais). |
| História de provas do self-dev sobrevive? | **Parcialmente**: 33 MUST + archival refs (21) remotas; 60 commits ainda só locais. |
| **Memória, identidade e ledger sobrevivem?** | **Não.** Existe **uma única cópia**: o volume Docker `supabase_db_anima`. Zero backup existente. |
| Segredos/credenciais sobrevivem? | **Não.** Só em `.env.local` e `supabase/.env`, ambos fora do Git, uma cópia. |
| Há prova de restauração? | **Sim, parcial**: V0.1 (2026-09-28) provou o *procedimento* numa instância descartável da mesma máquina. Artefatos destruídos; nunca repetida; nunca em outro nó. |
| RPO atual | **Ilimitado** (desde a criação do banco, 2026-07-27). Nenhum artefato de banco existe hoje. |
| RTO atual | **Desconhecido.** Nunca medido em outra máquina. |

Persistência em disco ≠ backup independente. Hoje há persistência, não backup.

## 1. Mapa de estado e armazenamento

### 1.1 Estado essencial (insubstituível)

| Estado | Onde vive | Volume (contagens) | Cópia fora do volume |
|---|---|---|---|
| Identidade, perfis, pilares, hipóteses de identidade | Postgres `public` (`profiles` 34, `user_pillars` 88, `identity_hypotheses` 24, `identity_evidence` 97, `semantic_entities` 42, `entity_mentions` 5) | pequeno | **Nenhuma** |
| Memória narrativa/conversas | `ai_conversations` 394, `conversation_sessions` 50, `notes` 19, `insights` 2, `entry_embeddings` 26 | pequeno | **Nenhuma** |
| Diário, quests, progresso | `quests` 6, `xp_records` 26, `life_events` 0 | pequeno | **Nenhuma** |
| Contas e autenticação (hash de senha, identities) | `auth.users` 25 (GoTrue) | pequeno | **Nenhuma** |
| Ledger: work items, eventos, claims, evidências, checkpoints | `work_items` 206, `work_events` 3192 (seq 86721, desde 2026-07-27), `work_claims` 184, `work_contexts` 211, `work_*` demais | ~5,5 MB só `work_events` | **Nenhuma** (checkpoints Git têm SHA no ledger, ver 1.3) |
| Autoridades e orçamento pago | `paid_compute_authorizations` 45, `paid_compute_budget_events` 96 | pequeno | **Nenhuma** |
| Histórico de migrations aplicadas | `supabase_migrations.schema_migrations` 156 | — | Parcial: arquivos em Git; *quais foram aplicadas* só no banco |
| Segredos | `apps/web/.env.local` (≈45 variáveis: chaves Supabase, OpenAI, RunPod, SSH RunPod, credenciais do host residente e do system writer), `supabase/.env` (raiz JWT local) | — | **Nenhuma** (gitignored) |

Banco total: **68 MB**. Storage: 0 buckets, 0 objetos. Vault: 0 segredos.
Extensões relevantes: `vector`, `pgcrypto`, `pg_net`.
Observação: a V0.1 media 124 work items e 1733 eventos; hoje 206 e 3192. O
estado cresceu ~65% sem nenhum backup.

### 1.2 Estado em Git (parcialmente protegido)

- Remoto único: GitHub `GeanPfefer/anima`. Sem segundo remoto, sem bundle.
- 40 branches remotas; 225 locais; 46 worktrees registradas.
- **60 commits alcançáveis só por refs locais** (inclui I1, I1b, I2b, P2b de 2026-10-13/14 e 21 non-MUST históricos já classificados).
- **253 entradas untracked** (inclui `docs/planos/009–067` quase todos, `docs/registros/2026-10-0x-*`, `docs/operacao/`, `apps/web/scripts/_session/` com evidências brutas de INV, `.worktrees/`) e 10 arquivos modificados (WIPs de migrations/testes/AGENTS/PRD). Isso é **planejamento append-only e evidência que não existe em lugar nenhum além deste disco**.
- 20 tags anotadas `archive/anima/*` + 1 branch Prisma no remoto (verificado por `ls-remote`: 20 peeled).

### 1.3 Estado reconstruível

| Item | Como reconstruir | Custo |
|---|---|---|
| Imagens Docker (22,7 GB, pinadas) | `supabase start` + pull | rede |
| `node_modules`, `.next`, builds | `npm ci` | rede |
| Modelos Ollama | `ollama pull` | rede/tempo |
| Worktrees de attempts | recriáveis se o commit existe; **não** se o commit é só local | variável |
| Logs na raiz (`*.log`) | efêmeros | — |
| `entry_embeddings` | recálculo (script de backfill) | pago se OpenAI |
| Schema | migrations em Git + pacote `supabase/bootstrap/` (offline, **NO-GO, nunca exercitado em Postgres**) | — |

### 1.4 Estado de executores (fora do Git, fora do banco)

Codex CLI (`~/.codex`, autenticação), Ollama (modelos, `OLLAMA_HOST` em registro do Windows, `set-ollama-host.reg` gitignored), runner local (`ANIMA_LOCAL_*`), RunPod (chave de API; autoridade `3b87224f` está no banco). Credenciais de executor: re-autenticáveis por humano, **não documentadas como procedimento de recuperação**. Container de terceiros `open-webui` compartilha o Docker: fora do escopo do Anima.

## 2. Durabilidade atual — fatos medidos

| Fato | Medição |
|---|---|
| Localização física do banco | `/var/lib/docker/volumes/supabase_db_anima` dentro de `docker_data.vhdx` (39,8 GB) em `C:\Users\…\Docker\wsl\disk`, disco **KINGSTON SNVS500G (500 GB)**, o mesmo do SO; **88% cheio, 58 GB livres** |
| Repositório Git | `G:` em outro disco físico (CT2000P2SSD8, 2 TB). Isso protege contra falha de *um* SSD, **não** contra perda da máquina |
| WAL archiving | `archive_mode=off`, `archive_command` desabilitado; `wal_level=logical`; 0 réplicas, 0 consumidores de slot de arquivamento |
| Política de restart do container | `unless-stopped` (disponibilidade, não durabilidade) |
| Backup do Windows | `fhsvc` (File History) **parado**; sem tarefa de backup do Anima; tarefas `Backup*` são do sistema; shadow copies: consulta falhou (**não verificado**); OneDrive/sincronizador: **não verificado** |
| Artefatos de dump existentes | **Nenhum** (V0/V0.1 destruídos de propósito; manifesto V0 marca `NOT DURABLE BACKUP`, `encrypted:false`) |
| Integridade do repositório local | `git fsck`: o commit-graph referencia o objeto `ce0e8cb60a15…` que **não pode ser lido** do banco de objetos; 32 `.idx` sem `.pack`; 5 `tmp_obj_*` órfãos. Não corrigido (fora de autoridade); investigar antes de gerar bundle |
| Monitoramento | container `supabase_vector_anima` em loop de restart (coletor de logs; sem impacto no banco, mas sem alarme de ninguém) |

### Pontos únicos de falha

1. SSD `C:` (Docker VHDX) → perde memória, identidade, ledger.
2. A máquina inteira (roubo, incêndio, PSU, ransomware) → perde banco, segredos, untracked e commits locais.
3. `.env.local` / `supabase/.env` sem cópia → mesmo com dump restaurado, falta a chave RunPod/OpenAI e a identidade residente; JWT local pode ser regenerado, as credenciais pagas não.
4. Corrupção do VHDX por falha no host Docker/WSL (já houve VHDX de 39 GB crescendo sem monitoração).
5. Conhecimento do procedimento só em registros e em memória de agente.
6. Operador único e sem alarme: nenhuma capacidade do sistema detecta "dados sem cópia".
7. Modelo de ameaça de "corrupção silenciosa replicada": hoje inexiste réplica para detectar, e um backup futuro sem verificação não resolveria.

## 3. Matriz de riscos de perda

Prob.: B/M/A. Impacto: 1 (reconstruível) a 5 (identidade perdida).

| # | Cenário | Prob. | Impacto | Perde | Proteção hoje |
|---|---|---|---|---|---|
| R1 | Falha/corrupção do SSD `C:` ou do VHDX | M | 5 | Todo o banco | Nenhuma |
| R2 | Perda total da máquina (roubo, fogo, ransomware) | B–M | 5 | Banco, segredos, untracked, 60 commits | Só `origin/dev` |
| R3 | `docker system prune --volumes` / `supabase stop` sem `--backup` / `db reset` por engano | M | 5 | Banco | Regra textual (checkpoint humano), sem barreira técnica |
| R4 | Perda de `.env.local`/`supabase/.env` | M | 4 | Credenciais pagas, identidade residente | Nenhuma |
| R5 | `git clean`/prune de worktrees/branches locais | M | 3–4 | 60 commits locais, 253 untracked | Parcial (archival refs só dos MUST) |
| R6 | Corrupção lógica silenciosa do ledger (bug/migration ruim) | B | 5 | Integridade histórica | Digest do ledger só em prova pontual (V0.1) |
| R7 | Disco `C:` cheio (88%) trava Docker/Postgres | M | 3 | Disponibilidade, risco de corrupção | Nenhuma |
| R8 | Restauração falha por drift (ACL/trigger de `auth`) | M | 4 | RTO imprevisível | Procedimento V0.1 manual, passos conhecidos |
| R9 | Versão de Supabase CLI/Postgres/GoTrue diferente no novo nó | M | 3 | Restore incompatível | Versões pinadas em manifesto (V0) |
| R10 | Backup futuro em plaintext vaza memória pessoal | M | 5 | Privacidade | Nenhuma política ainda |
| R11 | Chave de criptografia do backup perdida | B | 5 | Backup inutilizável | N/A (não existe) |
| R12 | Git local com objeto ausente (`ce0e8cb`) propaga ao bundle | B | 2 | Cópia incompleta de história | Não detectado até hoje |

## 4. Evidências existentes e lacunas

### Existe

| Evidência | Fonte | Alcance |
|---|---|---|
| Restore com equivalência de dados **e** segurança (12/12 digests, 92 SECURITY DEFINER, restart) | `2026-09-28-operational-durability-backup-restore-v0-1.md` | Schema v143, instância descartável **na mesma máquina**, dump plaintext destruído |
| Causa-raiz da falha V0 (default privileges, trigger `auth.users`) | idem | Procedimento reprodutível |
| Ferramentas read-only de prova | `supabase/restore-proof/{security-projection.sql,data-snapshot.sql,digest.sh}` | Ainda no repo |
| Historical Code Durable (refs arquivais) | `2026-09-28-historical-durability-v1.md` | 33 MUST remotos |
| Pacote de bootstrap offline de schema | `supabase/bootstrap/` (272 fontes, hashes, `verify_sources.py`) | **Sem prova em Postgres**; GO condicionado/NO-GO |
| Princípio e meta | `capability-registry.ts` (`memory.durability`, maturidade `projected`) | Definição não é prova |

### Lacunas (nada disto tem evidência)

1. Qualquer backup de banco que exista **após** a V0.1; restore em schema 156.
2. Backup criptografado, versionado, com retenção.
3. Cópia fora da máquina (banco, segredos, untracked, commits locais).
4. Restore em **outra máquina**; RTO medido.
5. Login real de usuário restaurado (hash de senha) e recuperação do residente (modo read-only de probe do host: **ausente**, DEFERRED).
6. PITR: inexistente (sem WAL archiving).
7. Recuperação de segredos/executores.
8. Verificação automática periódica (nenhum agendamento).
9. `git bundle` offline (declarado "futuro" em 2026-09-28).
10. Integridade do Git local (item `ce0e8cb`).

Mapa para o `memory.durability` do registro: hoje cobre apenas "push como processo humano". Os três níveis do registro de 2026-09-28 (Code, Historical, **Operational**) são a decomposição correta: **Operational Durable não foi iniciado.** Esta investigação recomenda que o registro de capacidade seja reescrito para separar Backup, Recovery e HA (proposta, não alterada aqui).

## 5. Análise de recuperação

Suposição: máquina atual perdida; novo nó Windows ou Linux com Docker.

| Etapa | Possível hoje? | Depende de |
|---|---|---|
| Código | Sim (`git clone`), menos os 60 commits e 253 untracked | GitHub |
| Schema | Sim, via migrations; pacote offline não provado | Supabase CLI 2.105 / imagens pinadas |
| Dados (memória, identidade, ledger) | **Não — não há dump** | Backup que não existe |
| Segurança (ACL/trigger) | Procedimento conhecido (V0.1), manual, 7 passos | Scripts em `supabase/restore-proof` |
| Segredos | **Não** | Cópia humana fora da máquina |
| Executores | Reinstalação manual | Contas humanas |
| Retomar o host residente | Bloqueado: grava ao subir, sem modo probe | Unidade nova |

- **RPO**: ilimitado hoje. Com dump diário logicamente suficiente: ≤24 h. Para ≤minutos exigiria WAL archiving (PITR), que é capacidade distinta e provavelmente desproporcional a 68 MB.
- **RTO**: desconhecido. A V0.1 mostrou restore de ~2 s e subida de 31 s numa máquina com tudo pronto; isso **não** estima um nó novo (instalar Docker, baixar 22 GB, reconfigurar segredos).
- **PITR**: impossível sem `archive_mode`. A imagem Supabase suporta WAL-G, segundo a documentação do Supabase (a verificar no pinned `15.8.1.085`).
- **Integridade/versionamento dos backups**: a V0.1 deixou o *gate* (digests + contagens + âncora do ledger), mas não há repositório de backups versionado.
- **Dependências de chave**: senha de restauração do repositório criptografado (a criar), segredos de `.env.local`, e chave JWT local (regenerável).

Não se afirma que a recuperação funcione fora da máquina: **não há evidência**.

## 6. Referências externas e comparativo

Pesquisa web (standard) foi rasa em verificação de restore; a coluna de verificação abaixo mistura o que as fontes disseram com conhecimento prévio e está marcada para confirmação na documentação oficial antes de decidir.

| Ferramenta | Papel | Confiabilidade | Simplicidade p/ Windows+Docker | Custo | Observação |
|---|---|---|---|---|---|
| `supabase db dump` + `psql` (já provado) | Backup lógico | Alta p/ 68 MB; sem PITR | **Alta** (já usado) | 0 | Base do procedimento V0.1 |
| **restic** | Repositório criptografado, deduplicado, versionado; destino local, SFTP, S3/B2, rclone | Alta, mantido; pré-1.0 | **Alta** (binário estático Windows) | 0 + armazenamento | Candidata principal; `restic check` (confirmar) |
| Kopia | Idem restic, com GUI e mais rápido na carga inicial | Boa; pré-1.0 | Média | 0 | Alternativa equivalente |
| BorgBackup | Idem, muito eficiente | Alta; 1.x | **Baixa no Windows** (precisa WSL/servidor) | 0 | Descartar por plataforma |
| age / rage | Criptografar arquivo isolado | Alta, simples | Alta | 0 | Útil para segredos/dumps pontuais |
| `git bundle` / segundo remoto | Redundância do histórico Git (inclusive commits locais) | Alta | Alta | 0 | Falta resolver `ce0e8cb` |
| rclone | Transporte para S3/B2/Drive/SFTP, com `crypt` | Alta | Alta | 0 + armazenamento | Complemento do restic |
| WAL-G | PITR via archive_command; simples em nuvem | Boa | Média (altera imagem/config do banco) | 0 + armazenamento | Apenas se RPO em minutos for exigido; documentado pelo Supabase |
| pgBackRest | PITR, verificação nativa, mais maduro | Alta | Baixa (binário no container, config) | 0 | Uma fonte afirma risco de manutenção em abr/2026, **não corroborado**: confirmar antes de adotar |
| pg_basebackup | Backup físico | Alta | Média | 0 | Sem ganho sobre dump a 68 MB |
| Barman | Gestão corporativa | Alta | Baixa | 0 | Excessivo |
| Supabase cloud/PITR gerenciado | HA/backup gerenciado | Alta | Alta | Pago | Muda arquitetura "local-first"; fora de escopo |

Reuse before build: **nenhum código novo de backup é justificado**. A menor composição é `supabase db dump` (provado) → `restic` (criptografia, versão, retenção, check) → destino independente (disco externo e/ou S3/B2 via rclone), mais `git bundle`. O que precisa ser escrito é só a cola e o *gate* de restauração (já existe em `supabase/restore-proof`).

Fontes consultadas: [comparação restic/borg/kopia](https://wz-it.com/en/blog/restic-borg-kopia-backup-comparison/), [pgBackRest vs Barman vs WAL-G](https://www.kunalganglani.com/blog/postgresql-backup-tools-compared.md), [Supabase: Database backups](https://supabase.com/features/database-backups), [backup de Supabase self-hosted](https://simplebackups.com/blog/backup-self-hosted-supabase).

## 7. Não verificado nesta investigação

- Shadow copies / histórico do Windows (consulta WMI falhou).
- Sincronizadores em nuvem (OneDrive/Dropbox) cobrindo `G:` ou perfil.
- Conteúdo de `~/.codex` além da existência; estado do WSL Ubuntu (parado).
- Existência de cópias manuais fora da máquina feitas por humano e não registradas.
- Se `ce0e8cb` é alcançável por alguma ref ou só pelo commit-graph.

# 069 — E-0: preflight no disco G: e procedimento (NÃO EXECUTADO)

> **Atualizado por `070-d1-preparacao-e0-v2.md`**: o procedimento vigente é o da seção 6 do 070; os bloqueios 2.1 (1, 2 e 4) foram diagnosticados lá. Este documento fica como histórico do preflight.

Preparação. Nada foi criado, instalado, dumpado, restaurado ou alterado.
Continua o plano `068-memory-durability-roadmap.md` (degraus D1 e D3 parciais).
Origem: diagnóstico `docs/registros/2026-10-14-memory-durability-diagnostico.md`.

Medições de 2026-10-14, `dev = origin/dev = b6d2dda`, 156 migrations.

## 1. Destino em G:

| Item | Medição |
|---|---|
| Espaço livre | **475 GB** de 1,86 TB (NTFS, disco físico CT2000P2SSD8, distinto do SO) |
| Necessário (estimado) | dumps ≈ 10–20 MB; repositório restic ≈ <20 MB; scratch ≈ 100 MB; o Supabase descartável vive **no VHDX do Docker em C:** (≈1–2 GB, 58 GB livres) |
| Permissões da raiz `G:\` | `Usuários autenticados: Modificar` herdado. **Qualquer conta local leria/alteraria o que for criado.** O repositório é criptografado, mas o scratch tem plaintext: exige ACL restrita (ver 1.2) |
| Sincronização externa | Processo `OneDrive.Sync.Service` ativo, mas a única raiz é `C:\Users\GeanTeco\OneDrive` (pastas conhecidas Desktop/Documentos/Imagens ainda em `C:\Users\GeanTeco\*`). **Nada de `G:` é sincronizado.** Tailscale presente, sem compartilhamento de pasta verificado |
| Fora de `G:\anima` | Sim: destino proposto é irmão de `G:\anima` |
| Afeta WIPs/worktrees? | Não. `G:\anima`, `G:\anima-*` e `.worktrees` não são tocados; o Git do projeto fica intacto |
| Já existente no G: raiz | `anima-backup-presecret.bundle` (648 KB, 2026-06-17): `git bundle verify` OK, 5 heads, histórico antigo. Não é backup do banco. **Não mexer.** |
| Antivírus | Proteção em tempo real ligada; exclusões não consultáveis (sem admin). Pode atrasar, não bloquear |

### 1.1 Estrutura recomendada (não criar ainda)

```text
G:\anima-durability\
  restic-repo\          repositório criptografado (único artefato durável do E-0)
  scratch\e0-<UTC>\     dumps plaintext, cópia restaurada do restic, projeto Supabase descartável
                        (apagado no passo 10)
  evidence\e0-<UTC>\    somente digests, contagens, versões, hashes, logs sem conteúdo
```

### 1.2 ACL (ato humano, ao criar)

`icacls G:\anima-durability /inheritance:r /grant:r "%USERNAME%:(OI)(CI)F" "SYSTEM:(OI)(CI)F"`
(remove o acesso de “Usuários autenticados”). Não executado.

### 1.3 Limite que o E-0 não resolve

G: está **na mesma máquina**. O E-0 prova backup + restauração + criptografia,
**não** sobrevivência à perda da máquina. Isso continua sendo D2.

## 2. Ferramentas

| Ferramenta | Instalada | Versão | Compatibilidade |
|---|---|---|---|
| Supabase CLI | Sim (npm, `supabase.ps1`; funciona no bash) | **2.105.0** | Igual ao manifesto V0 |
| Docker | Sim | **29.8.2** (V0 usou 29.8.0) | Deriva de patch; aceitável, registrar |
| Postgres no container vivo | Sim | **15.8**; `pg_dump 15.8` dentro do container | Igual ao servidor; não há `psql`/`pg_dump` no host (usar `docker exec -i`) |
| Imagens | Sim | `postgres:15.8.1.085`, `gotrue:v2.189.0` | Idênticas às da V0.1 |
| `restic` | **Não** | disponível via `winget`: `restic.restic` **0.19.1** | Instalação é pré-requisito (autorização futura) |
| `age`, `rclone` | Não | — | Não necessários no E-0 |
| `sha256sum`, `sort`, `awk` | Sim (Git bash) | — | Usados por `digest.sh` |
| `supabase/restore-proof/` | Sim, versionado (`0b05166`), sem modificações locais | `digest.sh`, `security-projection.sql`, `data-snapshot.sql`; `*.sh` com LF forçado por `.gitattributes` | Usáveis, com as lacunas abaixo |
| Python | Só stub do WindowsApps (há Python311 no PATH) | — | Não necessário |

Comandos de dump (os 5 da V0, nomes de saída novos):
`supabase db dump --local [--role-only | --data-only --use-copy | --schema supabase_migrations ...] -f <arquivo>`.

### 2.1 Lacunas encontradas nas ferramentas de prova (precisam de correção antes da execução)

1. **`data-snapshot.sql` não cobre a memória.** Cobre auth e o ledger de trabalho; não há digest de `ai_conversations`, `notes`, `profiles`, `user_pillars`, `identity_*`, `semantic_entities`, `quests`, `xp_records`, `entry_embeddings`. Sem isso o E-0 não prova “identidade e memória recuperadas”. Especificação (unidade nova, só leitura): para cada tabela base de `public`/`private`, emitir `tabela=contagem:sha256(string_agg(to_jsonb(row)::text ORDER BY pk))`, sem imprimir linhas.
2. **Novo papel Postgres.** A migration `20260928000003_trusted_system_writer.sql` faz `CREATE ROLE anima_system_writer NOLOGIN NOINHERIT` e usa `auth.users.role = 'anima_system_writer'`. Em V0.1 o `roles.sql` tinha 297 bytes (só papéis padrão). **É preciso verificar se o dump de schema/roles reproduz o papel**; acrescentar uma projeção de papéis/membros ao digest. Se não reproduzir, o restore produzirá um writer sem papel e a identidade de sistema não voltará (caso de parada).
3. **Re-varredura de objetos em schemas gerenciados.** Das 17 migrations posteriores a 20260927, só `20260928000003` toca `auth` (via FK/dado, não novo trigger); nenhuma altera default privileges, storage ou realtime. Conferir de novo no dia da execução.
4. **Linha de claims.** `work_claims` com `released_at IS NULL`: 1 linha. O relatório anterior dizia “0 claims vigentes”. Usar a definição canônica de “vigente” do ledger e confirmar no gate PRE; não executar enquanto houver claim/lease realmente ativo.
5. `data-snapshot.sql` exige o e-mail residente (`-v email=…`) vindo de `.env.local`: o script deve lê-lo sem imprimir.

## 3. Fluxo seguro da senha do restic

Premissas: a senha nunca passa pelo chat, por scripts versionados, por argumentos
de processo ou por arquivo plaintext.

1. **Geração e guarda pelo humano**: gerar ≥ 24 caracteres aleatórios no gerenciador de senhas do humano. Nunca em Claude/ChatGPT/Codex.
2. **Execução no terminal do humano**, fora do app do Claude (PowerShell/Terminal próprio). Não usar `run_in_terminal` do Claude para digitar a senha, para que o segredo não passe pela sessão do modelo.
3. **Entrada interativa**: o restic pede a senha em prompt oculto quando o stdin é um terminal (`init` pede duas vezes; `backup`, `check`, `restore` pedem uma a cada comando — ≈ 4 vezes). Sem `RESTIC_PASSWORD`, sem `--password-file`, sem `--password-command`.
   *Fallback aceitável, se digitar quatro vezes for inviável*: script `Read-Host -AsSecureString` que define `RESTIC_PASSWORD` **só no processo filho**, remove-o em `finally` e nunca o escreve. Risco residual: variável visível a processos do mesmo usuário durante a execução.
4. **Os scripts do Claude/Codex nunca recebem a senha**; eles preparam os dumps e verificam os hashes; o humano executa as linhas `restic`.
5. **Recuperação após perda da máquina**: (a) a senha mora no gerenciador de senhas do humano (com sincronização própria) e em cópia offline em outro local físico; (b) após o `init`, o humano adiciona uma **segunda chave** (`restic key add`, senha independente) para guardar separadamente; (c) *sem a senha o repositório é irrecuperável por desenho*. (d) A prova de que a recuperação funciona só existe em D2/D5, a partir de **outra** máquina. No E-0 isso fica explicitamente **não provado**.
6. Verificações de higiene: histórico do PowerShell (`PSReadLine`) não deve conter a senha — o prompt oculto não a grava; conferir após a execução. Logs de evidência não registram o prompt.

Pendente de confirmação após instalar o restic: comportamento exato do prompt (confirmar que o processo não grava a senha), `restic check --read-data` e `restic key add` na versão 0.19.1.

## 4. Procedimento E-0 (não executado)

Convenções: `E=G:\anima-durability`, `RUN=e0-<UTC>`. Tudo roda da raiz do repo; o Claude pode preparar e conferir, o humano digita as linhas marcadas **[H]**.

**Passo 0 — Gate de entrada** (sem efeito): HEAD e `git status` registrados; Docker saudável; só `supabase_db_anima` + `open-webui` como volumes; versões iguais ao item 2; RAM livre ≥ 4 GB; nenhum Resident Host/`next dev`/attempt rodando; 0 claims/leases vigentes (definição canônica); nenhuma conexão não ociosa no banco; portas 56320–56324 livres.

**Passo 1 — Digests PRE** (leitura): `digest.sh` → 12 projeções; `data-snapshot.sql` + o novo snapshot de memória (2.1) + projeção de papéis; âncora do ledger (seq, id, digest). Saída só com hashes em `evidence\`; `.rows` ficam em `scratch\` e são apagados no fim.

**Passo 2 — Dump lógico** (leitura sobre o vivo): os 5 dumps da V0.1 para `scratch\`; depois digests POST; exigir PRE == POST (senão repetir e investigar escrita concorrente). Registrar bytes e SHA-256 de cada arquivo.

**Passo 3 — Repositório [H]**: criar `G:\anima-durability` com a ACL do item 1.2; `restic init --repo G:\anima-durability\restic-repo` (prompt); `restic key add` (segunda chave).

**Passo 4 — Backup [H]**: `restic backup --tag e0 --repo … scratch\<RUN>\dumps evidence\<RUN>\pre-manifest`.

**Passo 5 — Integridade com leitura real [H]**: `restic check --read-data` (≈ dezenas de MB, imediato) e `restic snapshots`.

**Passo 6 — Restore do repositório [H]**: `restic restore latest --target scratch\<RUN>\from-restic`; comparar SHA-256 dos 5 arquivos restaurados com os originais do passo 2. Divergência = parada. Só depois apagar os dumps originais; **o restore de banco usa apenas as cópias vindas do restic**, de modo que o repositório é quem é testado.

**Passo 7 — Banco descartável isolado**: projeto novo em `scratch\<RUN>\proj` com `project_id = anima-restore-proof-e0`, portas 56320–56324, volume próprio; se a RAM livre ficar < 2,5 GB, desligar serviços não essenciais (`studio`, `analytics`/`vector`, `imgproxy`, `inbucket`); manter GoTrue (cria o schema `auth`). Nenhuma configuração do projeto vivo é editada; nenhum processo ANIMA aponta para o alvo.
   a. `digest.sh` no alvo virgem → defaults (esperado igual ao vivo no dado de V0.1: `f5ea13c7…`).
   b. Neutralizar os defaults de `postgres`/`public` (3 `ALTER DEFAULT PRIVILEGES … REVOKE ALL`), derivados do alvo observado.
   c. Restore numa transação: `roles → schema → SET session_replication_role = replica → data` com `ON_ERROR_STOP`; depois o histórico de migrations.
   d. Aplicar só o `CREATE TRIGGER on_auth_user_created` extraído de `20260528000001` (SHA-256 do trecho `c30eea44…`).
   e. Verificar o papel `anima_system_writer` e `auth.users.role`.

**Passo 8 — Comparação**: 12/12 digests de segurança, snapshot de dados, snapshot de memória, âncora do ledger (seq 86721 salvo se o vivo tiver mudado por motivo explicado), projeção de papéis. Reiniciar **só o alvo** e repetir. Expectativa: 0 linhas de diferença.

**Passo 9 — Banco residente intacto**: digests e snapshots do vivo novamente == PRE; `supabase_db_anima` não reiniciou; nenhum evento novo no ledger além dos explicados; volumes = os mesmos de antes.

**Passo 10 — Encerramento**: `supabase stop --no-backup` do alvo; remover o volume `supabase_db_anima-restore-proof-e0` (confirmando o nome exato antes); apagar `scratch\<RUN>` (dumps, `.rows`, cópias restauradas, projeto); conferir que só `restic-repo` e `evidence` permanecem; registrar o **risco residual** (4.1).

**Passo 11 — Registro**: `docs/registros/…-e0-…md` com versões, tamanhos, hashes, resultados e as lacunas não provadas. Sem linhas, sem segredos, sem a senha.

### 4.1 Risco residual a documentar

- Apagar arquivos no NTFS/SSD **não é apagamento seguro**; blocos do plaintext podem permanecer em G: até serem reescritos (TRIM ajuda, não garante).
- O volume do alvo descartável fica no `docker_data.vhdx` em C:; apagar o volume não zera os blocos do VHDX.
- Dumps passam por `pagefile.sys` e cache de memória; antivírus em tempo real pode ler os arquivos.
- O `restic-repo` está na mesma máquina que o banco (item 1.3).
- Chave única de recuperação = senha do humano.
- Nenhuma shadow copy foi verificável; não se sabe se há cópias automáticas de `G:`.

## 5. Condições de parada (qualquer uma encerra, sem “consertar”)

1. HEAD diferente de `b6d2dda` sem explicação, ou `git status` alterado durante o E-0.
2. Claim, lease, attempt, host residente ou conexão ativa no banco vivo.
3. PRE ≠ POST nos dumps, ou digests mudam durante o procedimento.
4. RAM livre < 2,5 GB com os serviços mínimos, ou `C:` < 10 GB livres, ou G: < 20 GB.
5. Versões de CLI/imagens diferentes das do item 2 (exceto a deriva de patch do Docker, registrada).
6. Qualquer ERROR no restore (os 472 WARNING de GRANT em funções da extensão `vector` são esperados).
7. SHA-256 restaurado ≠ original, `restic check` com erro, ou o papel `anima_system_writer` ausente no alvo.
8. Qualquer sinal de que a senha apareceu em argumento, log, chat ou arquivo.
9. O `supabase start` do alvo tocar o stack `anima` (nome de projeto, portas ou volume coincidentes).
10. Reinício, unhealthy ou aumento de latência no container vivo.

## 6. Investigação Git (somente leitura)

| Achado | Medição |
|---|---|
| `ce0e8cb60a15…` | Não é objeto nem commit alcançável: `cat-file` falha; nenhuma ref, reflog ou worktree o contém; `--contains` vazio. Aparece apenas no **commit-graph** |
| Commit-graph | Cadeia de 2 camadas (`graph-79c1e56…` de 2026-09-08 e `graph-4cfb326…` de 2026-10-06). Entrada obsoleta de um commit inalcançável já podado |
| Integridade real | `git -c core.commitGraph=false fsck --connectivity-only` **sem erros** (1,5 s); `rev-list --all` = 994 commits com e sem grafo |
| Índices sem pack | 35 `.idx`, 3 `.pack` ⇒ 32 `.idx` órfãos (datas de 2026-06-17 a 2026-10); `tmp_obj_*` órfãos de 2026-08-26 a 2026-10-07 (5) |
| Commits só-locais | **60** com e sem commit-graph (consistente); 329 refs; 0 worktrees prunable |
| Estado | `git status` e `HEAD` inalterados (`b6d2dda`); 0 stash |

Conclusão: o repositório está **conectado e íntegro nas refs**; o defeito é
metadado derivado (commit-graph). Risco para o D2: `git bundle` com grafo
corrompido. Mitigação sem reparo: gerar o bundle com
`git -c core.commitGraph=false bundle create …`. Reparo (recriar/remover o grafo,
remover `.idx` órfãos) é ato separado e autorizado, fora do E-0.

## 7. GO / NO-GO

**GO condicionado** para a execução do E-0, **após**:

1. Autorização explícita para instalar o `restic` (`winget`, versão 0.19.1) e criar `G:\anima-durability`.
2. Correção das lacunas 2.1 (1, 2 e 4 são bloqueantes; 3 e 5 são conferências).
3. Gate de entrada do Passo 0 verde no dia (RAM é o ponto mais apertado: 4,9 GB livres de 15,9 hoje).
4. O humano aceitar o risco residual 4.1 e a limitação 1.3.

**NO-GO se**: não houver como provar a memória (lacuna 1), o papel `anima_system_writer` não reaparecer, ou houver claim/lease vigente.

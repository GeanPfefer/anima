# E-0 — limpeza controlada concluída (RUN e0-20261014T193034Z)

- **Data:** 2026-10-14 · **Tipo:** operação (limpeza), append-only; complementa [a prova](2026-10-14-e0-restauracao-isolada-comprovada.md). Separado do ledger de self-dev.
- **Branch/HEAD:** dev, `f7c629aa` (= `origin/dev`), inalterado. Sem commits, push, migrations, mudanças no ledger, work items ou outros projetos Docker.
- **Autorização:** humana, em chat, restrita ao inventário aprovado.

## Pré-condições verificadas

Residente healthy, StartedAt `18:12:31Z`, 0 restarts, 156 migrations, seq 86765, quiescence-gate PASS (0 claims/leases vigentes; stale histórica `85000000:2026-07-27` preservada). Snapshot restic `77b180ce` presente (metadados) e 2 chaves no repositório (sem acessar senhas). Evidência completa: `pre`, `post`, `pre-recheck`, `target-run1`, `target-run2`, `resident-final` (5 arquivos cada) e `dumps.sha256`. Alvo com volume e rede distintos do residente. Nenhum reparse point em `scratch\<RUN>`; caminho canônico conferido.

## Executado

1. `supabase stop --no-backup --workdir <scratch\RUN\target>` (documentado: apaga os volumes de dados após parar, sem backup do alvo). Apenas o projeto `anima-restore-proof-e0`.
2. Inspeção posterior por rótulo `com.supabase.cli.project=anima-restore-proof-e0` e por nome: **0** containers, volumes e redes restantes; o CLI removeu tudo, então nenhuma remoção manual foi necessária. Sem `prune`, sem filtros amplos.
3. Removido `G:\anima-durability\scratch\e0-20261014T193034Z` (dumps, cópias restauradas, `.rows`/`.raw`, projeto do alvo). A primeira tentativa foi bloqueada pela proteção da ferramenta (comando combinado com `cd G:\anima`) antes de apagar qualquer coisa; repetida isoladamente com as mesmas verificações.

## Removidos

Containers `supabase_{db,auth,rest,kong,realtime}_anima-restore-proof-e0`; volume `supabase_db_anima-restore-proof-e0`; rede `supabase_network_anima-restore-proof-e0`; diretório scratch do RUN. Imagens não tocadas (compartilhadas).

## Preservados e verificados no final

- Residente: healthy, mesmo StartedAt, 0 restarts, seq 86765, PRE intacto; 0 claims/leases vigentes; mesma stale.
- Volumes: `open-webui`, `supabase_db_anima`; rede `supabase_network_anima`.
- `restic-repo`: 7 arquivos, snapshot `77b180ce` presente, 2 chaves.
- `evidence\e0-20261014T193034Z`: 46 arquivos; `evidence\d1b` e `prep-d1` intactos.
- `scratch\draft`: 6 arquivos, intocado.
- Git: HEAD `f7c629aa`; `git status` idêntico ao anterior à limpeza (WIPs preservados).

## Riscos residuais e pendências

- Apagar no NTFS/SSD e remover o volume no `docker_data.vhdx` **não** é apagamento seguro: blocos de plaintext podem persistir até serem reescritos; pagefile/antivírus podem ter lido os dumps. Nada foi prometido além da remoção lógica.
- Backup só local: `restic-repo` na mesma máquina; sem off-site, sem failover, sem restauração em outra máquina; recuperação depende da senha do humano.
- 14 órfãs de FK (profiles 9, work_contexts 5) seguem como dívida de integridade aberta.
- Este registro e o da prova estão **sem commit** (não autorizado).

## Veredito

E-0 operacionalmente encerrado: prova registrada, recursos descartáveis removidos, repositório e evidências preservados, residente inalterado.

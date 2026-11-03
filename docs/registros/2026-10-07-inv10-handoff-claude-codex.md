# INV-10 — Handoff Claude → Codex (estado em 2026-10-07 ~23:50Z)

Registro de continuidade. Não é prova nem conclusão da INV-10: **nenhum work item INV-10 foi criado, aprovado ou executado**.

## 1. Git
- `dev` = `origin/dev` = `5391073fabeeaea6a49a598acf79f3600d26e41f`; `origin/main` = `99bec54e3ab42bfe882a8686cd1385d8058b916e` (intacta). Nenhum commit/push nesta sessão.
- WIPs tracked preservados (não tocar): `anima-prd.md`, `docs/planos/008-primeira-prova-trusted-produce-change-backlog.md`.
- Untracked preexistentes preservados: `docs/planos/009–039`, `.tmp/`, `.worktrees/`, `%SystemDrive%/`, `apps/web/scripts/_session/*` (pré-existentes), logs na raiz.
- Arquivos criados nesta sessão (untracked): `docs/planos/040-inv10-total-capability-audit-backlog.md` (6 perguntas completas, metodologia, limitações, consolidação); este registro; `apps/web/scripts/_session/inv10-{preflight,budget,queue-dryrun,runtime}-readonly.ts` (somente SELECT/leitura).

## 2. Banco e serviços
- Docker Desktop iniciado; Supabase local de pé (REST 54321 = 200). Nenhuma migration, nenhum `db reset`.
- `anima status`: identidade residente ok; autonomia habilitada; 35 itens retomáveis (blocked 1, changes_requested 18, approved 6, proposed 8, review 2). Total `work_items`: 147.
- Último evento: `seq 86333 integration_completed` (item `b521fbcd`, `dev` 6efcc68→5391073, ff_only). Confere com o informado.
- Executores (`work executors`): codex-cli `ready` (recomendado); ollama `ollama_unreachable`; claude-code `version_check_failed`; openai exige authority paga por item; deepseek-harness `parked_not_operational`.
- Codex: `ANIMA_CODEX_CLI_PATH=C:\Users\GeanTeco\AppData\Local\OpenAI\Codex\bin\979a96ce184041d1\codex.exe` — só no processo, nunca persistir.
- Next (3000), Ollama (11434): parados.

## 3. Resident Host
- **NÃO está rodando.** Tentativa de iniciá-lo em background foi NEGADA pelo classificador de permissões do Claude Code (processo autônomo). Nada foi iniciado; nenhum workaround foi tentado.
- Dry-run read-only (`inv10-queue-dryrun-readonly.ts`, planner puro sobre o backlog real): fila autônoma VAZIA; decisão `stop/awaiting_human_or_recovery` ⇒ o host, se subir agora, não inicia attempts.
- `.env.local` tem `ANIMA_COMPUTE_ROUTER_V1_ENABLED=1`: subir o host com `=0` (env do processo vence o `--env-file`).
- Comando planejado (rodar no terminal do usuário, não por agente), de `apps/web`, com `SINCE` = instante do start em ISO com fuso:

```bash
ANIMA_COMPUTE_ROUTER_V1_ENABLED=0 ANIMA_POST_APPROVAL_CLASSIFICATION=1 ANIMA_POST_APPROVAL_CLASSIFICATION_SINCE=<ISO-Z-agora> \
ANIMA_RESIDENT_MAX_TURNS_PER_CYCLE=1 ANIMA_RESIDENT_MAX_CYCLES=1 ANIMA_RESIDENT_MAX_ITERATIONS=40 \
ANIMA_AUTONOMY_FILE=<arquivo com "enabled"> ANIMA_RESIDENT_LOG_FILE=<jsonl> \
ANIMA_CODEX_CLI_PATH='C:\Users\GeanTeco\AppData\Local\OpenAI\Codex\bin\979a96ce184041d1\codex.exe' npm run local-host
```
- Kill switch imediato: apagar o conteúdo/arquivo de `ANIMA_AUTONOMY_FILE` (ausente ⇒ desabilitado). Sem `ANIMA_RESIDENT_MATERIALIZE_*`.

## 4. INV-09 e INV-10
- INV-09 (`41f80b3a-2043-4e2f-8c67-0c62aa795bda`, base `534a1bd`): `blocked`, `user_attempt_budget_exhausted`/`awaits_budget_window`, 0 attempts, approval seq 86288, classificado. **Preservar; não cancelar/reabrir/alterar.**
- Efeito: cada turno do Supervisor chama `readmit_budget_blocked_work` (`supervisor.ts:225`); com vaga de orçamento o INV-09 volta a `approved` e, por FIFO (seq 86288), passa à frente das INV-10 e consome a 1ª vaga. Não há como segurá-lo sem mudar estado. **Decisão humana pendente: A (deixar executar primeiro) ou B (aguardar, host desligado).**
- INV-10a–f: apenas rascunho no `040`. Nenhum item criado.

## 5. Decisões e autorizações já concedidas
- Auditoria única, seis Investigation Sessions subordinadas; preâmbulo epistemológico aprovado.
- Autorizado: subir Docker/Supabase; `ANIMA_CODEX_CLI_PATH` temporário; `anima status`/executores/eventos; materializar o `040` (feito); iniciar o host com `ANIMA_POST_APPROVAL_CLASSIFICATION=1` desde que provado que não dispara attempts inesperados.
- NÃO autorizado: criar/aprovar INV-10a–f (precisa nova autorização), `work supervise`, API paga, migrations, alterar código, commit/push, pesquisa/integração externa.
- Fronteira do arco: INV-10 → comparação com ai-memory/AI Lair/Akita → ADOPT/WRAP/FORK/BUILD/IGNORE → só então pesquisa para gaps.

## 6. Orçamento (24h, medido 23:46Z)
- Tentativas: 8 `execution_started` em 24h; bloqueia com ≥ 6 (item: 3). Eventos (seq, hora Z): 86173 23:51 · 86195 00:15 · 86212 00:38 · 86232 00:49 · 86252 00:55 · 86275 02:19 · 86304 03:48 · 86323 04:03.
- Vagas se usadas em sequência (uma por vez): 00:38Z, 00:49Z, 00:55Z, 02:19Z, 03:48Z, 04:03Z (UTC−3: 21:38, 21:49, 21:55, 23:19, 00:48, 01:03). Seis vagas simultâneas NÃO existem.
- Runtime: 25 min / 120 min (não é a barreira). Cada attempt recente durou 87–359 s.

## 7. Riscos, bloqueios e dívidas
- Host não iniciado (permissão); Router=1 no `.env.local` (usar `=0`); INV-09 vai à frente na fila.
- Limites da Investigation: 1 attempt, 30 min, pergunta ≤ 4.000 chars, sem retry/recovery genérico se falhar, evidência `lines` só em arquivos ≤ 150.000 B (citar `anima-prd.md` sem `lines`); snapshot = só repositório (OPERATIONAL/ledger não verificáveis por ela).
- Dívidas conhecidas (não resolvidas): `candidate_recovery.corrections` não chega ao prompt; `canonical_backlog_v1` sem live proof; controles negativos SDC-22 sem live proof; G1/G2 do SDC-22; registro documental final do SDC-23; lifecycle autônomo do host e dependência do operador; Codex path de deploy; integração governada sem CLI; push manual.

## 8. Continuar a partir do estado real
```bash
cd /g/anima && git rev-parse HEAD origin/dev origin/main        # esperado 5391073 / 5391073 / 99bec54
docker info | head -1 && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:54321/rest/v1/
export ANIMA_CODEX_CLI_PATH='C:\Users\GeanTeco\AppData\Local\OpenAI\Codex\bin\979a96ce184041d1\codex.exe'
npm run anima -- status
cd apps/web && node --no-warnings --experimental-transform-types --import ./scripts/ts-resolve.mjs --env-file-if-exists=.env.local scripts/_session/inv10-queue-dryrun-readonly.ts
node --no-warnings --experimental-transform-types --import ./scripts/ts-resolve.mjs --env-file-if-exists=.env.local scripts/_session/inv10-runtime-readonly.ts   # tentativas/runtime 24h
```

## 9. Próxima ação concreta para o Codex
1. Reconfirmar Git/Supabase/dry-run (§8). 2. Pedir ao humano: aprovar o texto das 6 perguntas do `040`; decidir INV-09 (A/B); iniciar o host no terminal do usuário (§3). 3. Só após autorização explícita: `anima work propose-investigation` da INV-10a (base `5391073…`), aprovação humana, uma vaga por vez conferindo o dry-run e o runtime antes de cada aprovação. 4. Ler cada resultado, conferir evidências (3 refs independentes do Verifier), registrar intervenções do operador, consolidar em `docs/registros`. Não reiniciar a investigação nem repetir o preflight além da reconfirmação.

## 10. ATUALIZAÇÃO FINAL DA ETAPA CLAUDE (2026-10-08 ~00:00Z) — decisões reconciliadas e criação da INV-10a

### Decisões humanas reconciliadas (sobrepõem o §4/§5 acima onde divergirem)
- As seis perguntas INV-10a–f estão **aprovadas integralmente** (texto do `040`).
- INV-09: **decisão A** — preservar FIFO; executa primeiro quando houver orçamento. Não alterar seu estado.
- Início controlado do Resident Host estava autorizado; a **negativa da ferramenta (classificador do Claude Code, "Create Unsafe Agents") permanece registrada** e não foi contornada. O Claude NÃO deve tentar novamente: o host é iniciado pelo humano/Codex no terminal do usuário (§3).
- Criação da INV-10a autorizada **sem aprovação nem execução**; `work supervise` segue proibido; sem commit/push.

### Resultado da criação (mecanismo canônico `anima work propose-investigation`)
- Pergunta: texto integral da INV-10a do `040` (1.728 chars), base `5391073fabeeaea6a49a598acf79f3600d26e41f`, capability `research`.
- Item criado: id `6de8e0eb-0be2-486e-9c2c-16f1c2931331`, estado **`proposed`**, ações disponíveis approve/reject/defer/revise_proposal.
- **Referência legível atribuída pelo sistema: `INV-10`** (sequencial automática `INV-NN`), NÃO "INV-10a". Mapeamento a manter: `INV-10` (sistema) = INV-10a (auditoria). As próximas serão `INV-11`, `INV-12`… e devem ser registradas neste handoff como INV-10b… para evitar confusão com o nome da auditoria.
- Gate planejado: 1 critério sem `covers`; Verifier advisory; limites 1 attempt / 30 min; executor `investigation-v1`, `codex-cli/default`.
- Dry-run pós-criação: 36 candidatos (proposed 9), fila autônoma vazia, decisão `stop/awaiting_human_or_recovery` (item `proposed` não executa). HEAD `5391073`, `origin/main` `99bec54`. Nenhum attempt iniciado.

### Próxima ação concreta para o Codex
1. Reconfirmar Git/Supabase/dry-run (§8). 2. Iniciar o Resident Host no terminal do usuário com os controles do §3 (Router=0, SINCE=instante do start, 1 turno/1 ciclo, kill switch por arquivo). 3. Aprovação humana de `INV-10` (`6de8e0eb…`): `npm run anima -- work approve 6de8e0eb-0be2-486e-9c2c-16f1c2931331` — **só pelo humano ou com autorização explícita**; antes, conferir dry-run e vaga. 4. INV-09 passa primeiro (FIFO) quando a janela abrir (primeira vaga ~00:38Z); a INV-10a ocupa a seguinte (~00:49Z) — conferir o log do host. 5. Ler o `InvestigationResultV1`, conferir evidências, registrar intervenções do operador; só então propor `INV-10b` (próximo `INV-NN`) com a pergunta do `040`.

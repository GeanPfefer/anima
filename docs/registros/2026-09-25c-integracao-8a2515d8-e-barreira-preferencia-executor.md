# 2026-09-25c — Integração do resultado aceito de 8a2515d8 e barreira de preferência de executor

## Objetivo

Retomar após reboot, aceitar `bd4092af`, preparar a 2ª prova E2E (Resident Host normal →
Router V1 → `waiting_for_human_authorization`) e parar antes de qualquer gasto.

## Branch e HEAD

- `dev`: início `341564f` → fim `34a5f78` (+ este registro). Sem push. `main` = `origin/main` = `99bec54`.

## Infra (pós-reboot)

Docker Desktop, `supabase start` (sem `db reset`, sem migration pendente), `npm run dev:web`,
`npm run local-host` (Router V1 ON, coder `gpt-5.6-sol`/high/300 s/32k). Ollama NÃO iniciado.

## Decisões e atos humanos executados

1. `bd4092af`: ACCEPT (decisão humana) via `anima work accept` ⇒ `completed`. Parecer
   histórico do Verifier (`rejected`, artefato de covers herdados; ver
   [registro 2026-09-25](2026-09-25-prova-sol-bd4092af-router-lineage-e-covers.md)) preservado;
   envelope não reescrito.
2. Candidato `c41ad2ff` descartado: o mesmo pedido já tinha lineage canônica posterior
   `ce90eb14 → 01fdf66a → 8a2515d8`, e `8a2515d8` estava `completed` (`result_accepted`
   `fe9bdd2b` sobre `result_submitted` `4f2d4b0e`, attempt `60f8287b`, `commitSha 9bf3783`).
3. Integração (decisão humana, opção 1): `git merge --no-ff 9bf3783` ⇒ `34a5f78`. Diff só em
   `apps/web/scripts/prove-openai-strong-e2e{,.test}.ts` (+100/−15), sem conflito.
   Nada reimplementado.

## Provas

- `npm run test --workspace=@anima/web -- scripts/prove-openai-strong-e2e.test.ts`: 7/7 PASS.
- `tsc --noEmit` (web): 0 erros. `git diff --check`: limpo.

## Placeholders duplicados

`c41ad2ff`, `38a0cb27`, `6a552fc0`, `d4e13b0a`, `ed519527`, `224475fa`: todos `proposed` v1,
`intent.planner=admission_placeholder`, sem lineage, authority própria de 2026-09-05 expirada.
Todos descrevem o pedido agora satisfeito por `34a5f78`. Única variação: pedem leitor
padrão `node:fs/promises` (assíncrono); o resultado aceito usa `readFileSync` — a mesma
variação existia no pedido de `8a2515d8` e foi aceita pelo humano. **Duplicatas comprovadas;
retirada = decisão humana separada (não executada).**

## Candidatos à 2ª prova (busca read-only no backlog = work_items não terminais)

- `58159655` (`approved` v1, 2026-08-11): `GET /api/dev-readiness` em `apps/web` — pedido
  humano real, nunca implementado (início manual liberado em 2026-09-05), escopo pequeno,
  verificável por teste. Proposta v1 é de investigação (não executável) e o item é âncora
  de provas do advisor ⇒ a unidade nova deve nascer por nova mensagem de chat.
  **Melhor candidato.**
- `b34d4561`/`cde9684e` (diagnóstico do planner): `cde9684e` já tem resultado `verified` em
  `review` ⇒ não é trabalho pendente.
- `5895b59c` (B1 settlement): congelado. `b2930e81`/`1257f22f`/`b84dacde`/`4d4fd374`: antigos,
  já cobertos ou vagos. `418b7a23`: conta pessoal (armadilha UX-02).

## Barreiras (paradas antes de gasto)

1. **Materialização pelo chat exige login humano.** A CLI não cria item a partir de pedido;
   o navegador está em `/login` e o agente não entra credenciais.
2. **Estrutural — preferência de executor por unidade não existe.** O planner grava
   `execution_spec.coder_backend` a partir de `resolveConfiguredCoderBackend()` (env de
   deploy; default `ollama`). Sem override de `ANIMA_CODER_PROVIDER`, uma unidade nova
   não tem `preferred=openai`; o Router V1 (`decideComputeRoute`) com local admissível
   (`available` fixo `true`, governor por pressão de RAM, sem falha na lineage) escolhe
   `ollama` (`local_sufficient`). Os únicos caminhos até `waiting_for_human_authorization`
   hoje são: override global do env (vedado pelo humano), falha local na lineage (exige
   attempt Ollama) ou governor negando por pressão de RAM (não determinístico). Resolver
   exige decidir como o humano expressa, por unidade, "este trabalho usa OpenAI/Sol"
   (o comentário do planner afirma que o provedor "nunca [é] escolha por-proposta do usuário").

## Efeitos externos

Nenhuma chamada OpenAI, nenhuma authority/reserva/attempt/claim nova, nenhum Ollama.
Sem push/PR; `origin/main` intacta. Reserva `b1239ccb` (B1) continua aberta.

## Retomada exata

Decisão humana sobre a barreira 2 (forma da preferência por unidade). Depois: humano pede no
chat (GPT, modo desenvolvimento) o trabalho de `58159655` → revisão do plano → `approve` →
`anima work prepare-autonomous <id>` → Resident Host ⇒ `waiting_for_human_authorization` →
`anima work authorize-compute <id> --max-usd 3 --max-minutes 30 --valid-hours 2`.

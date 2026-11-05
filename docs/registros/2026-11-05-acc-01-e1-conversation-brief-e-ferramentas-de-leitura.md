# ACC-01-E1: Conversation Brief, ferramentas de leitura e prompt do Chat Dev — 2026-11-05

Append-only. Tipo: **implementação** (código + testes; sem schema, sem escrita no banco residente, sem execução de agentes). Formato de [`README.md`](README.md). Antecede: investigação ACC-01-R1 (relatório na sessão; sem arquivo).

## Dados

- Branch `claude/acc-01-e1-conversation-brief`, base `dev` = `94e43c6` (`origin/dev` = `21b2af9`, `main` = `99bec54` intactas). Sem push.
- Sete arquivos SQL modificados no checkout principal (migrations 0905 e testes) pré-existentes: preservados, não tocados.

## O que mudou (somente Chat Dev: `developmentMode` explícito + allowlist)

1. **Conversation Brief** (`lib/ai/conversation-brief.ts`, puro; `lib/ai/project-read-model.ts`, leitores): decisões ratificadas com versão e mensagem de origem, foco, trabalhos abertos (referência curta, estado, resumo), últimas evidências por item e eventos novos desde a última resposta do assistente. Cada seção distingue **falha de consulta** de **ausência de dados**. Texto de registro é sanitizado (controles, cercas, tags, segredos) e rotulado como dado, nunca instrução. Orçamento: 8 decisões, 10 itens, 5 eventos por item, 8 mudanças, teto por seção e total de 7000 caracteres.
2. **Ferramentas de leitura** (`lib/ai/project-read-tools.ts`): `project_list_work`, `project_get_work`, `project_list_decisions`, `project_executors_readiness`. Só `SELECT` pelo cliente autenticado do usuário (RLS); sem RPC, sem processo, sem rede, sem payload de evento. `project_executors_readiness` lê **configuração** (env + existência de arquivo), declara `processesStarted:false`, `loginVerified:false`; Claude Code aparece como não admitido no Single-Item e sem prova governada. Anexadas ao provider apenas com `developmentMode` e contexto; compartilham o teto de 10 chamadas.
3. **Prompt do Chat Dev** (`lib/ai/chat-dev-prompt.ts`): conversa de planejamento, cita referências, distingue hipótese/proposta/decisão/aprovação/execução/evidência, só lê, brief em envelope de dados que não pode ser fechado por conteúdo.
4. Fiação: `chat-provider.ts` (contexto opcional, lista de ferramentas, despacho) e `app/api/ai/chat/route.ts` (brief fail-closed + prompt dev + contexto; janela de histórico do Chat Dev de 10 para 24 mensagens). O chat pessoal permanece idêntico.

## Provas

- Testes novos: `conversation-brief.test.ts` e `project-read-tools.test.ts` (RLS simulada, dois usuários, falha de tabela, zero mutação, zero processo, 9 turnos, limite de chamadas, ausência de ferramentas no chat pessoal). Regressão: 15 suítes de chat e 28 de `lib/ai`+`app/api/ai`; `tsc` web e core limpos. `project-tools.test` falhou uma vez sob carga ampla e passou isolado (flake conhecido).
- Sonda anon somente leitura no Supabase local: `project_decision_proposal_state`, `project_decision_events` e `ai_conversations` aceitam as colunas consultadas (200); as demais tabelas negam `anon` (42501), como esperado.

## Não provado

- Conversa ao vivo contra o residente com usuário autenticado (exige login humano; não realizado). Build do Next não executado (evita escrever no cache do checkout principal via junction).
- Qualidade do modelo com as ferramentas (nenhuma chamada paga foi feita).

## Limites

Brief é uma fotografia por turno; só trabalhos abertos entram nele (concluídos via ferramenta); decisões vêm de enunciados sem rationale; delta usa a última resposta do assistente da sessão ativa; detectores pessoais continuam rodando no Chat Dev (fora do escopo).

## Próximo ponto de retomada

ACC-01-E2: mandato com executor escolhido e alvo externo, parando em `proposed`.

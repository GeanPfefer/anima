# Aprovação humana do backlog ratificado

- **Data/tipo:** 2026-08-24 — prova local de checkpoint humano.
- **Objetivo:** aprovar exatamente as três WorkProposals v2 da política
  local-first, encerrando antes de classificação/claim/execução.
- **Branch/HEAD inicial:** `dev` em
  `d0724e3f5f9fda34c6f3663690fe2fbb72609c63`, igual a `origin/dev`.
- **Resultado:** `RATIFIED_BACKLOG_TO_EXECUTION_V0_HUMAN_APPROVAL = PASS`.

## Aprovações

O boundary `public.resolve_approval` foi chamado como role `authenticated`, com
`auth.uid()` do proprietário e RLS/allowlist vigentes. Não foi usado
`service_role` nem `author=system`.

| Item | Evento | Seq | Horário UTC |
|---|---|---:|---|
| `0cedae21-433d-4842-8fbd-9045c5128bcf` | `874ce100-1a16-41b9-b9b4-6077141b8340` | 34679 | 2026-08-24 22:54:58.568366 |
| `b2930e81-3f19-48f5-92ab-a27e10633896` | `fd3c6460-4166-4842-8ff7-f54891f9c754` | 34680 | 2026-08-24 22:55:09.578615 |
| `1257f22f-03dd-464c-bafb-d90744c9f92e` | `47abe007-bf13-4a3a-8dc1-6ee8112092ee` | 34681 | 2026-08-24 22:55:18.915177 |

Todos os eventos têm `author=user`, `proposal_version=2` e payload limitado a
`decision=approve` + `decided_proposal_version=2`. O replay dos três pelo mesmo
boundary retornou a recusa de estado/versão (`55000`) e não criou duplicatas.

## Readiness após approval

- Item 1: spec elegível e dependências satisfeitas; ainda fora da fila porque
  `work_intelligence_classification_missing`.
- Item 2: spec elegível; dependência do item 1 não satisfeita e classificação
  ausente.
- Item 3: spec elegível; dependência do item 2 não satisfeita e classificação
  ausente.

A fila autenticada retornou zero desses itens. Isso é fail-closed e não é bug de
dependência. Nenhum claim foi adquirido.

## Ausência de efeitos

- Antes/depois: work items `63→63`; eventos `613→616`; approvals `48→51`;
  claims `41→41`; attempts/`execution_started` `41→41`; `work_started` `43→43`;
  work focus `2→2`; coder evidence `20→20`; gate evidence `15→15`.
- Autorização financeira: zero. A aprovação de trabalho não foi reinterpretada
  como envelope de custo.
- Resident Host, Supervisor, coder, Ollama, OpenAI, RunPod, cloud, provisioning,
  worktree de execução, PR, merge e deploy: não acionados.
- Egress de provider/modelo: zero.

## Próximo checkpoint

Classificar os três itens pelo boundary local apropriado, sem executar, e então
revalidar que somente o item 1 aparece na fila. Qualquer autorização para rodar o
Supervisor/Resident Host deve ser uma decisão humana posterior e separada.

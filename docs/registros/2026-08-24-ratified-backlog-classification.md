# Classificação do backlog ratificado

- **Data/tipo:** 2026-08-24 — prova local de estado.
- **Objetivo:** classificar as três WorkProposals v2 aprovadas e provar a fila
  causal sem adquirir claim nem iniciar execução.
- **Branch/HEAD inicial:** `dev` em
  `fb60aeafac2fb29df871fca666a59893ea31599c`, igual a `origin/dev`.
- **Resultado:** `RATIFIED_BACKLOG_TO_EXECUTION_V0_CLASSIFICATION = PASS`.

## Boundary e classificações

Foi reutilizada a RPC `record_work_intelligence_classification`, chamada como
role `authenticated` com o `auth.uid()` do proprietário. A classificação é
`system_assessed`, `classifierId=ratified-backlog-v2-local-review` e
`policyVersion=work-intelligence-classification-v1`; não representa decisão
humana, roteamento, autorização financeira ou execução.

| Item | Eixos | Evento/seq |
|---|---|---|
| `0cedae21-433d-4842-8fbd-9045c5128bcf` | bounded, moderate, conditionally_reversible, clear, normal | `ab087941-09bb-4937-b3bf-798785f5a740` / 34682 |
| `b2930e81-3f19-48f5-92ab-a27e10633896` | complex, high, conditionally_reversible, clear, normal | `59b3c439-00b8-4267-8eec-95be5b703e7b` / 34683 |
| `1257f22f-03dd-464c-bafb-d90744c9f92e` | complex, high, conditionally_reversible, clear, normal | `577dce5f-46ef-42ee-ae61-d5ed79c44901` / 34684 |

Todos os eventos têm `author=system`, `proposal_version=2`, revision 1 e nenhum
eixo `unknown`. O replay byte-idêntico dos três retornou `replayed` apontando os
mesmos IDs. Alterar `urgency` mantendo expected revision 0 foi recusado com
`55000` nos três, sem nova linha.

## Fila e dependências

- Antes: nenhum dos três itens na fila por classificação ausente.
- Depois: somente o item 1 aparece, posição 1, alvo `anima`,
  `target_occupied=false`.
- Item 1: spec, INTEL-01 e dependência satisfeitos.
- Item 2: spec e INTEL-01 satisfeitos; dependência do item 1 retorna false.
- Item 3: spec e INTEL-01 satisfeitos; dependência do item 2 retorna false.

## Ausência de efeitos

- Antes/depois: work items `63→63`; eventos `616→619`; classificações `36→39`;
  approvals `51→51`; claims `41→41`; attempts/`execution_started` `41→41`;
  `work_started` `43→43`; work focus `2→2`; coder evidence `20→20`; gate
  evidence `15→15`; AI conversations `203→203`.
- Não existe autorização financeira materializada: classificação e work approval
  não foram reinterpretados como envelope de custo.
- Resident Host, Supervisor, claim, attempt, executor, coder, Ollama, OpenAI,
  RunPod, cloud, worktree de execução, gates de implementação, Verifier, PR,
  merge e deploy: não acionados.
- Egress de provider/modelo: zero.

## Próximo checkpoint

Decisão humana separada entre autorizar exatamente um ciclo do item 1 ou
autorizar continuidade pela cadeia 1→2→3. Nenhuma das duas foi inferida nesta
prova.

# Item 1 Successor Slice V0 — proposta governada (sem execução)

- **Data/tipo:** 2026-08-25 — desenho de proposta (recorte de PROPOSTA, PARA antes da aprovação humana).
- **Branch / HEAD:** `dev` / `4857530`. `origin/main` `99bec54` intacta.
- **Autorização humana:** Gean autorizou criar uma PROPOSTA de work item sucessor do Item 1,
  pedindo que o Anima derive a primeira fatia mínima (sem implementação manual da política).
- **Princípio:** o sucessor NÃO substitui nem apaga o Item 1 (`failed`, 2/2, evidência histórica
  preservada). Ele é uma DECOMPOSIÇÃO governada da MESMA intenção humana, com proveniência de
  recuperação. Não cria nova Project Decision nem reinterpreta a intenção.

## Fatia mínima proposta (derivada do código atual)

- **Objetivo:** adicionar, no core `work-routing.ts`, um helper PURO e isolado que expressa a
  preferência *local-first* — dado um conjunto de rotas equivalentes rotuladas por localidade,
  preferir a rota LOCAL quando suficiente — como primitivo advisory. NÃO altera o comportamento
  de `selectWorkRoute` ainda; não inventa custo; não concede autorização financeira; não executa
  remoto.
- **included_scope (1 arquivo de produção + 1 teste, 1 camada = core):**
  - `packages/core/src/work-orchestration/work-routing.ts`
  - `packages/core/src/work-orchestration/work-routing.test.ts`
- **excluded_scope:** wiring em `selectWorkRoute`; adicionar campo obrigatório a
  `WorkRoutingCandidateV1` que ramifique para call sites; `apps/web/.../resource-governor.ts`
  (camada web); estimativa de custo; execução remota/provisionamento; autorização financeira;
  Resident Host.
- **Âncora (símbolos estáveis, não linha frágil):** as funções puras exportadas `selectWorkRoute`
  e `requiredEffortFor` e os tipos `WorkRoutingCandidateV1` / `WorkEffortLevel`. O helper novo é
  adicionado adjacente, reusando essas formas.
- **Acceptance criteria:** (1) o helper prefere determinística e establemente uma rota local a uma
  remota equivalente; (2) ausência/desconhecimento de localidade falha fechado (sem crash, sem
  preferência inventada); (3) `selectWorkRoute` e seus testes atuais permanecem inalterados.
- **Comando de validação:** `npm test --workspace=packages/core -- work-routing.test.ts`.
- **permissions:** `workspace_read`, `workspace_write_isolated`. **limits:** `max_attempts=2`,
  `max_duration_minutes=30`.
- **Tamanho/contexto:** escopo total ≈ 16.3k chars ≈ **~4.654 tokens** vs input budget 6.656
  (num_ctx 8192 − 1536) → cabe ~70%, camada única, âncora única — contra os ~2× do Item 1. Com o
  manifesto já melhorado (`38ae84c`, mapeia blocos de teste), o coder recebe um mapa real.
- **Próximo passo (NÃO materializado):** wire do helper no tie-break de `selectWorkRoute` +
  campo OPCIONAL de localidade em `WorkRoutingCandidateV1` (validado); depois representar a
  alternativa remota como advisory em `resource-governor` (web). Cada um uma fatia pequena.

## Proveniência (íntegra, por ID — nunca por título)

- **recovery_of:** Item 1 `0cedae21-433d-4842-8fbd-9045c5128bcf` (`failed`, 2/2,
  `ollama_read_round_limit` / escopo amplo demais).
- **mesma intenção:** Backlog Proposal `a76c5acf-3e6f-41d9-a8b4-170d51be2d13` v2, slice
  `local-first-capacity-cost-policy` (link real via `project_backlog_materialized_items`).
- **Project Decision** `1dedfd5f-0f19-4e8a-8ac5-fcc54a304fbb` v1 (local-first; compute pago exige
  autorização humana; sem auto-provisioning).

## Substrate: lacunas e mínima extensão necessária

- **Criação:** não existe RPC governada de "proposta de sucessor de recuperação". Os caminhos
  vigentes são (a) proposta conversacional por mensagem do usuário e (b) materialização do backlog
  canônico — cada um com sua própria proveniência. Persistir o sucessor corretamente exige uma
  **mínima extensão** (proveniência de recuperação + caminho de criação). Por isso, neste recorte,
  **NÃO persisti work_item** — o desenho é apresentado para aprovação; sem auto-approval.
- **Dependência/sucessão:** Item 2 `depends_on` [Item 1] e Item 3 `depends_on` [Item 2], por ID.
  Não existe conceito de sucessor/supersessão em WORK ITEMS — só há precedente `supersedes_id` em
  `project_decision_proposals` (nível de DECISÃO) e `supersedes_event_id` na classificação (nível
  de EVENTO). Logo o sucessor **NÃO desbloqueia o Item 2 automaticamente**. NÃO reescrevi
  dependências. A extensão mínima consistente seria um vínculo de "satisfação do predecessor pelo
  sucessor" espelhando o `supersedes_id` — decisão humana.

## Estado (invariante)

- Item 1 `failed` 2/2 intacto; Item 2/3 `approved` bloqueados por dependência do Item 1.
- Zero execução, zero approval/classify/claim/attempt/coder/worktree/cloud/provider/egress.
  Nenhum work_item novo persistido. `origin/main` intacta.
- **ITEM1_SUCCESSOR_SLICE_V0 = PASS** (desenho pronto, proveniência íntegra, fatia cabe no coder,
  dependência tratada explicitamente, sem execução).

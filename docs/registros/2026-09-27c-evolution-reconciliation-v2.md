# 2026-09-27c — Evolution Reconciliation V2

- **Tipo:** reconciliação epistemológica + desenvolvimento (modelo mínimo + UI).
- **Objetivo:** fazer o Capability Map e `/evolution` refletirem o estado real depois de
  89 commits sem reconciliação. A pergunta continua: "o que o ANIMA consegue fazer hoje,
  com qual nível de evidência?".
- **Branch:** `dev`. **HEAD inicial:** `117fb46` (`dev` = `origin/dev` =
  `backup/marco-research-web-dev-readiness-2026-09-27`). `main` = `origin/main` = `99bec54`,
  intocados. Sem push.

## Baseline real (medida no Git)

- Última edição do registry/modelo: `7f276d8` (2026-09-16, Evolution UX V1).
  Continha 40 capacidades em 6 domínios: 14 operacionais, 15 comprovadas, 2 implementadas,
  2 especificadas e 7 projetadas.
- Última edição da UI: `9089034` (2026-09-18, Proof Engine V1.1). Depois dela a
  "Avaliação dinâmica" passou a mostrar o porquê; o registry declarado não mudou mais.
- Registros de referência: `2026-09-16-evolution-ux-v1.md`, `2026-09-18-capability-proof-engine-v1.md`
  e `2026-09-18b-capability-proof-engine-v1-1.md`.

## Auditoria epistemológica (antes de editar)

**Proof Engine sobre o histórico real** (read-only, identidade residente, US$ 0):
1343 eventos, 0 issues.

| Capacidade | Declarado | Derivado | Base |
|---|---|---|---|
| agency.edit-file | operacional | operacional | 15 ocasiões, 0 negativas |
| agency.run-tests | comprovada | **operacional** | 15 ocasiões, 0 negativas |
| agency.produce-change | comprovada | operacional | 8 ocasiões |
| agency.verify-change | comprovada | operacional | 8 ocasiões |
| governance.verifier | comprovada | operacional | 12 ocasiões conclusivas |
| agency.supervised-self-development | comprovada | comprovada | 5 negativas, depois o aceite de `f6c326b1` (recuperação) |

**Regra aplicada:**
- O motor conta ocasiões de sucesso, não taxa de sucesso.
- Só promovi onde o critério declarado em `advancement` foi cumprido.
- Onde a contagem sobe mas o critério não fecha, mantive o nível declarado e escrevi o motivo.

**Checagem de entrega do recovery evidence** (read-only): os 20 eventos de `f6c326b1`
(54719–54738) não contêm referência ao evento ancestral `5ebf4d94`.
- A entrega à attempt `515c4d83` **não é registrada** em evento tipado.
- Portanto não pode ser declarada como prova.
- A seleção foi provada antes, por reconstrução read-only (registro 2026-09-27).

## Delta

### A. Capacidades que amadureceram (promoções declaradas)
| Capacidade | De → Para | Evidência |
|---|---|---|
| agency.run-tests | comprovada → **operacional** | Loop vivo edit→test→submit (attempts `2a145ca1` e `515c4d83`); 15 ocasiões host-observed. O sandbox de kernel passa a ser critério de autonomia. |
| agency.detect-deficiency | projetada → **comprovada** | `09b3bc7`; dry-run real `2c4cbb1` (1130 eventos → 6 deficiências, 100% dos refs resolvem) |
| agency.formulate-improvement | projetada → **implementada** | `09b3bc7` + `bfdf1fa` (materialização idle). Nenhuma proposta real materializada. |

**Nova prova sem mudança de nível:**
- memory.continuity: `25198a5`, retomada de `d1d6c5d`.
- agency.recovery-correction: `bd4092af` e `f6c326b1` aceitos. Não é rotina: 6 unidades e 5 attempts pagas.
- agency.supervised-self-development: `f6c326b1`/`515c4d83` com verified 0/0/13 e aceite (evento 54738).
- governance.authority: `341564f`, `af3d215`, `d6968d5`; 5 authorities item-scoped, uma attempt cada.
- compute.selection: `fc53649` (lineage), `33ffe01` (preferência autoritativa).

**Mantidas, com divergência explicada** (derivado operacional, declarado comprovado):
- produce-change: na lineage dev-readiness, 2 de 5 attempts pagas chegaram a verified.
- verify-change e governance.verifier: 5 de 7 decisões humanas sobre verified pediram mudanças.

**Rebaixadas:** nenhuma.

### B. Capacidades realmente novas (existem no código)
| Capacidade | Nível | Por quê |
|---|---|---|
| research.web.search | comprovada | `515ba65`; prova viva controlada (`5260316`), 2 execuções, `degraded` honesto |
| research.web.open | comprovada | mesma prova; 0 processos e 0 diretórios residuais |
| research.web.extract | comprovada | `contentHash` idêntico nas 2 execuções e ao do POC |
| research.query-privacy | comprovada | Testes da função pura + consulta viva `public`. O bloqueio nunca é exercido ao vivo, por design. |
| research.web.navigate | implementada | Mesmo primitivo de open; sem prova própria; sem clique |
| research.web.network-boundary | implementada | Não é boundary de segurança: DNS TOCTOU, Windows sem isolamento |
| governance.external-tool-boundary | implementada | Envelope + ExternalExecutionPolicyV1 + `untrusted_external_content`; 1 consumidor |
| governance.harness-recovery | comprovada | `d30f9bb` e `8437570`; 3 usos vivos (f19ac716, 843669bd, f6c326b1) |
| governance.differential-evidence | implementada | Cadeia shadow (`2e67da6`…`30cd600`, `a163c5f`); 0 `eligible` ao vivo |
| compute.unit-preference | comprovada | `9faf2d0`; honrada em 5 unidades. Não operacional: o Router V1 ainda é feature gate de processo. |
| agency.recovery-evidence | implementada | `9035cef` e `6580be2`. A 1ª prova viva foi negativa; a entrega não é registrada. |

Nenhuma capacidade nova é operacional: não há consumidor de research.web no Anima (chat, host ou self-dev).

### C. Composições ainda não concluídas (futuro)
- research.web.cite: **especificada**. O contrato `WebExtractedFindingV1`/`webFindingCitation` existe, mas nada produz findings.
- research.web.compare, research.web.persist-findings, research.web.isolated-runtime e agency.reuse-discovery: **projetadas**.

### D. Candidatas externas (reuso)
Estão em `reuse.status = candidate`, sempre em nível futuro e sem `proofRefs`.
A evidência externa fica em `reuse.externalEvidence` e nunca conta como prova.

| Capacidade | Ferramenta | Estratégia |
|---|---|---|
| memory.cross-harness | ai-memory | WRAP |
| compute.subscription-availability | ai-usagebar | WRAP (condicionado) |
| understanding.github-attention | ghpending | contribute upstream / fork leve (adiado) |
| agency.external-harness | Claude Code / Codex CLI | a decidir (auth + classe de autoridade) |

Reuso integrado (`status = integrated`, WRAP): SearXNG em search; agent-browser em open, extract e navigate.

### E. Novas direções (projetadas)
- **memory.durability.** A durabilidade hoje é **processo humano comprovado** (push de `dev` e
  branch de backup em `117fb46`), não capacidade do sistema.
- **memory.evolution-history.**
- **memory.architectural-memory.** Nova dependência de `agency.continuous-self-development`.

### Contagens
Eram 40 capacidades em 6 domínios; agora são **63 em 7 domínios**:
- operacionais: 14 → 15;
- comprovadas: 15 → 21;
- implementadas: 2 → 8;
- especificadas: 2 → 3;
- projetadas: 7 → 16;
- autônomas: 0.

## Recovery / self-dev — cadeia factual reconstruída

A cadeia de dev-readiness, com refs reais:

1. `2c7afe1d` falhou por harness (`c284f09c`); fixes `d17dcbe` e `b496708`.
2. Recovery de harness (`d30f9bb`) gerou `f19ac716`.
   - Sol `2a145ca1`, commit `d1d6c5d`, gates PASS, Verifier inconclusive, review.
   - Request-changes com gate `next build` (`0693efe`) gerou `7610b066`.
   - Sol `92607a82` falhou (`Response is not defined`).
3. Continuidade de evidência (`9035cef`) e recovery em descendant (`8437570`) geraram `843669bd`.
   - Sol `98402f85` falhou: a sanitização quebrava o matching e 0 itens foram entregues (`73b37f7`).
4. Identidade canônica de gate (`6580be2`) gerou `f6c326b1`.
   - Sol `515c4d83`, commit `25198a5`.
   - Gates host (focal, typecheck, build) passaram; Verifier verified (0/0/13).
   - Aceite humano (evento 54738), `completed`.
   - Integração local em `dev` (`117fb46`), que não registra `integrated`.

## Modelo (extensão mínima, contrato compatível)

Em `packages/core/src/capability-map.ts`:

**Domínio `research` ("Pesquisa externa").**
- Research não cabia em `understanding` (mundo do usuário) nem em `interaction`.
- "Continuidade/Evolução" coube em `memory`; "Harness externo/Reuso" virou atributo de origem, não domínio.

**`reuse?`:** `{ strategy, tool, status: integrated | candidate, externalEvidence? }`.
Ausente = interna.

**`history?`:** entradas declarativas `{ at, change, from?, to?, note, refs }`.
- É **semente**, não derivação.
- Registra só o que esta reconciliação auditou.

**Validação nova:**
- `strong_maturity_without_proof`;
- `external_candidate_realized`;
- `invalid_history` (data, ordem, refs, from≠to);
- `history_maturity_mismatch` (o último `to` precisa bater com a maturidade atual).

**`listRecentEvolution(caps, since)`:** projeta só entradas `history` desde a baseline.

**`EVOLUTION_BASELINE`** (`7f276d8`, 2026-09-16) está no registry.

O nome `ANIMA_CAPABILITY_REGISTRY_V0` foi mantido: é o nome do contrato.

## UI `/evolution` (sem redesign)

**Preservados:** pan/zoom, Ajustar/Resetar, foco por relações, filtro por domínio, seletor de
objetivo, painel e provas tipadas.

**Novidades:**
- Nova coluna **Pesquisa externa**. Marcador "Evolution V2".
- **Lentes:** "Mapa completo" / "Evolução recente (N)" / "Reuso externo (N)". Combinam com o filtro de domínio.
  - O painel da lente recente lista as mudanças desde a baseline, com data, tipo e nota; clicar seleciona a capacidade.
  - O painel da lente de reuso separa **temos internamente × reuso integrado × candidatas externas**.
- **Chips:**
  - candidata externa tem borda pontilhada e o sufixo "· externa";
  - reuso integrado tem sufixo de estratégia ("· WRAP");
  - o aria-label carrega a origem;
  - chips internos ficam inalterados.
- **Legenda:** "Reuso integrado" e "Candidata externa".
- **Painel da capacidade:** novas seções **Origem** e **História**, com refs tipadas.
  A seção História traz um placeholder honesto: a derivação completa fica para a V3.

## Gates

- Core: focais `capability-map` e `capability-registry` 43/43; completo **101 suítes / 2093 testes**; typecheck ok.
- Web: `EvolutionClient` + `lib/evolution` **3 suítes / 44 testes**.
- `npm run typecheck`: todos os workspaces ok.
- `next build`: ok (67 páginas; `/evolution` 9,86 kB).
- `git diff --check`: ok.
- Testes antigos ajustados de propósito:
  - `capability-assessment-read.test.ts` e `capability-proof-assessment.test.ts` agora esperam `run-tests` declarada `operational`;
  - o limite de tamanho do registry passou de ≤40 (V0) para ≤70.
- Verificação visual no navegador **não** realizada: `/evolution` exige login, e Claude não loga (barreira AUTH).
  Cobertura por testes de UI e pelo build.

## Evolution History V3 (não implementado)

**Hoje:** `history` declarativa e auditada, a lente "Evolução recente" e a seção História por capacidade.

**Fica para a V3:**
- derivar a história de git + `work_events` + registros, com proveniência;
- registrar a entrega de recovery evidence como evento tipado;
- a narrativa "como chegou até aqui" por capacidade;
- a memória arquitetural consultável pelo self-dev.

Sem historiador LLM e sem banco novo até haver contrato.

## Efeitos externos

Leituras read-only do Supabase local sob identidade residente (Proof Engine, eventos de `f6c326b1`, `work show`).

Não houve:
- push;
- authority, reserva, attempt ou provider;
- `db reset` ou `service_role`.

Custo: **US$ 0**.

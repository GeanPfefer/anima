# Capability Proof Engine — provas vivas de capacidade (V1)

Este documento descreve o motor que deriva, a partir do estado canônico
persistido, **quais capacidades o Anima realmente demonstrou** e com **quais
provas**. Ele consolida o motor parcial já existente (introduzido junto do
Capability Map / Evolution V0) até um V1 coerente. Complementa — não substitui —
`docs/arquitetura/protecao-contrato-canonico-estado-residente.md` (a barreira do
incidente 51929) e o registro `docs/registros/2026-09-16-capability-map-v0.md`.

## Modelo conceitual: quatro papéis distintos

```
Capability Registry            → DEFINIÇÃO   ("o que significa esta capacidade?")
        │
Estado canônico persistido     → OBSERVAÇÃO  (work_events: resultado, Git, gates,
(work_events append-only)                     coder, Verifier — fatos, não juízo)
        │
Capability Proof Engine        → CONCLUSÃO   (maturidade DERIVADA de prova +
(extração → avaliação)                        proveniência + lacunas)
        │
/evolution                     → PROJEÇÃO    (a leitura humana da conclusão)
```

A regra de ouro é a separação de papéis:

- o **registry** (`packages/core/src/capability-registry.ts`) é ontologia. Ele
  pode afirmar até `implemented`; estados fortes que ele declara existem só para
  auditoria/migração e **nunca** são premissa da conclusão do motor;
- a **observação** é o event log canônico. É fato bruto, nunca juízo;
- a **conclusão** é derivada só de definição + evidência dinâmica;
- a **projeção** (`/evolution`) descreve a conclusão em linguagem de produto. Ela
  não recalcula maturidade — só renderiza o que o core concluiu.

O registry **não** vira histórico de execução, e o event log **não** vira
ontologia.

## Pipeline real (arquivos)

```
capability-registry.ts  ─ ANIMA_CAPABILITY_REGISTRY_V0 (definição, 40 capacidades)
        │
work_events (Supabase) ─ estado canônico append-only
        │  apps/web/lib/evolution/capability-assessment-read.ts
        │     · pagina, mapeia (mapWorkEvent), falha fechado em timestamp inválido
        │     · classifyCanonicalResidentEvent (canonical-resident-contract.ts):
        │         readable / not_canonical            → participa
        │         unsupported_contract(_version)       → canonical_contract_incompatibility
        │         invalid_payload                      → event_history_invalid
        │  capability-proof-assessment.ts
        │     deriveCapabilityAssessmentsFromWorkHistory
        │       ├─ capability-proof-work-evidence.ts   ── EXTRAÇÃO DE PROVA (adapter)
        │       │    fatos do worktree → CapabilityEvidenceObservation[]
        │       └─ assessCapabilitiesFromEvidence      ── AGREGAÇÃO
        │            └─ capability-proof-engine.ts      ── REGRAS/CONCLUSÃO
        │  capability-assessment-explanation.ts        ── PROJEÇÃO humana (pura)
        │
apps/web/app/(app)/evolution/page.tsx → EvolutionClient.tsx  ── UI (só renderiza)
```

## Classes de evidência e maturidade derivada

A definição só afirma até `implemented`. Os estados fortes pertencem à evidência:

| Classe de evidência        | Maturidade derivada | Significado                                  |
|----------------------------|---------------------|----------------------------------------------|
| `implementation`           | `implemented`       | o código foi exercitado                      |
| `verified_execution`       | `proven`            | 1 execução verificada com prova independente |
| `reproduced_operation`     | `operational`       | reproduzida de forma confiável (**V1**)      |
| `autonomous_operation`     | `autonomous`        | operada autonomamente sob governança válida  |

Regressão é uma conclusão temporal, não uma classe: evidência forte **negativa**
posterior a uma capacidade comprovada deriva `degraded` até nova prova.

### Regra de reprodução (a lacuna que o V1 fecha)

Antes do V1, o adapter só produzia `verified_execution`, então a escada **morria
em `proven`**: `reproduced_operation`/`autonomous_operation` eram tipos definidos
mas nunca derivados. O V1 fecha a metade inferior dessa lacuna com uma regra
explícita e testável no engine:

> Execução verificada **positiva** em `REPRODUCTION_THRESHOLD` (= 2) **ocasiões
> independentes** dentro da janela válida promove a capacidade de `proven` para
> `operational` (`reproduced_operation`).

- **Ocasião** é sinalizada explicitamente por `occasionId` na observação
  (tipicamente o `attempt`). Reprodução conta **ocasiões**, nunca a quantidade de
  ponteiros de prova (`proofRefs`).
- Duas provas da **mesma** ocasião não contam como reprodução.
- `occasionId` ausente **nunca** dispara promoção por reprodução (fail-closed).
- A contagem usa a **janela pós-recuperação**: ocasiões anteriores a uma
  regressão não são reaproveitadas (uma única prova após regressão re-prova, não
  re-opera).

`autonomous` continua exigindo evidência de classe `autonomous_operation`, que
**ainda não é derivada** de nenhum sinal atual — permanece honestamente fora do
alcance do V1 (ver "O que ainda não é derivado").

## Capacidades-piloto

O motor deriva de prova real as capacidades cujo histórico canônico já carrega
sinais persistidos. São **seis** (quatro do V1 + duas conectadas no V1.1),
cobrindo classes de prova distintas:

| Capacidade                | Fonte de prova (adapter)                                            | Regra mínima de promoção                                | Não é suficiente                                                        |
|---------------------------|--------------------------------------------------------------------|---------------------------------------------------------|------------------------------------------------------------------------|
| `agency.edit-file`        | `host_observed_coder_evidence` + handoff + `host_observed_evidence` (Git) correlacionados na mesma attempt/backend, mesmo commit e mesmo conjunto de arquivos | ≥1 ocasião ⇒ `proven`; ≥2 ocasiões ⇒ `operational`      | diff Git sozinho; coder sozinho; backend divergente; arquivos divergentes |
| `agency.run-tests`        | `host_observed_gate_evidence` com **todos** os gates terminais `passed` | idem                                                    | gate terminal falho; ausência de gates                                 |
| `agency.produce-change`   | cadeia forte: resultado + Git + gates + **Verifier** independente (coverage git+gates, correlação exata) | idem                                                    | `verified` puramente atestado; falta de um fato independente           |
| `agency.verify-change`    | mesma cadeia forte (o Verifier conferiu contra gates)              | idem                                                    | idem                                                                    |
| `governance.verifier` **(V1.1)** | parecer do Verifier conclusivo (`verified` **ou** `rejected`) sobre observação **independente** (git + gates), correlacionado à attempt | ≥1 ocasião ⇒ `proven`; ≥2 ocasiões ⇒ `operational`      | `inconclusive`; parecer atestado/sem cobertura independente; correlação errada |
| `agency.supervised-self-development` **(V1.1)** | cadeia forte verificada **+** decisão humana de revisão sobre o resultado (`result_accepted`) | idem                                                    | sem decisão humana (aguardando review); sem cadeia forte; verifier rejeitou; gate falho |

A seleção é guiada por **evidência real disponível**, não pela facilidade de
hardcodar. Capacidades sem sinal persistido **não** foram incluídas só para
completar número.

### governance.verifier — "o verifier funcionou" ≠ "a mudança foi aprovada"

`governance.verifier` credita a capacidade de **verificar trabalho**, não a de
produzir uma boa mudança. O sinal é um parecer do Verifier que repousa sobre
**observação independente** (git + gates observados pelo host, correlacionados à
attempt) e chega a um **veredito conclusivo**:

- `verified` **e** `rejected` provam que o verifier OPEROU — uma rejeição
  bem-fundada é o verifier fazendo o seu trabalho. Ambos são ocasiões
  **positivas** para `governance.verifier`;
- `inconclusive` é abstenção → não conta;
- parecer **puramente atestado** (sem observar git/gates de forma independente),
  correlação divergente ou payload ilegível → falham fechado (não contam).

Uma ocasião por attempt (`occasionId = attempt`): múltiplos pareceres da mesma
attempt colapsam para o mais recente e **nunca** viram reprodução. Não há sinal
persistido que prove o verifier ter **falhado** (um falso-positivo só é
descoberto por revisão humana, cuja causa pode ser de produto, não do verifier),
então o adapter não emite ocasião negativa — a régua de regressão do engine
segue disponível caso um sinal futuro exista.

### agency.supervised-self-development — auto-modificação sob supervisão válida

Distingue-se de `produce-change` justamente pela **supervisão**: além de produzir
e verificar uma mudança no próprio código, o resultado passou pela **decisão
humana de revisão**. `supervised` ≠ `autonomous`: a intervenção humana não
invalida — ela é a prova.

- cadeia forte verificada **+** `result_accepted` (que aponta o resultado
  revisado) → ocasião **positiva**;
- cadeia forte verificada **+** `changes_requested` (que aponta o resultado
  revisado) → ocasião **negativa** — o supervisor pediu mudanças; o
  self-development não se sustentou (captura o padrão do falso-positivo
  seq4→seq5). Uma negativa posterior a uma positiva deriva `degraded`;
- sem decisão humana terminal ainda → nenhuma observação (aguardando supervisão),
  para não confundir "produziu" com "supervisionado e aceito".

Não basta um work item ser "self-dev", existir uma attempt, haver um commit ou
uma chamada de provider: sem a cadeia forte verificada **e** a decisão humana, a
capacidade não é creditada.

### Comportamentos por capacidade-piloto

- **Falha** (attempt falha, gate falho, Verifier negativo/rejeitado, envelope
  incoerente): nenhuma evidência positiva é emitida; a maturidade não é promovida.
  Um `verified` posterior não-`verified` da mesma attempt suprime um `verified`
  antigo (a conclusão sempre reflete o parecer válido mais recente).
- **Incompatibilidade de contrato**: a leitura falha fechado com
  `canonical_contract_incompatibility` (ver abaixo) — nunca deriva maturidade a
  partir de histórico que esta linha não sabe reprojetar.
- **Histórico misto** (sucesso e falha ao longo do tempo): a ordem temporal
  decide. Regressão → `degraded`; recuperação re-prova só o nível novamente
  demonstrado; reprodução só conta ocasiões da janela válida corrente.

## Fallback seguro (migração progressiva)

Capacidades ainda **não conectadas** ao motor não quebram e não são rebaixadas:

- sem evidência dinâmica, a capability **não é reavaliada** — ausência de
  telemetria nunca vira ausência de capacidade;
- o estado **declarado** pelo registry continua visível e íntegro;
- o derivado nunca reescreve o declarado — a UI mostra os dois lado a lado.

## Limites epistemológicos (invariantes)

- implementado ≠ provado ≠ operacional ≠ autônomo;
- uma função existir no código não prova capacidade operacional;
- uma tentativa existir não prova sucesso; execução falha não promove;
- Verifier negativo não vira evidência positiva;
- um sucesso único não prova autonomia (nem operação reproduzível);
- evidência ilegível/incompatível não é descartada em silêncio nem lida como
  sucesso — **fail closed** quando a prova necessária não puder ser interpretada;
- texto livre do modelo **nunca** é fonte autoritativa; nada de LLM julgando
  maturidade; nada de memória textual como prova.

## Incompatibilidade futura vs corrupção (barreira 51929 preservada)

A distinção segue integralmente em `canonical-resident-contract.ts` e é honrada
pelo read-model:

- contrato/versão que esta linha não reconhece → **incompatibilidade**
  (`canonical_contract_incompatibility`), sinal de reconciliação, não corrupção;
- payload inválido de um contrato **suportado** → **corrupção/histórico inválido**
  (`event_history_invalid`).

O caso legítimo do incidente 51929 — `host_observed_coder_evidence_recorded` com
transcript V3 contendo `runtimeEvents` — continua **legível** e coberto por teste
de regressão (`capability-assessment-read.test.ts`, fixture `seq: 51929`).

## O que ainda NÃO é derivado (dívida honesta)

- **`autonomous_operation`** (→ `autonomous`): nenhum sinal atual demonstra
  operação autônoma sob governança; o degrau existe na escada mas fica fora do
  V1/V1.1 **de propósito**. O sinal candidato seria uma execução verificada sob
  autoridade válida **sem** intervenção humana no ciclo (sem `work_approved`
  humano nem decisão humana de revisão como pré-condição) — mas isso exige um
  contrato que distinga autoridade autônoma concedida de aprovação humana
  pontual, e há ambiguidade sobre o que conta como "sem humano no ciclo" quando o
  envelope de autonomia foi concedido por um humano. Fica para sessão própria.
- Capacidades fora das seis pilotos (compreensão, memória, o restante de
  governança/compute/interação/agência) ainda vivem só pela **definição** —
  conectá-las ao motor é a evolução natural seguinte.
- O motor é **majoritariamente read-model/projection**: V1 e V1.1 não adicionaram
  nenhuma migração, tabela, contrato canônico novo nem tipo novo de `work_event`.
  Toda a conclusão é derivada do estado canônico já existente.

## Extensibilidade

Conectar uma nova capacidade é escrever um adapter de extração no
`capability-proof-work-evidence.ts` que emita `CapabilityEvidenceObservation`
(com `occasionId` quando houver ocasião independente). Toda derivação que depende
do Verifier passa por **um** reader compartilhado
(`resolveIndependentVerifierOpinions`), que resolve o parecer + resultado + fatos
observados e os correlaciona — cada caller aplica só o seu filtro (cadeia forte,
veredito conclusivo, decisão humana). A régua de maturidade (engine) e a projeção
(UI) **não** mudam. A UI nunca codifica maturidade: ela renderiza a conclusão e a
explicação que o core produz; a linguagem de domínio por capacidade vive no core
(`capability-assessment-explanation.ts`), nunca em React.

# Recovery com budget transferido esgotado — decisão sem execução

Investigação de domínio; dev, HEAD inicial/final `addf4670aa2b535b62c3c90915bbda03820816b3`
(= origin/dev, confirmado remotamente). origin/main `99bec54` intacta.
Sem mudança de código, commit ou push; notas desta sessão ficam locais.

## Estado reconciliado por RLS/event log

| Item | Estado/versão | Attempts | Consumo/limite |
|---|---|---|---|
| PIN-02 `8e9fd82b-8986-4526-9258-40893200b173` | changes_requested/v2 | a9ea146f, 5a0c7716 | 2/3 |
| Correction `5b8e371d-6ca9-453c-bbfe-693ae3266468` | failed/v1 | 2685b72b, 0cfdd6cb | 2/3 |
| Replan `7b132de5-8ca1-436e-9d23-e4317d59aaea` | failed/v1 | ab7e7b6f | 1/1 |

Lineage `60eb5b84` (correction seq 2) → `4b63fe6b` (replan seq 1).
Correction seq 1 `330e55e2` está cancelled, com zero attempts e limite declarado 3.
Ledger work_replans `c7532a7a`: predecessor used=2, max=3, allocated=1.
**3/3 é o envelope correction→replan**; toda a árvore soma **5 attempts** históricas.
O limite transferido 1 não acrescenta autorização aos 3; saldo nominal do ancestral
não é saldo disponível para o filho.

Readiness real: BLOCKED/attempt_budget_exhausted, used=1, max=1, remaining=0,
proposalVersion=1. failureEvent `07664942-c43a-46c4-bce5-333daec2d7d3`, attempt
`ab7e7b6f-258e-4637-b2e1-a9be60c810de`, retryable:true.
Primeira edição/checkpoint `967008e` introduziu TS1128; gate exit 1; repair recusou
before ausente. [Investigação anterior](2026-09-02-investigacao-read-edit-replan.md).

## Contratos e contrafactuais

Retryability é possibilidade técnica; budget é autoridade. A readiness/RPC conta
attempts por item/versão contra execution_spec.limits. Retry humano reaprova dentro
desse teto, sem autoridade financeira. Recovery tradicional exige escopo estritamente
menor e limite do filho não superior ao pai; não define ledger agregado universal.
Plano 007 acrescentou transferência explícita de saldo e anti-loop. Custos financeiros
e admission do Resource Governor são restrições adicionais, não saldo de attempts.

Probes puros com a falha real:
- evaluateGovernedRetry: 1/1 → BLOCKED; contrafactual 1/2 com demais condições válidas
  → RETRY_READY. A readiness real para no orçamento antes das outras verificações;
  não afirmar que essas outras condições já passaram no banco.
- decideRecovery: 1/1 e 1/2 → unknown/human_required/failure_not_classified.
  ollama_ambiguous_replacement não pertence à allowlist. Portanto a política automática
  não autorizaria retry nem com saldo; retry humano governado é uma via distinta.
- hasMaterialReplanProgress sobre diagnosis/strategy persistidos → false. A RPC de
  replan também barra descendência de replan, falha retryable e saldo esgotado.

addf467 mudou observabilidade, não matcher, estratégia, modelo ou autorização.
Pode tornar uma experiência mais informativa; não demonstra maior convergência.
Não há ramo capability-evolution que renove saldo. Mesmo uma melhoria futura de
execução seria evidência para decisão, não concessão automática de autoridade.

## Escolha: E — parar agora

**A, retry com nova autoridade, é apenas possibilidade futura**, não ação disponível.
Não escolher B: observabilidade não é progresso semântico; replan não pode renovar
saldo. Corrigir a premissa falsa do plano é necessário, mas não remove o anti-loop.
Não escolher D para esconder o mesmo objetivo num UUID novo. Novo Work Item só é
legítimo com nova intenção/autoridade explícita, não como bypass de budget.

C (routing/model change) também não renova saldo. work-routing-adjustment eleva effort
após duas falhas no histórico recebido; não diagnostica incapacidade semântica nem
concede autoridade. Fallback é por capacidade. Placement pode selecionar nó remoto
habilitado/saudável com modelo compatível sob pressão local. Nó pago/provisionamento
exige autoridade financeira e admission próprias. Não foi identificado gatilho que
transforme baixa convergência desta lineage em concessão de modelo/budget. Não concluir
incapacidade do 14b: havia também instruções incorretas no plano.

Não existe grant_additional_attempts equivalente identificado. revise_work_proposal
só aceita proposed, não failed. Não forçar transições nem alterar maxAttempts.

## Menor operação candidata — desenho, não implementado nem autorizado

Concessão humana append-only de delta para item/versão/falha e envelope de lineage
identificados: autor, motivo, request id idempotente, consumo prévio, teto anterior,
delta e teto agregado aprovado. Preservar spec original, failures, attempts e ledger;
nenhuma troca de versão reseta consumo. Saldo efetivo precisaria ser reconhecido por
TODAS as guardas de readiness/admission/start, com lock/replay. Registrar concessão
não cria approval/claim/attempt; retry humano permanece ato separado.
Concessão única por envelope ratificado, sem refresh ou encadeamento automático;
novo teto exige nova decisão explícita de política. Nenhum delta foi escolhido aqui.

**Grant isolado não basta para este item:** o plano persistido afirma falsamente que
exports existentes não existem. Corrigir as instruções exige nova autoridade sobre
o plano, preservando o anterior; não esconder essa revisão numa concessão de saldo.
A revisão de plano de item failed ainda não tem operação canônica existente demonstrada.

Próximo ato humano: decidir se quer ratificar uma retomada limitada com plano corrigido,
teto agregado e recurso definidos, e autorizar a implementação estreita dessas guardas.
Não é autorização de execução já concedida. E permanece a decisão operacional atual.

## Validação e invariantes

71 testes existentes passaram: governed-retry, recovery-decision, replan e routing
adjustment; probes acima executados em funções puras. Sem mudança de domínio,
typecheck/build novos não necessários. git diff --check das notas.
Não modelado grant em código: não alegar prova de atomicidade/idempotência futura.
Zero mutation do banco, nova attempt, successor/replan, budget, cloud ou compute pago.
Diagnóstico/event log e branches históricas preservados; artefatos do operador intactos.

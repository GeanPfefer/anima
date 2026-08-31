# 2026-08-31 — Teto agregado de compute pago e revisão adversarial

**Tipo:** desenvolvimento + prova adversarial. **Branch:** `dev`. **HEAD inicial:** `5c4ae2a`.
**HEAD funcional:** `3503dd6` (o commit posterior contém apenas este registro e o reparo de fixture
do gate web). `origin/main` permaneceu `99bec54`.

## Objetivo e resultado

Revisar independentemente o envelope pago recém-construído e substituir a semântica por-request
de `maxCostEstimate` pelo teto agregado ratificado. O resultado usa um ledger append-only e uma
RPC transacional com row lock na autorização: a reserva é durável, idempotente e anterior a
qualquer chamada ao provider. Ver [Plano 005](../planos/005-provisionamento-on-demand-v1.md) e
[arquitetura](../arquitetura/provisionamento-lease-seguranca.md).

## Achados e correções

- **Crítico corrigido:** a mesma autorização podia liberar infinitas leases; não existia reserva
  agregada nem proteção cross-process contra TOCTOU.
- **Corrigido:** price hint zero/ausente não pode admitir compute pago; novas autorizações exigem
  teto monetário positivo. Autorizações históricas sem teto seguem legíveis/revogáveis, mas
  inelegíveis para nova admissão.
- **Corrigido:** deadlines além do limite inteiro de `setTimeout` eram convertidos pelo Node em
  1 ms; o watchdog agora rearma em parcelas seguras e recalcula o relógio.
- **Corrigido durante prova:** a primeira compilação local das RPCs tinha colisão entre nomes de
  parâmetros/colunas PL/pgSQL; a diretiva explícita e a migration `00003` recompilam sem ambiguidade.
- **Reparo de gate:** fixtures da rota backlog-cycle não acompanhavam a leitura de histórico e o
  snapshot obrigatório de pressão; só o teste foi alinhado, sem alterar produção.

## Modelo e falhas

`paid_compute_budget_events` registra `reserved|voided`, owner, autorização, lease, item, node,
estimate/moeda e chave idempotente. `FOR UPDATE` na autorização serializa processos concorrentes.
A mesma lease recupera a reserva; outra lease compromete novo valor. Término normal, timeout,
crash, resposta perdida e resultado ambíguo **não** liberam reserva. `voided` só aceita prova de
provider não chamado ou rejeição definitiva pré-create. Reserva não é gasto e price hint não é
billing final. A UI read-only mostra teto, reservado, anulado, comprometido e restante.

## Provas e gates

- Concorrência real em duas sessões Postgres: teto USD 1,00; pedidos simultâneos USD 0,70 + 0,70;
  uma `reserved`, uma `aggregate_budget_exceeded`; ledger final 1 reserva / USD 0,70.
- pgTAP: lifecycle/autorização `19/19`; orçamento agregado `15/15` (`34/34`).
- Core: `1337/1337`. Web: `1139/1139`. Typecheck: 5 workspaces. Next build: OK.
- `git diff --check`: limpo.

## Efeitos externos, riscos e retomada

ZERO chamada cloud paga, ZERO pod RunPod real, ZERO gasto, ZERO API key real usada. Nenhum PR,
merge, deploy ou integração; INT-05 intacta. `.worktrees/`, `.claude/settings.local.json` e
`watch4-sensors.txt` preservados.

Riscos residuais: billing final/observado ainda não existe; lookup vivo de preço não foi avançado;
a janela create→resposta ainda depende de lookup por nome se o processo cai antes de receber e
persistir `providerRef`; watchdog/provider TTL não substituem mitigação para host offline. Próximo
recorte seguro: catálogo/preço read-only com contrato e HTTP fake, seguido do endurecimento
provider-side de TTL/create→providerRef. A primeira prova paga continua bloqueada por nova decisão
humana explícita.

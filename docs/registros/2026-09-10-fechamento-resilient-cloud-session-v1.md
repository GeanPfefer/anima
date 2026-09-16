# 2026-09-10 — fechamento local da Resilient Cloud Session V1

- **Tipo:** desenvolvimento + prova local; zero cloud/provider write/compute pago.
- **Objetivo:** fechar settlement tardio, wiring resiliente vivo, reuso do Pod saudável, retry por
  placement e driver da próxima prova, preservando todo o WIP herdado.
- **Git:** branch `dev`; HEAD inicial/final `d783a5dc495da692eb7097f7c7252bb5ba074e51`;
  `origin/main=99bec54e3ab42bfe882a8686cd1385d8058b916e` intacta. Nenhum commit/push/reset/stash/drop.
- **WIP:** amplo e misturado, anterior a esta sessão; preservado integralmente.

## Mudanças fechadas

- `prepareCloudCoderNode` é a entrada canônica do host-turn. Gate
  `ANIMA_RESILIENT_CLOUD_SESSION=true` leva RunPod pago a `prepareResilientCloudCoderSession`; OFF
  preserva o caminho single-attempt e outros modos.
- Cada tentativa seleciona candidate capability-compatible, reserva, cria, espera endpoint, TCP,
  SSH, túnel e health. Falha recuperável com providerRef confirma teardown, faz settlement e só
  então permite outra tentativa. O loop é sequencial e `maxNodes/maxInFlight=1`.
- O Pod saudável é devolvido com runtime, `providerRef`, lease deadline e `finish`. Teste percorre
  coder→gates→Verifier→review sem teardown e confirma stop+destroy+settlement final depois. Falhas
  de coder e gate também fecham em `finish` via o `finally` do host-turn.
- Retry pré-create usa `providerId:gpuTypeId`, a identidade mais fina disponível. O driver da prova
  usa duas tentativas por SKU e 16 tentativas como rede defensiva; custo, validade, deadline e
  candidatos são os bounds soberanos.
- O driver `prove-runpod-autoprov-8a2515d8.ts` força Router OFF (zero API terceira), gate resiliente
  ON, valida exatamente a authority capability-based esperada antes do host-turn e não bypassa a
  sessão.
- Criado preview estritamente read-only `preview-late-settlement-3b87224f.ts`. Ele não chama RPC de
  settlement nem provider.

## Settlement e banco

- Migration `20260910000001_paid_compute_budget_settlement.sql` confirmada aplicada duravelmente no
  Supabase local; nenhum `db reset`.
- `packages/types/src/database.ts` contém a RPC `settle_paid_compute_budget_reservation`; web/core
  compilam sem cast de assinatura da RPC.
- pgTAP ampliado para 23 assertions: committed final, idempotência, custo negativo/acima da reserva,
  fonte inválida, settled→void bloqueado, voided→settled bloqueado, RLS e late settlement após
  expiração e revogação. Resultado 23/23 PASS, sempre em transação com ROLLBACK.

## Authority e ledger (read-only)

- Authority `3b87224f-071f-486d-88b8-a9dfe0259747`: ativa, não revogada, válida até
  `2026-09-17T10:58:47.786Z`; RunPod; item `8a2515d8-6967-463e-af2a-fd5d2b5e42a1`; 24 GiB; CUDA;
  `maxNodes=1`; `maxHourlyPrice=USD 0.55`; duração 30 min; teto agregado `USD 1.50`.
- Duas reservas abertas: `94641959…` e `0a85dc0f…`, `USD 0.245` cada; committed `USD 0.490`.
- Preview estimado: custos `USD 0.08247` e `USD 0.08250`; excessos possíveis `USD 0.16253` e
  `USD 0.16250`; committed resultante `USD 0.16497`. **Nada aplicado.** Late settlement real
  permanece uma ação humana explícita futura.

## Gates

- Core full: 79 suites, 1643 tests PASS; typecheck PASS.
- Web focais finais: 9 suites, 148 tests PASS; `prepare-resilient-cloud-session` 13/13 PASS;
  typecheck PASS.
- Settlement pgTAP: 23/23 PASS.
- `git diff --check`: PASS (somente avisos CRLF do WIP preexistente).

## Segurança, efeitos e retomada exata

- Zero Pod, zero provider write, zero gasto, zero API proprietária de modelo, zero alteração em
  `origin/main`. Docker/Supabase apenas locais; nenhum navegador.
- Próximo passo sob **um único GO humano**: executar o driver consolidado. Ele faz preflight da
  authority, seleciona candidato, reserva/cria um Pod; em falha recuperável confirma teardown e
  settlement antes de reprovisionar; ao obter health reutiliza o mesmo Pod até review; então faz
  settlement final e teardown. A prova deve terminar confirmando provider zero.

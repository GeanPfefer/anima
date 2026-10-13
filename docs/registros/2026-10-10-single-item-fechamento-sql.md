# Single-Item V1 — fechamento SQL mínimo

2026-10-10 — desenvolvimento e prova local. [Plano 054](../planos/054-single-item-first-attempt-sql.md).

**GO para revisão humana da candidata localizada. Não é autorização de promoção
nem GO de execução.** Não se afirma ausência global de deadlocks ou PASS das
quatro propriedades históricas de orçamento que continuam falhando.

## Implementação

Nova [migration](../../supabase/migrations/20261010000000_single_item_first_attempt_candidate.sql),
SHA-256 `f233e2f7098a873fcfe1781ae4075968078d0cc74c0c30090bd95ecee2d94925`.
Somente três `CREATE OR REPLACE FUNCTION`:

- `public.release_work_claim(uuid,text)`: corpo da candidata item/claim, item próprio antes de claim.
- `public.start_claimed_work_attempt(uuid,uuid,text)`: corpo da candidata de orçamento, nova admissão orçamento → item → claim → alvo; replay sem orçamento de nova admissão e revalidação após esperas.
- `private.begin_work_attempt(uuid,uuid,integer,uuid,text,text,uuid)`: corpo efetivo de `20260721000005`, alterando somente o timestamp da transição para `in_progress` para `GREATEST(v_item.created_at,v_item.updated_at,clock_timestamp())`.

[Diff completo contra baseline](2026-10-10-single-item-fechamento-sql-evidencias/baseline-minimal.diff);
[delta contra corpos candidatos/helper histórico](2026-10-10-single-item-fechamento-sql-evidencias/candidate.diff).
Acquire Single-Item e as três RPCs de retomada não foram alterados ou instalados
por esta migration. Assinaturas, ownership, ACL/grants, RLS, políticas de orçamento,
classificação e auditoria preservados. Sem mudanças de tipos.
O helper também é chamado pelo início comandado; o piso temporal vale para esse
chamador, sem modificar sua ordem de locks ou admissão. Não corrige o relógio nem
os timestamps históricos de eventos; `updated_at` pode permanecer no piso anterior.

## Prova efetivamente executada

Um único novo container, imagem PostgreSQL 15.8 pinada conforme plano 052:
`4a1623b9aeecadd33156fb9e89abdde11faf21111336f77271a1b719e2a23475`.
Cluster `7695092864814764160`, distinto dos históricos. Banco
`anima_single_item_proof_890a47e45cd141adaec715c366dc754e`.
Bootstrap baseline congelado **272/272**, seguido **somente da nova migration**.
Não foram aplicadas as duas candidatas antigas, portanto nenhuma RPC de retomada
da candidata de orçamento foi instalada por arrasto.

Guard real antes de initdb e durante as provas: network none, sem portas/binds/
volumes persistentes; dados/socket em tmpfs; rootfs read-only; cap-drop ALL;
no-new-privileges; 1 CPU, 1 GiB RAM/swap máximo e 64 PIDs. SQL exclusivamente
por socket do container identificado; ambiente filtrado, sem credenciais residentes.

| Prova | Resultado |
|---|---|
| Offline: contrato novo, temporal, sessões, guard, candidata congelada, executor e bootstrap | 113 PASS |
| Catálogo real antes/depois e após testes | 279 funções GO; 118 memberships vector 0.8.0 verificadas; exatamente três corpos alterados, nenhum outro atributo/objeto protegido |
| pgTAP focal | 138 asserções: 134 PASS, 4 FAIL históricos |
| Single-Item canônico, incluído acima | 55/55 PASS, incluindo terceiros ativos/vencidos, autorização, replay e ledger |
| RPCs naturais acquire/start, acquire/release, start/block-budget | 3 PASS completos; primeiros dois A=55000/B=0; orçamento A/B=0; nenhum 40P01/23514 |
| Transação B anterior à criação confirmada do item | PASS sem 23514; rollback e zero órfãos |
| Piso persistido à frente do relógio e replay | PASS; piso de updated_at preservado; um único execution_started; rollback íntegro |
| Revogação durante espera: início em item/orçamento/alvo, liberação em item | 4 PASS com 42501, sem writes parciais; zero órfãos |
| Exclusividade: mesmo item, mesmo alvo, global misto e orçamento | 4 PASS; lock esperado observado, A commit/B recusa, ledger estrangeiro preservado |
| Pré-locks adversariais item/claim e item/orçamento | 2 deadlocks 40P01 comprovados; esperados fora da ordem de entrada; rollback/cleanup completos |

São 15 cenários focais completos além das asserções pgTAP. Não foi repetida a
campanha completa de 334 asserções; seus arquivos/expectativas foram preservados.
FAIL históricos local/externo: asserções **1, 2, 6, 10**, mesmas expectativas e
resultados anteriores; não são PASS nem foram corrigidos nesta sessão.

Controle temporal antigo: B começou `17:39:02.304984Z`, item criado por outra
transação `17:39:03.568664Z`, retorno atualizado `17:39:03.851668Z`. O produtor
anterior `now()` violaria o CHECK nesse controle. Controle adversarial de piso:
clock `17:40:43.282800Z`, created `18:40:43.245611Z`, updated anterior/retornado
`19:40:43.245611Z`; não se alterou o relógio do host/container.

Deadlocks residuais preservados: item/claim, PIDs 28068/28075 e XIDs 1246/1247;
item/orçamento, PIDs 28317/28324, advisory `[16384,815462361,2991672838,1]`
versus XID 1252. A transação A já segurava item antes de entrar na RPC.
As provas naturais não adquiriram locks artificiais de item/claim; a barreira S
segurou somente o alvo. Resultados completos em
[resumo verificável](2026-10-10-single-item-fechamento-sql-evidencias/proof-summary.json).

## Instrumentação e limites

Preservadas, sem substituir logs: controle adicional temporal teve `22P02` na
concatenação do resultado JSON; v2 teve `42501` na leitura de tabela temporária
criada como postgres enquanto authenticated. v3 corrige somente a serialização e
o papel da inspeção; as RPCs continuam authenticated e mesmas asserções passam.
Primeiro controle de revogação não iniciou SQL por `ModuleNotFoundError`: pacote
052 não contém sessões 053. v2 importa explicitamente o runner 053 revisado,
com hash do review conferido. Nenhum corpo de produto foi ajustado após aplicação.

Suíte offline antiga, executada inicialmente no diretório com a nova migration,
recusou inventário não congelado e encontrou o delta temporal agora autorizado;
reexecução no pacote histórico correto: 15 PASS. Invocação inicial de teste
bootstrap não encontrou testes; seleção correta: 25 PASS. Todas essas saídas
permanecem arquivadas; não foram contadas como PASS.

Sem garantia sobre transações compostas, ordens de entrada com pré-locks,
operações entre itens, início comandado versus orçamento, recovery ou retomadas.
Não há benchmark de throughput/starvation ou prova de segurança global.

## Preservação e retomada

156 migrations anteriores, 2.484 arquivos dos pacotes 052r2, 556 hashes bootstrap,
fixtures e gate íntegros ao final. Branch dev, HEAD inicial/final
`6bc4aadef9414d655600c2ea37c6be436b3628c8`, índice vazio, 46 worktrees preservadas.
Nenhum commit/staging/integração. Mudanças desta sessão: migration, teste focal,
plano/registro/evidências e ponteiro append-only no PRD; WIPs anteriores preservados.

Somente o novo container encerrado, não removido; tmpfs perdido após encerramento,
evidências externas duráveis. Catálogo final 279 GO, zero linhas sintéticas e zero
backends órfãos. DB/Auth residentes saudáveis e metadados idênticos; 23 containers
anteriores, redes e volumes preservados. Vector continua unhealthy, com reinícios
preexistentes independentes; não modificado. Host livre 3,93 GiB no preflight e
5,43 GiB numa amostra posterior; WSL sem swap/pressão de memória nas amostras.
Sem OOM no novo container; amostras não são monitoramento contínuo.

Nenhum SQL residente, proposta/backlog/recovery OpenAI, attempt ANIMA, Host,
INV-11, serviço pago ou liberação do gate. Classificações/attempts sintéticas
existiram exclusivamente dentro das provas SQL descartáveis.

Próximo passo: revisão humana do diff mínimo e dos limites acima. Antes de eventual
promoção, inventariar o residente e revisar um pacote que **não aplique por arrasto
as candidatas antigas/RPCs de retomada**. Esta sessão não autoriza instalação
residente, alteração de `resume_from_checkpoint`, remoção de
`single_item_atomic_claim_unavailable` ou execução de self-dev. A fronteira de
execução permanece fechada até autorização e conclusão de seus gates próprios.

# Bootstrap reproduzível — pré-requisitos fechados offline

Data: 2026-10-08. Tipo: desenvolvimento + prova determinística/estática.
Objetivo: fechar fontes/compatibilidade/composição antes da reconstrução descartável.
Branch dev; HEAD inicial/final `6bc4aadef9414d655600c2ea37c6be436b3628c8`.
Commits/staging/push/reset/clean/prune: nenhum. WIPs e worktrees preservados.

Continuação do [registro 247](2026-10-08-bootstrap-247-compatibilidade.md);
fontes táticas: [PRD](../../anima-prd.md), [plano 043](../planos/043-single-item-governed-execution-v0.md)
e [pacote durável](../../supabase/bootstrap/README.md). Histórico anterior intacto.

## Resultado e parecer

**GO técnico condicionado para revisão/autorização de bootstrap diagnóstico** em
NOVA instância descartável. As lacunas conhecidas de fonte/ordem/composição e de
idempotência 248 foram fechadas. **NO-GO para executar nesta sessão**, usar residente,
liberar gate ou afirmar êxito PostgreSQL. Autorização humana/preflight factual da
nova instância e provas reais continuam obrigatórios. Ainda pode haver erro SQL
não detectável pelos instrumentos estáticos; parar na primeira falha.

## Mudanças e bugs

- 247: hash completo sem cabeçalho variável confirmado offline; lookup/hashing/
  replace qualificados pg_catalog, owner postgres/ACL efetiva mínima e allowlist
  explícita de concessões verificados antes de no-op/EXECUTE. Sem GRANT/REVOKE da RPC.
- 248: a original duplicava a guarda sobre 246, não lançava a mesma exceção da 247.
  Correção estrita aceita corpo canônico sem guarda ou corpo corrigido da 246;
  recusa parcial/duplicado/ambíguo/desconhecido e verifica pós-condição. Sem quota,
  política de budget, corpo 246, RLS, assinatura ou application code alterados.
- Audit de privilégio: service_role recebe EXECUTE pelos defaults de 20260620000000;
  246 não o revoga. Preservado e documentado; não declarar authenticated exclusivo.
- Compositor anterior não renderizava namespace Auth nem excluía down da imagem.
  Rendering controlado e scanner de topo corrigidos; escape/identificador da
  etapa 6 preservado, SET de configuração/role insegura recusado.
- Ledger anterior revogava roles não criadas antes do init. Agora schema privado
  fecha PUBLIC sem referenciar roles inexistentes. Hash rendered adicionado.
- Ledger Auth agora acompanha ledger audit na mesma transação, sem upsert silencioso.
  Diretório e parent fsync antes do marcador plan_complete; não overwrites.
- 272 fontes congeladas + 272 payloads + manifest/spec/hash index/verificador
  persistidos em supabase/bootstrap. Os arquivos anteriores não foram limpos.

O ledger não é imutável contra owner/superuser; atomicidade, privileges e confiabilidade
do executor são obrigações de runtime. Scanner != parser e fonte disponível !=
SQL aplicado. SHA256SUMS != assinatura. Detalhes e sequência no pacote durável.

## Recuperação exata de fontes

69 arquivos oficiais Auth v2.189.0, commit
`4fa66ba71d8c55b5c95cd5635766ed8bbae6d96a`; todos os 69 SHA-256 conferiram com
histórico. GET público GitHub API para resolver tag + codeload pelo commit, sem
executar código baixado. Archive SHA-256
`5a6bcb0367aa3adf57e6fced02e43f94997b2828916f5ff133a81ee9861410a1`.
Fontes originais e LICENSE MIT preservados sem normalização ou stubs.

Três pré-requisitos recuperados por AST/literal_eval das chamadas add no registro
local de ferramentas anterior, sem executar o executor recuperado. Hashes históricos
coincidem para ordens 1/48/118. Os bytes/hashes estão no pacote; não é necessário
reter/consultar logs privados para retomar. Nenhum segredo/log privado foi copiado.
Os 46 scripts de imagem e 154 Anima foram congelados byte a byte. Das 272 fontes,
270 mantêm SHA histórico; somente patches autorizados 247/248 diferem.

## Hashes para revisão

| Artefato | SHA-256 |
|---|---|
| 246 inalterada | `6e8e6527fdfb8cf251f000904776a7a27fe5464d7cd7feffc1b91a6ddf7af2ee` |
| 247 arquivo final | `7902b120e07f71bb9500bc6e2b270d19921a79e537f3691d7a2b99aaa86c650e` |
| 248 arquivo final | `3438443f90d26bdc9ddf9686f47ee3cd003d7e63dad23acd398f0736aedebd34` |
| Manifest de fontes | `0ecf79ee3a3880c75917401c2ae91ce509125bbc7624a9e73802ac5e5f06833f` |
| Spec | `b56b82fea48da8228baaca6376a049fbe00353fc691a577c536ce1ee8c7bce96` |
| Plan JSONL (bytes) | `e6f76f92b73e6293ab3c45bd27972e03fecf9486965d69f5aea85508437a2105` |
| Entradas do plano (JSON canônico) | `6ffde5c0bd689c4473c9c1186c97853fb07c5c5d9dcaa8d254d41a0f5596ee13` |
| SHA256SUMS (556 arquivos) | `1ecb76f006b1ee0f17b2ca9922f8f2a4727479ea1180c01e8d7a26f3ec82f1ab` |

Corpos canônicos de função e hashes individuais de todos os arquivos estão no
[pacote](../../supabase/bootstrap/README.md) e no manifest. O
[diff exato de código desta sessão](2026-10-08-bootstrap-prerequisitos-code.diff)
parte dos bytes no início desta tarefa, preservando o WIP de correção 247 anterior.
As fontes/payloads adicionados estão disponíveis inteiros e indexados por hash;
não foram colapsados em um diff de milhares de linhas neste registro.

## Gates e limitações

- 25/25 bootstrap PASS: modelos textuais das duas migrations, patches extraídos
  dos literais reais do SQL, no-op/replay, unknown/parcial/duplicado/adversarial,
  assertivas estáticas metadata/ACL, 272 hashes/ordem, 272 payloads reproduzidos,
  marker/template/escape/terminador/ambos ledgers e recusa de drift.
- 25/25 single_item_concurrency_test.py PASS, testes existentes offline, só
  doubles/processos locais fake; sem concorrência PostgreSQL ou Docker.
- AST Python dos três instrumentos PASS; diff check focal PASS.
- Verificador bundle e SHA256SUMS confirmados; todos os 272 arquivos disponíveis.
- Typecheck TypeScript/build não pertinentes: somente SQL preparado, Python e docs.
  Sem instalação de dependência, TS/application code/tipos alterados.
- Falhas iniciais de adaptação: recovery encontrou comando histórico Python com
  string inválida e passou ao comando válido, sem executá-los; testes antigos de
  fase/escaping/248 atualizados para o contrato novo; scanner confundia `}}` de
  JSON em comentário com template. Corrigido, todos os gates finais verdes.
  Nenhum flake conhecido. Falha DNS em sandbox para GET público resolvida por
  acesso de rede autorizado; nenhuma rejeição de auto-review.

Os 37 testes anteriores e os 50 atuais **não são prova PostgreSQL**. Não foram
observados catálogo/ACL efetiva/owner/commit/rollback/deadlock/STABLE/isolamento
ou extensão da imagem em runtime. Disponibilidade do digest local é pré-condição
futura, sem pull automático. Fsync em WSL/DrvFS não prova power-loss durability.
Não existe executor operacional SQL/Docker neste pacote; seu comportamento será
supervisionado pela próxima sessão autorizada, seguindo o protocolo e hashes.

## Git, efeitos e fronteiras

Status inicial: 13.884 entradas porcelain -uall. Final: 14.439 entradas; nenhuma
entrada anterior removida ou com status alterado. Novo status dirty da 248 e
554 novos arquivos (552 no pacote + diff/registro). Demais alterações desta sessão
estão em arquivos já dirty/não rastreados, autorizados no escopo de bootstrap,
mais adendos PRD/plano/procedimento. Nenhum WIP fora do escopo foi editado.
Snapshot de comparação em /tmp/anima-bootstrap-prereqs-baseline; relato durável aqui.

Sem SQL executado ou banco consultado, incluindo residente read-only. Sem Docker,
container iniciado/removido/recriado, migration aplicada, fixture/pgTAP/concorrência
real, Resident Host, INV-11, API paga, RunPod/compute pago ou integração externa.
Únicos efeitos externos: GET público oficial de fontes/documentação, sem credencial.
`single_item_atomic_claim_unavailable` incondicional; types factuais ainda pendentes.
Sem staging/commit/push/reset/clean/prune. Preservados ambientes e worktrees anteriores.

## Próxima retomada exata

**BLOCKED_BY_HUMAN_DECISION para Docker/SQL**. Revisar diff e hashes do pacote;
autorizar especificamente novo container + initdb como postgres + database nonce +
bootstrap diagnóstico. Revalidar manifest/spec/payloads antes e preflight factual
após criação. Criar ledger privado antes da etapa 1; conectar todas as 272 sessões
à database nonce como login postgres, mantendo a database padrão local postgres
para GRANTs oficiais. No primeiro erro, parar e diagnosticar nova instância/ledger,
sem replay ou cleanup automático. Ao confirmar 272/272 factualmente, parar antes
de fixtures/pgTAP/concorrência/liberação de gate/INV-11 e registrar evidências.

# Execução canônica autônoma no nó remoto

Data: 2026-08-24
Tipo: desenvolvimento + prova viva

`CANONICAL_AUTO_EXECUTION_REMOTE_NODE = PASS`

## Objetivo e estado Git

Provar uma execução canônica sem intervenção humana até `review`, mantendo o plano de
controle, Git, worktree, gates, evidência e Verifier na Goma e delegando somente a inferência
do coder ao Pod RunPod A40 existente.

- Branch: `dev`.
- HEAD inicial: `1d4a79f749fa351918b3ecdf591b765e93a8537d`.
- `origin/dev` inicial: o mesmo SHA; `origin/main=99bec54e3ab42bfe882a8686cd1385d8058b916e`, intacta.
- `.worktrees/`, `.claude/settings.local.json` e `apps/web/.env.local` preservados.
- Nenhum PR, merge, deploy, clone no Pod ou recurso pago adicional.

## Recorte implementado

- `ANIMA_WORKTREE_OLLAMA_URL` seleciona somente o endpoint do coder. Ausente, preserva
  `OLLAMA_URL`/`http://127.0.0.1:11434` e a identidade histórica local.
- Endpoint remoto exige URL HTTP loopback com porta explícita, sem credenciais/path/query,
  `ANIMA_WORKTREE_OLLAMA_LOCALITY=remote` e `ANIMA_WORKTREE_OLLAMA_NODE_ID` seguro; qualquer
  configuração incompleta falha fechada, sem fallback local.
- Evidência prevista e observada converge em
  `ollama:remote/runpod-a40:qwen3-coder:latest`; a mensagem humana do protocolo passou a ser
  neutra quanto à localidade (`Modelo Ollama`) e a identidade estruturada permanece a fonte
  auditável.

## Transporte e nó

- Pod existente `4g36cwpyq2aaml` (`wasteful_brown_bobcat`), A40 48 GB, EU-SE-1, mantido
  `RUNNING`; nenhum lifecycle/storage/GPU foi alterado.
- Ollama 0.32.15 permaneceu em `127.0.0.1:11434` no Pod, sem porta pública.
- Túnel local dedicado: `127.0.0.1:21434` → SSH autenticado → remoto
  `127.0.0.1:11434`; `/api/version`, `/api/tags` e inferência benigna passaram antes do uso.
- Modelo `qwen3-coder:latest`, contexto 8192, 49/49 layers e 100% GPU. Após a prova:
  18.813 MiB VRAM usada, 26.676 MiB livre; cgroup do Pod 50.000.000.000 bytes, uso total
  21.772.132.352 bytes, dos quais 21.205.741.568 eram cache e 491.532.288 RSS.

## Meta-prova viva

Identidade descartável `54db2b9f-3755-4d21-8bf9-b923f0c2ad3a`, sem dado pessoal real,
foi criada administrativamente e inserida somente na allowlist local. A chave
`service_role` foi removida do ambiente antes de iniciar o resident host, executado sem
recarregar `.env.local`; runtime integralmente user-scoped por Bearer/RLS.

Item `d3890a38-fefe-45d5-b9b6-67cfaf75a1c8`, tentativa
`6e9c7935-e5b4-4b69-beb0-d1e98f138010`:

1. fila vazia → `FIX-01` planejado pelo OpenAI apenas na planning boundary;
2. `work_proposed` → `work_approved author=system` → `work_intelligence_classified`;
3. roteamento selecionou `modelRef=ollama:remote/runpod-a40:qwen3-coder:latest`;
4. claim + `execution_started`; coder remoto aplicou a alteração em worktree local;
5. coder observado pelo host: `succeeded`, 10.272 ms;
6. `npm.cmd run typecheck` local: PASS, 21.462 ms;
7. Git observado localmente: commit descartável `1078d1f`, 1 arquivo/3 inserções;
8. Verifier `verified`: 7 checks, 3 attested, 4 independent, 0 gaps, 0 violações;
9. estado final persistido: `review`.

Da materialização ao Verifier decorreram ~42,4 s; da inicialização da instância válida ao
Verifier, ~52,6 s. A tentativa executável (`execution_started` → `result_submitted`) levou
~41,0 s. A Goma tinha 15,87 GiB totais e 4,22 GiB livres antes; após, 4,66 GiB livres.
O Governor passou `permit/low/host_ready`; o qwen3-coder local não foi carregado.

## Integridade, custos e limites

- Worktree/branch da tentativa foi descartada; `docs/registros/_scratch-fixture-materializer.md`
  não apareceu na árvore principal. Worktrees preexistentes foram preservadas.
- O planner recebeu somente objetivo/contrato da fixture por autorização humana limitada;
  nenhum arquivo, diff, backlog real, segredo ou dado pessoal foi enviado.
- O Pod recebeu apenas prompts do coder pelo endpoint loopback; nenhum repo, `.env`, token,
  GitHub ou credencial foi enviado.
- Custo incremental estimado da instância válida: ~US$0,0066 a US$0,45/h; janela do coder:
  ~US$0,0013. Estimativa, não fatura.
- Pod e túnel permaneceram ativos por decisão humana pendente. Não implementar neste recorte
  Node Registry, Capacity Router, provisionamento/stop automático, integração, PR/merge/deploy.

## Próximo ponto exato

Gean decide explicitamente entre continuar usando, parar ou destruir o Pod. Enquanto isso,
o túnel pode ser encerrado localmente pelo PID que possuir a porta 21434; não alterar o Pod
automaticamente.

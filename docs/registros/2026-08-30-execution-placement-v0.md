# Execution Placement V0 provado localmente

- **Data/tipo:** 2026-08-30 — desenvolvimento + prova controlada.
- **Objetivo:** substituir somente a inferência do coder por um node configurado,
  preservando toda autoridade de execução na Goma.
- **Branch / HEAD inicial:** `dev` / `e487832`.
- **HEAD final:** commit que inclui este registro.
- **Commits:** `82ebfce` — `Implemente o placement remoto do coder`; commit de
  documentação que inclui este registro.

## Mudanças e decisões

- `decideCoderPlacement` escolhe `local`, `remote` ou `defer` por pressão e capability.
- Node V0 é configuração explícita, sem descoberta/provisionamento; endpoint remoto só
  é aceito por túnel HTTP loopback, sem credenciais na URL.
- O `Resident Host` pode ultrapassar a recusa local do Resource Governor apenas quando
  há placement remoto elegível; a decisão é refeita com o modelo do contrato antes da attempt.
- `OllamaCoderBackend` continua usando o protocolo existente; `WorktreeExecutorAdapter`
  continua dono de leitura/escrita, Git, gates e checkpoint.
- Evidência host-observed ganhou identidade opcional `placement/nodeId/model`, com
  compatibilidade para eventos legados e espelho SQL fail-closed.
- Compute `paid` permanece inelegível no caminho vivo (`paidComputeAuthorized=false`)
  até existir autorização financeira canônica persistida.

## Provas

- Placement/backend/evidence/governor/driver: 110/110 web verdes.
- Evidência core: 21/21 verdes.
- Ollama coder/protocolo/selection: 120 testes focados verdes nas execuções divididas.
- Worktree executor completo: 36/36 verdes em 39,144 s.
- Prova remota controlada isolada: endpoint efêmero → operação → aplicação local →
  checkpoint local → gate real → evidência remota, verde em 1,563 s (suíte 7,141 s).
- Typecheck raiz: mobile, web, core, supabase e types verdes.
- Supabase: migration `20260830000002` aplicada sem reset; 44 arquivos / 994 testes
  pgTAP verdes. A invocação focada inicial não montou `helpers/routing.inc`; duas
  iterações da suíte completa revelaram e corrigiram somente o papel/temp-table das
  novas asserções antes do passe final.
- `git diff --check`: verde (somente avisos de normalização LF/CRLF).

## Segurança e efeitos externos

- Nenhuma cloud, VM/GPU, deploy, merge, main, segredo ou gasto externo.
- Nenhum node escreveu no repositório; a workspace original permaneceu intacta.
- `.worktrees/`, `.claude/settings.local.json` e `watch4-sensors.txt` preservados.
- O push normal de `dev` foi tentado, mas a política do host não aceitou como
  autorização direta o texto anexado; nenhum commit foi enviado. Sem force-push.

## Próximo ponto exato

Executar prova viva pelo Resident Host com um Ollama real separado atrás de túnel local
e persistir a evidência no Supabase. Só depois desenhar a porta manual de provisionamento
on-demand V1, condicionada a autorização financeira persistida.

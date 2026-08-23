# Auto-approval canônico V1 — implementação pronta, meta-prova bloqueada no planner local

Data: 2026-08-23
Tipo: desenvolvimento + tentativa de prova viva

`CANONICAL_AUTO_EXECUTION = NOT_PROVEN`
`BLOCKED_BY_LOCAL_PLANNER = TRUE`

## Objetivo e estado Git

Fechar fixture canônica → materialização → autorização sistêmica → Supervisor → coder local
→ worktree → gates → evidência host-observed → Verifier → review, sem aprovação manual.

- Branch: `dev`.
- HEAD inicial: `74cedb31bac247f4f4463728eb8b5d605c7c793b`.
- Commit funcional: `6a3ed9e` — `Implemente a autorização autônoma canônica`.
- `origin/main`: `99bec54e3ab42bfe882a8686cd1385d8058b916e`, intacta.
- A implementação foi commitada depois da recuperação pós-reboot e da repetição dos gates
  mínimos; a meta-prova continua explicitamente não provada. Nenhum PR, merge ou deploy.
- `.worktrees/`, `.claude/settings.local.json` e `apps/web/.env.local` preservados.

## Implementação no working tree

- evaluator puro `evaluateAutonomousApprovalEnvelope`, envelope V1 estreito e fail-closed;
- RPC `auto_approve_autonomous_work`: append-only/idempotente, `work_approved`
  `author=system`, payload `authority=autonomous_policy`, sem reutilizar `resolve_approval`;
- tipos Supabase regenerados a partir do schema local migrado, sem `db reset`;
- adapter application-side lê o item persistido, consulta o Governor, avalia a policy,
  persiste pela RPC existente a classificação de inteligência derivada do envelope e só
  então persiste a decisão; erros/ambiguidade voltam para humano;
- resident host encadeia causalmente materialização → autorização; a execução continua pela
  fila/Supervisor existentes, sem segunda maquinaria.

## Provas e gates

- evaluator core: 23/23 PASS;
- adapter + resident host: 41/41 PASS;
- pgTAP da RPC: 17/17 PASS;
- typecheck: 5/5 workspaces PASS;
- suíte geral: mobile 51/51, web 867/868 na corrida conjunta, core 1010/1010 e supabase
  8/8 (+2 skipped). A única falha foi timeout de 5 s em `project-tools.test.ts` sob carga;
  repetição isolada 4/4 PASS em 77 ms — flake de infraestrutura, não regressão.

## Tentativas vivas e barreira comprovada

Uma identidade descartável local, isolada e allowlisted foi usada. A primeira execução não
autenticou por campos de token nulos da fixture SQL; corrigidos apenas nessa identidade, o
GoTrue autenticou e o Realtime assinou. Na execução válida, uma única instância bounded do
resident host realizou oito host-turns; todos pararam em
`waiting_resource/host_turn_resource_pressure`, com zero itens tocados.

Medição pelo mesmo seam do produto: inicialmente `verdict=defer`, `pressure=moderate`, 2,83
GiB livres de 15,87 GiB (17,8%); reserva confortável V0 = 25%. O Governor depois recuperou
honestamente para `permit`, sem reduzir a reserva. Nessa janela, o resident host materializou
`FIX-01` e persistiu `work_approved author=system` com envelope completo. O wake ocorreu por
evento, mas a fila permaneceu vazia: faltava `work_intelligence_classified`, antes criado só
pela borda humana de `supervisor-turn`. A correção mínima passou a derivar e persistir essa
classificação do envelope antes da aprovação; testes focados ficaram verdes.

O item incompleto foi removido exclusivamente da identidade-fixture e a prova reiniciada com
fila vazia. Duas tentativas bounded com planner local falharam antes de qualquer mensagem/item
persistido: `planning_failed: ... não chegou a uma proposta terminal` e `planning_failed: ...
não produziu uma proposta estruturada`. Modelos foram descarregados entre tentativas e o
Governor respeitado. Uma tentativa de usar o planner OpenAI configurado foi bloqueada antes
de iniciar pela política do ambiente, pois egress de contexto requer autorização explícita;
nenhum provider externo foi chamado.

## Invariantes e próximo ponto exato

- backlog real não alterado; fixture documental controlada;
- nenhuma aprovação humana ou `author=user` fabricada;
- nenhum efeito externo, integração, credencial no log, PR, merge, deploy ou push;
- não reduzir a reserva do Governor nem encerrar processos do usuário para fabricar PASS.

Retomar exatamente por uma destas vias: (a) corrigir/provar a terminalidade do planner local
no protocolo estruturado sem afrouxar o host, começando pela comparação controlada com
`ANIMA_PROJECT_PLANNER_MODEL=qwen3-coder:latest`; ou (b) obter autorização humana explícita
para usar o planner externo já configurado apenas na fronteira de proposta. Com
Governor=`permit`, repetir uma única instância bounded; verificar cadeia de eventos, coder/modelo local,
worktree/gates/evidências/Verifier/review; só então declarar
`CANONICAL_AUTO_EXECUTION_LOCAL = PASS` e persistir eventual correção causal separadamente.

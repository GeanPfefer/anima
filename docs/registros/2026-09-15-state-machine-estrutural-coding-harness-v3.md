# 2026-09-15 — State machine estrutural do Coding Harness V3

Data: 2026-09-15  
Tipo: desenvolvimento e prova local determinística

## Objetivo e estado Git

Continuação direta do WIP de 2026-09-14/15 para tornar `SUBMIT` estruturalmente
dependente das provas da revisão corrente. Branch `dev`; HEAD inicial e final
`b14a32c1d7ca1d361f1a3c1519e2fbec351a0669`; nenhum commit. `origin/main`
permaneceu em `99bec54e3ab42bfe882a8686cd1385d8058b916e`.

## Resultado

- Estados canônicos: `exploring` → `dirty_unvalidated` → `dirty_validated` →
  `ready_to_submit`; somente o último anuncia/aceita `submit`.
- `editRevision` liga TEST verde e `git diff` à edição atual; novo EDIT invalida
  ambas as provas. TEST vermelho não avança.
- Esgotamentos pós-edit falham com `ollama_submit_gate_unsatisfied` quando há
  validação executável e faltam provas; tarefas sem `validationCommands` mantêm a
  compatibilidade histórica.
- O diff vazio só é aceito para criação real de arquivo untracked; alteração de
  arquivo existente continua exigindo diff não vazio.
- Transcript ganhou eventos host-observed de estado, revisão, TEST/EXEC,
  GIT/DIFF e submit bloqueado/permitido.

## Regressão de provisioning

O fake node tinha duas suposições obsoletas: buscava `ready_to_submit` no corpo
HTTP inteiro (o termo já aparece nas instruções do prompt inicial) e reportava
`prompt_eval_count=1000`, menor que a estimativa do prompt V3 (~2182). Isso fazia
SUBMIT prematuro ou a guarda legítima `ollama_prompt_truncated` encerrar a prova.
O fixture agora extrai o conteúdo do prompt e lê o marcador autoritativo
`Ações permitidas nesta rodada (estado ...)`; também reporta capacidade de prompt
suficiente. Nenhuma regra de produção foi afrouxada.

## Provas

- Core focal: 1 suíte / 16 testes PASS; typecheck core PASS.
- Web focal/sweep: 8 suítes / 237 testes PASS (`ollama-coder`, protocolo,
  transcript, GPT wrapper, coder-backend, executor, supervisor e provisioning).
- Reexecução conjunta executor/supervisor/provisioning: 3 suítes / 50 testes PASS.
- `git diff --check`: PASS.
- Typecheck web permanece vermelho somente em scripts operacionais preexistentes
  e fora deste recorte; nenhum erro aponta para os arquivos da state machine.

## Segurança e efeitos externos

Zero chamada a provider, OpenAI ou RunPod; zero authority, reservation, successor,
settlement ou mutation de orchestration persistida; nenhum push/PR/merge/deploy.
As worktrees e todo o WIP preexistente foram preservados.

## Retomada

A correção estrutural e o sweep focal estão verdes. Antes de qualquer benchmark
pago, continua necessária autorização humana própria; esta sessão não a criou nem
a inferiu.

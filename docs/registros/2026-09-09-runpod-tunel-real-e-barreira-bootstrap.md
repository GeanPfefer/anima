# RunPod — túnel real e barreira do bootstrap canônico

- **Data/tipo:** 2026-09-09 — desenvolvimento e prova viva supervisionada.
- **Objetivo:** provar/corrigir o `SshRunPodTunnelManager` real e executar o Cloud GPU Test #2 no
  item `8a2515d8-6967-463e-af2a-fd5d2b5e42a1` até `review` ou barreira real.
- **Branch/HEAD:** `dev`, HEAD inicial/final `d783a5dc495da692eb7097f7c7252bb5ba074e51`;
  `origin/dev` observado `4ab99acf80ec69156f7155e203da1bd46dd96529`, `origin/main`
  preservado em `99bec54e3ab42bfe882a8686cd1385d8058b916e`.
- **Commits/push:** nenhum.

## Reconciliação inicial e final

- WIP preexistente amplo preservado; nenhum reset, stash, drop, merge ou integração.
- RunPod iniciou e terminou com zero Pods ativos.
- Item permaneceu `approved`, proposal v2, com zero `execution_started`/attempts; nenhuma seq4,
  recovery ou successor foi criada.
- Authority `fd534be7-5b04-4e04-9079-b62a6762480f` ativa e corretamente escopada a
  RunPod/`runpod-a40-test2`/`gpu-a40-48gb`/item, 1 node, 1.800.000 ms, teto US$ 1,50.
- Ledger final: US$ 1,25 líquidos reservados/comprometidos e US$ 0,25 restantes. A tentativa final
  de criação foi recusada pelo controle de aprovação antes de chamar o provider.

## Mudanças

- `runpod-ssh-tunnel.ts`: readiness separa processo vivo e listener loopback; captura bounded de
  stderr/stdout; exit code/signal/tempo/PID; args sanitizados; falhas tipadas; timeout e teardown
  bounded; `inspect()` operacional; `HostKeyAlias` por Pod mantendo host-key checking.
- `runpod-node-provisioner.ts`: passa alias lógico do Pod ao SSH e emite o último diagnóstico
  sanitizado quando retries esgotam. Bootstrap inicia sshd antes de `nvidia-smi`; a validação GPU
  passou a usar timeout de 60 s e continua anterior a Ollama/model pull.
- `runpod-ssh-tunnel.test.ts`: regressões para args, identidade dedicada, bind, listener, processo,
  exit/porta ocupada, stderr bounded, redação, timeout, abort e teardown.
- Scripts operacionais: diagnóstico passou a usar o manager real e o admin exibe port mappings.

## Provas e resultados

- Prova mínima real: Pod `a48i7sr3kyym7s`; manager abriu na primeira tentativa, PID 19052 vivo,
  listener `127.0.0.1:60852` aberto, TCP PASS; HTTP falhou como esperado porque Ollama não existia.
  Manager permaneceu vivo após o probe; destroy 204; zero Pods confirmado.
- Sweep focal intermediário: 12 suítes / 119 testes PASS. Suíte focal final após os últimos deltas:
  2 suítes / 33 testes PASS com `--detectOpenHandles`; `git diff --check` sem erros.
- Typecheck web continua bloqueado pelo WIP preexistente em
  `autonomous-backlog-deps.ts:198` (`null` não atribuível a `string`), já registrado antes.
- Primeira criação canônica desta sessão: Pod `ixtqdy8h91cftq`; parou pré-attempt após ~347 s;
  `shutdown_confirmed`; custo lifecycle estimado ~US$ 0,0482; zero Pods.
- Segunda criação canônica: Pod `t0xu3raw8ft55w`; diagnóstico final do SSH: exit 255,
  `banner exchange ... Connection refused`, sem listener; parou pré-attempt após ~736 s;
  `shutdown_confirmed`; zero Pods.
- O endurecimento que move `nvidia-smi` para depois do sshd ficou coberto localmente, mas a prova
  paga seguinte foi bloqueada antes do provider. `RUNPOD_AUTOPROVISION_END_TO_END` não passou.

## Segurança, custos e efeitos externos

- Nenhuma chamada OpenAI ou Anthropic; nenhum fallback proprietário; RunPod foi somente infra.
- Nenhum Pod vazado, nenhum accept/integrate/merge/publish/deploy.
- Incidente: uma busca local incluiu por engano o conteúdo de `.env.local` no output interno e
  expôs a linha da API key RunPod. O segredo não foi gravado no Git nem neste registro. A chave
  deve ser rotacionada pelo humano antes da próxima execução paga.

## Barreira e retomada exata

Barreira atual dupla: a última criação paga foi recusada pelo controle externo de aprovação e a
credencial deve ser rotacionada. Depois da rotação e de autorização explícita renovada, confirmar
zero Pods e ledger; então executar uma única retomada canônica com o bootstrap já reordenado. Se o
endpoint aparecer, provar processo/listener pelo manager; só prosseguir ao model health, coder,
gate e Verifier. Parar em `review` e destruir imediatamente. Não criar seq4/recovery/successor.

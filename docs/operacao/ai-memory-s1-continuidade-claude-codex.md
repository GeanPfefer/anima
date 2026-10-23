# ai-memory S1 — continuidade Claude ↔ Codex (runbook)

Procedimento do **operador** para sessões interativas supervisionadas de desenvolvimento do ANIMA com memória compartilhada entre Claude Code e Codex. Contexto, provas e limites: [`../registros/2026-10-23-ai-memory-s1-continuidade-interativa.md`](../registros/2026-10-23-ai-memory-s1-continuidade-interativa.md).

## Escopo e estatuto

- Ferramenta do operador. **Não é executor governado** nem fonte de autoridade: o histórico do ANIMA (Git, ledger, registros, Verifier, gates) continua a fonte de verdade. O ledger do ai-memory é memória auxiliar e descartável.
- **Fora do escopo:** Single-Item, L1/E2, Codex WSL (o wrap é recusado nesses caminhos), attempts e work items governados.
- Versão pinada: ai-memory **2.4.1**. Não instalar nem atualizar para 3.x sem nova decisão e nova prova.
- Sem API paga: Claude por assinatura (`claude.ai`) e Codex por assinatura (ChatGPT).

## Privacidade e segurança

- **Nunca enviar segredos reais ao S1.** O ledger guarda mensagens e argumentos de ferramentas **em texto claro**; o sanitizador é parcial.
- Armazenamento local, servidor só em loopback (`127.0.0.1:49394`), `embedding_provider="none"`, sem LLM, webhook ou `server_url` remoto, sem serviço permanente.
- Sem hooks nem MCP globais; sem `setup`, `install.ps1`, `install-hooks --apply` ou `install-mcp --apply`; sem alterar PATH; sem variáveis de API (o script de operação recusa rodar se houver).
- **Checkout com segredos:** se o diretório de trabalho contém arquivos como `.env.local`, **não** aponte o agente para ele. Crie um **snapshot** (por exemplo, `git archive` de um commit, mais só os documentos necessários), sem `.env*` nem arquivos não rastreados sensíveis, e use o snapshot como diretório de trabalho. Para leitura, restrinja os agentes: Claude com `--tools Read,Glob,Grep`; Codex com `sandbox_mode=read-only` e `approval_policy=never`.
- Leitura não é confinada por sandbox de escrita; dependa do snapshot, não da sandbox.

## Pré-requisitos (uma vez)

- Diretório do laboratório do operador, **fora do Git**, com: dados do servidor, `hooks` do Claude (`--settings`), **`CODEX_HOME` exclusivo** do S1 com `hooks.json` próprio e login ChatGPT feito pelo operador, shim do Codex e o script de operação `s1.ps1`. Nada disso é versionado aqui.
- `CODEX_HOME` do S1 **nunca** é o do L1, nem o de `~\.codex`, nem o de outro laboratório. Os hooks do Codex do S1 apontam só para o `ai-memory.exe` 2.4.1, o `--data-dir` do S1 e a porta 49394.
- Hooks do Codex confiados pela interface nativa (`/hooks`) pelo operador; **não** usar `--dangerously-bypass-hook-trust`. Estado conhecido: **seis** confiados (`session_start`, `user_prompt_submit`, `pre_tool_use`, `post_tool_use`, `pre_compact`, `session_end`); `Stop` **sem confiança** (o fim de turno do Codex não é capturado).

## Iniciar, verificar e encerrar

```powershell
cd <diretorio-do-laboratorio-S1>
.\s1.ps1 start     # sobe o servidor oculto; confere o hash do exe pinado; registra o PID
.\s1.ps1 status    # saúde, workstreams, runs, context_delivered e último sync (sem ler conteúdo)
.\s1.ps1 stop      # encerra apenas o servidor criado pelo script
```

## Alternar Claude e Codex no mesmo workstream

O primeiro agente cria o workstream (`-New`); o outro continua com o mesmo nome. Mesmo diretório de trabalho para ambos.

```powershell
.\s1.ps1 run -Agent claude -Workstream minha-tarefa -New -Cwd <diretorio>
.\s1.ps1 run -Agent codex  -Workstream minha-tarefa -Cwd <diretorio>
.\s1.ps1 run -Agent claude -Workstream minha-tarefa -Cwd <diretorio>
```

Argumentos do agente vão no fim, via `-Pass`; `-Capture <nome>` grava a saída em área privada do laboratório (tratar como sensível; não versionar).

## Handoff: compacto, no fim, com confirmação

O contexto entregue ao agente seguinte tem orçamento de cerca de **9 KB**; relatórios longos são truncados e o final se perde.

1. **Encerre a sessão com um handoff de até 3 KB como a ÚLTIMA mensagem.** Conteúdo: um marcador curto (por exemplo, `HANDOFF-ID=<8 hex novos>`), as afirmações-chave verificáveis com `caminho:linha`, as perguntas abertas e o ponto onde parou.
2. **Abra a sessão seguinte pedindo, na primeira linha da resposta, a devolução do marcador** (e dos títulos das afirmações), ou "não recebido" e parar. O prompt **não** deve conter o handoff nem o marcador.
3. Se vier "não recebido", **não reconstrua por adivinhação**: peça ao agente anterior para reemitir um handoff compacto e repita a continuação.

## Verificar a entrega real (não só `context_delivered`)

- `status` com `context_delivered ≥ 1` e `sync` igual ao último evento do agente anterior prova apenas **sincronização**.
- A entrega do **conteúdo** é provada pelo marcador devolvido na primeira linha e pela verificação independente das afirmações. Em investigação, o agente seguinte deve conferir cada afirmação no código.
- Se necessário, confirme a entrada do modelo inspecionando apenas a **presença** do marcador no registro de sessão do agente (contagem, sem ler o conteúdo).

## Recuperação

- Servidor fora do ar: `.\s1.ps1 start`. O script recusa `run` se a saúde falhar.
- Lease preso por um launcher morto: usar `ai-memory run --force-unlock` **somente** quando se tem certeza de que o launcher não existe mais.
- Handoff truncado: reemitir em formato compacto (ver acima); o agente também pode buscar o restante no ledger (`ai-memory workstream-search`, com o id do workstream indicado no cabeçalho do contexto).
- Hook não confiado ou ausente: o Codex segue funcionando, mas sem captura do evento correspondente; reabrir `/hooks` na interface nativa e conferir.

## Rollback

1. `.\s1.ps1 stop`.
2. Apagar o diretório do laboratório (dados, hooks, `CODEX_HOME`, evidência) — ou apenas o diretório de dados para zerar a memória. Nada global foi alterado, então não há mais nada a desfazer.
3. Opcional: apagar as transcrições do Claude dos diretórios usados pelo S1 em `~\.claude\projects\`.
4. Conferir que as configurações globais de Claude (`settings.json`) e Codex (`config.toml`) mantêm os hashes anteriores às sessões do S1.

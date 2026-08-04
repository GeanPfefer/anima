# Anima Local Agent POC

Agente local de programação por terminal, usando Ollama e sem VS Code. Este é um POC isolado; não integra nem altera o Anima.

## Requisitos

- Windows 10/11, PowerShell e Python 3.11+
- Git
- Ollama em `http://127.0.0.1:11434`
- Modelo `qwen2.5-coder:14b`
- Docker Desktop com contêineres Linux

## Instalação

```powershell
cd "CAMINHO\PARA\anima-local-agent-poc"
py -3.11 -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
ollama pull qwen2.5-coder:14b
docker build -t anima-local-agent-python:0.1 .
```

## Validação

```powershell
python -m pytest -q
python -m compileall local_agent tests
python -m mypy local_agent
ollama list
```

Prepare a workspace descartável:

```powershell
cd .\example_workspace
git init
git add .
git commit -m "test: baseline descartável"
cd ..
```

## Uso

Interativo:

```powershell
python -m local_agent --workspace "$PWD\example_workspace" --model qwen2.5-coder:14b
```

Direto:

```powershell
python -m local_agent --workspace "$PWD\example_workspace" --task "Adicione uma função sum(a, b), crie testes, rode-os e mostre o diff."
```

Produzir resultado para revisão sem alterar a workspace original:

```powershell
python -m local_agent --workspace "$PWD\example_workspace" --task "Adicione uma função sum(a, b) e teste." --produce-only
```

Nesse modo, o runner termina em `result_produced`, persiste manifesto, testes, evidência sanitizada e um bundle local dos arquivos produzidos em `.anima-agent-evidence`, e não chama a etapa transacional de aplicação. A evidência referencia o bundle por nome opaco e SHA-256, sem persistir caminho absoluto. A última linha `ANIMA_RESULT_JSON=<json>` expõe o estado, os caminhos relativos produzidos e essas referências em um envelope V1 estável para adaptadores locais. A aplicação permanece uma decisão posterior e separada.

Não existe autoaprovação no fluxo normal. Toda execução exige confirmação manual. O POC aceita apenas Ollama local e execução Python dentro da imagem isolada. Variáveis configuráveis estão em `.env.example`.

## Operação segura

O agente pede uma aprovação inicial do plano. Ações seguras seguem sem microconfirmações. Operações sensíveis são bloqueadas neste MVP, em vez de executadas. Para solicitar alteração de escopo, negue e reinicie com uma tarefa revisada.

Comandos Python rodam em contêiner efêmero com `network none`, usuário não root, raiz somente leitura, capacidades removidas e limites de CPU, memória e PIDs. A workspace original não é montada: cada comando recebe uma cópia sanitizada sem `.git`, `.agent`, `.env`, credenciais ou symlinks. Mudanças persistentes continuam passando pelas ferramentas confinadas da aplicação. Sem Docker, a execução falha fechada e nunca cai para o host.

Antes do planejamento, a aplicação registra `git status`, `git diff` e hashes dos arquivos não sensíveis. Workspaces sujas são recusadas por padrão; interativamente é possível abortar, preservar o baseline identificado ou escolher outra workspace. Em automação descartável, `--allow-dirty` torna essa escolha explícita.

No Windows, todo comando Git recebe apenas no próprio processo `git -c safe.directory=<workspace> ...`. A configuração global nunca é modificada. Isso permite operar workspaces criadas por outra conta de sandbox sem confiar globalmente em outros diretórios.

O planejador retorna um objeto validado com apenas objetivo, etapas futuras, impacto e riscos. Planos com código, campos extras ou alegações de execução são regenerados e nunca são exibidos diretamente.

Os comandos `/status`, `/diff`, `/stop` e `/help` ficam como evolução do REPL; status e diff já são mostrados automaticamente ao final.

Logs sanitizados são gravados em `.agent/runs/` dentro da workspace e devem permanecer ignorados pelo Git.

## Revisão

Testes e diff são obrigatórios. Uma revisão separada deve abrir novo contexto somente leitura e comparar resultado, critérios e riscos. Como usa o mesmo modelo, não equivale a independência forte; revisão humana ou outro modelo continua recomendada.

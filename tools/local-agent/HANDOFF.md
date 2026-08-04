# Handoff — Anima Local Agent POC

Última atualização: 2026-08-04 (integração ao monorepo em `tools/local-agent`; antes: 2026-07-16, branch `fix/complete-requires-passing-tests`).

> **Antes de qualquer tarefa no Anima, leia o `AGENTS.md` na raiz do monorepo** — o roteador operacional canônico. Este handoff cobre apenas o runner local.

## Propósito

POC de um runner agêntico local que executa tarefas de programação com modelo via Ollama, em workspace isolada, com aprovação humana inicial e gates factuais antes de qualquer alteração persistir. O código foi **trazido para o monorepo em `tools/local-agent`** (por `git subtree`), mas mantém processo, ambiente Python, workspace temporária e contratos de segurança **separados** da aplicação web — nenhum código do runner é importado por `apps/web`.

## O que já está comprovado

- Plano estruturado validado + aprovação humana antes de qualquer execução.
- Execução somente em cópia temporária sanitizada; comandos Python em contêiner efêmero isolado (sem rede, sem root, fail-closed sem Docker).
- `action=complete` só é aceito com evidência de testes verdes (exit 0, >0 testes, sem timeout) na geração de escrita atual; qualquer edição posterior invalida a evidência.
- Sem evidência, o runner executa o comando de teste configurado e devolve ao modelo um resumo estruturado da falha (comando, exit code, contagem, stdout/stderr); o loop continua e o modelo pode corrigir. Duas recusas sem nova edição encerram como falha (exit 6), com evidência sanitizada persistida.
- Gate final independente reexecuta os testes antes de aplicar; aplicação é transacional com rollback e a workspace original permanece intacta em qualquer falha.
- Comprovação: suíte pytest (incluindo `tests/test_cli.py::test_cli_full_fix_cycle_is_deterministic_with_fake_executor`, que simula o ciclo completo falha→feedback→correção→verde→applied sem dependências externas) e dois E2E reais com Ollama+Docker terminando em `applied` (evidências em `G:\agent-lab-e2e\.anima-agent-evidence`).

## Instalar e rodar os testes

```powershell
cd G:\anima-local-agent-poc
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m mypy local_agent
```

A suíte inteira roda sem Ollama; os testes que exigem Docker são pulados automaticamente quando ele está fora do ar.

## Executar um E2E real

Requisitos: Ollama local com um modelo coder (`qwen2.5-coder:14b` ou `qwen3-coder:30b`) e Docker com a imagem `anima-local-agent-python:0.1` (`docker build -t anima-local-agent-python:0.1 .`).

```powershell
$env:OLLAMA_MODEL = 'qwen2.5-coder:14b'
$env:LOCAL_AGENT_TEST_COMMAND = 'python -m unittest'   # pytest não existe na imagem
.\.venv\Scripts\python.exe -m local_agent --workspace 'CAMINHO\DA\WORKSPACE' --task 'sua tarefa'
```

A workspace deve ser um repositório git limpo. Armadilhas conhecidas do Windows: o PowerShell 5.1 injeta BOM ao canalizar stdin (a aprovação `A` chega corrompida) e o Git Bash corrompe acentos em argv — em automação, passe tarefa e aprovação via arquivo UTF-8 sem BOM redirecionado ao stdin, com `PYTHONIOENCODING=utf-8`. O git interno ignora a config global (`GIT_CONFIG_NOSYSTEM=1`); workspaces preparadas à mão precisam de arquivos LF com `core.autocrlf=false` local para o status inicial ficar limpo.

## Limitações conhecidas

- Modelos locais são instáveis no protocolo: o planejamento pode ser recusado legitimamente (basta reexecutar) e `qwen2.5-coder:14b` às vezes escapa aspas dentro de conteúdo JSON, produzindo Python inválido que ele não corrige.
- `run_tests` aceita somente comandos exatos da allowlist; modelos tendem a acrescentar argumentos e falham — a validação automática na conclusão compensa.
- A revisão somente leitura usa o mesmo modelo; não é independência forte.
- Um run cobre uma tarefa por vez; não há fila, scheduler, retomada ou roteamento de modelos.
- `example_workspace/` carrega estado histórico de runs antigos; use workspaces novas para E2E.

## Relação futura com o Anima

O contrato da fase F8 do Anima (`packages/core/src/work-orchestration/executor.ts`, `WorkExecutorAdapter`) prevê executores reais substituíveis. Este POC é o candidato a primeiro executor real: o ciclo aprovado aqui (proposta → aprovação → execução isolada → evidência → gate → aplicação) espelha o fluxo de orquestração do Anima. A integração só deve acontecer com autorização explícita e via adaptador, mantendo o core do Anima independente de fornecedor.

## Regra de separação

O runner permanece fora do repositório `G:\anima` por enquanto. Não mover código para lá, não adicionar dependências cruzadas e não fazer push deste repositório sem autorização explícita.

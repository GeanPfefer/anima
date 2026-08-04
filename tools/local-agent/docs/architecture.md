# Arquitetura

O CLI separa configuração, sandbox de filesystem, política de comandos, executor de processos, ferramentas, cliente Ollama e loop do agente. O modelo nunca recebe uma ferramenta de shell livre: toda chamada passa por schema, parsing, allowlist e limites.

O executor de comandos cria uma cópia sanitizada da workspace, monta somente essa cópia em um contêiner efêmero e a descarta depois. O contêiner não persiste alterações; edições reais passam por `write_file`, que resolve caminhos no sandbox da aplicação. Nesta rodada, apenas Python é suportado.

Fluxo: `/api/tags` → snapshot factual somente leitura → tarefa → plano JSON estruturado sem ferramentas → validação e renderização pela aplicação → aprovação única → `/api/chat` com tool calling → ferramentas confinadas → testes/diff → resumo atribuído contra o baseline → nova chamada sem ferramentas para revisão somente leitura. A revisão automática não altera arquivos e não representa independência forte por usar o mesmo modelo.

O snapshot inclui status, diff staged/unstaged e SHA-256 dos arquivos rastreados ou não ignorados. Uma negação captura novamente o estado e exige igualdade total. Em baseline sujo, a aplicação preserva a lista e o diff preexistentes e calcula as mudanças da execução pela diferença de hashes.

O projeto deliberadamente não inclui banco, filas, UI, commits remotos nem integração com o Anima.

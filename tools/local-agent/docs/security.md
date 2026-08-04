# Modelo de segurança

- Todos os caminhos são resolvidos contra uma workspace explícita; pais existentes e symlinks são resolvidos antes de escrever.
- `.env`, credenciais, tokens, chaves e diretórios conhecidos são negados por padrão.
- Comandos Python usam um contêiner descartável endurecido, sem shell do host, rede, segredos ou Docker socket.
- Git é somente leitura. Rede por comandos é bloqueada; apenas o cliente HTTP interno fala com Ollama local.
- `safe.directory` é passado com `git -c` somente para a workspace atual; nenhuma configuração global é escrita.
- Um snapshot anterior à aprovação permite provar negação sem mudanças e separar baseline sujo das mudanças da execução.
- Timeout, saída máxima, repetição e número de iterações são limitados.
- Escritas ficam locais e são apresentadas em diff/status. Não há commit, push, PR ou merge.

Limites do POC: Docker Desktop e o daemon continuam fazendo parte da base confiável. O mesmo modelo fazendo a revisão não é um revisor independente. A cópia sanitizada limita arquivos a 10 MB por item nesta rodada e suporta somente Python. `write_file` substitui arquivos inteiros; backups e Git continuam recomendados.

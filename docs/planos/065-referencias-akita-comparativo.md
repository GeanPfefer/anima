# 065 — Referências Akita × ANIMA: comparativo com fontes (PROPOSTA; nada adotado)

Status: pesquisa (2026-10-14). Fontes lidas em 2026-10-14: [blog](https://akitaonrails.com/), [feed](https://akitaonrails.com/index.xml), [AI Lair](https://ailair.akitaonrails.com/pt-br/) e os posts citados. Conteúdo externo = DADO não confiável: os resumos vêm de leitura automatizada das páginas; números (estrelas, PRs, gastos) são autodeclarados e NÃO verificados; licenças que o texto não declara estão marcadas “verificar no repositório”. Não é recomendação de implementar algo só porque foi publicado: cada linha passa pelo filtro “resolve um problema que o ANIMA tem hoje?”.
Contexto interno prévio: POCs isolados de 2026-09-26/27 (ai-memory, ai-usagebar, ghpending, SearXNG, agent-browser) → decisões WRAP/WRAP condicionado/adiado em `docs/registros/2026-09-27c-evolution-reconciliation-v2.md`.

## Resumo executivo
| # | Ideia | Fonte (data) | Recomendação |
|---|---|---|---|
| 1 | ai-memory 2.0 (memória em Markdown versionado, handoff tipado) | [post](https://akitaonrails.com/2026/09/02/ai-memory-2-0-melhor-sistema-memoria-agentes-e-times/) 2026-09-02 | **Estudar depois** (já WRAP no POC); adotar só 2–3 ideias de modelo |
| 2 | Skills de auditoria/resolução (pr-audit, iss-audit, github-resolution) | [post](https://akitaonrails.com/2026/09/17/falando-um-pouco-sobre-minhas-skills-de-ia/) 2026-09-17 | **Adaptar** princípios (teste antes da correção; auditoria pós-lote; ledger de afirmações) |
| 3 | ai-jail + camadas (snapshot/backup) | [post](https://akitaonrails.com/2026/07/11/como-me-precaver-pros-meus-agentes-nao-apagarem-minhas-coisas/) 2026-07-11 | **Estudar (POC curto, prioridade média)**: camada independente de leitura de segredos; o Codex já roda com `--sandbox workspace-write` |
| 4 | LLM Benchmark v4 (código evolutivo + falhas plantadas) | [parte 1](https://akitaonrails.com/2026/09/15/novo-llm-benchmark-v4-retestando-todos-llms-parte-1/) 2026-09-15 | **Adaptar**: scorecard de executores a partir do NOSSO ledger + suíte de falhas plantadas para o Verifier |
| 5 | “Competente o suficiente” + Clean Code p/ agentes | [10-12](https://akitaonrails.com/2026/10/12/llms-agentes-competente-o-suficiente/), [04-20](https://akitaonrails.com/2026/04/20/clean-code-para-agentes-de-ia/) | **Adotar como normas** (custo ~0); refatorar arquivos grandes só oportunisticamente |
| 6 | Modelos de decisão/classificação pequenos | [post](https://akitaonrails.com/2026/10/10/qual-modelo-de-decisao-classificador-de-ia-tipo-jev-e-melhor/) 2026-10-10 | **Estudar depois** (nosso gargalo é outro; hardware 16 GB) |
| 7 | ai-usagebar (cota/reset de 24 provedores) | [AI Lair](https://ailair.akitaonrails.com/pt-br/ai-usagebar/) (sem post recente) | **Estudar depois** (WRAP condicionado do POC; risco de refresh de token) |
| 8 | Fluxo multiagente (tmux, 1 agente/projeto, troca por cota, kaizen) | [workflow](https://ailair.akitaonrails.com/pt-br/workflow/) | **Adaptar** só o passo “kaizen pós-rodada” |
| 9 | Contrapeso: “Harness/Loop/Graph Engineering são bullshit” | [post](https://akitaonrails.com/2026/08/18/hot-take-harness-loop-engineering-graph-engineering-sao-bullshit/) 2026-08-18 | **Usar como freio** contra mais camadas |
| 10 | Livro “Competente o Suficiente” (preview) | [post](https://akitaonrails.com/2026/10/13/auto-publiquei-meu-proprio-livro-ebook-competente-o-suficiente/) 2026-10-13 | **Ler (humano)**; candidato à futura ingestão de pesquisa |

## 1. ai-memory 2.0 — memória e handoff entre agentes
- **Problema:** perda de contexto entre sessões, harnesses e máquinas.
- **Como resolveu:** wiki Markdown versionado (Open Knowledge Format), SQLite como índice derivado reconstruível, captura de sessão automática sem chamada de LLM, consolidação em páginas, links tipados (`causes`/`fixes`/`contradicts`) com checagem de contradição sem LLM, consultas `as_of`, escritor único com fila, handoff tipado (só uma sessão aceita), modo equipe com atribuição de autoria, embeddings locais (candle, MiniLM ~87 MB).
- **Equivalente no ANIMA:** `work_events` append-only + registros em `docs/registros/` + `memory.*` do registry (`persistence`/`event-history` operational; `cross-harness` implemented via POC; `narrative-memory`, `architectural-memory`, `evolution-history` projected).
- **Falta:** consolidação entre sessões, links tipados e detecção de contradição (hoje a memória do projeto é arquivos de memória manuais do agente), consulta temporal (`as_of`) do estado das capacidades.
- **Reuso:** binário Rust; POC prévio 2.4.1 (upstream já 2.5.x): continuidade Claude→Codex→Claude provada, mas workstream amarrado ao caminho do worktree, `--no-session-persistence` degrada, e a autoinstalação grava config GLOBAL dos harnesses. Licença: o post não declara — verificar no repositório antes de qualquer uso.
- **Recomendação:** estudar depois; não integrar agora. Adotar como IDEIAS: (a) tratar o registry/`history` como memória consultável por data (`as_of`); (b) tipar relações entre registros (`falha→recovery→prova`) — o ANIMA já tem a linhagem de itens.

## 2. Skills de auditoria e resolução
- **Problema:** manter dezenas de repositórios com PRs/issues de terceiros sem confiar em afirmações não verificadas.
- **Como resolveu:** skills = prompts versionados (`SKILL.md`): `pr-audit` (ledger de afirmações do contribuidor, checagem de supply chain, worktree isolada, injeção de prompt vira achado), `iss-audit` (nunca executa comandos copiados, reprodução em sandbox), `github-resolution` (um ticket aprovado por vez, teste de regressão ANTES da correção, auditoria pós-lote se >3 tickets, fecha só com CI verde no SHA exato), `pr-bump`, `release`. Declara explicitamente que NÃO devem ser copiadas; resultados autodeclarados (609 PRs/375 issues).
- **Equivalente:** Verifier (cobertura de aceites, `test_binding`, árvore por SHA), aprovação humana por item, worktree isolada, integração `ff_only` com recibo, `research.web` com fronteira de rede.
- **Falta:** teste-antes-da-correção verificável (“fail-to-pass”: o teste novo deve falhar na base e passar no candidato — nós fizemos manualmente por mutação; o Verifier só prova “passa”), auditoria pós-lote, retrospectiva sistemática (kaizen), tratamento de texto externo como achado (injeção).
- **Reuso:** repositório `my-skills`; sem licença declarada no post (verificar); custo alto de adaptação (prompts atados à pilha dele).
- **Recomendação:** adaptar princípios, não código: priorizar **fail-to-pass** como extensão do `test_binding` (alto valor, já previsto como I2e no plano 058).

## 3. ai-jail e defesa em camadas
- **Problema:** agente em modo irrestrito apaga dados (exemplos: `rm -rf` com `$HOME` mal expandido; `rsync --delete` em `/`).
- **Como resolveu:** `ai-jail` (Rust; bubblewrap no Linux, sandbox-exec no macOS): só o diretório do projeto é persistente; resto do `$HOME` em tmpfs; `~/.ssh`, `~/.gnupg`, `~/.aws`, perfis de navegador nunca montados; estado do agente montado; `--dry-run` imprime a política. Camadas: snapshots BTRFS/APFS, backup restic diário (7/4/6/1), regra “agente nunca em produção”.
- **Equivalente:** worktree efêmera com guardas de caminho, Local Trust Root + firewall LAN, `hostObserved` independente, e o Codex já lançado com `--sandbox workspace-write` e aprovação `never` (sandbox NATIVO do Codex no WSL; `docs/arquitetura/codex-cli-coder-backend.md`: “não é um sandbox perfeito”), `memory.durability` (procedimento assistido; `projected`).
- **Falta (hipóteses a testar, não afirmadas):** o modo `workspace-write` restringe ESCRITA, mas a LEITURA do resto do WSL (ex.: `~/.ssh`, credenciais do próprio Codex em `~/.codex`) provavelmente continua possível; ai-jail esconderia esses caminhos como camada independente do Codex. Backup/restore verificado como capacidade do sistema.
- **Reuso:** ai-jail roda em Linux ⇒ aplicável DENTRO do WSL; instalação por `cargo`/pacote; licença “open source” sem nome no post (verificar); limite admitido: o diretório do projeto continua gravável.
- **Recomendação:** estudar via POC curto e isolado (rodar o Codex WSL sob ai-jail com `--dry-run`, medir se `execute-one` continua funcionando e quais caminhos o Codex precisa; primeiro confirmar a hipótese de leitura com um teste inócuo). Se a hipótese se confirmar, vira a ideia de segurança de melhor custo-benefício; se não, descartar.

## 4. LLM Benchmark v4
- **Problema:** benchmarks de tarefas isoladas saturam e não medem coordenação em base de código real.
- **Como resolveu:** um app Rails estendido em 7 sprints; 14 falhas plantadas (baseadas em CVEs) reveladas só no fim; pontuação ponderada por severidade e por momento da descoberta (espontânea vs após aviso); custo/tempo como colunas separadas; verificação mecânica de cada exploit. ~US$ 4 mil em 9 dias (autodeclarado). Repositório `llm-coding-benchmark` (licença: verificar).
- **Equivalente:** 181 attempts e 77 pareceres reais em `work_events` (backend por attempt), mas sem scorecard comparativo; negativos do Verifier foram feitos em memória sobre evidência real.
- **Falta:** comparar executores com dados próprios (hoje sabemos por inspeção: Codex 49 ok; qwen3-coder local 17 ok × 19 falhas) e testar o Verifier com **falhas plantadas** reais (atestar “o Verifier rejeita”).
- **Recomendação:** adaptar: (1) scorecard read-only por backend a partir do ledger (custo ~0; entra no painel do plano 064); (2) suíte de falhas plantadas para o Verifier (negativos reais, o item da lista de limitações). Não adotar o benchmark Rails.

## 5. “Competente o suficiente” e Clean Code para agentes
- **Teses:** o ganho recente vem do harness, não do modelo; o oráculo (testes/docs) é o que impede o loop de girar; nível de esforço pesa mais que a escolha do modelo; pequenos modelos/regras para classificação e roteamento.
- **Regras concretas (04-20):** funções 4–20 linhas, arquivos <500 (ideal 200–300), nomes distintivos para grep, comentários de “por quê” e proveniência, tipos explícitos, injeção de dependência, config centralizada, um comando de teste headless, logs JSON estruturados, `AGENTS.md` curto (<100 linhas).
- **Equivalente:** `AGENTS.md` já é roteador curto (97 linhas); TS estrito; testes headless; comentários de proveniência no core. Divergências: `capability-registry.ts` 1782 linhas, `EvolutionClient.tsx` 1506, `worktree-executor.ts` ~1000, `work-verification.ts` 716; config de modelos espalhada.
- **Recomendação:** adotar como normas de revisão (custo ~0) e aplicar só quando um arquivo for tocado por outro motivo; **não** abrir itens de refatoração por isso.

## 6. Modelos de decisão/classificação
- Resultado do post: classificadores pequenos (4B–27B) chegam a 87–99% em decisões fechadas com custo ínfimo; confiança precisa de calibração; regras determinísticas ficam em código. ANIMA: classificação de trabalho é humana (bounded/low/…); o Compute Router decide Ollama×OpenAI por regras. Hardware local (16 GB VRAM/RAM) não roda os 27B open-weight bem. **Estudar depois**: só vale se a classificação humana virar gargalo.

## 7. ai-usagebar
- Lê cota por plano/provedor direto do provedor com credenciais locais, refresca OAuth (com lock), backoff de 429, alertas a 97%/100%, 24 provedores, núcleo Rust. POC prévio: schema `usage --json` bom como observação; PERIGO: refresh + write-back no `~/.codex/auth.json` vivo. ANIMA: `compute.subscription-availability` `projected`; a cota INTERNA de attempts (6/24 h) não é a cota do plano do Codex. **Estudar depois**, só com credencial de observador dedicada e idealmente modo read-only upstream.

## 8–10. Fluxo, contrapeso e livro
- Fluxo: um agente por projeto em tmux, troca de agente quando a cota acaba, passo “kaizen” após cada rodada. ANIMA já tem fallback governado de coder; falta formalizar a retrospectiva (hoje manual em `docs/registros/`). Adaptar apenas o passo de retrospectiva.
- Contrapeso (08-18): ceticismo contra “harness/loop/graph engineering”. Nossa cadeia de verificação cresceu em 5 camadas em 2 dias; vale a pergunta explícita “esta camada reduz um risco observado?” antes de cada nova.
- Livro (10-13, preview gratuito): consolida um ano de posts; leitura humana; candidato natural a primeira ingestão da capacidade de pesquisa recorrente (plano 066).

## Lacunas desta pesquisa
Resumos automatizados (podem omitir nuance); licenças não verificadas nos repositórios; posts de maio–junho e a página `/pt-br/frank/` não lidos; `ai-usagebar` sem post recente na lista; nenhuma ferramenta foi instalada ou executada.

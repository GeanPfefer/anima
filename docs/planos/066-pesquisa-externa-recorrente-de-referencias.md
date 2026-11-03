# 066 — Capacidade de pesquisa externa recorrente de referências (PROJETO; nada implementado)

Status: projeto (2026-10-14). Objetivo: o ANIMA descobrir, ler com segurança, comparar e relatar publicações externas relevantes (primeira fonte: Fabio Akita) SEM depender do Claude e SEM abrir trabalho automaticamente. Reaproveita o que existe: nós `research.web.*` do registry (`search`/`open`/`extract` proven; `network-boundary`/`navigate` implemented; `isolated-runtime`/`compare`/`persist-findings` projected; `cite` specified), `docs/arquitetura/research-web-v1.md`, SearXNG + agent-browser (POCs), fronteira de rede e privacidade de consulta (`research.query-privacy` proven), Resident Host, Compute Router local-first e o Capability Map. Primeira rodada manual: plano 065.

## 1. Princípios
1. Conteúdo externo é DADO não confiável: nunca instrução, nunca executado, nunca com ferramentas nem segredos ao alcance.
2. Relatório, não ação: a saída é uma lista de oportunidades; nenhum work item é criado/aprovado automaticamente. Promover uma oportunidade a trabalho é um ato humano pelo caminho normal (proposta → aprovação → classificação).
3. Reuso antes de construção: ledger em arquivos versionados e CLI do ANIMA antes de tabelas novas; migration só se o volume exigir.
4. Custo zero por padrão: leitura via RSS/HTTP + modelo local (Ollama); sem API paga sem autoridade explícita.
5. Proveniência obrigatória: toda afirmação do relatório aponta URL + data + hash do conteúdo lido.

## 2. Componentes
**2.1 Descoberta.** Lista de fontes permitidas (`docs/referencias/fontes.json`: id, feed URL, domínios permitidos, frequência máxima, tema). Busca o RSS (ex.: `https://akitaonrails.com/index.xml`; o feed tem ~760 mil caracteres: ler em páginas e parar no último GUID conhecido). Normaliza `{guid, url canônica, título, data, hash do item}`.
**2.2 Deduplicação e registro de fontes.** Ledger append-only (JSONL em `docs/referencias/ledger.jsonl`, uma linha por item descoberto/lido, com `status`: discovered|read|analyzed|reported|dismissed). Chave: URL canônica + `sha256` do texto extraído; alteração de conteúdo gera nova linha (versão), nunca sobrescreve. Sem tabela nova nesta fase.
**2.3 Leitura segura.** Fetch pelo caminho existente de rede (allowlist de domínios, limites de tamanho/tempo, sem cookies/credenciais, User-Agent identificado, respeito a robots/termos). Extração de texto (HTML→Markdown) em processo SEM ferramentas; limite de ~100 mil caracteres; remoção de scripts/links ocultos; detecção de padrões de injeção (“ignore previous instructions”, URLs de exfiltração, comandos shell) registrada como ACHADO sobre a fonte, nunca obedecida. O leitor/sumarizador é um modelo local sem tools, com saída em JSON de schema fixo validado pelo host (campos: problema, solução, tecnologias, afirmações verificáveis, licença mencionada, custo/risco declarado); saída fora do schema é descartada.
**2.4 Comparação.** (a) Determinística: casa tecnologias/termos com `capability-registry` (ids, `frontier`) e com `docs/planos/*`; (b) modelo local propõe candidatos de equivalência, mas o host só aceita ids que existem. Para cada achado produz o formato do plano 065: fonte, problema, como resolveu, capacidade equivalente + maturidade (declarada e derivada), lacuna, reuso (ferramenta, licença verificada no repositório, custo de integração), recomendação ∈ {adotar, integrar, adaptar, estudar depois, descartar} com justificativa.
**2.4.1 Licença e reuso:** licença só é “conhecida” se lida do arquivo LICENSE/metadata do repositório; texto do post não conta. Sem licença verificada ⇒ recomendação máxima “estudar”.
**2.5 Relatório.** Arquivo Markdown por rodada em `docs/registros/referencias/AAAA-MM-DD-<fonte>.md` (untracked até o humano commitar) e comando de leitura (`anima research report`); nunca grava em `docs/planos` nem toca no registry. Ordenação por impacto estimado e evidência de necessidade (campo “problema observado no ANIMA com referência a evento/registro”).
**2.6 Aprovação humana.** `anima research promote <achado>` apenas PREPARA um rascunho de proposta (texto) e para; criar o item, classificá-lo e aprová-lo seguem o fluxo normal e exigem ato humano; sem execução.

## 3. Operação sem o Claude
Executável pelo Resident Host (agendador local) com modelo Ollama local; frequência baixa (ex.: diária, janela de baixa carga, só com `readResourceAdmission = permit`); sem acesso a credenciais; kill-switch por arquivo/flag; teto de itens por rodada; falha de qualquer etapa ⇒ item volta a `discovered` e a rodada termina com relatório de erro (nunca silencia). O Claude/Codex só entram como revisores humanos assistidos.

## 4. Ameaças e controles
| Ameaça | Controle |
|---|---|
| Injeção de prompt no texto externo | leitor sem tools/segredos, schema fixo, achado de injeção, texto nunca vira instrução |
| SSRF / exfiltração | allowlist de domínios, sem redirecionamento cross-host automático, sem credenciais |
| Feed adulterado / typosquatting de domínio | domínio exato na allowlist; hash e GUID registrados |
| Copyright | armazenar resumo + link + hash, não cópia integral |
| Inflação de trabalho (FOMO de novidade) | relatório sem criação automática; campo obrigatório “problema observado no ANIMA”; recomendação padrão = estudar depois |
| Custo/carga | modelo local, janela de baixa carga, teto por rodada |
| Alucinação de equivalência | host valida ids; qualquer afirmação sem fonte é descartada |

## 5. Fases (cada uma, item governado pequeno)
- **R1 — Scan determinístico:** CLI `anima research scan` (RSS → ledger JSONL, dedupe, sem LLM). Testes com feed gravado. Valor imediato: lista de novidades auditável.
- **R2 — Leitura segura + extração estruturada** (modelo local, schema fixo, achados de injeção). Avaliação: reproduzir, em 4 dos 10 posts já analisados à mão (plano 065), problema/solução/recomendação consistentes.
- **R3 — Comparação com o Capability Map** e relatório no formato 065.
- **R4 — Agendamento no Resident Host** + resumo semanal para o humano.
Dependências: R1 sem dependências; R2 depende de fronteira de rede reaproveitada (`research.web.network-boundary` implemented); R3 depende de R2; R4 depende de R3 e do plano 059 apenas se usar lease E0 (não deve).
Métricas de sucesso: taxa de achados que o humano marca como úteis ≥50% em 4 rodadas; 0 itens criados automaticamente; 0 falhas de segurança (injeção obedecida); custo monetário 0.

## 6. Riscos e decisão pendente
Feed gigante (760 mil caracteres) exige leitura incremental; o modelo local viável (14B) falhou em compliance estrutural no planner (ver P3): a extração deve usar schemas MUITO pequenos e validação estrita, com repetição limitada; escolher entre local e provedor pago é decisão humana (custo/autoridade). Esta capacidade só deve ser priorizada após os itens fundamentais do plano 067.

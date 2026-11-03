# INV-10 — Total Capability & Functionality Audit (backlog dedicado)

Auditoria ÚNICA, coordenada, executada por seis Investigation Sessions subordinadas (INV-10a–f). Cada uma é um item `read_only` (`investigation-v1`, `codex-cli/default`, `workspace_read`, advisory, 1 attempt, 30 min, capability `research`).
Snapshot comum de todas: commit `5391073fabeeaea6a49a598acf79f3600d26e41f` (`dev` = `origin/dev`; `origin/main` = `99bec54`).
Status: RASCUNHO NÃO MATERIALIZADO. Nenhum item foi criado, aprovado ou executado. Criar, aprovar e `work supervise` são atos humanos autorizados por item.

## Metodologia

- ANIMA FIRST: o ANIMA executa a investigação; o Claude supervisiona, coleta, confere e consolida, e registra cada intervenção.
- Criação via `anima work propose-investigation --question ... --base-sha 5391073... --capability research` (um por domínio). Aprovação humana por item. Execução pelo orçamento normal de tentativas (sem `work supervise`).
- Escala epistemológica: PLANNED, IMPLEMENTED, TESTED, PROVEN, OPERATIONAL, AUTONOMOUS. Maturidade não sobe por existir componente, teste isolado ou evento histórico.
- Cada capacidade recebe código estável, evidência, limitação e confiança. UUIDs ficam só para rastreabilidade técnica.
- Observação, inferência e hipótese são separadas. O que não foi auditado é declarado.

## Limitações conhecidas (declaradas antes da execução)

- O snapshot é só o repositório no commit: nada de banco, logs, serviços ou working tree. Disponibilidade atual (OPERATIONAL) e eventos do ledger não são verificáveis pela investigação; são observados à parte, pelo operador, por leituras read-only, e identificados como tal.
- Leitura limitada pelo contexto e pelos 30 minutos por sessão; arquivos > 150.000 B só aceitam referência sem `lines` (SDC-20). O resultado de cada sessão pode ser `partial`.
- 1 attempt por item e sem recovery genérico de Investigation falha: uma falha consome a pergunta.
- Perguntas limitadas a 4.000 caracteres: por isso seis sessões.
- WIPs (`anima-prd.md`, plano 008) e untracked não entram no snapshot.

## Critérios de consolidação

1. O relatório final reúne os seis `InvestigationResultV1` sem perder as evidências individuais (referência por INV-10x e finding).
2. Divergências entre sessões são listadas, não harmonizadas em silêncio.
3. Toda capacidade final traz classe, evidência, confiança e a sessão de origem; sem origem no ANIMA, é marcada como intervenção do operador.
4. Seção própria: o que o ANIMA não conseguiu fazer, qual mecanismo foi usado, o que aconteceu, que capacidade faltou e que intervenção foi necessária.
5. Entregáveis: inventário, mapa de componentes, funcionalidades ao usuário, capacidades internas e de agentes, evidências e provas, implementação × comportamento, ausências, dívidas, limitações do ANIMA e áreas candidatas à comparação externa.
6. Nada de pesquisa ou integração externa nesta fase.

## Perguntas (texto integral, com preâmbulo)

### INV-10a — Inventário e mapa de componentes

- **Caracteres:** 1728 (limite 4000)

```text
Snapshot: commit 5391073fabeeaea6a49a598acf79f3600d26e41f, somente leitura; sem web, banco, logs, arquivos untracked ou execução com efeito colateral; ignore working tree e WIPs. Classifique cada capacidade em PLANNED | IMPLEMENTED | TESTED | PROVEN | OPERATIONAL | AUTONOMOUS, sem elevar maturidade só por existir componente, teste ou registro histórico. PROVEN exige evidência operacional citada (docs/registros, ou teste com Git/integração real, dizendo qual); OPERATIONAL exige disponibilidade no ambiente atual, que o snapshot sozinho não prova: marque como NÃO VERIFICÁVEL NO SNAPSHOT em vez de supor. Para cada capacidade informe: código estável (ex. agency.produce-change), nome, classe, evidência (arquivo e commit), limitação e confiança (alta/média/baixa). Separe observação, inferência e hipótese. Cite anima-prd.md SEM lines (arquivo grande). Não use UUIDs como identificador principal. Termine com a lista explícita do que NÃO foi auditado e o que ficou desconhecido. Registre lacunas em vez de preencher. Escopo desta sessão: (1) Inventário dos workspaces e módulos: apps/web (rotas, API routes, lib/*), apps/mobile, packages/core, packages/types, tools/local-agent, supabase/migrations, scripts, cli. (2) Mapa de relações entre componentes (quem depende de quem, quais fronteiras são puras e quais têm efeito). (3) Compare com packages/core/src/capability-registry.ts: capacidades reais sem nó no registry e nós do registry sem implementação correspondente. (4) Funcionalidades presentes só como documento ou plano. Não detalhe cada domínio; os domínios pessoal, agentes, governança, compute e prova operacional são auditados por outras sessões, então aqui entregue apenas o inventário, o mapa e as divergências.
```

### INV-10b — Domínio pessoal e interfaces

- **Caracteres:** 1675 (limite 4000)

```text
Snapshot: commit 5391073fabeeaea6a49a598acf79f3600d26e41f, somente leitura; sem web, banco, logs, arquivos untracked ou execução com efeito colateral; ignore working tree e WIPs. Classifique cada capacidade em PLANNED | IMPLEMENTED | TESTED | PROVEN | OPERATIONAL | AUTONOMOUS, sem elevar maturidade só por existir componente, teste ou registro histórico. PROVEN exige evidência operacional citada (docs/registros, ou teste com Git/integração real, dizendo qual); OPERATIONAL exige disponibilidade no ambiente atual, que o snapshot sozinho não prova: marque como NÃO VERIFICÁVEL NO SNAPSHOT em vez de supor. Para cada capacidade informe: código estável (ex. agency.produce-change), nome, classe, evidência (arquivo e commit), limitação e confiança (alta/média/baixa). Separe observação, inferência e hipótese. Cite anima-prd.md SEM lines (arquivo grande). Não use UUIDs como identificador principal. Termine com a lista explícita do que NÃO foi auditado e o que ficou desconhecido. Registre lacunas em vez de preencher. Escopo desta sessão: (1) Memória narrativa, organização implícita, recuperação de contexto, Prisma/Reflexão Crítica, jornadas, projetos e objetivos, planejamento e execução de objetivos: o que o código de fato faz hoje e o que o usuário final alcança. (2) Superfícies: web (telas e rotas), mobile (paridade com a web, o que falta) e CLI (comandos). (3) Modelos de dados e persistência ligados a esse domínio (tabelas, RLS, funções, views) e como memória e contexto chegam ao prompt do modelo. (4) Distinga o que é o produto pessoal do que é infraestrutura de self-development. Aponte capacidades prometidas no manifesto e no PRD sem código correspondente.
```

### INV-10c — Agentes, ferramentas, harnesses e self-development

- **Caracteres:** 1681 (limite 4000)

```text
Snapshot: commit 5391073fabeeaea6a49a598acf79f3600d26e41f, somente leitura; sem web, banco, logs, arquivos untracked ou execução com efeito colateral; ignore working tree e WIPs. Classifique cada capacidade em PLANNED | IMPLEMENTED | TESTED | PROVEN | OPERATIONAL | AUTONOMOUS, sem elevar maturidade só por existir componente, teste ou registro histórico. PROVEN exige evidência operacional citada (docs/registros, ou teste com Git/integração real, dizendo qual); OPERATIONAL exige disponibilidade no ambiente atual, que o snapshot sozinho não prova: marque como NÃO VERIFICÁVEL NO SNAPSHOT em vez de supor. Para cada capacidade informe: código estável (ex. agency.produce-change), nome, classe, evidência (arquivo e commit), limitação e confiança (alta/média/baixa). Separe observação, inferência e hipótese. Cite anima-prd.md SEM lines (arquivo grande). Não use UUIDs como identificador principal. Termine com a lista explícita do que NÃO foi auditado e o que ficou desconhecido. Registre lacunas em vez de preencher. Escopo desta sessão: (1) Executores de coding (ollama, openai, deepseek-harness, codex-cli, claude-code): contrato, seleção, readiness e limites reais. (2) Coding harness (READ/WRITE/EXEC), worktree executor, planner, backlog canônico e materializer, Verifier, recovery, retry e correção, review. (3) Investigation Sessions: o que foi implementado, o que o executor garante e o que ainda falta. (4) Ciclo de self-development ponta a ponta: quais etapas são automáticas no código e quais dependem de ato humano, operador externo ou script scratch. (5) Local agent runner (tools/local-agent). Distinga capacidade implementada de capacidade comprovada em execução.
```

### INV-10d — Governança, autoridade, segurança e isolamento

- **Caracteres:** 1644 (limite 4000)

```text
Snapshot: commit 5391073fabeeaea6a49a598acf79f3600d26e41f, somente leitura; sem web, banco, logs, arquivos untracked ou execução com efeito colateral; ignore working tree e WIPs. Classifique cada capacidade em PLANNED | IMPLEMENTED | TESTED | PROVEN | OPERATIONAL | AUTONOMOUS, sem elevar maturidade só por existir componente, teste ou registro histórico. PROVEN exige evidência operacional citada (docs/registros, ou teste com Git/integração real, dizendo qual); OPERATIONAL exige disponibilidade no ambiente atual, que o snapshot sozinho não prova: marque como NÃO VERIFICÁVEL NO SNAPSHOT em vez de supor. Para cada capacidade informe: código estável (ex. agency.produce-change), nome, classe, evidência (arquivo e commit), limitação e confiança (alta/média/baixa). Separe observação, inferência e hipótese. Cite anima-prd.md SEM lines (arquivo grande). Não use UUIDs como identificador principal. Termine com a lista explícita do que NÃO foi auditado e o que ficou desconhecido. Registre lacunas em vez de preencher. Escopo desta sessão: (1) Aprovação humana e fronteiras de autoridade: o que o código impede (fail-closed, RPC, RLS, constraints) e o que é só convenção ou texto. (2) Trusted Evidence Boundary, papel de escritor de sistema, Local Trust Root, guarda de estado residente canônico, integração governada (ff_only), classificação pós-aprovação. (3) Isolamento: sandbox read-only dos executores externos, credenciais, service_role, segredos, worktrees e firewall. (4) Lacunas de segurança conhecidas ou inferíveis, sem propor correções. Não execute nada. Para cada garantia diga se a evidência é código, teste ou prova operacional.
```

### INV-10e — Compute, orçamento, observabilidade e diagnósticos

- **Caracteres:** 1589 (limite 4000)

```text
Snapshot: commit 5391073fabeeaea6a49a598acf79f3600d26e41f, somente leitura; sem web, banco, logs, arquivos untracked ou execução com efeito colateral; ignore working tree e WIPs. Classifique cada capacidade em PLANNED | IMPLEMENTED | TESTED | PROVEN | OPERATIONAL | AUTONOMOUS, sem elevar maturidade só por existir componente, teste ou registro histórico. PROVEN exige evidência operacional citada (docs/registros, ou teste com Git/integração real, dizendo qual); OPERATIONAL exige disponibilidade no ambiente atual, que o snapshot sozinho não prova: marque como NÃO VERIFICÁVEL NO SNAPSHOT em vez de supor. Para cada capacidade informe: código estável (ex. agency.produce-change), nome, classe, evidência (arquivo e commit), limitação e confiança (alta/média/baixa). Separe observação, inferência e hipótese. Cite anima-prd.md SEM lines (arquivo grande). Não use UUIDs como identificador principal. Termine com a lista explícita do que NÃO foi auditado e o que ficou desconhecido. Registre lacunas em vez de preencher. Escopo desta sessão: (1) Compute Router, Ollama local, RunPod (lease, provisionamento, settlement), OpenAI paga (authority por item), ledger e settlement: o que está implementado e o que nunca foi comprovado em execução. (2) Orçamento de tentativas e de runtime, admissão de recursos e pressão de RAM. (3) Resident Host: lifecycle, wake, kill switch, o que ele faz ou não faz sozinho. (4) Observabilidade: event log, diagnósticos de falha, registros, tela /evolution e Capability Map. (5) Dependências de operador externo para ligar, manter e diagnosticar esse domínio.
```

### INV-10f — Evidência operacional

- **Caracteres:** 1641 (limite 4000)

```text
Snapshot: commit 5391073fabeeaea6a49a598acf79f3600d26e41f, somente leitura; sem web, banco, logs, arquivos untracked ou execução com efeito colateral; ignore working tree e WIPs. Classifique cada capacidade em PLANNED | IMPLEMENTED | TESTED | PROVEN | OPERATIONAL | AUTONOMOUS, sem elevar maturidade só por existir componente, teste ou registro histórico. PROVEN exige evidência operacional citada (docs/registros, ou teste com Git/integração real, dizendo qual); OPERATIONAL exige disponibilidade no ambiente atual, que o snapshot sozinho não prova: marque como NÃO VERIFICÁVEL NO SNAPSHOT em vez de supor. Para cada capacidade informe: código estável (ex. agency.produce-change), nome, classe, evidência (arquivo e commit), limitação e confiança (alta/média/baixa). Separe observação, inferência e hipótese. Cite anima-prd.md SEM lines (arquivo grande). Não use UUIDs como identificador principal. Termine com a lista explícita do que NÃO foi auditado e o que ficou desconhecido. Registre lacunas em vez de preencher. Escopo desta sessão: Use somente docs/registros, docs/planos, docs/marcos, docs/arquitetura e anima-prd.md versionados no snapshot. (1) Quais capacidades têm prova operacional descrita, com data, commit e limite declarado. (2) Provas únicas ou irreproduzidas (uma só ocasião) e provas que dependeram de operador, script scratch ou ambiente específico. (3) Contradições entre registros, PRD, registry e código, e registros que afirmam mais do que a evidência sustenta. (4) Dívidas e limitações declaradas ainda abertas, e capacidades nunca provadas. Não promova nenhuma capacidade a PROVEN sem citar o registro específico.
```

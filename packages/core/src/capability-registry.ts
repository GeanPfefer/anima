// Capability Registry V0 — o modelo hand-authored das capacidades do Anima.
//
// Este é o V0 declarativo previsto no item 4/10 do plano do Capability Map. Ele
// NÃO é a árvore visual: é o modelo que a tela `/evolution` projeta. No futuro,
// este registro manual pode ser SUBSTITUÍDO por um Capability Proof Engine que
// deriva maturidade e provas de event log + attempts + verifier + runtime — sem
// mudar o contrato de `Capability` nem a UI (ver capability-map.ts).
//
// Regra de honestidade: uma capacidade só recebe estado forte
// (`proven`/`operational`/`autonomous`) quando há EVIDÊNCIA REAL no repositório.
// `proofRefs` apontam para commits, testes, attempts, marcos e registros que
// existem de fato. Na dúvida, o estado é rebaixado. Capacidades futuras aparecem
// como `projected`/`specified` — nunca como se já existissem.

//
// Evolution Reconciliation V2 (2026-09-27): conteúdo reconciliado com o estado
// real desde a baseline `7f276d8` (última edição do registry, Evolution UX V1).
// O nome `..._V0` é do CONTRATO e foi mantido para não quebrar consumidores.
// Toda mudança feita nesta reconciliação está em `history` com refs reais; ver
// docs/registros/2026-09-27c-evolution-reconciliation-v2.md.
//
// SDC-09 (2026-10-05): reconciliado com o ciclo SDC-01→SDC-08 (executores
// nativos, correção por checkpoint, recuperação de candidato, integração
// governada, referências humanas). Só o que o git/código prova subiu (até
// `implemented`); uso real reportado pelo operador NÃO promove nada. Limites
// abertos e dependência humana ficam em `frontier`.

// SDC-21 (2026-10-06): registry 44db504 reconciliado até 349a35e (SDC-20).
// INV-08 é advisory, não autoridade de maturity. Reuso antes de novo nó;
// Investigation entrega conhecimento read_only distinto de candidato mutante.
// Nenhuma maturity existente muda; fronteiras humanas permanecem explícitas.

import { buildCapabilityGraph, type Capability, type CapabilityGraph } from './capability-map';

/** Baseline da última Evolution relevante: "Evolução recente" = mudanças desde aqui. */
export const EVOLUTION_BASELINE = {
  commit: '7f276d8',
  date: '2026-09-16',
  label: 'Evolution UX V1',
} as const;

const RECONCILIATION_V2_RECORD = 'docs/registros/2026-09-27c-evolution-reconciliation-v2.md';

export const ANIMA_CAPABILITY_REGISTRY_V0: Capability[] = [
  // ─── COMPREENSÃO ──────────────────────────────────────────────────────────
  {
    id: 'understanding.entities',
    name: 'Entidades e relações',
    description: 'Extrair entidades (pessoas, lugares, projetos, hábitos) e derivar vínculos entre elas e os pilares.',
    domain: 'understanding',
    maturity: 'operational',
    dependsOn: ['memory.persistence', 'understanding.pillars'],
    meaning:
      'O Anima reconhece coisas do mundo do usuário como entidades de primeira classe e as liga entre si e a pilares — um tecido navegável, não texto solto.',
    advancement:
      'Autonomia: manter precisão de extração e de relações sob volume real, sem revisão humana, e reconciliar duplicatas sozinho.',
    proofRefs: [
      { kind: 'route', ref: 'apps/web/app/api/ai/extract-entities', note: 'rota de extração de entidades' },
      { kind: 'route', ref: 'apps/web/app/(app)/graph/page.tsx', note: 'entidades e arestas relation/cooccurrence no grafo' },
    ],
  },
  {
    id: 'understanding.pillars',
    name: 'Pilares (XP e níveis)',
    description: 'Modelar áreas de vida como pilares com XP, níveis e progresso.',
    domain: 'understanding',
    maturity: 'operational',
    dependsOn: ['memory.persistence'],
    meaning: 'A evolução do usuário é medida por pilar — o substrato de "jornadas de evolução" do manifesto.',
    advancement: 'Já operacional; próximo salto é o Anima ajustar pesos/curvas por evidência sem configuração manual.',
    proofRefs: [
      { kind: 'test', ref: 'packages/core/src/levels.test.ts' },
      { kind: 'doc', ref: 'apps/web/app/(app)/home/_components/LifeRadar.tsx' },
    ],
  },
  {
    id: 'understanding.pillar-inference',
    name: 'Inferência de pilares',
    description: 'Propor pilares emergentes e confirmá-los/descartá-los com o usuário.',
    domain: 'understanding',
    maturity: 'proven',
    dependsOn: ['understanding.pillars', 'understanding.entities'],
    meaning: 'O Anima percebe áreas de vida que estão surgindo e as sugere, em vez de exigir que o usuário as declare.',
    advancement: 'Reproduzir a proposta de pilares de forma confiável e reduzir falsos positivos sem revisão constante.',
    proofRefs: [
      { kind: 'route', ref: 'apps/web/app/api/pillars/confirm' },
      { kind: 'doc', ref: 'apps/web/app/(app)/home/_components/PendingPillarsWidget.tsx' },
    ],
  },
  {
    id: 'understanding.projects',
    name: 'Projetos e intake',
    description: 'Capturar/estruturar ideias (Project Intake) e representar projetos com advisor, snapshot operacional e drilldown.',
    domain: 'understanding',
    maturity: 'proven',
    dependsOn: ['memory.persistence'],
    meaning: 'Uma ideia crua vira um objeto de projeto estruturado que o sistema raciocina, acompanha, aconselha e resume — cidadão de primeira classe.',
    advancement: 'Comprovar intake conversacional e acompanhamento contínuo de projetos de domínios diferentes (não só o próprio Anima).',
    proofRefs: [
      { kind: 'test', ref: 'packages/core/src/project-intake.test.ts' },
      { kind: 'test', ref: 'packages/core/src/project-advisor.test.ts' },
      { kind: 'test', ref: 'packages/core/src/project-operational-snapshot.test.ts' },
    ],
  },
  {
    id: 'understanding.world-model',
    name: 'World model',
    description: 'Um modelo unificado do mundo do usuário que se reorganiza sozinho quando novos dados chegam.',
    domain: 'understanding',
    maturity: 'projected',
    dependsOn: ['understanding.entities', 'understanding.pillar-inference', 'understanding.projects', 'memory.narrative-memory'],
    target: { description: 'Compreensão emergente e auto-organizada do mundo do usuário.' },
    meaning: 'O Anima deixa de guardar fatos isolados e passa a manter um modelo vivo que reorganiza conceitos por conta própria.',
    advancement: 'Falta o mecanismo de reorganização emergente e a memória narrativa que o alimenta.',
  },

  {
    id: 'understanding.github-attention',
    name: 'Atenção multi-repo (GitHub)',
    description: 'Derivar o que espera atenção nos repositórios (PRs/issues abertos, draft, alertas, repo parado).',
    domain: 'understanding',
    maturity: 'projected',
    dependsOn: ['understanding.projects'],
    reuse: {
      strategy: 'contribute_upstream',
      tool: 'ghpending',
      status: 'candidate',
      externalEvidence:
        'POC ghpending (G:\\anima-labs): lógica útil, mas sem JSON e sem suporte a Windows ⇒ --json upstream ou fork leve. Teste autenticado pendente (PAT read-only criado pelo humano). Adiado.',
    },
    meaning: 'Baixo valor enquanto o Anima acompanha um único repositório.',
    advancement: 'Depende de saída JSON upstream e de um POC autenticado.',
    history: [
      {
        at: '2026-09-27',
        change: 'introduced',
        to: 'projected',
        note: 'Candidata externa (Reuse Architecture V1), adiada.',
        refs: [{ kind: 'record', ref: RECONCILIATION_V2_RECORD }],
      },
    ],
  },

  // ─── MEMÓRIA ────────────────────────────────────────────────────────────────
  {
    id: 'memory.persistence',
    name: 'Persistência',
    description: 'Armazenar de forma durável entradas, notas, entidades e estado sob RLS por usuário.',
    domain: 'memory',
    maturity: 'operational',
    dependsOn: [],
    meaning: 'A base de tudo: nada evolui se não persiste. Supabase com RLS por usuário guarda o estado do Anima.',
    advancement: 'Já operacional; evolução é resiliência multi-nó/portátil (ver Marco 004) sem cópia indiscriminada.',
    proofRefs: [{ kind: 'doc', ref: 'supabase/migrations', note: 'schema versionado + RLS' }],
  },
  {
    id: 'memory.event-history',
    name: 'Eventos e histórico',
    description: 'Registrar eventos append-only (work_events, ledger) e expor histórico navegável.',
    domain: 'memory',
    maturity: 'operational',
    dependsOn: ['memory.persistence'],
    meaning: 'O passado do sistema é recuperável só pelo repositório/estado — base para auditoria, retomada e futura inferência de provas.',
    advancement: 'Já operacional; próximo uso é alimentar o Capability Proof Engine a partir destes eventos.',
    proofRefs: [
      { kind: 'test', ref: 'packages/core/src/economic-observations.test.ts', note: 'event store por coorte' },
      { kind: 'route', ref: 'apps/web/app/(app)/history' },
    ],
  },
  {
    id: 'memory.context-recovery',
    name: 'Recuperação de contexto',
    description: 'Embutir entradas e recuperar contexto relevante por similaridade.',
    domain: 'memory',
    maturity: 'proven',
    dependsOn: ['memory.persistence'],
    meaning: 'O Anima traz de volta o que é relevante para o momento, em vez de depender de o usuário lembrar onde algo está.',
    advancement: 'Comprovar relevância consistente sob volume e integrar à memória narrativa.',
    proofRefs: [{ kind: 'route', ref: 'apps/web/app/api/ai/embed-entry' }],
  },
  {
    id: 'memory.continuity',
    name: 'Continuidade e retomada',
    description: 'Retomar trabalho de um checkpoint durável após interrupção (orçamento, decomposição).',
    domain: 'memory',
    maturity: 'proven',
    dependsOn: ['memory.event-history', 'governance.attempt'],
    meaning: 'Uma interrupção não perde trabalho: o Anima retoma exatamente de onde parou, preservando o que já foi verificado.',
    advancement: 'Reproduzir retomada de forma rotineira em cenários variados até virar operacional.',
    proofRefs: [
      { kind: 'commit', ref: 'e090013', note: 'retomada da worktree do checkpoint na decomposição' },
      { kind: 'milestone', ref: 'docs/marcos/008-dev-local-v1-review-rework-incremental.md' },
      { kind: 'commit', ref: '25198a5', note: 'attempt 515c4d83 retomou o checkpoint durável d1d6c5d após 3 falhas na lineage e chegou a completed' },
    ],
    history: [
      {
        at: '2026-09-27',
        change: 'proof_added',
        note: 'Retomada do checkpoint d1d6c5d através de uma lineage de 4 sucessores até aceite humano. Ainda uma cadeia, não rotina: maturidade mantida.',
        refs: [
          { kind: 'work_item', ref: 'f6c326b1', note: 'completed' },
          { kind: 'attempt', ref: '515c4d83' },
        ],
      },
    ],
  },
  {
    id: 'memory.narrative-memory',
    name: 'Memória narrativa',
    description: 'Uma memória que narra a evolução do usuário e reconcilia contradições ao longo do tempo, não só guarda registros.',
    domain: 'memory',
    maturity: 'projected',
    dependsOn: ['memory.context-recovery', 'memory.event-history'],
    target: { description: 'Memória que relaciona no tempo, narra a evolução e resolve contradições — base da proatividade cognitiva.' },
    meaning: 'O Anima passa de "receber → armazenar → exibir" para "lembrar → relacionar → refletir", percebendo e reconciliando conflitos (Prisma como capacidade interna).',
    advancement: 'Falta a síntese narrativa sobre o histórico e a detecção/resolução de contradições que a mantém coerente.',
  },
  {
    id: 'memory.durability',
    name: 'Durabilidade do progresso',
    description: 'Nenhum progresso importante existe somente em uma máquina: o Anima garante sozinho a cópia remota do que conquistou.',
    domain: 'memory',
    maturity: 'projected',
    dependsOn: ['memory.persistence', 'memory.event-history'],
    target: { description: 'Progresso importante sempre recuperável fora da máquina que o produziu, sem depender de lembrança humana.' },
    meaning:
      'Hoje a durabilidade é um PROCESSO HUMANO comprovado (push de dev e branch de backup remota), não capacidade do sistema. O Anima nem detecta progresso não publicado.',
    advancement: 'Falta detectar progresso só-local e propor/executar a publicação sob authority. Push é efeito externo: continua ato humano até haver mandato.',
    history: [
      {
        at: '2026-09-27',
        change: 'introduced',
        to: 'projected',
        note: 'Princípio adotado pelo humano. A prova manual (dev e backup/marco-research-web-dev-readiness-2026-09-27 em 117fb46) não conta como capacidade.',
        refs: [
          { kind: 'commit', ref: '117fb46', note: 'publicado por ato humano' },
          { kind: 'record', ref: RECONCILIATION_V2_RECORD },
        ],
      },
    ],
  },
  {
    id: 'memory.evolution-history',
    name: 'História da evolução',
    description:
      'Explicar como e por que cada capacidade chegou ao estado atual: quando surgiu, commits, work items, attempts/falhas, decisões e mudanças de maturidade.',
    domain: 'memory',
    maturity: 'projected',
    dependsOn: ['memory.event-history', 'governance.attempt'],
    target: { description: 'O Anima explica não só o que é hoje, mas como e por que chegou até aqui.' },
    meaning:
      'Legibilidade histórica. A Evolution V2 tem só uma semente: entradas `history` escritas à mão numa reconciliação, com refs reais. Não é derivação.',
    advancement:
      'Evolution History V3: derivar entradas de git + work_events + registros com proveniência, sem historiador LLM e sem banco histórico novo até haver contrato.',
    history: [
      {
        at: '2026-09-27',
        change: 'introduced',
        to: 'projected',
        note: 'Direção registrada; semente declarativa (history) criada nesta reconciliação.',
        refs: [{ kind: 'record', ref: RECONCILIATION_V2_RECORD }],
      },
    ],
  },
  {
    id: 'memory.architectural-memory',
    name: 'Memória arquitetural',
    description:
      'Antes de alterar uma arquitetura, o self-dev consulta tentativas e decisões anteriores para não repetir abordagens que falharam ou foram abandonadas.',
    domain: 'memory',
    maturity: 'projected',
    dependsOn: ['memory.evolution-history', 'agency.detect-deficiency'],
    target: { description: 'Self-dev que aprende com a própria história antes de mudar a arquitetura.' },
    meaning:
      'Exemplos reais do que ela evitaria: o oráculo 0bea4c8 congelado, a igualdade textual de gate que a sanitização quebrou e o export extra em Route Handler que quebrou o next build.',
    advancement: 'Depende da história da evolução existir como dado consultável.',
    history: [
      {
        at: '2026-09-27',
        change: 'introduced',
        to: 'projected',
        note: 'Direção registrada; não implementada.',
        refs: [{ kind: 'record', ref: RECONCILIATION_V2_RECORD }],
      },
    ],
  },
  {
    id: 'memory.cross-harness',
    name: 'Continuidade entre harnesses',
    description:
      'Implementado apenas o wrap opcional do ai-memory nos native CLI backends (Claude Code e Codex CLI), com workstream configurado e mecanismos new/resume cobertos pelos testes. NÃO está implementada a correlação automática do ledger/resume com attempt/lineage do ANIMA.',
    domain: 'memory',
    maturity: 'implemented',
    dependsOn: ['agency.external-harness', 'memory.continuity'],
    reuse: {
      strategy: 'wrap',
      tool: 'ai-memory',
      status: 'integrated',
      externalEvidence:
        'POC ai-memory × ANIMA (G:\\anima-labs): Claude→Codex→Claude provado com ids em repo descartável. Riscos: o ledger guarda prompts e arquivos em texto claro; autowire global.',
    },
    meaning: '≠ memory.continuity (checkpoint interno do Anima). Não fundir: esta é continuidade técnica de harnesses externos. Na integração atual o ai-memory é OPCIONAL nos backends nativos.',
    advancement:
      'O wrap opcional existe em código e testes (backends Codex/Claude). Sem prova de uso real verificável aqui.',
    proofRefs: [
      { kind: 'commit', ref: '2e153ed', note: 'wrap do ai-memory nos backends Claude Code e Codex CLI (opcional)' },
      { kind: 'test', ref: 'apps/web/lib/work-orchestration/native-cli-coder.ai-memory.test.ts' },
      { kind: 'test', ref: 'apps/web/lib/work-orchestration/executor-selection.ai-memory.test.ts' },
    ],
    frontier: [
      'Trabalho futuro: correlacionar automaticamente o ledger/resume do ai-memory com attempt/lineage do ANIMA (não implementado).',
      'Opcional e sem prova viva verificável; o ledger guarda prompts e arquivos em texto claro (risco declarado).',
    ],
    history: [
      {
        at: '2026-09-27',
        change: 'introduced',
        to: 'projected',
        note: 'Candidata externa (Reuse Architecture V1).',
        refs: [{ kind: 'record', ref: RECONCILIATION_V2_RECORD }],
      },
      {
        at: '2026-10-02',
        change: 'maturity_changed',
        from: 'projected',
        to: 'implemented',
        note: 'ai-memory embrulhado, de forma opcional, nos backends nativos. Implementado ≠ comprovado.',
        refs: [{ kind: 'commit', ref: '2e153ed' }],
      },
    ],
  },

  // ─── AGÊNCIA ────────────────────────────────────────────────────────────────
  {
    id: 'agency.edit-file',
    name: 'Ler e editar arquivo',
    description: 'O coder lê arquivos do workspace e edita código por âncora exata, robusto a CRLF e a âncoras ambíguas.',
    domain: 'agency',
    maturity: 'operational',
    dependsOn: ['agency.isolated-workspace'],
    meaning: 'READ e WRITE são a base da agência de código: o coder enxerga o que vai mudar e altera com precisão cirúrgica.',
    advancement: 'Operacional; a rodada de leitura já vira orçamento no Harness V3 e endurecimentos (harness policy + AST) mitigam edições fora do alvo.',
    proofRefs: [
      { kind: 'commit', ref: '6adce1c', note: 'desambiguação de âncora por evidência (in_lines)' },
      { kind: 'commit', ref: '97c042d', note: 'edição agnóstica a fim de linha (CRLF↔LF)' },
      { kind: 'test', ref: 'apps/web/lib/work-orchestration/harness/deepseek-harness-runtime.test.ts' },
    ],
  },
  {
    id: 'agency.run-tests',
    name: 'Executar testes e comandos governados',
    description: 'Rodar testes escopados ao workspace como gate (host-observed) e comandos sob política (git read-only, rede negada).',
    domain: 'agency',
    maturity: 'operational',
    dependsOn: ['agency.isolated-workspace', 'governance.authority'],
    meaning: 'EXEC/TEST é uma autoridade distinta de READ/WRITE: o Anima não confia no próprio código sem prova, e comandos rodam num envelope explícito.',
    advancement:
      'Autonomia exige sandbox de rede em nível de kernel (hoje a negação de rede é política de comando, não isolamento) e gates rodando sem supervisão.',
    proofRefs: [
      { kind: 'commit', ref: '533ce86', note: 'escopo do gate ao workspace (causa raiz do fan-out)' },
      { kind: 'record', ref: 'docs/registros', note: 'independência dos gates + Coding Harness V3 command-execution-policy' },
      {
        kind: 'event',
        ref: 'host_observed_gate_evidence_recorded',
        note: 'Proof Engine sobre o histórico real (2026-09-27, 1343 eventos): 15 ocasiões independentes positivas, 0 negativas',
      },
      { kind: 'record', ref: 'docs/registros/2026-09-25h-recovery-harness-dev-readiness-ate-review.md', note: 'loop vivo edit→teste vermelho→edit→verde→diff→submit (attempt 2a145ca1)' },
    ],
    history: [
      {
        at: '2026-09-27',
        change: 'maturity_changed',
        from: 'proven',
        to: 'operational',
        note:
          'O critério pendente ("prova viva end-to-end do loop edit→test→submit") foi cumprido em attempts pagas reais e os gates host-side reproduziram em 15 ocasiões. O sandbox de kernel continua ausente e agora é critério de autonomia.',
        refs: [
          { kind: 'attempt', ref: '2a145ca1' },
          { kind: 'attempt', ref: '515c4d83' },
          { kind: 'record', ref: RECONCILIATION_V2_RECORD },
        ],
      },
    ],
  },
  {
    id: 'agency.isolated-workspace',
    name: 'Workspace isolado (worktree)',
    description: 'Trabalhar numa git worktree isolada, resiliente a falhas transitórias de filesystem.',
    domain: 'agency',
    maturity: 'operational',
    dependsOn: [],
    meaning: 'Cada tentativa de mudança acontece isolada, sem tocar a árvore principal — contenção é pré-requisito de segurança.',
    advancement: 'Operacional; footgun conhecido no dispose de junction node_modules é tratado.',
    proofRefs: [
      { kind: 'commit', ref: '8dc2228', note: 'worktree resiliente a falha transitória de FS' },
      { kind: 'record', ref: 'docs/registros', note: 'ADR-001 worktree executor' },
    ],
  },
  {
    id: 'agency.produce-change',
    name: 'Produzir alteração de código',
    description: 'Produzir mudança de código coerente por executor substituível (Ollama/OpenAI; backends nativos em agency.external-harness).',
    domain: 'agency',
    maturity: 'proven',
    dependsOn: ['agency.edit-file', 'agency.run-tests', 'compute.selection'],
    meaning: 'Transformar intenção aprovada em candidato mutante com Git e gates; Investigation read_only entrega conhecimento, não uma mudança.',
    advancement:
      'O Proof Engine deriva "operacional" (8 ocasiões verificadas), mas conta sucessos, não taxa: na lineage dev-readiness só 2 de 5 attempts pagas chegaram a verified e 1 foi aceita. Declarado segue comprovada até a produção ser confiável (e a barreira local de RAM ser resolvida).',
    proofRefs: [
      { kind: 'commit', ref: '3bfa619' },
      { kind: 'commit', ref: '2d8546f' },
      { kind: 'doc', ref: 'apps/web/lib/work-orchestration/executor-selection.ts' },
      { kind: 'commit', ref: '87a3ad8', note: 'PIN-02 provado ao vivo pelo self-dev' },
      { kind: 'commit', ref: 'fbf0baa', note: 'fallback governado de coder por capacidade' },
    ],
  },
  {
    id: 'agency.verify-change',
    name: 'Verificar alteração',
    description: 'Conferir a mudança contra o contrato aprovado (gates + parecer do Verifier).',
    domain: 'agency',
    maturity: 'proven',
    dependsOn: ['agency.run-tests', 'governance.verifier'],
    meaning: 'Verificar é separado de produzir: o Anima confere a própria obra contra o que foi aprovado antes de pedir revisão.',
    advancement:
      'O Proof Engine deriva "operacional" (8 ocasiões), mas o critério é a verificação não enganar a revisão humana: das 7 decisões humanas sobre resultados verified, 5 pediram mudanças. Declarado segue comprovada.',
    proofRefs: [
      { kind: 'commit', ref: '824c714', note: 'requisitos de prova heterogêneos pós-review' },
      { kind: 'record', ref: 'docs/registros', note: 'seq4→seq5: verified foi falso positivo, corrigido por request_changes' },
    ],
    frontier: ['Gates sequenciais revelam defeitos um de cada vez: um defeito real pode ficar mascarado até o gate seguinte (segundo o operador, causa do defeito do SDC-02).'],
  },
  {
    id: 'agency.recovery-correction',
    name: 'Recovery e correção',
    description: 'Replanejar após falha, corrigir após request_changes e retomar sob autoridade humana.',
    domain: 'agency',
    maturity: 'proven',
    dependsOn: ['agency.produce-change', 'governance.recovery-authority', 'governance.attempt'],
    meaning: 'Request-changes/correction/rework preservam o que já valia e reabrem somente o autorizado por ato humano; nova attempt não é recovery genérica de Investigation.',
    advancement:
      'Reproduzir correções bem-sucedidas de forma rotineira até virar operacional. Hoje há três lineages de correção que terminaram aceitas, mas a de dev-readiness precisou de 6 unidades e 5 attempts pagas: não é rotina.',
    proofRefs: [
      { kind: 'commit', ref: 'b9d617c' },
      { kind: 'commit', ref: '4b5c500', note: 'replanejamento após falha determinística' },
      { kind: 'commit', ref: '1c6c656', note: 'Human Recovery Authority' },
      { kind: 'work_item', ref: 'bd4092af', note: 'seq3 da lineage de correção de a703e92f, aceito (2026-09-25)' },
      { kind: 'work_item', ref: 'f6c326b1', note: 'fim da lineage 2c7afe1d→f19ac716→7610b066→843669bd→f6c326b1, aceito (2026-09-27)' },
      { kind: 'commit', ref: 'a15698f', note: 'work correct --rework <path> (rework estruturado)' },
      { kind: 'commit', ref: '5aad729', note: 'reabertura de escopo preservado por root authority, por ato humano auditado' },
      { kind: 'commit', ref: '243b740', note: 'preservação multinível inherited-preserved' },
    ],
    frontier: [
      'Gates sequenciais revelam defeitos um de cada vez: um defeito fica mascarado até o gate seguinte.',
      'Correção por checkpoint e rework estruturado dependem de ato humano.',
      'Retry/recovery genérico de Investigation read_only falha é missing: max_attempts=1 bloqueia retry por attempt_budget_exhausted; resume/replan/recover-harness/recover-candidate exigem evidências de worktree que investigation-v1 não produz. INV-08 é nova investigação, não continuação de lineage.',
    ],
    history: [
      {
        at: '2026-09-25',
        change: 'proof_added',
        note: 'Correção por lineage com compute forte (Sol) aceita; Router passou a considerar a lineage.',
        refs: [
          { kind: 'commit', ref: 'fc53649' },
          { kind: 'record', ref: 'docs/registros/2026-09-25-prova-sol-bd4092af-router-lineage-e-covers.md' },
        ],
      },
      {
        at: '2026-09-27',
        change: 'proof_added',
        note: 'Cadeia falha→recovery de harness→recoveries sucessivas→Sol→gates host→Verifier verified→aceite humano. Maturidade mantida: 3 lineages aceitas não são rotina.',
        refs: [
          { kind: 'work_item', ref: 'f6c326b1' },
          { kind: 'commit', ref: '117fb46', note: 'resultado integrado localmente em dev' },
        ],
      },
      {
        at: '2026-10-04',
        change: 'proof_added',
        note:
          'Correção por retomada de checkpoint (`work correct`) com rework estruturado, reabertura de escopo preservado e preservação multinível, todos em código e testes. Maturidade mantida: nova mecânica ≠ correção rotineira.',
        refs: [
          { kind: 'commit', ref: 'a15698f' },
          { kind: 'commit', ref: '5aad729' },
          { kind: 'commit', ref: '243b740' },
        ],
      },
      {
        at: '2026-10-06',
        change: 'proof_added',
        note: 'SDC-19: correção de diagnóstico nativo por checkpoint; proven preservada, sem alegar recovery de Investigation.',
        refs: [
          { kind: 'commit', ref: 'b9d617c' },
        ],
      },
    ],
  },
  {
    id: 'governance.candidate-recovery',
    name: 'Recuperação governada de candidato',
    description: 'Por ato humano, recuperar candidato com defeito real preservando lineage; checkpoint ancestral distinto do candidato e delta Git exato checkpoint→candidate contra observedChangedFilesSinceStart.',
    domain: 'governance',
    maturity: 'implemented',
    dependsOn: ['governance.recovery-authority', 'governance.attempt', 'agency.recovery-correction'],
    meaning:
      'Distinto de governance.harness-recovery (defeito do harness): aqui o defeito está no candidato produzido. O Anima não decide recuperar nem aprova sozinho — registra o ato humano e deriva o sucessor.',
    advancement:
      'Existe em código, migration e pgTAP. O primeiro uso real (SDC-02) é reportado pelo operador e não é verificável pelo repositório, então não vira comprovada aqui. Exige as lacunas abaixo fechadas e prova registrada.',
    proofRefs: [
      { kind: 'commit', ref: '57f2e66', note: 'SDC-15: finalização da correção de checkpoint/delta' },
      { kind: 'commit', ref: 'f46e124' },
      { kind: 'commit', ref: '5f14add' },
      { kind: 'commit', ref: '4bc07fa', note: 'work recover-candidate + migration 20261004000000_candidate_recovery' },
      { kind: 'commit', ref: 'd4db97f', note: 'typegen e pgTAP alinhados' },
      { kind: 'test', ref: 'supabase/tests/candidate_recovery.test.sql' },
      { kind: 'test', ref: 'apps/web/lib/work-orchestration/candidate-recovery.test.ts' },
    ],
    frontier: [
      '`candidate_recovery.corrections` não é propagada automaticamente ao prompt nativo do Codex/Claude: o operador revisou a proposta à mão.',
      'Não é encadeável: um segundo recover-candidate sobre o mesmo item é recusado.',
      'Gates sequenciais mascaram defeitos até o gate seguinte.',
      'Migration e deploy continuam atos humanos.',
    ],
    history: [
      {
        at: '2026-10-04',
        change: 'introduced',
        to: 'implemented',
        note: 'Caminho governado mínimo, por ato humano, para recuperar candidato com defeito real. Implementado ≠ comprovado.',
        refs: [
          { kind: 'commit', ref: '4bc07fa' },
          { kind: 'commit', ref: 'd4db97f' },
        ],
      },
      {
        at: '2026-10-05',
        change: 'proof_added',
        note: 'SDC-15: checkpoint ancestral distinto e delta Git exato contra observedChangedFilesSinceStart; ausência/divergência falha fechada. Implemented preservada.',
        refs: [
          { kind: 'commit', ref: '57f2e66' },
          { kind: 'commit', ref: 'f46e124' },
          { kind: 'commit', ref: '5f14add' },
        ],
      },
    ],
  },
  {
    id: 'governance.governed-integration',
    name: 'Integração governada de resultado aceito',
    description:
      'Efeito de integração em dev de um resultado aceito (modo ff_only por CAS de ref, sem merge commit), com receipt validado em SQL.',
    domain: 'governance',
    maturity: 'implemented',
    dependsOn: ['governance.review', 'agency.supervised-self-development'],
    meaning: 'O primitive de biblioteca autoriza integration_effect_authorized e executa ff_only por CAS de ref, receipt com mergeCommitSha null e integration_completed pelo Trusted System Writer. Implementação existente é separada de prova canônica do exercício.',
    advancement: 'Código e testes do primitive estão versionados em f6117f7 e 52a745e. Exercício do primitive via wrapper scratch em clone dedicado é relato operacional/banco local, sem proofRef canônica versionada; implemented permanece. Falta prova versionada de autorização, receipt ff_only e integration_completed.',
    proofRefs: [
      { kind: 'doc', ref: 'apps/web/lib/work-orchestration/integration-effect.ts' },
      { kind: 'commit', ref: 'f6117f7', note: 'modo ff_only no efeito de integração governada' },
      { kind: 'commit', ref: '52a745e', note: 'endurecimento SQL do receipt após auditoria' },
      { kind: 'test', ref: 'apps/web/lib/work-orchestration/integration-effect.integration.test.ts' },
      { kind: 'test', ref: 'supabase/tests/integration_effect.test.sql' },
    ],
    frontier: [
      'CLI/UX first-class de integração governada ainda missing: o primitive é só biblioteca; Modo W é fase posterior.',
      'Clone dedicado necessário: guarda target_checked_out impede integrar no checkout humano ativo.',
      'Sync do checkout humano é manual; push é manual e não existe push governado.',
      'O exercício de integration_completed e do receipt no banco local não é prova canônica versionada.',
    ],
    history: [
      {
        at: '2026-10-03',
        change: 'introduced',
        to: 'implemented',
        note: 'Efeito de integração governada com modo ff_only; ainda não é o caminho usado no ciclo SDC.',
        refs: [
          { kind: 'commit', ref: 'f6117f7' },
          { kind: 'commit', ref: '52a745e' },
        ],
      },
    ],
  },
  {
    id: 'agency.supervised-self-development',
    name: 'Self-development supervisionado',
    description: 'Cadeia completa backlog → attempt → worktree → coder → gates → review → aceite humano.',
    domain: 'agency',
    maturity: 'proven',
    dependsOn: ['agency.produce-change', 'agency.verify-change', 'governance.review', 'interaction.resident-host'],
    meaning: 'O Anima constrói o próprio Anima sob supervisão: uma solicitação aprovada percorre toda a esteira até revisão humana.',
    advancement:
      'Operacional exige reprodutibilidade local (RAM) e provas pagas confiáveis; hoje é comprovado ponta a ponta, não rotineiro.',
    proofRefs: [
      { kind: 'work_item', ref: '8a2515d8', note: 'work item que foi fim-a-fim até review→completed com OpenAI forte (2026-09-11)' },
      { kind: 'milestone', ref: 'docs/marcos/008-dev-local-v1-review-rework-incremental.md' },
      { kind: 'verifier', ref: 'f6c326b1/515c4d83', note: 'verified (0 violações, 0 lacunas, 13 checks) + aceite humano (result_accepted 54738)' },
    ],
    history: [
      {
        at: '2026-09-27',
        change: 'proof_added',
        note:
          'Proof Engine: depois de 5 decisões humanas negativas, o aceite de f6c326b1 reabriu a janela positiva, e o nível derivado voltou a comprovada. Supervisionado ≠ autônomo.',
        refs: [
          { kind: 'work_item', ref: 'f6c326b1' },
          { kind: 'event', ref: '54738', note: 'result_accepted' },
        ],
      },
    ],
  },
  {
    id: 'agency.detect-deficiency',
    name: 'Detectar deficiência própria',
    description: 'O Anima percebe sozinho uma limitação/lacuna na própria capacidade.',
    domain: 'agency',
    maturity: 'proven',
    dependsOn: ['agency.supervised-self-development', 'governance.verifier', 'memory.event-history'],
    target: { description: 'Primeiro degrau rumo ao self-development contínuo.' },
    meaning: 'Em vez de esperar um humano apontar o que falta, o Anima infere as próprias deficiências a partir de attempts, verifier e histórico.',
    advancement:
      'Três detectores determinísticos (falha repetida, regressão de capacidade, verifier recorrente) rodaram sobre o histórico real. Operacional exige detecção recorrente no host residente sem dry-run manual, e classes além das três atuais.',
    proofRefs: [
      { kind: 'commit', ref: '09b3bc7', note: 'Self-Development Continuous Loop V0 (detectores + dedup + proveniência)' },
      { kind: 'record', ref: 'docs/registros/2026-09-18d-self-development-loop-v0-prova-e2e-real.md', note: '1130 eventos reais → 6 deficiências, 100% dos refs resolvem' },
      { kind: 'commit', ref: 'ab47402', note: 'lifecycle de deficiência fail-closed' },
    ],
    history: [
      {
        at: '2026-09-18',
        change: 'maturity_changed',
        from: 'projected',
        to: 'proven',
        note: 'O detector existe e foi executado read-only contra o histórico residente real, com auditoria manual dos refs (registrado só agora).',
        refs: [
          { kind: 'commit', ref: '09b3bc7' },
          { kind: 'commit', ref: '2c4cbb1' },
        ],
      },
    ],
  },
  {
    id: 'agency.formulate-improvement',
    name: 'Formular melhoria própria',
    description: 'Transformar uma deficiência detectada numa proposta de melhoria concreta.',
    domain: 'agency',
    maturity: 'implemented',
    dependsOn: ['agency.detect-deficiency'],
    target: { description: 'Segundo degrau rumo ao self-development contínuo.' },
    meaning: 'O Anima propõe a própria evolução: dada uma deficiência, formula o que mudar e por quê.',
    advancement:
      'Existem templates determinísticos (sem LLM) e a materialização idle no host residente (máximo `proposed`, sempre estrutural). Nenhuma proposta real foi materializada: falta a primeira prova viva, atrás de ANIMA_RESIDENT_MATERIALIZE_SELF_IMPROVEMENT.',
    proofRefs: [
      { kind: 'commit', ref: '09b3bc7', note: 'formulateImprovementProposal + materializeSelfImprovementProposal' },
      { kind: 'commit', ref: 'bfdf1fa', note: 'materialização quando o host residente fica idle' },
    ],
    history: [
      {
        at: '2026-09-21',
        change: 'maturity_changed',
        from: 'projected',
        to: 'implemented',
        note: 'Formulação e materialização existem em código e testes; sem execução viva.',
        refs: [
          { kind: 'commit', ref: '09b3bc7' },
          { kind: 'commit', ref: 'bfdf1fa' },
        ],
      },
    ],
  },
  {
    id: 'agency.validate-improvement',
    name: 'Validar melhoria própria',
    description: 'Provar que uma melhoria auto-formulada de fato melhora, sem regressão.',
    domain: 'agency',
    maturity: 'projected',
    dependsOn: ['agency.formulate-improvement', 'agency.verify-change', 'governance.differential-evidence'],
    target: { description: 'Terceiro degrau rumo ao self-development contínuo.' },
    meaning: 'Antes de incorporar, o Anima valida a própria melhoria com evidência — auto-modificação sob prova.',
    advancement:
      'Depende de formular melhoria e de verificação forte o suficiente para autojulgamento. O substrato diferencial (FAIL no base → PASS no resultado) existe em shadow, mas nenhuma execução real chegou a `eligible`.',
    history: [
      {
        at: '2026-09-19',
        change: 'relation_added',
        note: 'Passa a depender da evidência diferencial de gate (shadow), o substrato de "melhorou sem regressão".',
        refs: [
          { kind: 'commit', ref: '2e67da6' },
          { kind: 'record', ref: RECONCILIATION_V2_RECORD },
        ],
      },
    ],
  },
  {
    id: 'agency.continuous-self-development',
    name: 'Self-development contínuo',
    description: 'O Anima detecta, formula, valida e incorpora melhorias próprias dentro da authority, sem loop humano constante.',
    domain: 'agency',
    maturity: 'projected',
    dependsOn: [
      'agency.validate-improvement',
      'agency.recovery-correction',
      'governance.progressive-autonomy',
      'memory.architectural-memory',
    ],
    target: {
      description: 'Norte do arco de agência: evolução própria contínua e segura sob mandato.',
      milestone: 'docs/marcos/005-autonomia-progressiva-e-identidade-una.md',
    },
    meaning: 'A capacidade mais ambiciosa do arco: o Anima evolui a si mesmo continuamente, dentro de limites explícitos e revogáveis.',
    advancement:
      'Detectar já é comprovado e formular já está implementado; faltam validar e incorporar sob autonomia progressiva comprovada, e consultar a própria história arquitetural antes de mudar.',
    frontier: [
      'O Claude Desktop ainda atua como operador bootstrap do ciclo de self-development.',
      'Classificação pós-aprovação pelo Resident Host é missing; preparação/classificação e configuração/autenticação são humanas.',
      'Retry/recovery genérico de Investigation read_only falha é missing; INV-08 é nova investigação, não continuação de lineage.',
      'Lifecycle autônomo do Resident Host é future: iniciar/continuar ainda exige operação externa em pontos do fluxo.',
      'Integração exige clone dedicado; sync do checkout humano e push são manuais, sem push governado.',
      'Migration e deploy continuam atos humanos.',
      'A seleção final de executor ainda pode exigir decisão humana.',
    ],
    history: [
      {
        at: '2026-09-27',
        change: 'relation_added',
        note: 'Passa a depender da memória arquitetural: não repetir abordagens que já falharam ou foram abandonadas.',
        refs: [{ kind: 'record', ref: RECONCILIATION_V2_RECORD }],
      },
    ],
  },

  {
    id: 'agency.recovery-evidence',
    name: 'Evidência entre recoveries',
    description:
      'Levar ao sucessor a evidência host-observada de ancestors da lineage (mesmo gate FAIL → edição → PASS), com identidade canônica de gate.',
    domain: 'agency',
    maturity: 'implemented',
    dependsOn: ['agency.recovery-correction', 'memory.event-history', 'agency.run-tests'],
    meaning:
      'O sucessor não recomeça do zero: recebe o que a lineage já provou, sem transcript livre nem raciocínio do provider, com referências rastreáveis.',
    advancement:
      'A 1ª prova viva falhou: a sanitização quebrava o matching, e zero itens chegaram ao coder. Depois da identidade canônica, a seleção foi provada por reconstrução read-only (2 itens). A entrega na attempt 515c4d83 não fica registrada em evento tipado, e o sucesso dela não pode ser atribuído a isso. Comprovar exige registrar a entrega.',
    proofRefs: [
      { kind: 'commit', ref: '9035cef', note: 'continuidade de evidência entre recoveries' },
      { kind: 'commit', ref: '6580be2', note: 'identidade canônica (fingerprint) do gate' },
      { kind: 'record', ref: 'docs/registros/2026-09-26-continuidade-evidencia-recovery-dev-readiness.md', note: 'prova viva NEGATIVA (98402f85): 0 itens entregues' },
      { kind: 'record', ref: 'docs/registros/2026-09-27-identidade-canonica-gate-recovery.md', note: 'reconstrução read-only: 2 itens selecionados' },
    ],
    history: [
      {
        at: '2026-09-26',
        change: 'introduced',
        to: 'implemented',
        note: 'Contrato de recovery evidence; a 1ª execução viva não entregou nada, porque a identidade do gate ficou textual e sanitizada.',
        refs: [
          { kind: 'commit', ref: '9035cef' },
          { kind: 'commit', ref: '73b37f7' },
        ],
      },
      {
        at: '2026-09-27',
        change: 'proof_added',
        note: 'Identidade canônica de gate. A seleção foi provada read-only; a entrega à attempt não foi registrada.',
        refs: [{ kind: 'commit', ref: '6580be2' }],
      },
    ],
  },
  {
    id: 'agency.reuse-discovery',
    name: 'Descoberta de reuso',
    description:
      'Antes de construir, pesquisar ferramentas existentes e anexar à proposta a decisão ADOPT/WRAP/FORK/BUILD com evidência citada.',
    domain: 'agency',
    maturity: 'projected',
    dependsOn: ['research.web.search', 'research.web.extract', 'research.web.cite', 'agency.formulate-improvement'],
    target: { description: 'O self-dev deixa de construir o que já existe: reuso decidido com evidência da web citada.' },
    meaning: 'Hoje o reuso foi decidido por humanos com POCs manuais; o Anima ainda não faz essa pesquisa para si.',
    advancement: 'Falta citar e persistir findings (cite/persist) e o plano que usa research.web antes de propor BUILD.',
    history: [
      {
        at: '2026-09-27',
        change: 'introduced',
        to: 'projected',
        note: 'Direção da Reuse Architecture V1 (G:\\anima-labs, fora do repo); não há código.',
        refs: [{ kind: 'doc', ref: 'docs/arquitetura/research-web-v1.md', note: 'lista selfdev.reuse_discovery como não implementado' }],
      },
    ],
  },
  {
    id: 'agency.external-harness',
    name: 'Harness externo (Claude Code / Codex)',
    description: 'Usar um harness de código externo como CoderBackend enraizado, sob os mesmos gates, escopo e Verifier.',
    domain: 'agency',
    maturity: 'implemented',
    dependsOn: ['agency.produce-change', 'governance.authority'],
    reuse: {
      strategy: 'wrap',
      tool: 'Claude Code / Codex CLI',
      status: 'integrated',
      externalEvidence:
        'POC ai-memory × ANIMA (G:\\anima-labs): Claude→Codex→Claude provado em repo descartável. Continua pendente a decisão humana sobre a classe de autoridade da quota de assinatura.',
    },
    meaning: 'Codex CLI e Claude Code são CoderBackends nativos governados. Caminho direto do Codex usa --json e thread.started/turn.failed: usage_limit_exceeded por heurística textual estreita, 401 Unauthorized vira unauthorized, demais casos unknown_native_cli_failure. Diagnóstico não prova disponibilidade de assinatura.',
    advancement:
      'Existe em código e testes (backends, evidência do coder, especificação canônica preservada até o coder). Não sobe para comprovada por esta reconciliação: o uso real (Claude Code no SDC-01/SDC-03, Codex CLI no SDC-04/05/06/08, com falhas reais no SDC-02, no recovery do SDC-02 e no SDC-07) vem do operador e não é verificável pelo repositório. Falta registrar essa prova em evento/commit auditável e decidir a authority da quota de assinatura.',
    proofRefs: [
      { kind: 'commit', ref: 'ad669c3' },
      { kind: 'commit', ref: '29cd393' },
      { kind: 'commit', ref: 'b9d617c' },
      { kind: 'doc', ref: 'apps/web/lib/work-orchestration/codex-cli-coder.ts' },
      { kind: 'commit', ref: '9404bd4', note: 'Codex CLI como backend de código' },
      { kind: 'commit', ref: 'cd73276', note: 'Claude Code como backend de código' },
      { kind: 'commit', ref: 'f518d0d', note: 'evidência do coder para backends CLI nativos' },
      { kind: 'commit', ref: '6eb2dee', note: 'CoderTaskSpecV1 preservada até o coder' },
      { kind: 'test', ref: 'apps/web/lib/work-orchestration/codex-cli-coder.worktree.test.ts' },
      { kind: 'test', ref: 'apps/web/lib/work-orchestration/claude-code-coder.worktree.test.ts' },
    ],
    frontier: [
      'Prova de uso real reportada pelo operador não promove maturity sem registro canônico versionado.',
      'A classe de authority da quota de assinatura segue decisão humana; diagnóstico não certifica quota disponível.',
      'Descoberta durável do executável Codex é missing: ANIMA_CODEX_CLI_PATH de deploy do operador ou codex no PATH; readiness só faz probes de versão/login.',
    ],
    history: [
      {
        at: '2026-09-27',
        change: 'introduced',
        to: 'projected',
        note: 'Candidata externa registrada a partir da Reuse Architecture V1. POC externo ≠ capacidade do Anima.',
        refs: [{ kind: 'record', ref: RECONCILIATION_V2_RECORD }],
      },
      {
        at: '2026-10-02',
        change: 'maturity_changed',
        from: 'projected',
        to: 'implemented',
        note: 'Codex CLI e Claude Code adotados como CoderBackend governado, com evidência do coder e especificação canônica preservada. Implementado ≠ comprovado: sem prova viva verificável aqui.',
        refs: [
          { kind: 'commit', ref: '9404bd4' },
          { kind: 'commit', ref: 'cd73276' },
          { kind: 'commit', ref: '6eb2dee' },
        ],
      },
      {
        at: '2026-10-06',
        change: 'proof_added',
        note: 'SDC-18/19: JSON nativo --json com thread.started/turn.failed e diagnóstico estreito, sem certificar disponibilidade de assinatura. Implemented preservada.',
        refs: [
          { kind: 'commit', ref: 'ad669c3' },
          { kind: 'commit', ref: '29cd393' },
          { kind: 'commit', ref: 'b9d617c' },
        ],
      },
    ],
  },
  {
    id: 'agency.executor-discovery',
    name: 'Descoberta de executores',
    description: 'Listar executores e recomendar por readiness/elegibilidade; read_only exige exatamente Codex CLI, sem fallback, modelo ausente/default, project:anima e SHA de 40 hex, encaminhando a investigation-v1.',
    domain: 'agency',
    maturity: 'implemented',
    dependsOn: ['agency.external-harness', 'compute.selection'],
    meaning:
      'O humano enxerga, antes de escolher, quais executores estão prontos e elegíveis. A recomendação reflete só readiness, elegibilidade e custo — não afirma que o modelo serve à tarefa, não persiste e não inicia attempt.',
    advancement:
      'Existe em código e testes. Falta uso registrado e a escolha deixar de ser ato humano: hoje o Anima recomenda, o humano decide o executor.',
    proofRefs: [
      { kind: 'commit', ref: '3bfa619' },
      { kind: 'commit', ref: '2d8546f' },
      { kind: 'test', ref: 'apps/web/lib/work-orchestration/executor-selection.investigation.test.ts' },
      { kind: 'doc', ref: 'apps/web/lib/work-orchestration/codex-cli-coder.ts' },
      { kind: 'commit', ref: '6f7577f', note: 'anima work executors (discovery + readiness, read-only)' },
      { kind: 'test', ref: 'apps/web/lib/work-orchestration/executor-discovery.test.ts' },
      { kind: 'test', ref: 'apps/web/lib/work-orchestration/executor-readiness.test.ts' },
    ],
    frontier: [
      'Seleção final do executor continua ato humano; descoberta só recomenda.',
      'Descoberta durável do executável Codex é missing: ANIMA_CODEX_CLI_PATH de deploy do operador ou codex no PATH; readiness apenas probes de versão/login.',
    ],
    history: [
      {
        at: '2026-10-03',
        change: 'introduced',
        to: 'implemented',
        note: 'Consulta somente leitura pela CLI; sem prova de uso registrada no repositório.',
        refs: [{ kind: 'commit', ref: '6f7577f' }],
      },
      {
        at: '2026-10-05',
        change: 'proof_added',
        note: 'SDC-11: read_only roteado sem fallback. Relações existentes preservadas; não há descoberta durável do executável.',
        refs: [
          { kind: 'commit', ref: '3bfa619' },
          { kind: 'commit', ref: '2d8546f' },
        ],
      },
    ],
  },

  // Único nó novo SDC-21; comparação semântica de reuso explícita no meaning.
  {
    id: 'agency.investigation-sessions',
    name: 'Investigation Sessions',
    description: 'Entregar conhecimento read_only em snapshot autorizado detached por investigation-v1 e Codex CLI read-only/ephemeral, sem candidato, branch de trabalho ou gates mutantes.',
    domain: 'agency',
    maturity: 'implemented',
    dependsOn: ['governance.authority'],
    meaning: 'InvestigationResultV1 entrega findings, evidências e lacunas. Reuso comparado: agency.produce-change e agency.supervised-self-development entregam candidato mutante; agency.external-harness fornece backend; governance.verifier opina; interaction.action-cards prepara/decide; agency.executor-discovery lista/roteia; agency.verify-change confere gates. Nenhum representa honestamente a entrega first-class de conhecimento read_only. research.web.* permanece separado: sem browser/rede nesta lane.',
    advancement: 'Código/testes existem; INV-08 advisory, banco local e uso relatado não bastam para proven. Exige prova canônica versionada de funcionamento; verified do investigation-verifier-v1 não certifica a verdade.',
    proofRefs: [
      { kind: 'commit', ref: '11ae49f' },
      { kind: 'commit', ref: '3bfa619' },
      { kind: 'commit', ref: '2d8546f' },
      { kind: 'commit', ref: 'ebf5be8' },
      { kind: 'commit', ref: 'a173f40' },
      { kind: 'commit', ref: '74f3c5c' },
      { kind: 'commit', ref: '448fdde' },
      { kind: 'commit', ref: '349a35e' },
      { kind: 'doc', ref: 'apps/web/lib/work-orchestration/investigation-executor.ts' },
      { kind: 'test', ref: 'apps/web/lib/work-orchestration/investigation-executor.worktree.test.ts', note: 'Git real: EOF e blob grande; range_not_validated_file_too_large sustentado por testes, não exercício vivo.' },
      { kind: 'test', ref: 'packages/core/src/work-orchestration/investigation-result.test.ts' },
    ],
    frontier: [
      'Read_only isola efeitos no snapshot, não garante confinamento de leituras, integridade de todo filesystem ou ausência de efeitos externos; revisão humana necessária.',
      'Retry/recovery genérico de Investigation falha é missing: max_attempts=1 resulta em attempt_budget_exhausted; resume/replan/recover-harness/recover-candidate exigem evidências da lane worktree não produzidas por investigation-v1. INV-08 é nova investigação, não continuação de lineage.',
      'SDC-12 rejeita por-ref line_start_out_of_range/line_end_out_of_range, sem clamp; SDC-20 rejeita range_not_validated_file_too_large antes de ler o blob. Ref inteira sem lines continua válida; findings sem evidências restantes são rebaixados e lacunas ficam explícitas.',
      'Falhas duras de commit/path ausente, objeto não-blob, conteúdo inválido ou Git indisponível derrubam resultado inteiro. Diagnósticos estruturados transport/structure/evidence/post_rejection não são novas capacidades; evidence_file_too_large permanece no enum por compatibilidade.',
      'INV-08 só relatou mitigação de origem: anima-prd.md (~198 KB), lines=null aceito sem rejeição; não exerceu ao vivo o ramo range_not_validated_file_too_large.',
    ],
    history: [
      {
        at: '2026-10-05', change: 'introduced', to: 'implemented',
        note: 'Antes: nó ausente; agora implemented por núcleo/wiring em código e testes. Comparados os sete nós existentes descritos no meaning: conhecimento read_only sem candidato/gates mutantes é capacidade distinta. Sem prova canônica suficiente para proven.',
        refs: [{ kind: 'commit', ref: '11ae49f' }, { kind: 'commit', ref: '2d8546f' }],
      },
      {
        at: '2026-10-05', change: 'relation_added',
        note: 'Depende de governance.authority: request/envelope e snapshot autorizados são pré-condições. Candidatos excluídos individualmente: agency.produce-change gera candidato mutante, dispensado nesta lane; agency.external-harness fornece backend, mas o wiring investigation-v1 usa Codex read-only sem depender do fluxo mutante desse nó; governance.verifier opina sobre o resultado, não é pré-condição para entregar conhecimento; interaction.action-cards prepara/decide, mas a criação oficial também ocorre pela CLI; agency.executor-discovery lista/roteia executores, não é pré-condição do backend Codex configurado; agency.supervised-self-development exige mudança própria aceita, ausente nesta lane; agency.verify-change confere gates mutantes, dispensados nesta lane; research.web.* usa browser/rede, ausentes nesta lane. Sem edges automáticas por reuso, proximidade ou hipóteses advisory do INV-08.',
        refs: [{ kind: 'doc', ref: 'apps/web/lib/work-orchestration/investigation-executor.ts' }],
      },
      {
        at: '2026-10-05', change: 'proof_added',
        note: 'SDC-12/16: rejeição por-ref além do EOF e diagnósticos estruturados; implemented preservada.',
        refs: [{ kind: 'commit', ref: 'a173f40' }, { kind: 'commit', ref: '448fdde' }],
      },
      {
        at: '2026-10-06', change: 'proof_added',
        note: 'SDC-20: arquivo grande rejeita só range antes do blob; teste com Git real, não exercício vivo do ramo. INV-08 advisory não promove maturity.',
        refs: [{ kind: 'commit', ref: '349a35e' }, { kind: 'test', ref: 'apps/web/lib/work-orchestration/investigation-executor.worktree.test.ts' }],
      },
    ],
  },

  // ─── GOVERNANÇA ─────────────────────────────────────────────────────────────
  {
    id: 'governance.authority',
    name: 'Authority (mandato)',
    description: 'Derivar um envelope de trabalho a partir de intenção e limites e impedir o que estiver fora dele.',
    domain: 'governance',
    maturity: 'proven',
    dependsOn: ['memory.persistence'],
    meaning: 'A aprovação evolui de micropermissão para mandato: o usuário aprova intenção e limites; o sistema barra o resto (fail-closed).',
    advancement: 'Autoridades pagas por-item são efêmeras (expiram); operacional pleno exige envelopes reutilizáveis e revogáveis por evidência.',
    proofRefs: [
      { kind: 'milestone', ref: 'docs/marcos/005-autonomia-progressiva-e-identidade-una.md' },
      { kind: 'route', ref: 'apps/web/app/api/work-orchestration/paid-compute-authorizations' },
      { kind: 'commit', ref: 'af3d215', note: 'espera por authority paga visível e ato humano de concessão' },
      { kind: 'commit', ref: 'd6968d5', note: 'espera estável (mesmo decision_id no replay)' },
    ],
    history: [
      {
        at: '2026-09-25',
        change: 'proof_added',
        note:
          'Caminho normal até a authority paga sem scripts (CLI authorize-compute). Em 2026-09-25/27 houve 5 authorities item-scoped, cada uma consumida por exatamente uma attempt. Não virou operacional: as authorities ainda são efêmeras, sem envelope reutilizável.',
        refs: [
          { kind: 'commit', ref: '341564f' },
          { kind: 'record', ref: 'docs/registros/2026-09-25b-caminho-normal-ate-authority-sem-scripts.md' },
        ],
      },
    ],
  },
  {
    id: 'governance.attempt',
    name: 'Attempt e lineage',
    description: 'Tentativas persistentes com claim exclusivo e rastreio de sucessores (decomposição, replan, correção) preservando a história.',
    domain: 'governance',
    maturity: 'operational',
    dependsOn: ['memory.persistence'],
    meaning: 'Cada esforço é uma attempt durável e exclusiva com linhagem: a unidade que o sistema retoma de checkpoints, replaneja e audita, sem apagar história.',
    advancement: 'Operacional; recuperação de attempt "dead-end" (start manual sem attempt) é ação humana via RPC; cadeias de sucessão longas ainda não são rotina.',
    proofRefs: [
      { kind: 'milestone', ref: 'docs/marcos/003-trabalho-autonomo-seguro.md' },
      { kind: 'commit', ref: '4b5c500', note: 'replanejamento (sucessor proposed)' },
      { kind: 'commit', ref: 'e090013', note: 'decomposição com retomada de checkpoint' },
    ],
  },
  {
    id: 'governance.review',
    name: 'Review',
    description: 'Parar antes do efeito externo e pedir revisão humana (review request fail-closed).',
    domain: 'governance',
    maturity: 'operational',
    dependsOn: ['governance.attempt'],
    meaning: 'Nenhuma mudança de impacto vaza sem revisão: o sistema para ANTES do PR e espera a decisão humana.',
    advancement: 'Já operacional; evolução é promover classes de efeito a autônomas por evidência (autonomia progressiva).',
    proofRefs: [
      { kind: 'route', ref: 'apps/web/app/api/work-orchestration/review-requests' },
      { kind: 'milestone', ref: 'docs/marcos/008-dev-local-v1-review-rework-incremental.md' },
    ],
  },
  {
    id: 'governance.verifier',
    name: 'Verifier',
    description: 'Parecer append-only, puro e advisory que confere o resultado contra o contrato aprovado.',
    domain: 'governance',
    maturity: 'proven',
    dependsOn: ['agency.run-tests'],
    meaning: 'Parecer separado de produzir/aceitar. investigation-verifier-v1 advisory: checks A–E (snapshot clean; HEAD detached no base; ausência de novas refs proibidas; referências resolvidas; estrutura válida). A/B atestados, C–E independentes; verified não certifica a verdade semântica.',
    advancement: 'Falso positivo já observado; operacional exige que "verified" resista à revisão humana de forma consistente.',
    frontier: [
      'Verifier advisory de Investigation não certifica verdade, confinamento de leituras ou ausência de efeitos externos; revisão humana necessária.',
    ],
    proofRefs: [
      { kind: 'commit', ref: '11ae49f' },
      { kind: 'doc', ref: 'packages/core/src/work-orchestration/investigation-result.ts' },
      { kind: 'commit', ref: '824c714', note: 'Verifier v2 — cobertura heterogênea' },
      { kind: 'record', ref: 'docs/registros', note: 'VerifierOpinionV1 append-only, fail-open' },
    ],
    history: [
      {
        at: '2026-10-05',
        change: 'proof_added',
        note: 'SDC-10: verifier advisory de Investigation; proven anterior preservada. dependsOn agency.run-tests permanece para verificação de mudanças. A Investigation read_only não exige gates mutantes.',
        refs: [
          { kind: 'commit', ref: '11ae49f' },
          { kind: 'doc', ref: 'packages/core/src/work-orchestration/investigation-result.ts' },
        ],
      },
    ],
  },
  {
    id: 'governance.budgets',
    name: 'Budgets e limites',
    description: 'Orçamento local e externo com bloqueio temporal, re-admissão e fail-closed.',
    domain: 'governance',
    maturity: 'operational',
    dependsOn: ['governance.authority'],
    meaning: 'O Anima trabalha dentro de um envelope econômico: quando o orçamento esgota, ele bloqueia e re-admite sem perder trabalho.',
    advancement: 'Já operacional; settlement de custo real de compute pago ainda é barreira (ver compute.paid-settlement).',
    proofRefs: [
      { kind: 'commit', ref: '6bef210', note: 'orçamento V0 — bloqueio temporal + re-admissão' },
      { kind: 'commit', ref: '636aa7b', note: 'interrupção de orçamento retoma do checkpoint' },
    ],
  },
  {
    id: 'governance.recovery-authority',
    name: 'Human Recovery Authority',
    description: 'Autorizar +1 tentativa após saldo esgotado, append-only e anti-loop.',
    domain: 'governance',
    maturity: 'proven',
    dependsOn: ['governance.budgets', 'governance.attempt'],
    meaning: 'Quando o envelope trava, o humano — e só o humano — pode conceder mais uma tentativa, sem reabrir loops infinitos.',
    advancement: 'Reproduzir concessões de recovery de forma rotineira mantendo a barreira anti-loop.',
    proofRefs: [{ kind: 'commit', ref: '1c6c656', note: 'authorize_work_resume' }],
  },
  {
    id: 'governance.harness-recovery',
    name: 'Recovery governada de defeito de harness',
    description:
      'Quando a falha é do harness (não do trabalho), derivar exatamente um sucessor honesto, com o SHA do fix conferido pelo host, sem aprovar, preferir nem pagar.',
    domain: 'governance',
    maturity: 'proven',
    dependsOn: ['governance.recovery-authority', 'governance.attempt'],
    meaning:
      'Um defeito do próprio Anima não vira diagnóstico falso do trabalho: a recovery registra o fix, preserva proposta e escopo e mantém a lineage (inclusive em descendants).',
    advancement:
      'Usada ao vivo 3 vezes (f19ac716, 843669bd, f6c326b1); o 2º uso esbarrou numa recusa de descendants corrigida por migration. Operacional exige usos sem barreira nova.',
    proofRefs: [
      { kind: 'commit', ref: 'd30f9bb', note: 'authorize_harness_fix_recovery + CLI work recover-harness' },
      { kind: 'commit', ref: '8437570', note: 'recoveries governadas em descendants' },
      { kind: 'work_item', ref: 'f6c326b1', note: 'sucessor de recovery que chegou a completed' },
    ],
    history: [
      {
        at: '2026-09-25',
        change: 'introduced',
        to: 'proven',
        note: 'Primeiro sucessor por defeito de harness (f19ac716) chegou a review na mesma sessão.',
        refs: [
          { kind: 'commit', ref: 'd30f9bb' },
          { kind: 'record', ref: 'docs/registros/2026-09-25h-recovery-harness-dev-readiness-ate-review.md' },
        ],
      },
      {
        at: '2026-09-26',
        change: 'proof_added',
        note: 'Recovery em descendant (843669bd) depois da migration que removeu a recusa por presença ancestral.',
        refs: [{ kind: 'commit', ref: '8437570' }],
      },
    ],
  },
  {
    id: 'governance.differential-evidence',
    name: 'Evidência diferencial e readiness (shadow)',
    description:
      'Rodar o gate no base e no resultado (FAIL→PASS), avaliar policy/readiness e calibrar contra a revisão humana — só como telemetria.',
    domain: 'governance',
    maturity: 'implemented',
    dependsOn: ['agency.run-tests', 'governance.verifier'],
    meaning:
      'O substrato para um dia promover autoridade por evidência: distinguir um gate que discrimina de um gate que sempre passa. Evidência ≠ policy ≠ readiness ≠ enforcement.',
    advancement:
      'Shadow absoluto: nada o consome. Um teste de integração provou que a saída real do executor pode chegar a `eligible`; ao vivo, a calibração tem 0 `eligible` (histórico anterior à cadeia).',
    proofRefs: [
      { kind: 'commit', ref: '2e67da6', note: 'classifyDifferentialGate' },
      { kind: 'commit', ref: '10229a5', note: 'baseline diferencial por gate no executor' },
      { kind: 'commit', ref: 'eb6449a', note: 'Enforcement Readiness V0 (shadow)' },
      { kind: 'commit', ref: '30cd600', note: 'Readiness Calibration V0' },
      { kind: 'test', ref: 'apps/web/lib/work-orchestration/worktree-executor.test.ts', note: 'a163c5f: executor real → eligible' },
    ],
    history: [
      {
        at: '2026-09-19',
        change: 'introduced',
        to: 'implemented',
        note: 'Cadeia shadow: evidência diferencial → Policy V0 → Enforcement Readiness V0 → Change Authorization Evidence.',
        refs: [
          { kind: 'commit', ref: '68558b9' },
          { kind: 'commit', ref: '8eb00a8' },
        ],
      },
      {
        at: '2026-09-21',
        change: 'proof_added',
        note: 'Calibração ao vivo (0 eligible, dado histórico) e prova de integração do executor real até eligible.',
        refs: [
          { kind: 'commit', ref: 'a163c5f' },
          { kind: 'record', ref: 'docs/registros/2026-09-21-prova-eligible-fim-a-fim-e-auditoria-baseline.md' },
        ],
      },
    ],
  },
  {
    id: 'governance.external-tool-boundary',
    name: 'Fronteira de ferramentas externas',
    description:
      'Envelope de observação externa, política de execução externa e rótulo `untrusted_external_content`: o que uma ferramenta devolve é dado, nunca instrução.',
    domain: 'governance',
    maturity: 'implemented',
    dependsOn: ['governance.authority'],
    meaning:
      'ANIMA governa, ferramentas executam ou observam. Status/degradação/erro estruturados, allowlist e limites vivem numa política explícita, não no humor da ferramenta.',
    advancement:
      'V1 tem um único consumidor (research.web). A defesa contra prompt injection é estrutural (o conteúdo nunca dispara ferramenta), não semântica. Comprovar exige um segundo consumidor ou uma prova adversarial viva.',
    proofRefs: [
      { kind: 'commit', ref: '515ba65', note: 'ExternalObservationEnvelopeV1, ExternalExecutionPolicyV1, UNTRUSTED_EXTERNAL_CONTENT' },
      { kind: 'test', ref: 'packages/core/src/research-web/research-web.test.ts' },
    ],
    history: [
      {
        at: '2026-09-27',
        change: 'introduced',
        to: 'implemented',
        note: 'Nasce com o primeiro consumidor (Research Web V1), sem framework genérico.',
        refs: [{ kind: 'commit', ref: '515ba65' }],
      },
    ],
  },
  {
    id: 'governance.progressive-autonomy',
    name: 'Autonomia progressiva',
    description: 'Capacidades conquistam autoridade por evidência de segurança e a perdem por evidência de risco.',
    domain: 'governance',
    maturity: 'specified',
    dependsOn: ['governance.authority', 'governance.verifier', 'memory.event-history', 'governance.differential-evidence'],
    target: {
      description: 'Motor que promove/rebaixa autoridade por evidência — sem teto filosófico, alterar a própria política é o ato mais protegido.',
      milestone: 'docs/marcos/006-politica-de-seguranca-como-maturidade-maxima.md',
    },
    meaning: 'O princípio central da maturidade do Anima está ESPECIFICADO (Marcos 005/006), mas o motor genérico que move autoridade por evidência ainda não existe.',
    advancement:
      'Falta o mecanismo que lê evidência e ajusta authority automaticamente, com processo reforçado para a política máxima. A readiness shadow existe, mas a promoção automática segue bloqueada por decisão ratificada.',
    proofRefs: [{ kind: 'milestone', ref: 'docs/marcos/005-autonomia-progressiva-e-identidade-una.md' }],
    frontier: [
      'Hoje a autoridade sobre integração, push, migration, deploy e seleção final de executor é exercida por humano; nenhum desses atos é promovido por evidência.',
    ],
    history: [
      {
        at: '2026-09-19',
        change: 'relation_added',
        note: 'Passa a depender da evidência diferencial/readiness (shadow), o sinal que um motor de promoção leria.',
        refs: [
          { kind: 'commit', ref: 'eb6449a' },
          { kind: 'record', ref: RECONCILIATION_V2_RECORD },
        ],
      },
    ],
  },

  // ─── COMPUTE ────────────────────────────────────────────────────────────────
  {
    id: 'compute.local-execution',
    name: 'Execução local',
    description: 'Rodar modelos e o host residente localmente (Ollama, resident host in-process).',
    domain: 'compute',
    maturity: 'operational',
    dependsOn: [],
    meaning: 'local-first: o Anima prefere capacidade local e mantém um host residente que acorda por Realtime para trabalhar.',
    advancement: 'Barreira de RAM (16GB) limita modelos grandes; 32GB ou burst on-demand contorna.',
    proofRefs: [
      { kind: 'record', ref: 'docs/registros', note: 'Resident Local Host V0 (npm run local-host)' },
      { kind: 'commit', ref: '1d4a79f', note: 'caracterização de capacidade da Goma' },
    ],
  },
  {
    id: 'compute.external-provider',
    name: 'Provider externo',
    description: 'Chamar providers externos (OpenAI) por uma borda única governada (admit antes do fetch).',
    domain: 'compute',
    // Auditoria 2026-09-16: rebaixada operational→proven. As chamadas pagas são
    // deliberadamente raras e gated (autoridade efêmera por item), então não há
    // "uso rotineiro reproduzido" que justifique operational — só provas concretas.
    maturity: 'proven',
    dependsOn: ['governance.authority'],
    meaning: 'local-first != local-only: o Anima usa modelos externos enquanto forem mais capazes, sempre por uma borda única que admite antes de gastar.',
    advancement: 'Transporte comprovado; operacional exigiria uso reproduzido, hoje limitado por autoridades pagas efêmeras e pela barreira de settlement de custo real.',
    proofRefs: [
      { kind: 'commit', ref: '78dfc3f', note: 'governança OpenAI global (borda única)' },
      { kind: 'commit', ref: '43b47c2', note: 'coder pago OpenAI governado até review' },
    ],
  },
  {
    id: 'compute.selection',
    name: 'Seleção de compute',
    description: 'Rotear entre Ollama × OpenAI (e casar recursos de cloud) por política e economia.',
    domain: 'compute',
    maturity: 'proven',
    dependsOn: ['compute.local-execution', 'compute.external-provider', 'memory.event-history'],
    meaning: 'A escolha do provider é decisão de capacidade e política — nunca parte da identidade. O Router decide; OFF é invisível.',
    advancement:
      'O Router V1 selecionou ao vivo em várias unidades pagas, mas sempre a mesma rota (preferência Sol + authority) e ainda como feature gate de processo. Operacional exige seleção variada e Router ligado por padrão; o matching de recurso de cloud ainda é WIP.',
    proofRefs: [
      { kind: 'commit', ref: '38494d5', note: 'Compute Router V1 (feature gate)' },
      { kind: 'commit', ref: '9fa181c', note: 'ponte economic observations → Router' },
      { kind: 'commit', ref: 'fc53649', note: 'sinal de falha local agregado pela lineage de recovery' },
    ],
    history: [
      {
        at: '2026-09-25',
        change: 'proof_added',
        note: 'Router consciente da lineage (deixa de insistir no local depois de no_progress) e preferência aprovada autoritativa.',
        refs: [
          { kind: 'commit', ref: 'fc53649' },
          { kind: 'commit', ref: '33ffe01' },
        ],
      },
    ],
  },
  {
    id: 'compute.unit-preference',
    name: 'Preferência de compute por unidade',
    description:
      'O humano registra, por work item, a estratégia de compute (ex.: provider_api/openai/gpt-5.6-sol), separada da authority paga; o Router a honra sem trocar por local.',
    domain: 'compute',
    maturity: 'proven',
    dependsOn: ['compute.selection', 'governance.authority'],
    meaning: 'Preferência ≠ authority: escolher o executor não autoriza gasto, e autorizar gasto não escolhe executor.',
    advancement:
      'Honrada ao vivo em 5 unidades (2c7afe1d, f19ac716, 7610b066, 843669bd, f6c326b1). Fica comprovada, não operacional, enquanto depender do Router V1 como feature gate de processo.',
    proofRefs: [
      { kind: 'commit', ref: '9faf2d0', note: 'record_compute_preference + CLI work set-compute' },
      { kind: 'event', ref: '54721', note: 'compute_preference_recorded em f6c326b1' },
      { kind: 'record', ref: 'docs/registros/2026-09-25d-preferencia-de-compute-por-unidade.md' },
    ],
    history: [
      {
        at: '2026-09-25',
        change: 'introduced',
        to: 'proven',
        note: 'Correção da barreira "coder_backend só por env": preferência por unidade, fail-closed.',
        refs: [
          { kind: 'commit', ref: '9faf2d0' },
          { kind: 'record', ref: 'docs/registros/2026-09-25c-integracao-8a2515d8-e-barreira-preferencia-executor.md' },
        ],
      },
    ],
  },
  {
    id: 'compute.subscription-availability',
    name: 'Disponibilidade de quota de assinatura',
    description: 'Observar janelas de quota das assinaturas Claude/Codex como sinal do Router, nunca como autoridade.',
    domain: 'compute',
    maturity: 'projected',
    dependsOn: ['compute.selection', 'agency.external-harness'],
    reuse: {
      strategy: 'wrap',
      tool: 'ai-usagebar',
      status: 'candidate',
      externalEvidence:
        'POC ai-usagebar (G:\\anima-labs): formato `usage --json` bom. WRAP condicionado a uma credencial de observador dedicada: o refresh com write-back rotacionaria o token vivo do Codex. Leitura real não executada.',
    },
    meaning: 'Só faz sentido quando houver harness por assinatura como opção do Router.',
    advancement: 'O harness externo já existe em código (implementado); falta um POC de auth com credencial de observador.',
    history: [
      {
        at: '2026-09-27',
        change: 'introduced',
        to: 'projected',
        note: 'Candidata externa (Reuse Architecture V1).',
        refs: [{ kind: 'record', ref: RECONCILIATION_V2_RECORD }],
      },
    ],
  },
  {
    id: 'compute.provisioning',
    name: 'Provisionamento on-demand',
    description: 'Ciclo de vida governado de nós de compute sob demanda (lease + reconciler + teto de custo).',
    domain: 'compute',
    maturity: 'proven',
    dependsOn: ['compute.selection', 'governance.budgets'],
    meaning: '"necessidade ≠ gasto": o Anima provisiona compute só dentro de um envelope de segurança com custo máximo obrigatório.',
    advancement: 'Comprovado com recurso OWNED; operacional exige o ciclo pago completo com settlement.',
    proofRefs: [
      { kind: 'record', ref: 'docs/registros', note: 'Provisionamento On-Demand V1' },
      { kind: 'doc', ref: 'docs/arquitetura/provisionamento-lease-seguranca.md' },
    ],
  },
  {
    id: 'compute.cloud-self-hosted',
    name: 'Cloud self-hosted + resiliência de sessão',
    description: 'Subir e usar um nó de inferência próprio na nuvem (RunPod cold-start + túnel) e reprovisionar/teardown de forma governada.',
    domain: 'compute',
    maturity: 'implemented',
    dependsOn: ['compute.provisioning'],
    meaning:
      'Quando o local não basta, o Anima levanta o próprio nó de GPU na nuvem — sem depender de endpoint de terceiros — e sabe trocar de máquina ruim sem estourar o envelope.',
    advancement:
      'Barreira viva: RUNPOD_AUTOPROVISION_END_TO_END=FAIL (pod RUNNING mas endpoint não publica); falta adapter de sessão resiliente vivo e migração de settlement aplicada.',
    proofRefs: [
      { kind: 'commit', ref: '37cf35f', note: 'endurece provisionador RunPod para cold-start' },
      { kind: 'record', ref: 'docs/registros', note: 'RunPod readiness em camadas + Resilient Cloud Session V1 (WIP)' },
    ],
  },
  {
    id: 'compute.paid-settlement',
    name: 'Settlement de custo pago',
    description: 'Liquidar o custo REAL de compute pago (actual-cost) no ledger, append-only.',
    domain: 'compute',
    maturity: 'implemented',
    dependsOn: ['compute.external-provider', 'governance.budgets'],
    meaning: 'Reservar não é gastar e derivar não é liquidar: o Anima precisa fechar o custo real do que consumiu, com honestidade.',
    advancement: 'Catálogo versionado provider-pricing-catalog.json (anima/provider-pricing-catalog@2026-09-28.1) precifica gpt-5.6-terra e gpt-5.6-sol. provider-api-settlement.ts liquida somente decisão settle; demais decisões deixam reserva aberta/cost_unknown; catálogo fail-closed. Migrations 20260927000000_provider_api_usage_priced_settlement.sql e 20260927000001_restore_provider_api_reservation_correlation.sql existem. Barreira: prova viva paga e aplicação operacional das migrations fora do ambiente local.',
    frontier: [
      'Prova viva paga com authority humana necessária; implemented não implica settlement operacional.',
      'Aplicação operacional das migrations fora do ambiente local precisa de confirmação/prova, não inferida pelo código.',
    ],
    proofRefs: [
      { kind: 'commit', ref: 'e0adff7' },
      { kind: 'commit', ref: 'a68eada' },
      { kind: 'commit', ref: '2c435b2' },
      { kind: 'doc', ref: 'apps/web/lib/work-orchestration/provider-pricing-catalog.json' },
      { kind: 'doc', ref: 'apps/web/lib/work-orchestration/provider-api-settlement.ts' },
      { kind: 'doc', ref: 'supabase/migrations/20260927000000_provider_api_usage_priced_settlement.sql' },
      { kind: 'doc', ref: 'supabase/migrations/20260927000001_restore_provider_api_reservation_correlation.sql' },
      { kind: 'commit', ref: 'b14a32c', note: 'infraestrutura mínima de settlement do ledger de compute pago' },
      { kind: 'record', ref: 'docs/registros', note: 'benchmark settlement V3 — barreira de actual-cost' },
    ],
    history: [
      {
        at: '2026-09-27',
        change: 'proof_added',
        note: 'Settlement pós-attempt usage_priced e migrations de liquidação/correlação existem no repositório. Código não prova aplicação operacional fora do ambiente local; implemented preservada.',
        refs: [
          { kind: 'commit', ref: 'e0adff7' },
          { kind: 'doc', ref: 'apps/web/lib/work-orchestration/provider-api-settlement.ts' },
          { kind: 'doc', ref: 'supabase/migrations/20260927000000_provider_api_usage_priced_settlement.sql' },
          { kind: 'doc', ref: 'supabase/migrations/20260927000001_restore_provider_api_reservation_correlation.sql' },
        ],
      },
      {
        at: '2026-09-28',
        change: 'proof_added',
        note: 'Catálogo versionado precifica terra/sol, com vigência epistemológica e carregamento fail-closed. Substitui texto stale; implemented preservada: sem prova viva paga canônica.',
        refs: [
          { kind: 'commit', ref: 'a68eada' },
          { kind: 'commit', ref: '2c435b2' },
          { kind: 'doc', ref: 'apps/web/lib/work-orchestration/provider-pricing-catalog.json' },
        ],
      },
    ],
  },

  // ─── INTERAÇÃO ──────────────────────────────────────────────────────────────
  {
    id: 'interaction.chat',
    name: 'Chat',
    description: 'A entrada conversacional unificada do Anima.',
    domain: 'interaction',
    maturity: 'operational',
    dependsOn: ['memory.persistence'],
    meaning: 'O chat é a única frente conversacional do produto; telas auxiliares só visualizam e confirmam.',
    advancement: 'Operacional; evolui com proatividade cognitiva (o Anima puxando assunto sobre o futuro).',
    proofRefs: [{ kind: 'route', ref: 'apps/web/app/(app)/chat' }],
  },
  {
    id: 'interaction.web-interface',
    name: 'Interface web',
    description: 'As telas do app (home, grafo, entidades, histórico, evolução) sobre a mesma base de dados.',
    domain: 'interaction',
    maturity: 'operational',
    dependsOn: ['memory.persistence'],
    meaning: 'A camada visual que projeta o estado do Anima — inclui esta própria tela de evolução.',
    advancement: 'Operacional; esta tela /evolution é o V0 da projeção do autoconhecimento do sistema.',
    proofRefs: [{ kind: 'route', ref: 'apps/web/app/(app)', note: 'grupo de rotas do app' }],
  },
  {
    id: 'interaction.resident-host',
    name: 'Resident Host',
    description: 'Runtime residente in-process que acorda por Realtime e executa trabalho admitido.',
    domain: 'interaction',
    maturity: 'operational',
    dependsOn: ['interaction.web-interface', 'governance.attempt'],
    meaning: 'O Anima tem um "corpo" residente que roda continuamente e reage a eventos, em vez de só responder a cliques.',
    advancement: 'Operational do runtime admitido não é lifecycle autônomo. ensurePlannedProjectClassification existe para humanos via CLI work prepare-autonomous, rota API e botão da UI; Host não classifica aprovados não classificados.',
    frontier: [
      'Classificação pós-aprovação pelo Resident Host é missing; preparação/classificação exige ato humano (ensurePlannedProjectClassification). SDC-17 falhou e não está integrado.',
      'Lifecycle autônomo é future: configuração/autenticação e bootstrap continuam humanos.',
      'Recovery/rework, seleção final de executor, integração em clone dedicado, sync do checkout humano e push continuam fronteiras humanas.',
    ],
    proofRefs: [
      { kind: 'commit', ref: '732ff60' },
      { kind: 'doc', ref: 'apps/web/lib/work-orchestration/planned-project-classification.ts' },
      { kind: 'doc', ref: 'apps/web/lib/resident-host/resident-host.ts' },
      { kind: 'record', ref: 'docs/registros', note: 'Marco Resident Local Host V0' },
      { kind: 'commit', ref: '3d5aa65', note: 'autoridade de execução do Resident Host' },
    ],
    history: [
      {
        at: '2026-10-05',
        change: 'proof_added',
        note: 'SDC-14 reconhece envelope Investigation na classificação humana; não automatiza preparação no Host. Operational do runtime preservada.',
        refs: [
          { kind: 'commit', ref: '732ff60' },
          { kind: 'doc', ref: 'apps/web/lib/work-orchestration/planned-project-classification.ts' },
          { kind: 'doc', ref: 'apps/web/lib/resident-host/resident-host.ts' },
        ],
      },
    ],
  },
  {
    id: 'interaction.action-cards',
    name: 'Interação com ações',
    description: 'Confirmar, aprovar, aceitar, pedir mudanças e retomar trabalho; CLI oficial anima work propose-investigation cria proposta read_only (INV-NN), sem aprovar nem executar.',
    domain: 'interaction',
    maturity: 'operational',
    dependsOn: ['interaction.chat', 'governance.review'],
    meaning: 'Decisões humanas compartilham serviços. Criação oficial de Investigation usa cli_propose_investigation_v1, 1 attempt, 30 min, workspace_read e verifier advisory; criação não é execução.',
    advancement: 'Operacional; web e CLI compartilham os serviços com identidade residente (RLS, sem service_role).',
    proofRefs: [
      { kind: 'commit', ref: '732ff60' },
      { kind: 'commit', ref: '96606b4' },
      { kind: 'test', ref: 'apps/web/lib/work-orchestration/investigation-preparation.test.ts' },
      { kind: 'test', ref: 'apps/web/cli/app.test.ts' },
      { kind: 'commit', ref: 'de14178', note: 'CLI operacional como adapter oficial' },
      { kind: 'test', ref: 'apps/web/app/(app)/chat/_components/WorkProposalCard.test.tsx' },
      { kind: 'test', ref: 'apps/web/lib/work-orchestration/work-reference.test.ts', note: 'referência humana legível (SDC-01) na CLI' },
    ],
    history: [
      {
        at: '2026-10-05',
        change: 'proof_added',
        note: 'A CLI aceita referências humanas legíveis (`anima work show SDC-01`); o UUID continua válido. Maturidade mantida.',
        refs: [{ kind: 'commit', ref: '930ea70' }],
      },
      {
        at: '2026-10-05',
        change: 'proof_added',
        note: 'SDC-14: CLI propose-investigation, INV-NN e provenance estrita criam proposed, sem aprovar/executar. Operational da interação preservada.',
        refs: [
          { kind: 'commit', ref: '732ff60' },
          { kind: 'commit', ref: '96606b4' },
        ],
      },
    ],
  },
  {
    id: 'interaction.local-executor-arm',
    name: 'Braço executor local (GUI/OS)',
    description: 'Perceber e operar aplicações/OS locais como braço executor provider-neutral sob mandato.',
    domain: 'interaction',
    maturity: 'specified',
    dependsOn: ['interaction.resident-host', 'governance.authority'],
    target: {
      description: 'Operar interfaces locais (abrir, navegar, clicar, digitar) sob mandato, com cada classe de efeito amadurecendo à parte.',
      milestone: 'docs/marcos/007-interacao-com-computador-e-aplicacoes-locais.md',
    },
    meaning: 'O Anima estende os nós locais à camada GUI: enxergar a tela e operar apps, sempre sob escopo/impacto/duração aprovados.',
    advancement: 'Estado estreito: só prova inicial do canal; falta taxonomia, contrato e implementação por classe de efeito.',
    proofRefs: [{ kind: 'milestone', ref: 'docs/marcos/007-interacao-com-computador-e-aplicacoes-locais.md' }],
  },
  {
    id: 'interaction.cognitive-proactivity',
    name: 'Proatividade cognitiva',
    description: 'O Anima observa, relaciona no tempo, projeta cenários e puxa conversa sobre o futuro.',
    domain: 'interaction',
    maturity: 'projected',
    dependsOn: ['interaction.chat', 'memory.narrative-memory', 'understanding.world-model'],
    target: {
      description: 'Passar de "receber → armazenar → exibir" para "observar → lembrar → relacionar → refletir → projetar → conversar" (capacidade Prisma).',
    },
    meaning: 'A proatividade é COGNITIVA, não operacional: o Anima nota mudanças e conversa sobre o futuro — sem iniciar execuções sozinho.',
    advancement: 'Depende da memória narrativa e do world model existirem para relacionar dados no tempo.',
  },

  // ─── PESQUISA EXTERNA (Research Web V1, 2026-09-27) ────────────────────────
  // "Comprovada" aqui = prova viva controlada real (SearXNG em contêiner +
  // agent-browser local, 2 execuções, mesmo contentHash). Nenhuma é operacional:
  // não há consumidor do Anima (chat/host/self-dev) e o runtime seguro não existe.
  {
    id: 'research.query-privacy',
    name: 'Privacidade da consulta',
    description: 'Classificar toda consulta (public / project_public / private_blocked) antes de qualquer rede; private_blocked nunca sai.',
    domain: 'research',
    maturity: 'proven',
    dependsOn: ['governance.external-tool-boundary'],
    meaning: 'Self-hosted ≠ privado: o SearXNG repassa a consulta aos buscadores com o IP do host. A classificação é conservadora e explicável, não DLP universal.',
    advancement:
      'Ao vivo só o caminho `public` foi exercido; o bloqueio está provado por testes da função pura (por design, nunca sai). Operacional exige um consumidor real e revisão de falsos negativos.',
    proofRefs: [
      { kind: 'test', ref: 'packages/core/src/research-web/research-web.test.ts', note: 'segredos, .env, URLs/IPs privados, caminhos, stack traces, e-mails' },
      { kind: 'record', ref: 'docs/registros/2026-09-27b-research-web-v1.md', note: 'consulta viva classificada public' },
    ],
    history: [
      {
        at: '2026-09-27',
        change: 'introduced',
        to: 'proven',
        note: 'Research Web V1.',
        refs: [
          { kind: 'commit', ref: '515ba65' },
          { kind: 'commit', ref: '5260316' },
        ],
      },
    ],
  },
  {
    id: 'research.web.search',
    name: 'Busca web',
    description: 'Buscar na web por um metabuscador self-hosted e normalizar resultados, degradação e engines silenciosas.',
    domain: 'research',
    maturity: 'proven',
    dependsOn: ['research.query-privacy', 'governance.external-tool-boundary'],
    reuse: { strategy: 'wrap', tool: 'SearXNG', status: 'integrated', externalEvidence: 'POC SearXNG (G:\\anima-labs): CAPTCHA/429 por volta de 60 consultas; vazio silencioso em algumas engines.' },
    meaning: 'O Anima não constrói buscador: governa um. Ausência de resultado nunca prova inexistência (`silent_empty` ⇒ complete=false).',
    advancement:
      'Não há consumidor no Anima (só o probe manual). O SearXNG degrada sob carga num IP residencial, e o fallback de API (escape hatch) não foi implementado.',
    proofRefs: [
      { kind: 'commit', ref: '515ba65', note: 'searchWeb + normalizeSearxngResponse' },
      { kind: 'record', ref: 'docs/registros/2026-09-27b-research-web-v1.md', note: 'prova viva: degraded (github/stackoverflow silent_empty), rank 1 = docs oficiais' },
    ],
    history: [
      {
        at: '2026-09-27',
        change: 'introduced',
        to: 'proven',
        note: 'Research Web V1 com prova viva controlada.',
        refs: [
          { kind: 'commit', ref: '515ba65' },
          { kind: 'commit', ref: '5260316' },
        ],
      },
    ],
  },
  {
    id: 'research.web.network-boundary',
    name: 'Política de alvo e rede web',
    description: 'Só http/https públicos; recusa localhost/IP/porta/credencial e domínio que resolve para rede privada; allowlist por operação.',
    domain: 'research',
    maturity: 'implemented',
    dependsOn: ['governance.external-tool-boundary'],
    meaning: 'Pré-validação do Anima antes de abrir qualquer página. Não é boundary de segurança.',
    advancement:
      'A checagem de DNS tem TOCTOU (rebinding) e o Windows não isola a rede do processo. A defesa real é o egress controlado do runtime isolado, que ainda não existe.',
    proofRefs: [
      { kind: 'commit', ref: '515ba65', note: 'evaluateWebTarget, isPublicIpAddress, --allowed-domains' },
      { kind: 'test', ref: 'apps/web/lib/research-web/research-web.test.ts' },
    ],
    history: [
      {
        at: '2026-09-27',
        change: 'introduced',
        to: 'implemented',
        note: 'Executada ao vivo no caminho permitido; a propriedade de segurança não está provada.',
        refs: [{ kind: 'commit', ref: '515ba65' }],
      },
    ],
  },
  {
    id: 'research.web.isolated-runtime',
    name: 'Runtime web isolado',
    description: 'Rodar o metabuscador e o browser em contêiner Linux com egress controlado (sem daemon TCP sem auth, sem rede privada).',
    domain: 'research',
    maturity: 'projected',
    dependsOn: ['research.web.network-boundary'],
    meaning: 'O ambiente Windows atual é de desenvolvimento, não boundary: o daemon do agent-browser escuta TCP sem autenticação.',
    advancement: 'Só existe a abstração `browserRuntime` (valor `local`); o modo contêiner não foi implementado.',
    history: [
      {
        at: '2026-09-27',
        change: 'introduced',
        to: 'projected',
        note: 'Gap declarado do Research Web V1.',
        refs: [{ kind: 'doc', ref: 'docs/arquitetura/research-web-v1.md' }],
      },
    ],
  },
  {
    id: 'research.web.open',
    name: 'Abrir página web',
    description: 'Abrir uma URL validada numa sessão de browser efêmera, com policy default-deny de ações reais, close garantido e limpeza.',
    domain: 'research',
    maturity: 'proven',
    dependsOn: ['research.web.network-boundary', 'governance.external-tool-boundary'],
    reuse: {
      strategy: 'wrap',
      tool: 'agent-browser',
      status: 'integrated',
      externalEvidence: 'POC agent-browser (G:\\anima-labs): allow vazio não restringe; `evaluate` (não `eval`); `close` precisa estar na allowlist.',
    },
    meaning: 'O Anima não automatiza browser: governa sessão, allowlist, limites e encerramento.',
    advancement: 'Sem consumidor no Anima e sem runtime isolado; comprovada só em Windows local.',
    proofRefs: [
      { kind: 'commit', ref: '515ba65', note: 'openAndExtractWebPage (sessão efêmera, kill por PID, rm com retentativa)' },
      { kind: 'record', ref: 'docs/registros/2026-09-27b-research-web-v1.md', note: 'docs.searxng.org aberto; 0 processos e 0 diretórios residuais' },
    ],
    history: [
      {
        at: '2026-09-27',
        change: 'introduced',
        to: 'proven',
        note: 'Research Web V1 com prova viva controlada.',
        refs: [
          { kind: 'commit', ref: '515ba65' },
          { kind: 'commit', ref: '5260316' },
        ],
      },
    ],
  },
  {
    id: 'research.web.extract',
    name: 'Extrair conteúdo web',
    description: 'Extrair texto legível da página aberta como `untrusted_external_content`, com contentHash para proveniência.',
    domain: 'research',
    maturity: 'proven',
    dependsOn: ['research.web.open'],
    reuse: { strategy: 'wrap', tool: 'agent-browser', status: 'integrated' },
    meaning: 'Conteúdo externo é dado, nunca instrução; a proveniência aponta para a página aberta, não para o snippet da busca.',
    advancement: 'Não há findings persistidos nem citados: o conteúdo extraído ainda não alimenta nada.',
    proofRefs: [
      { kind: 'commit', ref: '515ba65' },
      {
        kind: 'record',
        ref: 'docs/registros/2026-09-27b-research-web-v1.md',
        note: 'sha256:4a88cfe9… idêntico nas 2 execuções e ao do POC; 5614 caracteres',
      },
    ],
    history: [
      {
        at: '2026-09-27',
        change: 'introduced',
        to: 'proven',
        note: 'Research Web V1 com prova viva controlada.',
        refs: [
          { kind: 'commit', ref: '515ba65' },
          { kind: 'commit', ref: '5260316' },
        ],
      },
    ],
  },
  {
    id: 'research.web.navigate',
    name: 'Navegar na web (mínimo)',
    description: 'Seguir para outra URL validada — na V1, numa NOVA sessão efêmera; sem clique nem sessão contínua.',
    domain: 'research',
    maturity: 'implemented',
    dependsOn: ['research.web.open'],
    reuse: { strategy: 'wrap', tool: 'agent-browser', status: 'integrated' },
    meaning: 'Navegação mínima por reabertura validada: cada salto passa de novo por política e allowlist.',
    advancement: 'Não foi exercida separadamente na prova viva (uma abertura só). Clique/seguimento na mesma sessão estão fora da V1.',
    proofRefs: [{ kind: 'commit', ref: '515ba65' }],
    history: [
      {
        at: '2026-09-27',
        change: 'introduced',
        to: 'implemented',
        note: 'Mesmo primitivo de open; sem prova própria.',
        refs: [{ kind: 'commit', ref: '515ba65' }],
      },
    ],
  },
  {
    id: 'research.web.cite',
    name: 'Citar evidência web',
    description: 'Citar um finding pela página aberta (URL final + contentHash + observedAt), nunca pelo resultado de busca.',
    domain: 'research',
    maturity: 'specified',
    dependsOn: ['research.web.extract'],
    meaning:
      'O contrato existe em código (`WebExtractedFindingV1`, `webFindingCitation`), mas nada no Anima produz findings: a capacidade não se realiza.',
    advancement: 'Falta o produtor de findings, que extrai claims de uma página aberta, e o uso da citação numa saída real.',
    proofRefs: [{ kind: 'doc', ref: 'packages/core/src/research-web/web-page.ts', note: 'contrato futuro' }],
    history: [
      {
        at: '2026-09-27',
        change: 'introduced',
        to: 'specified',
        note: 'Contrato nasceu com o Research Web V1.',
        refs: [{ kind: 'commit', ref: '515ba65' }],
      },
    ],
  },
  {
    id: 'research.web.compare',
    name: 'Comparar fontes web',
    description: 'Confrontar findings de fontes diferentes e registrar concordância/divergência.',
    domain: 'research',
    maturity: 'projected',
    dependsOn: ['research.web.cite'],
    meaning: 'Composição própria do Anima (modelo sobre evidência); nenhuma ferramenta a fornece.',
    advancement: 'Depende de findings citáveis existirem.',
    history: [
      {
        at: '2026-09-27',
        change: 'introduced',
        to: 'projected',
        note: 'Não implementado no Research Web V1.',
        refs: [{ kind: 'doc', ref: 'docs/arquitetura/research-web-v1.md' }],
      },
    ],
  },
  {
    id: 'research.web.persist-findings',
    name: 'Persistir findings web',
    description: 'Guardar findings citados como evidência do work item, com proveniência.',
    domain: 'research',
    maturity: 'projected',
    dependsOn: ['research.web.cite', 'memory.event-history'],
    meaning: 'O que o Anima aprendeu na web vira evidência auditável da unidade de trabalho, não texto solto.',
    advancement: 'Depende de cite e de um contrato de evidência no work item.',
    history: [
      {
        at: '2026-09-27',
        change: 'introduced',
        to: 'projected',
        note: 'Não implementado no Research Web V1.',
        refs: [{ kind: 'doc', ref: 'docs/arquitetura/research-web-v1.md' }],
      },
    ],
  },
];

/** Constrói o grafo de capacidades do Anima a partir do registro V0. */
export function getAnimaCapabilityGraph(): CapabilityGraph {
  return buildCapabilityGraph(ANIMA_CAPABILITY_REGISTRY_V0);
}

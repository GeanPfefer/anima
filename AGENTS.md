# Anima — roteador operacional

O Anima é um sistema de evolução pessoal baseado em memória narrativa, organização implícita e uma única experiência conversacional. Sua arquitetura deve permitir que, no futuro, ele orquestre capacidades em qualquer domínio sem deixar de ser a interface principal do usuário.

## Ordem obrigatória de leitura

Antes de qualquer tarefa, leia nesta ordem:

1. este `AGENTS.md`;
2. `anima-manifesto.md`;
3. `anima-prd.md`;
4. `docs/marcos/README.md` e os marcos aplicáveis;
5. a documentação aplicável em `docs/arquitetura/`;
6. o plano específico da tarefa, quando existir em `docs/planos/` ou tiver sido fornecido pelo usuário.

Leia também outros `AGENTS.md` mais próximos dos arquivos envolvidos, caso sejam criados no futuro.

## Convergência de agentes

Todo agente que trabalha no Anima começa por este `AGENTS.md` e segue a mesma ordem de leitura acima — é assim que qualquer um deles retoma o trabalho sem perder o que já foi feito:

- **Claude** chega aqui por `CLAUDE.md`, que aponta para este arquivo.
- **Codex** lê este `AGENTS.md` nativamente.
- **Braços locais com Ollama** (`tools/local-agent`) devem ler este roteador antes de qualquer tarefa no repositório; o `README.md` e o `HANDOFF.md` do runner cobrem apenas o próprio runner.

A divisão de fontes é fixa: a **visão de longo prazo** vive em `anima-manifesto.md`; o **estado tático vivo** (o que existe hoje e o que está em andamento) vive em `anima-prd.md`; o **histórico append-only** vive em `docs/planos/` e `docs/marcos/`. Ao encerrar uma sessão relevante, **atualize o estado vivo** — o PRD e o plano da tarefa — para que o próximo agente, humano ou modelo, continue exatamente de onde você parou.

## Estrutura principal

| Caminho | Responsabilidade |
|---|---|
| `apps/web` | Next.js 15: aplicação web e API Routes |
| `apps/mobile` | React Native + Expo Router: iOS e Android |
| `packages/core` | Regras de negócio compartilhadas e puras |
| `packages/types` | Tipos TypeScript e tipos gerados do Supabase |
| `supabase/migrations` | Schema versionado, RLS, funções, triggers e views |
| `tools/local-agent` | Runner agêntico local (Python): execução isolada em contêiner, ambiente e contratos de segurança separados da aplicação |
| `docs/arquitetura` | Decisões e contratos arquiteturais |
| `docs/planos` | Planos incrementais de implementação |
| `docs/marcos` | Mudanças de visão e identidade, append-only |

## Comandos existentes

Na raiz:

```bash
npm run dev:web
npm run dev:mobile
npm run typecheck
npm run test
npm run build
```

- `typecheck` executa os quatro workspaces.
- `test` executa somente workspaces que possuem script; atualmente apenas `packages/core` declara o script Jest.
- `build` executa somente workspaces que possuem script; atualmente apenas `apps/web` declara build.
- Não existe script de lint na raiz.
- No Windows com PowerShell bloqueando `npm.ps1`, use `npm.cmd run <script>`.

## Princípios permanentes

- O Anima é a interface principal e única do usuário.
- O chat é a entrada unificada; telas auxiliares servem para visualizar, explorar e confirmar.
- Prisma é a capacidade interna de Reflexão Crítica, não uma persona ou chat paralelo.
- Claude, Codex, modelos e ferramentas são executores substituíveis de capacidades, nunca personagens do produto.
- Ações estruturais, estratégicas, financeiras, irreversíveis ou de impacto significativo exigem aprovação humana prévia.
- Observações reversíveis de baixo risco podem ocorrer silenciosamente.
- Capacidades futuras devem servir projetos e jornadas de qualquer domínio.
- Lógica de negócio compartilhada pertence a `packages/core`; tipos compartilhados pertencem a `packages/types`.
- TypeScript é strict; não introduza `any`.
- Não duplique grandes trechos do manifesto, PRD ou arquitetura em arquivos de ferramenta.

## Execução e verificação

- Preserve trabalho local existente; inspecione `git status` e o diff antes de editar.
- Não altere banco sem migration e regeneração dos tipos quando a tarefa autorizar schema.
- Aplique migrations pendentes com `supabase migration up`. `supabase db reset` apaga os dados locais: é ação destrutiva e exige checkpoint humano explícito, mesmo em banco local.
- Não introduza integração externa sem autorização explícita.
- Faça a menor mudança coerente com o plano aprovado.
- Execute typecheck, testes e build proporcionais ao escopo; registre scripts ausentes e falhas de infraestrutura/dependência separadamente de falhas de código.
- Não declare uma fase concluída sem cumprir seus critérios de aceite.
- Commits devem estar em português, no modo imperativo, salvo instrução específica da tarefa.

## Documentos detalhados

- Identidade e princípios: `anima-manifesto.md`
- Produto e estado técnico: `anima-prd.md`
- Orquestração de trabalho: `docs/arquitetura/orquestracao-de-trabalho.md`
- Plano do Modo Construção: `docs/planos/001-modo-construcao-mvp.md`
- Plano do Modo Autônomo V0: `docs/planos/002-modo-autonomo-v0.md` (backlog em `docs/planos/002-modo-autonomo-v0-backlog.md`)
- Histórico de visão: `docs/marcos/README.md`

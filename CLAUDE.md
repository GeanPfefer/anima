# Anima

Leia `anima-prd.md` antes de qualquer tarefa.

## Stack

| Camada | Tecnologia | Localização |
|--------|-----------|-------------|
| Mobile (iOS + Android) | React Native + Expo | `apps/mobile` |
| Web + Desktop | Next.js 15 | `apps/web` |
| Backend API | Next.js API Routes | `apps/web/app/api` |
| Banco de dados | Supabase (PostgreSQL) | variáveis de ambiente |
| Auth | Supabase Auth | variáveis de ambiente |
| Realtime | Supabase Realtime | variáveis de ambiente |
| Linguagem | TypeScript strict | todo o projeto |

## Estrutura

```
anima/
├── apps/
│   ├── mobile/          # React Native + Expo Router
│   └── web/             # Next.js (web + API Routes)
├── packages/
│   ├── core/            # lógica de XP, níveis, quests
│   └── types/           # TypeScript types compartilhados
├── anima-prd.md         # PRD com todas as decisões
└── CLAUDE.md            # este arquivo
```

## Comandos

```bash
npm run dev:web        # Next.js dev server (porta 3000)
npm run dev:mobile     # Expo dev server
npm run build          # build de produção (todos os workspaces)
npm run test           # Jest (todos os workspaces)
npm run typecheck      # tsc --noEmit (todos os workspaces)
```

## Supabase

```bash
npx supabase start                  # sobe Postgres + Auth + Studio locais
npx supabase db reset               # aplica todas as migrations do zero
npx supabase db push                # aplica migrations pendentes
npx supabase gen types typescript --local > packages/types/src/database.ts
                                    # regenera os tipos após mudar o schema
npx supabase stop                   # para os containers locais
```

Studio local: http://localhost:54323

## Variáveis de ambiente

Copie `.env.example` → `.env.local` em cada app e preencha:

- `apps/web/.env.local` — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `apps/mobile/.env.local` — mesmas chaves

## Convenções

- TypeScript strict em tudo — proibido `any`
- Lógica de negócio **somente** em `packages/core` — nunca nos apps
- Types compartilhados **somente** em `packages/types`
- Commits em português, modo imperativo (ex: "Adiciona sistema de XP")
- Nomes de arquivos: `kebab-case.ts`, componentes React: `PascalCase.tsx`
- Sem comentários óbvios — só comenta o "porquê", nunca o "o quê"

## Regras do sistema (resumo do PRD)

- XP = tempo (min) × taxa do pilar × multiplicador de bônus (teto ×2,5)
- 50 níveis por pilar, 5 eras, nível do personagem = média dos pilares raiz ativos
- Pilares são **emergentes** — inferidos pela IA, não configurados pelo usuário
- Onboarding = primeira conversa natural (sem wizard de steps)
- Lógica de XP e níveis já implementada em `packages/core`

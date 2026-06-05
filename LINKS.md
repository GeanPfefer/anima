# Links e atalhos do Anima

> Todos os serviços são **locais** — precisam estar rodando via `npx supabase start` e `npm run dev:web`.

## Serviços locais

| Serviço | URL | Para que serve |
|---------|-----|----------------|
| App web | http://localhost:3000 | A aplicação Next.js |
| Supabase Studio | http://localhost:54323 | Painel do banco de dados (tabelas, auth, SQL) |
| Supabase API | http://localhost:54321 | Endpoint da API (usado internamente pelo app) |
| Inbucket (e-mails) | http://localhost:54324 | Caixa de e-mails de teste (confirmações, reset de senha) |

## Como apagar um usuário e criar outro

### Opção 1 — pelo Studio (mais fácil)
1. Rode `npx supabase start` na pasta `anima/`
2. Abra http://localhost:54323
3. Vá em **Authentication → Users**
4. Clique no usuário → **Delete user**

> Isso apaga apenas o registro em `auth.users`. O perfil em `public.profiles` e os dados relacionados são removidos automaticamente pelo cascade definido nas migrations.

### Opção 2 — pelo SQL Editor
1. Abra http://localhost:54323 → **SQL Editor**
2. Rode a query abaixo trocando pelo e-mail do usuário:

```sql
DELETE FROM auth.users WHERE email = 'seu@email.com';
```

### Criar novo usuário
- Basta acessar http://localhost:3000 e passar pelo onboarding novamente.
- Ou crie diretamente pelo Studio: **Authentication → Users → Add user**.

## Reset completo do banco (apaga tudo e reaplicar migrations)

```bash
npx supabase db reset
```

Isso recria todas as tabelas do zero a partir das migrations em `supabase/migrations/`.

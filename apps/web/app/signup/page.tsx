import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import styles from './signup.module.css';

async function signUp(formData: FormData) {
  'use server';
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  });
  if (error) redirect('/signup?error=' + encodeURIComponent(error.message));
  redirect('/welcome');
}

type Props = { searchParams: Promise<{ error?: string }> };

export default async function SignupPage({ searchParams }: Props) {
  const { error } = await searchParams;

  return (
    <main className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Anima</h1>
        <p className={styles.subtitle}>Crie sua conta para começar</p>

        <form action={signUp} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">E-mail</label>
            <input
              id="email"
              name="email"
              type="email"
              className={styles.input}
              placeholder="seu@email.com"
              required
              autoComplete="email"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="password">Senha</label>
            <input
              id="password"
              name="password"
              type="password"
              className={styles.input}
              placeholder="Mínimo 6 caracteres"
              minLength={6}
              required
              autoComplete="new-password"
            />
          </div>

          {error && <p className={styles.error}>{decodeURIComponent(error)}</p>}

          <button type="submit" className={styles.button}>
            Criar conta
          </button>
        </form>

        <p className={styles.footer}>
          Já tem uma conta?{' '}
          <a href="/login" className={styles.link}>Entrar</a>
        </p>
      </div>
    </main>
  );
}

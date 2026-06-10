import { redirect } from 'next/navigation';

// Onboarding agora acontece diretamente no /chat (Fase 3).
export default function WelcomePage() {
  redirect('/chat');
}

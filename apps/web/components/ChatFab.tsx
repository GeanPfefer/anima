'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

export default function ChatFab() {
  const pathname = usePathname();
  if (pathname === '/chat') return null;

  return (
    <Link
      href="/chat"
      style={{
        position:        'fixed',
        bottom:          'calc(76px + env(safe-area-inset-bottom))',
        right:           16,
        zIndex:          50,
        width:           52,
        height:          52,
        borderRadius:    '50%',
        background:      'var(--accent)',
        color:           '#000',
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        fontSize:        22,
        boxShadow:       '0 4px 20px rgba(0,0,0,0.4)',
        textDecoration:  'none',
        transition:      'opacity 0.15s, transform 0.15s',
      }}
      title="Abrir Chat"
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.85'; (e.currentTarget as HTMLElement).style.transform = 'scale(1.08)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1';    (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
    >
      💬
    </Link>
  );
}

'use client';

import { usePathname } from 'next/navigation';
import styles from './AppNav.module.css';

const NAV_ITEMS = [
  { href: '/home',     label: 'Home' },
  { href: '/chat',     label: 'Chat' },
  { href: '/trabalhos', label: 'Trabalhos' },
  { href: '/quests',   label: 'Quests' },
  { href: '/history',  label: 'Histórico' },
  { href: '/notes',    label: 'Notas' },
  { href: '/entities', label: 'Entidades' },
  { href: '/identity', label: 'Identidade' },
  { href: '/reports',  label: 'Relatórios' },
  { href: '/graph',    label: 'Graph' },
  { href: '/evolution', label: 'Evolução' },
  { href: '/settings', label: 'Config' },
];

export default function AppNav() {
  const pathname = usePathname();

  return (
    <nav className={styles.nav}>
      <a href="/home" className={styles.logo}>Anima</a>
      <div className={styles.links}>
        {NAV_ITEMS.map(item => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <a
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`${styles.link} ${active ? styles.active : ''}`}
            >
              {item.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}

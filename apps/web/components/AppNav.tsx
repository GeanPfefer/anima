'use client';

import { usePathname } from 'next/navigation';
import styles from './AppNav.module.css';

const NAV_ITEMS = [
  { href: '/home',     label: 'Home' },
  { href: '/quests',   label: 'Quests' },
  { href: '/history',  label: 'Histórico' },
  { href: '/notes',    label: 'Notas' },
  { href: '/entities', label: 'Entidades' },
  { href: '/chat',     label: 'Chat' },
  { href: '/reports',  label: 'Relatórios' },
  { href: '/graph',    label: 'Graph' },
  { href: '/settings', label: 'Config' },
];

export default function AppNav() {
  const pathname = usePathname();

  return (
    <nav className={styles.nav}>
      <a href="/home" className={styles.logo}>Anima</a>
      <div className={styles.links}>
        {NAV_ITEMS.map(item => (
          <a
            key={item.href}
            href={item.href}
            className={`${styles.link} ${pathname === item.href ? styles.active : ''}`}
          >
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

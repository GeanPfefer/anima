import { render, screen } from '@testing-library/react';
import AppNav from './AppNav';

const pathname = jest.fn();
jest.mock('next/navigation', () => ({ usePathname: () => pathname() }));

test('o menu leva a Trabalhos, logo após o Chat', () => {
  pathname.mockReturnValue('/chat');
  render(<AppNav />);
  const labels = screen.getAllByRole('link').map(link => link.textContent);
  expect(labels.indexOf('Trabalhos')).toBe(labels.indexOf('Chat') + 1);
  expect(screen.getByRole('link', { name: 'Trabalhos' })).toHaveAttribute('href', '/trabalhos');
});

test.each(['/trabalhos', '/trabalhos/PROOF-01'])('Trabalhos fica ativo em %s e os demais não', current => {
  pathname.mockReturnValue(current);
  render(<AppNav />);
  expect(screen.getByRole('link', { name: 'Trabalhos' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Chat' })).not.toHaveAttribute('aria-current');
});

test('/chat continua ativo no Chat e não em Trabalhos', () => {
  pathname.mockReturnValue('/chat');
  render(<AppNav />);
  expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Trabalhos' })).not.toHaveAttribute('aria-current');
});

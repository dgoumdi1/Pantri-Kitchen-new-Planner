import { Link, useLocation } from 'wouter';
import { House, CookingPot, ShoppingBasket, Settings, Leaf, Sparkles, LogOut } from 'lucide-react';
import { useClerk, useUser } from '@clerk/react';

const links = [
  { href: '/', label: 'Dashboard', icon: House },
  { href: '/recipes', label: 'Recipes', icon: CookingPot },
  { href: '/assistant', label: 'Assistant', icon: Sparkles },
  { href: '/shopping', label: 'Shopping List', icon: ShoppingBasket },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Navigation() {
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand" data-testid="link-pantri-home">
          <span className="brand-mark"><Leaf size={19} /></span>
          <span>Pantri</span>
        </Link>
        <nav className="nav-links" aria-label="Main navigation">
          {links.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={`nav-link ${location === href ? 'active' : ''}`} data-testid={`nav-${label.toLowerCase().replaceAll(' ', '-')}`}>
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="nav-account">
          <span className="eyebrow" style={{ letterSpacing: '.4px', textTransform: 'none' }}>{user?.firstName || 'Your kitchen'}</span>
          <button className="icon-button" onClick={() => void signOut({ redirectUrl: import.meta.env.BASE_URL })} aria-label="Sign out" data-testid="button-nav-sign-out"><LogOut size={16} /></button>
        </div>
      </header>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {links.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} aria-label={label} className={location === href ? 'active' : ''} data-testid={`mobile-nav-${label.toLowerCase().replaceAll(' ', '-')}`}>
            <Icon size={19} />
            <span>{label === 'Shopping List' ? 'Shopping' : label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}

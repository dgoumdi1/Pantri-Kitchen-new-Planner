import { Link, useLocation } from 'wouter';
import { House, CookingPot, ShoppingBasket, Settings, Leaf } from 'lucide-react';

const links = [
  { href: '/', label: 'Dashboard', icon: House },
  { href: '/recipes', label: 'Recipes', icon: CookingPot },
  { href: '/shopping', label: 'Shopping List', icon: ShoppingBasket },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Navigation() {
  const [location] = useLocation();
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
        <div className="eyebrow" style={{ letterSpacing: '.4px', textTransform: 'none' }}>A little more joy, less waste</div>
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

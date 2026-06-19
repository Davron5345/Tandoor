export { IconTelegram as IconNavTelegram } from './ActionIcons';
export { IconWallet as IconNavPayments } from './ActionIcons';

function NavSvg({ children }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

export function IconNavHome() {
  return (
    <NavSvg>
      <path d="M4 10.5 12 4l8 6.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 9.5V19a1 1 0 0 0 1 1h4v-5h2v5h4a1 1 0 0 0 1-1V9.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </NavSvg>
  );
}

export function IconNavDocuments() {
  return (
    <NavSvg>
      <path d="M8 4h8l4 4v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      <path d="M16 4v4h4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      <path d="M8 13h8M8 17h5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </NavSvg>
  );
}

export function IconNavCatalog() {
  return (
    <NavSvg>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H10v5H4V6.5zM14 4h3.5A2.5 2.5 0 0 1 20 6.5V9H14V4zM4 13.5A2.5 2.5 0 0 1 6.5 11H10v9H4v-6.5zM14 11h6v9h-3.5A2.5 2.5 0 0 1 14 17.5V11z" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    </NavSvg>
  );
}

export function IconNavReports() {
  return (
    <NavSvg>
      <path d="M5 19V9" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M12 19V5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M19 19v-7" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </NavSvg>
  );
}

export function IconNavCashier() {
  return (
    <NavSvg>
      <rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path d="M7 10h.01M7 14h.01" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M12 10h5M12 14h3" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </NavSvg>
  );
}

export function IconNavArticles() {
  return (
    <NavSvg>
      <path d="M8 6h13" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M8 12h13" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M8 18h13" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="4.5" cy="6" r="1.25" fill="currentColor" />
      <circle cx="4.5" cy="12" r="1.25" fill="currentColor" />
      <circle cx="4.5" cy="18" r="1.25" fill="currentColor" />
    </NavSvg>
  );
}

export function IconNavAdmin() {
  return (
    <NavSvg>
      <circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path d="M3 19c0-3.3 2.7-5 6-5s6 1.7 6 5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M17 8.5a2.5 2.5 0 0 1 0 5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M21 19c0-2.2-1.4-3.6-3.5-4.2" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </NavSvg>
  );
}

export function IconNavWarehouse() {
  return (
    <NavSvg>
      <path d="M12 3 3 8.5 12 14l9-5.5L12 3z" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      <path d="M6 10.5V16l6 3.5 6-3.5v-5.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      <path d="M12 14V21" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </NavSvg>
  );
}

export function IconNavSun() {
  return (
    <NavSvg>
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </NavSvg>
  );
}

export function IconNavMoon() {
  return (
    <NavSvg>
      <path d="M20 14.5A7.5 7.5 0 0 1 9.5 4 6.5 6.5 0 1 0 20 14.5z" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    </NavSvg>
  );
}

export function IconNavChevronLeft() {
  return (
    <NavSvg>
      <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </NavSvg>
  );
}

export function IconNavChevronRight() {
  return (
    <NavSvg>
      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </NavSvg>
  );
}

export function IconNavChevronDown() {
  return (
    <NavSvg>
      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </NavSvg>
  );
}

export function IconNavMenu() {
  return (
    <NavSvg>
      <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </NavSvg>
  );
}

export function IconNavLogout() {
  return (
    <NavSvg>
      <path d="M10 7V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-2" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      <path d="M13 12H3m0 0 3-3M3 12l3 3" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </NavSvg>
  );
}

export function IconNavBranch() {
  return (
    <NavSvg>
      <path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10z" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      <circle cx="12" cy="11" r="2" fill="none" stroke="currentColor" strokeWidth="1.75" />
    </NavSvg>
  );
}

interface Props {
  userName: string | null;
  view: 'companies' | 'security';
  /** Shown next to the security entry when the account has no second factor. */
  mfaMissing: boolean;
  onNavigate: (view: 'companies' | 'security') => void;
  onLogout: () => void;
}

export function Sidebar({ userName, view, mfaMissing, onNavigate, onLogout }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">A</span>
        <span className="brand-name">ANYQ</span>
      </div>
      <nav className="nav">
        <button
          className={view === 'companies' ? 'nav-item active' : 'nav-item'}
          onClick={() => onNavigate('companies')}
        >
          Компании
        </button>
        <button
          className={view === 'security' ? 'nav-item active' : 'nav-item'}
          onClick={() => onNavigate('security')}
        >
          {/* Marked rather than merely available. This account can change every
              price in every company, and an owner who has never thought about
              the second factor will not go looking for the setting. */}
          Безопасность{mfaMissing ? ' •' : ''}
        </button>
      </nav>
      <div className="sidebar-footer">
        {userName && <span className="sidebar-user">{userName}</span>}
        <button className="sidebar-logout" onClick={onLogout}>Выйти</button>
      </div>
    </aside>
  );
}

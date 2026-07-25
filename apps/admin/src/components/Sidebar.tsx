interface Props {
  userName: string | null;
  onLogout: () => void;
}

export function Sidebar({ userName, onLogout }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">A</span>
        <span className="brand-name">ANYQ</span>
      </div>
      <nav className="nav">
        <span className="nav-item active">Компании</span>
      </nav>
      <div className="sidebar-footer">
        {userName && <span className="sidebar-user">{userName}</span>}
        <button className="sidebar-logout" onClick={onLogout}>Выйти</button>
      </div>
    </aside>
  );
}

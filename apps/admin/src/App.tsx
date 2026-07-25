import { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { CompaniesTable } from './components/CompaniesTable';
import { CreateCompanyDrawer } from './components/CreateCompanyDrawer';
import { CompanyDetailDrawer } from './components/CompanyDetailDrawer';
import { LoginScreen } from './components/LoginScreen';
import { pluralizeRu } from './utils';
import { getCompanies, createCompany, updateTariff, getShifts } from './api';
import type { CreateCompanyPayload, TariffPayload } from './api';
import type { Company } from './types';

const TOKEN_KEY = 'anyq_admin_token';
const USER_KEY = 'anyq_admin_user';

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [userName, setUserName] = useState<string | null>(() => localStorage.getItem(USER_KEY));
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    getCompanies(token)
      .then(setCompanies)
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Не удалось загрузить компании');
        if (err instanceof Error && err.message.toLowerCase().includes('автор')) {
          handleLogout();
        }
      })
      .finally(() => setLoading(false));
  }, [token]);

  function handleLogin(newToken: string, user: { name: string }) {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, user.name);
    setToken(newToken);
    setUserName(user.name);
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUserName(null);
    setCompanies([]);
  }

  async function handleCreate(payload: CreateCompanyPayload) {
    if (!token) return;
    const company = await createCompany(token, payload);
    setCompanies((prev) => [company, ...prev]);
    setCreateOpen(false);
    setSelectedId(company.id);
  }

  async function handleUpdateTariff(companyId: string, payload: TariffPayload) {
    if (!token) return;
    const company = await updateTariff(token, companyId, payload);
    setCompanies((prev) => prev.map((c) => (c.id === companyId ? company : c)));
  }

  function handleLoadShifts(companyId: string) {
    if (!token) return Promise.resolve([]);
    return getShifts(token, companyId);
  }

  const selected = companies.find((c) => c.id === selectedId) ?? null;

  if (!token) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="app-shell">
      <Sidebar userName={userName} onLogout={handleLogout} />
      <main className="content">
        <div className="content-header">
          <div>
            <div className="content-title">Компании</div>
            <div className="content-sub">
              {companies.length} {pluralizeRu(companies.length, 'компания', 'компании', 'компаний')} · аккаунты создаются и настраиваются вручную
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>+ Новая компания</button>
        </div>

        {loading && <div className="loading-note">Загрузка…</div>}
        {error && !loading && <div className="error-note">{error}</div>}
        {!loading && !error && <CompaniesTable companies={companies} onSelect={setSelectedId} />}
      </main>
      {createOpen && <CreateCompanyDrawer onClose={() => setCreateOpen(false)} onCreate={handleCreate} />}
      {selected && (
        <CompanyDetailDrawer
          key={selected.id}
          company={selected}
          onClose={() => setSelectedId(null)}
          onUpdateTariff={handleUpdateTariff}
          onLoadShifts={handleLoadShifts}
        />
      )}
    </div>
  );
}

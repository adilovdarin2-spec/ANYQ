import { useMemo, useCallback, useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { CompaniesTable } from './components/CompaniesTable';
import { CreateCompanyDrawer } from './components/CreateCompanyDrawer';
import { CompanyDetailDrawer } from './components/CompanyDetailDrawer';
import { UsersDrawer } from './components/UsersDrawer';
import { LoginScreen } from './components/LoginScreen';
import { MfaSettings } from './components/MfaSettings';
import { pluralizeRu, sortForRenewal, countForRenewal } from './utils';
import {
  ApiError,
  createCompany,
  createLocation,
  createUser,
  fetchMe,
  getCompanies,
  getShifts,
  updateLocation,
  updateTariff,
  updateUser,
  fetchSupportAccess,
  requestSupportAccess,
} from './api';
import type { CreateCompanyPayload, TariffPayload, UserPayload, LocationPayload } from './api';
import type { Company } from './types';

const TOKEN_KEY = 'anyq_admin_token';
const USER_KEY = 'anyq_admin_user';

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [view, setView] = useState<'companies' | 'security'>('companies');
  const [me, setMe] = useState<{ mfaEnabled: boolean; mfaPending: boolean; recoveryCodesLeft: number } | null>(null);

  const loadMe = useCallback(async () => {
    if (!token) return;
    try {
      const data = await fetchMe(token);
      setMe({ mfaEnabled: data.mfaEnabled, mfaPending: data.mfaPending, recoveryCodesLeft: data.recoveryCodesLeft });
    } catch {
      // A failed check must not lock anybody out of the app; the sidebar
      // simply does not mark the entry.
      setMe(null);
    }
  }, [token]);

  useEffect(() => { void loadMe(); }, [loadMe]);
  const [userName, setUserName] = useState<string | null>(() => localStorage.getItem(USER_KEY));
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [usersCompanyId, setUsersCompanyId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    getCompanies(token)
      .then(setCompanies)
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Не удалось загрузить компании');
        if (err instanceof ApiError && err.status === 401) {
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

  function handleLoadAccess(companyId: string) {
    if (!token) {
      return Promise.resolve({ state: 'none' as const, reason: '', requestedAt: null, expiresAt: null });
    }
    return fetchSupportAccess(token, companyId);
  }

  function handleRequestAccess(companyId: string, reason: string) {
    if (!token) return Promise.resolve({ id: '' });
    return requestSupportAccess(token, companyId, reason);
  }




  async function handleCreateUser(companyId: string, payload: UserPayload) {
    if (!token) throw new Error('Не авторизован');
    const user = await createUser(token, companyId, payload);
    setCompanies((prev) => prev.map((c) => (c.id === companyId ? { ...c, users: [...c.users, user] } : c)));
    return user;
  }

  async function handleUpdateUser(companyId: string, userId: string, payload: UserPayload) {
    if (!token) throw new Error('Не авторизован');
    const user = await updateUser(token, companyId, userId, payload);
    setCompanies((prev) => prev.map((c) => (c.id === companyId ? { ...c, users: c.users.map((u) => (u.id === userId ? user : u)) } : c)));
    return user;
  }

  async function handleCreateLocation(companyId: string, payload: LocationPayload) {
    if (!token) throw new Error('Не авторизован');
    const location = await createLocation(token, companyId, payload);
    setCompanies((prev) => prev.map((c) => (c.id === companyId ? { ...c, locations: [...c.locations, location] } : c)));
    return location;
  }

  async function handleUpdateLocation(companyId: string, locationId: string, payload: LocationPayload) {
    if (!token) throw new Error('Не авторизован');
    const location = await updateLocation(token, companyId, locationId, payload);
    setCompanies((prev) => prev.map((c) => (c.id === companyId ? { ...c, locations: c.locations.map((l) => (l.id === locationId ? location : l)) } : c)));
    return location;
  }

  // Порядок под ту работу, которая делается каждый месяц: сначала то, что
  // уже не работает, потом то, что кончается. Считается на клиенте, потому
  // что это правило про работу человека, а не про данные, и его надо было
  // уметь проверить целиком, не поднимая сервер.
  const forRenewal = useMemo(() => sortForRenewal(companies), [companies]);
  const renewal = useMemo(() => countForRenewal(companies), [companies]);

  const selected = companies.find((c) => c.id === selectedId) ?? null;
  const usersCompany = companies.find((c) => c.id === usersCompanyId) ?? null;

  if (!token) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="app-shell">
      <Sidebar
        userName={userName}
        view={view}
        mfaMissing={me !== null && !me.mfaEnabled}
        onNavigate={setView}
        onLogout={handleLogout}
      />
      <main className="content">
        {view === 'security' && (
          <div className="content-header">
            <MfaSettings
              token={token}
              enabled={me?.mfaEnabled ?? false}
              pending={me?.mfaPending ?? false}
              recoveryCodesLeft={me?.recoveryCodesLeft ?? 0}
              onChanged={loadMe}
            />
          </div>
        )}
        {view === 'companies' && (
        <>
        <div className="content-header">
          <div>
            <div className="content-title">Компании</div>
            <div className="content-sub">
              {companies.length} {pluralizeRu(companies.length, 'компания', 'компании', 'компаний')} · аккаунты создаются и настраиваются вручную
            </div>
            {/*
              Строка, по которой видно, есть ли сегодня работа.
              Магазин о конце тарифа предупреждают за неделю полоской поверх
              кассы; того, кто продлевает, до сих пор не предупреждал никто —
              он искал значки глазами по списку, отсортированному по дате
              создания. Молчит, когда сказать нечего: счётчик, висящий всегда,
              перестаёт быть счётчиком.
            */}
            {!loading && !error && (renewal.expired > 0 || renewal.soon > 0) && (
              <div className="content-sub renewal-line">
                {renewal.expired > 0 && (
                  <span className="renewal-expired">
                    {renewal.expired} {pluralizeRu(renewal.expired, 'не работает', 'не работают', 'не работают')} — срок вышел
                  </span>
                )}
                {renewal.expired > 0 && renewal.soon > 0 && ' · '}
                {renewal.soon > 0 && (
                  <span>
                    {renewal.soon} {pluralizeRu(renewal.soon, 'заканчивается', 'заканчиваются', 'заканчиваются')} на этой неделе
                  </span>
                )}
              </div>
            )}
          </div>
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>+ Новая компания</button>
        </div>

        {loading && <div className="loading-note">Загрузка…</div>}
        {error && !loading && <div className="error-note">{error}</div>}
        {!loading && !error && <CompaniesTable companies={forRenewal} onSelect={setSelectedId} />}
        </>
        )}
      </main>
      {createOpen && <CreateCompanyDrawer onClose={() => setCreateOpen(false)} onCreate={handleCreate} />}
      {selected && (
        <CompanyDetailDrawer
          key={selected.id}
          company={selected}
          onClose={() => setSelectedId(null)}
          onUpdateTariff={handleUpdateTariff}
          onLoadShifts={handleLoadShifts}
          onLoadAccess={handleLoadAccess}
          onRequestAccess={handleRequestAccess}
          onManageUsers={() => setUsersCompanyId(selected.id)}
          onCreateLocation={handleCreateLocation}
          onUpdateLocation={handleUpdateLocation}
        />
      )}
            {usersCompany && (
        <UsersDrawer
          key={usersCompany.id}
          companyId={usersCompany.id}
          companyName={usersCompany.name}
          users={usersCompany.users}
          onClose={() => setUsersCompanyId(null)}
          onCreate={handleCreateUser}
          onUpdate={handleUpdateUser}
        />
      )}
    </div>
  );
}

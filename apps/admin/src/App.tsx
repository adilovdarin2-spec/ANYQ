import { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { CompaniesTable } from './components/CompaniesTable';
import { CreateCompanyDrawer } from './components/CreateCompanyDrawer';
import { CompanyDetailDrawer } from './components/CompanyDetailDrawer';
import { ProductsDrawer } from './components/ProductsDrawer';
import { UsersDrawer } from './components/UsersDrawer';
import { LoginScreen } from './components/LoginScreen';
import { pluralizeRu } from './utils';
import { getCompanies, createCompany, updateTariff, getShifts, getProducts, createProduct, updateProduct, createUser, updateUser, createLocation, updateLocation, ApiError } from './api';
import type { CreateCompanyPayload, TariffPayload, UserPayload, LocationPayload } from './api';
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
  const [productsCompanyId, setProductsCompanyId] = useState<string | null>(null);
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

  function handleLoadProducts(companyId: string) {
    if (!token) return Promise.resolve([]);
    return getProducts(token, companyId);
  }

  function handleCreateProduct(companyId: string, payload: Parameters<typeof createProduct>[2]) {
    if (!token) throw new Error('Не авторизован');
    return createProduct(token, companyId, payload);
  }

  function handleUpdateProduct(companyId: string, productId: string, payload: Parameters<typeof updateProduct>[3]) {
    if (!token) throw new Error('Не авторизован');
    return updateProduct(token, companyId, productId, payload);
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

  const selected = companies.find((c) => c.id === selectedId) ?? null;
  const productsCompany = companies.find((c) => c.id === productsCompanyId) ?? null;
  const usersCompany = companies.find((c) => c.id === usersCompanyId) ?? null;

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
          onManageProducts={() => setProductsCompanyId(selected.id)}
          onManageUsers={() => setUsersCompanyId(selected.id)}
          onCreateLocation={handleCreateLocation}
          onUpdateLocation={handleUpdateLocation}
        />
      )}
      {productsCompany && (
        <ProductsDrawer
          key={productsCompany.id}
          companyId={productsCompany.id}
          companyName={productsCompany.name}
          onClose={() => setProductsCompanyId(null)}
          onLoad={handleLoadProducts}
          onCreate={handleCreateProduct}
          onUpdate={handleUpdateProduct}
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

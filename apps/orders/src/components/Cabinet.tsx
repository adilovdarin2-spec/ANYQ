import { useCallback, useEffect, useState } from 'react';
import type { CabinetLocation, CabinetSummary } from '../types';
import {
  ApiError,
  cabinetLogin,
  createCabinetPassword,
  fetchCabinetLocations,
  fetchCabinetStatus,
  fetchCabinetSummary,
  forgetCabinetToken,
  readCabinetToken,
  storeCabinetToken,
} from '../api';
import { CabinetGate } from './CabinetGate';
import { CabinetScreen } from './CabinetScreen';
import { StateScreen } from './StateScreen';

/**
 * Кабинет владельца целиком: дверь, сессия и экран.
 *
 * Живёт внутри витрины заказов, а не отдельным приложением. Это решение о
 * стоимости: отдельное приложение — это пятая служба на платформе, пятая
 * сборка, пятый адрес и пятый набор переменных ради одного экрана. Витрина уже
 * смотрит в интернет и уже раздаёт страницы по секретному пути.
 */
export function Cabinet({ secret }: { secret: string }) {
  const [status, setStatus] = useState<{ company: string; needsPassword: boolean } | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(() => readCabinetToken(secret));
  const [gateSubmitting, setGateSubmitting] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  const [company, setCompany] = useState('');
  const [locations, setLocations] = useState<CabinetLocation[]>([]);
  const [locationId, setLocationId] = useState('');
  const [days, setDays] = useState(1);
  const [summary, setSummary] = useState<CabinetSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Кабинет владельца · ANYQ';
  }, []);

  // Состояние ссылки спрашиваем только когда входить ещё нужно. Раньше это
  // делалось на каждой загрузке страницы, и владелец, обновивший кабинет
  // несколько раз подряд, упирался в лимит попыток входа — не введя ничего.
  useEffect(() => {
    if (token) return;
    fetchCabinetStatus(secret)
      .then(setStatus)
      // Запасной текст не повторяет заголовок: «Ссылка не открылась. Ссылка
      // не открылась» — это то, что видел бы владелец при обрыве связи.
      .catch((err) => setStatusError(err instanceof ApiError ? err.message : 'Сервер не ответил'));
  }, [secret, token]);

  const signOut = useCallback(() => {
    forgetCabinetToken(secret);
    setToken(null);
    setSummary(null);
    setLocations([]);
    setLocationId('');
    // Пароль мог быть задан в этой же сессии — статус перечитываем, иначе
    // экран снова предложит его придумать.
    fetchCabinetStatus(secret).then(setStatus).catch(() => undefined);
  }, [secret]);

  // Точки грузятся один раз за сессию: их список меняется куда реже, чем
  // владелец переключает период.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchCabinetLocations(token)
      .then((data) => {
        if (cancelled) return;
        setCompany(data.company);
        setLocations(data.locations);
        setLocationId((current) => current || data.locations[0]?.id || '');
      })
      .catch((err) => {
        if (cancelled) return;
        // Сессия кончилась или пароль сменили из кассы — это не ошибка,
        // а «войдите заново».
        if (err instanceof ApiError) signOut();
      });
    return () => {
      cancelled = true;
    };
  }, [token, signOut]);

  const load = useCallback(() => {
    if (!token || !locationId) return;
    setLoading(true);
    setError(null);
    fetchCabinetSummary(token, locationId, days)
      .then(setSummary)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Не удалось посчитать'))
      .finally(() => setLoading(false));
  }, [token, locationId, days]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleGate(password: string) {
    if (!status) return;
    setGateSubmitting(true);
    setGateError(null);
    try {
      const result = status.needsPassword
        ? await createCabinetPassword(secret, password)
        : await cabinetLogin(secret, password);
      storeCabinetToken(secret, result.token);
      setToken(result.token);
      setStatus({ ...status, needsPassword: false });
    } catch (err) {
      setGateError(err instanceof ApiError ? err.message : 'Не удалось войти');
    } finally {
      setGateSubmitting(false);
    }
  }

  if (statusError) {
    return (
      <StateScreen
        title="Ссылка не открылась"
        message={`${statusError}. Проверьте адрес целиком — его выдаёт касса в разделе «Кабинет владельца».`}
      />
    );
  }

  if (!status && !token) {
    return <StateScreen title="Открываем кабинет…" message="Секунду." />;
  }

  if (!token) {
    return (
      <CabinetGate
        company={status!.company}
        needsPassword={status!.needsPassword}
        submitting={gateSubmitting}
        error={gateError}
        onSubmit={handleGate}
      />
    );
  }

  return (
    <CabinetScreen
      company={company || status?.company || ''}
      locations={locations}
      locationId={locationId}
      days={days}
      summary={summary}
      loading={loading}
      error={error}
      onChangeLocation={setLocationId}
      onChangeDays={setDays}
      onRefresh={load}
      onSignOut={signOut}
    />
  );
}

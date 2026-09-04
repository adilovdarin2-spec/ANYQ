import { describe, it, expect } from 'vitest';
import { resolveLocationId, resolveTransferLocations, locationErrorMessage } from './locations';

const shop = { id: 'loc_shop' };
const warehouse = { id: 'loc_warehouse' };

describe('resolveLocationId', () => {
  it('uses the only location when the company has one and none was named', () => {
    expect(resolveLocationId([shop])).toEqual({ status: 'ok', locationId: 'loc_shop' });
  });

  it('refuses to guess once there is more than one location', () => {
    // This is the whole point: picking the first one silently booked a
    // warehouse receipt into the shop.
    expect(resolveLocationId([shop, warehouse])).toEqual({ status: 'ambiguous' });
  });

  it('uses the named location even when the company has several', () => {
    expect(resolveLocationId([shop, warehouse], 'loc_warehouse')).toEqual({
      status: 'ok',
      locationId: 'loc_warehouse',
    });
  });

  it('rejects a location that belongs to another company', () => {
    expect(resolveLocationId([shop], 'loc_somebody_else')).toEqual({ status: 'unknown' });
  });

  it('rejects a named location the single-location company does not have, rather than falling back to its own', () => {
    // Falling back here would let a stale or tampered request write into a
    // location it did not ask for and would never see in the response.
    expect(resolveLocationId([shop], 'loc_warehouse')).toEqual({ status: 'unknown' });
  });

  it('reports a company with no locations at all', () => {
    expect(resolveLocationId([])).toEqual({ status: 'none' });
    expect(resolveLocationId([], 'loc_shop')).toEqual({ status: 'unknown' });
  });

  it('treats an empty or blank id as "not named"', () => {
    expect(resolveLocationId([shop], '')).toEqual({ status: 'ok', locationId: 'loc_shop' });
    expect(resolveLocationId([shop], '   ')).toEqual({ status: 'ok', locationId: 'loc_shop' });
  });

  it('trims a padded id before matching', () => {
    expect(resolveLocationId([shop], ' loc_shop ')).toEqual({ status: 'ok', locationId: 'loc_shop' });
  });

  it('ignores a non-string id instead of coercing it', () => {
    expect(resolveLocationId([shop, warehouse], { id: 'loc_shop' })).toEqual({ status: 'ambiguous' });
  });
});

describe('resolveTransferLocations', () => {
  it('resolves both ends when each is named', () => {
    expect(resolveTransferLocations([shop, warehouse], 'loc_warehouse', 'loc_shop')).toEqual({
      status: 'ok',
      fromLocationId: 'loc_warehouse',
      toLocationId: 'loc_shop',
    });
  });

  it('refuses a transfer that would land where it started', () => {
    expect(resolveTransferLocations([shop, warehouse], 'loc_shop', 'loc_shop')).toEqual({ status: 'same' });
  });

  it('refuses a destination outside the company — the stock would leave its books', () => {
    expect(resolveTransferLocations([shop, warehouse], 'loc_shop', 'loc_outsider')).toEqual({ status: 'unknown' });
  });

  it('requires a destination even when the source can be inferred', () => {
    // Inferring it for a single-location company would resolve to the source
    // and report "transfer onto itself" for what is really a missing field.
    expect(resolveTransferLocations([shop], 'loc_shop', undefined)).toEqual({ status: 'noDestination' });
    expect(resolveTransferLocations([shop, warehouse], 'loc_shop', '')).toEqual({ status: 'noDestination' });
  });

  it('reports the source problem first when the source itself cannot be resolved', () => {
    expect(resolveTransferLocations([shop, warehouse], undefined, 'loc_shop')).toEqual({ status: 'ambiguous' });
  });
});

describe('locationErrorMessage', () => {
  it('explains each case in words a cashier can act on', () => {
    expect(locationErrorMessage('none')).toBe('У компании не настроена точка');
    expect(locationErrorMessage('unknown')).toBe('Точка не найдена');
    expect(locationErrorMessage('ambiguous')).toBe('Выберите точку — у компании их несколько');
    expect(locationErrorMessage('noDestination')).toBe('Укажите точку назначения');
    expect(locationErrorMessage('same')).toBe('Точка назначения совпадает с точкой отправления');
  });
});

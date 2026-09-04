export interface LocationRef {
  id: string;
}

export type LocationResolution =
  | { status: 'ok'; locationId: string }
  /** The company has no locations configured at all. */
  | { status: 'none' }
  /** A location was named, but not one of this company's — a stale client, or a tampered request. */
  | { status: 'unknown' }
  /** Nothing was named and the company runs more than one location, so there is no safe default. */
  | { status: 'ambiguous' };

// Every warehouse operation happens at one specific location, and the routes
// used to assume it was always `locations[0]` — receiving, transfers, counts
// and production all landed at whichever location happened to be first,
// whatever the user was actually standing in. For a company with a shop and a
// warehouse that silently books the stock in the wrong building.
//
// Naming the location is therefore required as soon as there is a choice to
// make. A single-location company still doesn't have to send one: there is
// exactly one answer, and demanding it would break every register in the
// field for no gain. Two or more, and an unnamed location is refused rather
// than guessed — guessing is what produced the wrong-building bug.
export function resolveLocationId(locations: LocationRef[], requested?: unknown): LocationResolution {
  if (typeof requested === 'string' && requested.trim()) {
    const wanted = requested.trim();
    const match = locations.find((l) => l.id === wanted);
    return match ? { status: 'ok', locationId: match.id } : { status: 'unknown' };
  }
  if (locations.length === 0) return { status: 'none' };
  if (locations.length > 1) return { status: 'ambiguous' };
  return { status: 'ok', locationId: locations[0].id };
}

export function locationErrorMessage(status: 'none' | 'unknown' | 'ambiguous' | 'noDestination' | 'same'): string {
  if (status === 'none') return 'У компании не настроена точка';
  if (status === 'unknown') return 'Точка не найдена';
  if (status === 'noDestination') return 'Укажите точку назначения';
  if (status === 'same') return 'Точка назначения совпадает с точкой отправления';
  return 'Выберите точку — у компании их несколько';
}

// A transfer needs two different locations, both belonging to the caller's
// company. Sending stock to a location that isn't yours would move it out of
// the company's books entirely; sending it to itself would write a movement
// pair that nets to nothing while looking like a real transfer in the ledger.
export type TransferResolution =
  | { status: 'ok'; fromLocationId: string; toLocationId: string }
  | { status: 'none' }
  | { status: 'unknown' }
  | { status: 'ambiguous' }
  | { status: 'noDestination' }
  | { status: 'same' };

export function resolveTransferLocations(
  locations: LocationRef[],
  requestedFrom: unknown,
  requestedTo: unknown,
): TransferResolution {
  const from = resolveLocationId(locations, requestedFrom);
  if (from.status !== 'ok') return from;

  // The destination is never inferred, not even for a single-location
  // company: inferring it there resolves to the source and turns a typo into
  // a transfer onto itself instead of an error the user can see.
  if (typeof requestedTo !== 'string' || !requestedTo.trim()) return { status: 'noDestination' };
  const to = resolveLocationId(locations, requestedTo);
  if (to.status !== 'ok') return { status: 'unknown' };

  if (from.locationId === to.locationId) return { status: 'same' };
  return { status: 'ok', fromLocationId: from.locationId, toLocationId: to.locationId };
}

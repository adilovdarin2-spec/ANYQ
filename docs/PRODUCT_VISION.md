# ANYQ — Product Vision & Engineering Constraints

Distilled from the "Universal Business OS" strategy brief (2026-07-28). This is not a build
spec for right now — it's the north star that future architecture decisions should be checked
against. See [PRICING.md](PRICING.md) for the current tariff grid.

## Positioning

One product, one core domain — presented differently per audience. A pharmacy owner should
never see restaurant modifiers; a HoReCa distributor should never see prescription fields. The
difference is feature flags and role-scoped screens, never a separate codebase or a separate
database per vertical.

## Core + industry packs

| Layer | What it is | ANYQ status |
|---|---|---|
| Core domain | Organizations, locations, users/roles, products, stock, sales, documents | Built |
| Retail Pack | Variants, discounts, loyalty, weight-based sale | **Built** (2026-07-28) — per-sale discount, loyalty points, product variants, and weight-based sale, all gated by `retail` module. Weight-based sale widened `Stock.quantity`/`DocumentItem.quantity` from `Int` to `Float` (a safe, lossless Postgres column-type change) rather than a grams-as-Int workaround — `price * quantity` keeps computing correct revenue everywhere (reports, discounts, loyalty, cart totals) with the results rounded to whole tenge at each aggregation point, since KZT has no practical sub-unit |
| Pharmacy Pack | Batch/expiry FEFO dispensing | **Built** — batches, expiry-aware sale allocation, receiving screen. `Prescription`/`ControlledSubstanceLedger` schema still has zero wiring (compliance/marking scope, deliberately deferred) |
| Warehouse Pro Pack | Multi-warehouse transfers, receiving, cycle counts, production/BOM | **Built** (2026-07-28) — `Document.type='transfer'/'receipt'/'adjustment'/'production'`, all gated by `warehouse` module. Production reuses the same `Recipe`/`RecipeIngredient` models the Restaurant Pack already had (they were never restaurant-specific), so a company can define a BOM for any product, not just dishes |
| Distribution Pack (B2B) | Personal pricing, credit limits, order portal, linked buyer/seller documents | **Built** — this is the `supply` module (`apps/orders` + `/pos/orders`) |
| Restaurant Pack | Recipes, ingredient deduction, food cost, stop-list, modifiers, table/floor plan, KDS | **Built** (2026-07-29) — floor plan + kitchen display, gated by `restaurant` module. Split bills (per-guest/per-item payment splitting) still not built — one table has exactly one open order and one payment, deliberately deferred as a separate, larger follow-up |
| Terminal/reports | Desktop layout, sales analytics, receipt printing | Built (2026-07-28, MVP scope) |

Keep this table honest going forward — a module only "counts" once it has real routes and UI,
not just a schema field. [PRICING.md](PRICING.md) already follows this discipline for Core vs. Supply.

## The B2B network effect — already seeded, worth deliberately growing

The `supply` module (public ordering site → same-account POS fulfillment → stock decrements
only on issuance) is a small instance of the bigger idea: one company can be simultaneously a
supplier to some counterparties and a buyer from others, with linked-but-independent documents
on each side. This is the platform's actual moat — a POS clone is trivial to copy, a live
network of suppliers and buyers who'd lose their order history by leaving is not. When extending
`supply`, prefer generalizing toward "any company can order from any other company on the
platform" over building one-off HoReCa-specific logic.

## Non-negotiable engineering rules

Carried forward from the brief, because violating any of these is expensive to undo later:

- **Stock must be a computed projection of a movement ledger, not a mutable number.**
  **Fixed (2026-07-29).** `StockMovement` is now the source of truth — every quantity change is a
  signed movement row (`reason` + optional `documentId`), and `Stock.quantity` is a materialized
  cache kept in lockstep with it via two shared helpers in `apps/api/src/stock.ts`:
  `applyStockDelta` (existing row) and `createStockWithMovement` (first stock at a location).
  Every route that used to call `prisma.stock.update`/`.create` directly — `/pos/sales`,
  `/pos/orders/:id/fulfill`, `/pos/transfers`, `/pos/receipts`, `/pos/counts`, `/pos/production`,
  `/pos/tables/:id/order`, and `/pos/batches` — now goes through one of these two functions, and
  nothing else is allowed to touch `Stock.quantity`. This unlocks the two things direct mutation
  couldn't: an audit trail (who/what moved stock and why) and reconciliation (the cache can always
  be rebuilt from `SUM(StockMovement.quantity)` per product+location). `ProductBatch.quantity`
  (pharmacy FEFO) is a separate, deliberately untouched concern — this rule was always about
  `Stock`, not batch-level tracking.
- Never store the whole business in one flat table per vertical — one core schema, feature
  flags per module, industry-specific fields live behind their own pack tables (matches the
  `ProductBatch`/`Prescription` split already in `schema.prisma`).
- Never make POS or warehouse receiving hard-depend on a live connection — offline-first with a
  local queue stays mandatory (already true for POS sales).
- Never let AI (if/when added) directly post financial documents, delete records, or change
  prices — draft + explicit human confirmation only.
- Never hardcode tax rates or compliance rules — Kazakhstan's VAT moved to 16% (with a 5% band
  for certain pharma) from 2026-01-01, and marking coverage keeps expanding (beer marking from
  2026-02-01, fuller traceability from 2027-01-01). Tax/compliance rules belong in a
  date-and-category-versioned config, not literals in code.
- Never charge per operational seat (cashier/waiter/picker) — only per management seat and per
  location/warehouse. Matches the `userLimit` field already existing on `Tariff`, but the
  pricing grid should keep this distinction explicit if operational-role headcount ever comes up.

## Role-scoped UI (future direction, not yet built)

Today `apps/pos` shows one screen set regardless of role (owner and cashier see the same POS,
differing only by PIN identity). The target state is role-scoped views — cashier sees sales/
returns/shift only, owner sees money/reports/alerts, purchasing sees reorder suggestions,
warehouse staff sees receiving/putaway/counts. `User.role` already exists in the schema
(`owner`/`manager`/`cashier`/`warehouse_staff`/`pharmacist`) but nothing in `apps/pos` branches
on it yet — this is a natural next increment once the terminal reports screen has been live long
enough to know what owners actually ask for.

## Phased roadmap (cross-checked against what's shipped)

The brief's own recommended order — foundation → shop/warehouse → distributor/B2B → restaurant
→ pharmacy → advanced WMS/manufacturing → ecosystem — already matches how ANYQ was actually
built, which is a good sign the existing sequencing wasn't wrong:

1. Foundation (companies, locations, users, roles, products, documents, offline sync) — done
2. Shop/warehouse POS — done
3. Distributor ↔ B2B buyer (the `supply` module) — done
4. Terminal/reports — done (MVP scope, 2026-07-28)
5. Restaurant Pack (recipes, ingredient deduction, food cost, stop-list, modifiers, table/floor
   plan, KDS) — done (2026-07-28, extended with floor plan + KDS 2026-07-29)
6. Pharmacy Pack (batch/expiry FEFO dispensing) — done (2026-07-28)
7. Multi-warehouse transfers — done (2026-07-28)
8. Advanced WMS (receiving documents, cycle counts) / manufacturing — done (2026-07-28).
   Production runs reuse `Recipe`/`RecipeIngredient` (generalized off the Restaurant Pack) plus
   `Document.type='production'`, with signed-quantity items (ingredients negative, finished good
   positive) — zero schema migration needed beyond what Restaurant Pack already added
9. Retail Pack (per-sale discounts, loyalty points, product variants, weight-based sale) — done
   (2026-07-28), all four items
10. Ecosystem (integrations marketplace, AI layer, fraud detection) — not started, and shouldn't
    be attempted before real paying usage justifies the investment

Every near-term vertical pack from the original brief is now built to at least MVP scope. What's
left before ecosystem-level features: prescription/marking compliance for pharmacies — pharmacy
compliance needs actual Kazakhstan regulatory detail, not a guess, so it stays deliberately
deferred until that detail is available. Don't jump to ecosystem features while it remains
unbuilt; it's what actually differentiates the product for the pharmacy customers ANYQ already has.

## Restaurant floor plan + KDS (2026-07-29) — architecture notes

The "real-time architecture decision" flagged as the blocker for KDS turned out not to need
anything exotic: the kitchen display polls `GET /pos/kds` every 8s while open, and the floor plan
polls `GET /pos/tables` every 15s while open — consistent with the offline-first, no-WebSocket
posture used everywhere else in ANYQ (the `Заказы` HoReCa-fulfillment screen already polled this
way). A table's occupied/free state mirrors whether it has an open (`type='sale', status='open'`)
`Document` — the same universal-transaction-record pattern used for every other document type,
extended with `Document.tableId` and `DocumentItem.kitchenStatus`. Stock and recipe ingredients
are deducted when items are sent to the kitchen, not when the table finally pays, since the
kitchen has to cook them regardless of payment timing — this is the one place dine-in service
diverges from the rest of POS, where a sale is always a single instant transaction.

## Admin back-office CRUD (2026-07-28)

Every company-scoped resource superadmin needs to manage day-to-day — products, staff/PINs, and
locations — now has proper create/edit UI in `apps/admin`, not just the disposable seed script.
None of the three have a delete route: products and staff deletion is judged too risky for MVP
(no confirmed need yet), and locations have real FK protection (`Stock`/`Document`/`Shift`/
`ProductBatch` all reference `locationId` with no cascade), so a delete route would be rejected by
Postgres the moment any activity happens at that location anyway.

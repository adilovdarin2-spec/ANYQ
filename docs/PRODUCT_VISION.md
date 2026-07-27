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
| Retail Pack | Variants, discounts, loyalty, weight-based sale | Not built (shop tariff today = bare POS) |
| Pharmacy Pack | Batch/expiry, serialized Data Matrix tracking, prescriptions, price ceilings | Schema exists (`ProductBatch`, `Prescription`, `ControlledSubstanceLedger`), **zero API/UI wiring** — do not price or market as delivered |
| Warehouse Pro Pack | Multi-warehouse transfers, receiving documents, cycle counts | Not built |
| Distribution Pack (B2B) | Personal pricing, credit limits, order portal, linked buyer/seller documents | **Built** — this is the `supply` module (`apps/orders` + `/pos/orders`) |
| Restaurant Pack | Recipes, modifiers, KDS, food cost | Not built — this is the deferred second half of the "terminal" ask |
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
  This is the one place ANYQ's current implementation already violates the target architecture:
  `/pos/sales` and `/pos/orders/:id/fulfill` do `prisma.stock.update({ data: { quantity: ... } })`
  directly. It works today because there's no reconciliation, no audit trail, and no multi-writer
  contention story yet — but it will not survive multi-warehouse transfers or an audit
  requirement. Flagging as the top architectural debt item, not fixing opportunistically.
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
5. Restaurant Pack (recipes, food cost, KDS) — not started
6. Pharmacy Pack (wire up the existing batch/expiry/prescription schema) — not started
7. Advanced WMS / manufacturing — not started
8. Ecosystem (integrations marketplace, AI layer, fraud detection) — not started, and shouldn't
   be attempted before steps 5–7 have real paying usage to justify the investment

Do not jump ahead to ecosystem-level features (AI analyst, fraud detection, no-code automation
builder, integration marketplace) while steps 5–6 are still unbuilt — those are what actually
differentiate the product for the customers ANYQ already has.

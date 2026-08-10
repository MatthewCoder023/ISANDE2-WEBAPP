# API Reference

All endpoints are prefixed with `/api`. Authentication is a session cookie
(`fc.sid`); `requireAuth` re-reads the user from the database on every request,
so a deactivated account or a changed password takes effect immediately.

Responses share one envelope:

```json
{ "success": true, "message": "optional", "data": { } }
```

Errors use the same shape with `success: false`, an HTTP status, and — for
validation failures (422) — an `errors` array of `{ field, message }`.

**Role column key:** `public` = no session · `client` = customer ·
`cashier` · `mixer` = paint_mixer · `admin`. Where a customer may reach an
endpoint, the controller scopes results to their own records; another
customer's resource returns **404, never 403**, so the response cannot be
used to prove a record exists.

---

## Authentication — `/api/auth`

| Method | Path | Roles | Purpose |
|---|---|---|---|
| POST | `/register` | public | Self-registration. Always creates a `client`; an injected role is ignored |
| POST | `/login` | public | Starts a session. Rate limited; 5 failures per email locks that account for 15 min |
| POST | `/forgot-password` | public | Emails a single-use, 30-minute reset link. Same response whether or not the account exists |
| POST | `/reset-password` | public | Consumes the token, sets the password, invalidates other sessions |
| POST | `/logout` | any | Destroys the session |
| GET | `/me` | any | The signed-in user |
| PATCH | `/profile` | any | Name and phone. Email is immutable — it is the login identity |
| POST | `/change-password` | any | Requires the current password; signs out every other session |

## Products — `/api/products`

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/` | any | Catalogue with filters. Customers never receive stock counts, only `availability`, and see only their own custom mixes |
| GET | `/stats` | admin | Catalogue totals and stock alerts (custom mixes excluded) |
| GET | `/match` | any | Closest paints to a hex by CIELAB ΔE. One-off custom mixes are never suggested |
| GET | `/export` | admin | Catalogue as CSV |
| GET | `/:id` | any | One product |
| POST | `/` | admin | Create; opening stock enters the audit trail |
| PATCH | `/:id` | admin | Whitelisted fields — never SKU or quantity |
| DELETE | `/:id` | admin | Archive (soft delete) |
| POST | `/:id/stock` | admin | Adjust stock through the audited service |
| GET | `/:id/movements` | admin | Stock history |

## Orders — `/api/orders`

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/verify` | **public** | Checks a document's code against the order. Public by design: whoever holds the paper must be able to check it |
| GET | `/` | client, cashier, admin | List. Customers see only their own. Supports `status` (incl. `active`), `type`, `search`, `customer`, `sort` |
| GET | `/stats` | client, cashier, admin | Role-shaped dashboard counts |
| GET | `/:id` | owner, staff | Order detail with its transaction |
| GET | `/:id/proof` | owner, staff | The payment-proof image; never served statically |
| GET | `/:id/invoice.pdf` | owner, staff | Invoice as a PDF carrying a verification code and QR |
| GET | `/:id/export.csv` | owner, staff | Invoice content as sectioned CSV |
| POST | `/` | client | Place an order. Prices are taken from the catalogue; the client sends only `productId` and `quantity` |
| POST | `/:id/payment-method` | client | Choose cash on pickup |
| POST | `/:id/proof` | client | Upload GCash proof. Rate limited, magic-byte checked, stored outside `public/` |
| POST | `/walk-in` | cashier, admin | POS sale: create, pay and complete in one step |
| POST | `/:id/verify-payment` | cashier, admin | Approve a proof; records the Transaction |
| POST | `/:id/reject-payment` | cashier, admin | Reject with a reason; returns the order to pending payment |
| POST | `/:id/prepare` · `/ready` · `/complete` | cashier, admin | Advance the fulfilment stages |
| POST | `/:id/cancel` | owner (while unpaid), staff | Cancel and restore stock |

## Custom mixing — `/api/mixing`

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/requests` | any | Customers see their own; staff see all. `status` accepts `active` and `history` |
| GET | `/stats` | any | Role-shaped counts |
| GET | `/ready` | client | Finished mixes not yet placed in the caller's cart |
| POST | `/ready/ack` | client | Marks them as collected, so removing one from the cart sticks |
| GET | `/requests/:id` | owner, staff | One request |
| POST | `/requests` | any | Request a mix; notifies the mixer |
| POST | `/requests/:id/start` | mixer, admin | Move to the bench |
| POST | `/requests/:id/complete` | mixer, admin | Finish, price (optional `unitPrice` overrides the quote) and **publish the paint for sale** |
| POST | `/requests/:id/cancel` | owner (while queued), mixer, admin | Cancel |

## Formulas — `/api/formulas`

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/` | mixer, cashier, admin | Recipe library |
| POST | `/` · PATCH `/:id` · DELETE `/:id` | mixer, admin | Maintain recipes |

## Transactions — `/api/transactions`

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/` | cashier, admin | Payment log. Supports `method`, `search`, `sort` |
| GET | `/export` | cashier, admin | Flat PDF for analysis |

## Notifications — `/api/notifications`

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/` | any | The caller's messages and unread count |
| GET | `/unread-count` | any | Cheap poll for the bell badge |
| POST | `/:id/read` · `/read-all` | any | Mark read. Scoped to the caller |

## Users, customers, settings, reports

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/users` · `/users/stats` | admin | Directory and counts |
| POST | `/users` · PATCH `/users/:id` | admin | Create and edit. Cannot self-demote; the last active admin is protected |
| POST | `/users/:id/reset-password` | admin | Reset; signs that user out everywhere |
| GET | `/users/events` | admin | Security audit log |
| GET | `/customers` | cashier, admin | Customer directory with order statistics |
| GET | `/settings` | any | Shop details and payment instructions |
| PATCH | `/settings` | admin | Update shop configuration |
| GET | `/reports/sales` | admin | Analytics. `days=N` or `from=&to=` (YYYY-MM-DD, read as local dates) |
| GET | `/reports/sales/export` | admin | The same window as a PDF |
| GET | `/reports/inventory` | admin | Stock position and reorder list |

---

## Conventions worth knowing

- **Pricing is never trusted from the client.** Order requests carry only
  product ids and quantities; the server prices from the catalogue and
  snapshots name, SKU and price onto the order so later catalogue edits
  cannot rewrite history.
- **Stock changes go through one place** (`inventory.service.adjustStock`),
  which writes a `StockMovement` for every change. There are no ad-hoc
  quantity updates anywhere in the codebase.
- **Order state changes go through `transition()`**, which appends to
  `statusHistory` — the tracker timeline is derived from it, not stored twice.
- **No MongoDB transactions.** The deployment target is a standalone mongod,
  so ordering uses reserve-with-compensation: stock is taken first and given
  back if the order fails to save.
- **Sorting and filtering are whitelisted.** Unrecognised `sort` keys fall
  back to a default rather than reaching the query.

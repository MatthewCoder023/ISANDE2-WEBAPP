# Flavor & Color — Paint Shop Management System
### ISANDE2-WEBAPP

A full-stack web application for the Flavor & Color paint shop, built on a
**three-tier architecture** with role-based access control (RBAC).

## Technology Stack

| Tier | Technology |
|---|---|
| Presentation | HTML5, CSS3, vanilla JavaScript (ES modules) |
| Application | Node.js, Express.js |
| Data | MongoDB (Mongoose ODM) |

## Getting Started

Prerequisites: Node.js 18+, MongoDB running locally (or an Atlas URI).

```bash
npm install
cp .env.example .env   # then set a strong SESSION_SECRET
npm run seed           # creates one demo account per role
npm run dev            # http://localhost:3000
npm test               # runs the automated suite (in-memory MongoDB)
npm run reset-demo     # wipe everything & reseed (never runs in production)
```

## Testing

`npm test` runs 106 Jest + Supertest tests in 9 suites against an in-memory
MongoDB (`mongodb-memory-server`) — no local database or running server
needed. The suites in `tests/` guard the system's core invariants:

- **auth** — registration (role injection blocked), sessions, account
  deactivation, self-service profile and password change, forgot-password
  tokens and the session invalidation a reset forces
- **rbac** — an access matrix across every module, plus page-guard redirects
- **inventory** — SKU/quantity immutability, audit-trail movements,
  negative-stock guard, customer response shaping, color matching
- **orders** — server-side pricing, stock reservation with rollback,
  cancellation restores, the online-ordering kill switch, walk-in POS
- **payments** — the full GCash proof flow (upload → reject → re-upload →
  verify → complete without double payment), proof privacy
- **users** — employee lifecycle, instant lockout on deactivation,
  password reset, admin self-lockout guards
- **mixing** — request lifecycle, formula reuse counting, archived-formula
  rejection, client scoping, and that a published custom paint never
  reaches another customer's catalogue
- **documents** — invoice PDF and CSV parity with the on-screen order, the
  verification code's tamper check, and staff-only access to XLSX exports
- **notifications** — delivery on real domain events, unread counts, and
  that one user can never read another's

CI runs the same suite on Node 24 for every push (`.github/workflows`).

### Seeded demo accounts

| Role | Email | Password |
|---|---|---|
| System Administrator | admin@flavorandcolor.com | Admin@1234 |
| Paint Mixer | mixer@flavorandcolor.com | Mixer@1234 |
| Cashier / Secretary | cashier@flavorandcolor.com | Cashier@1234 |
| Customer | client@example.com | Client@1234 |

> Demo credentials only — change them before any real deployment.

## Architecture

### Folder structure

```
├── server.js               # Entry point: loads env, connects DB, starts app
├── scripts/seed.js         # Idempotent demo-data seeder
├── src/                    # Application layer (Express)
│   ├── app.js              # App factory: middleware pipeline, sessions, routes
│   ├── config/db.js        # MongoDB connection
│   ├── constants/roles.js  # Single source of truth for roles & dashboards
│   ├── controllers/        # Request handlers (business logic)
│   ├── middleware/         # auth (RBAC guards), validation, error handling
│   ├── models/             # Mongoose schemas (data layer contracts)
│   ├── routes/             # API + protected page routes
│   ├── services/           # Domain logic that owns an invariant:
│   │                       #   inventory (stock), order (state), document,
│   │                       #   pdf, xlsx, mail, notification, mix-fulfillment
│   ├── utils/              # ApiError, asyncHandler
│   └── validators/         # express-validator rule sets
├── public/                 # Presentation layer: static pages & assets
│   ├── css/                # base (design tokens), components, page styles
│   └── js/                 # api client, toast, form utils, page scripts
├── views/                  # Protected dashboards, served only after
│                           # server-side session + role verification
├── tests/                  # Jest + Supertest suites (in-memory MongoDB)
└── uploads/                # Payment proofs — private, served only via
                            # an authenticated route, never statically
```

### Authentication & authorization

- **Session-based auth**: httpOnly, sameSite cookies backed by a MongoDB
  session store. Session IDs are regenerated on login (prevents fixation);
  passwords are hashed with bcrypt (12 rounds).
- **RBAC roles**: `client`, `paint_mixer`, `cashier`, `admin`
  (defined once in `src/constants/roles.js`).
- **Server-side enforcement everywhere**:
  - API routes: `requireAuth` → `requireRole(...)` middleware chain.
    `requireAuth` re-reads the user from the DB on each request, so role
    changes and deactivation take effect immediately.
  - Dashboard pages live in `views/` (not `public/`) and are only served
    after `requirePageAuth(role)` passes. Frontend checks are cosmetic only.
- **Hardening**: helmet security headers, login/registration rate limiting,
  identical error messages for wrong-email vs wrong-password, JSON body
  size limits, self-registration locked to the `client` role.

### API (current)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | /api/auth/register | Public | Create a customer account |
| POST | /api/auth/login | Public | Log in (all roles) |
| POST | /api/auth/forgot-password | Public | Email a reset link (only the token's hash is stored) |
| POST | /api/auth/reset-password | Public | Redeem a reset token; signs every other session out |
| POST | /api/auth/logout | Authenticated | Destroy session |
| GET | /api/auth/me | Authenticated | Current user |
| GET | /api/products | Authenticated | List products (search, category/status/stock filters, sort, pagination). Clients see only active products with `availability` instead of raw stock counts |
| GET | /api/products/:id | Authenticated | Product detail (archived products 404 for clients) |
| GET | /api/products/stats | Admin | Catalog totals, low/out-of-stock counts, inventory value |
| POST | /api/products | Admin | Create product (SKU auto-generated if omitted) |
| PATCH | /api/products/:id | Admin | Update product / restore archived (`sku` and `stock.quantity` immutable here) |
| DELETE | /api/products/:id | Admin | Archive product (soft delete) |
| POST | /api/products/:id/stock | Admin | Adjust stock (restock/adjustment) — atomic, audit-logged, cannot go negative |
| GET | /api/products/:id/movements | Admin | Paginated stock movement history |

**Inventory integrity**: stock quantity is never written directly. All changes
go through `src/services/inventory.service.js`, which performs a guarded
atomic `$inc` and records a `StockMovement` (type, signed delta, resulting
quantity, reason, who) — so current stock always reconciles with its history.

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | /api/orders | Client | Place an online order (server-side pricing, stock reserved) |
| POST | /api/orders/walk-in | Cashier/Admin | One-step POS sale: create + pay + complete |
| GET | /api/orders | Client/Cashier/Admin | Clients see own orders; staff see all (status/type/search filters) |
| GET | /api/orders/stats | Client/Cashier/Admin | Role-shaped dashboard stats (own counts vs. sales/queue totals) |
| GET | /api/orders/:id | Client/Cashier/Admin | Detail incl. payment record; clients limited to own orders |
| POST | /api/orders/:id/ready | Cashier/Admin | pending → ready |
| POST | /api/orders/:id/complete | Cashier/Admin | Take payment (creates Transaction) → completed |
| POST | /api/orders/:id/cancel | Owner or staff | Cancel & restore stock (clients: pending only; staff: pending/ready) |
| GET | /api/transactions | Cashier/Admin | Payment log with method filter, order search, pagination |

**Order integrity**: items are priced from the live catalog server-side —
the client only ever sends `{ productId, quantity }`, and line prices are
snapshotted onto the order so later catalog edits never rewrite history.
Stock is reserved at placement through the inventory service (`sale`
movements); multi-item reservations roll back already-applied lines if a
later one fails, and cancellation restores stock as `return` movements.
Completion is payment: it creates a `Transaction` (method, tendered,
change, cashier) and stamps `paidAt`/`completedAt`.

**Order lifecycle**:
`pending_payment → [pending_verification → payment_verified] → preparing → ready → completed`,
with `cancelled` possible before completion. GCash orders go through proof
verification; cash-on-pickup orders skip straight to preparing and are paid
at handover. Walk-in POS sales are created directly as completed. Every
transition is appended to the order's `statusHistory`, which drives the
customer-facing tracker timeline.

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | /api/orders/:id/payment-method | Client (owner) | Choose cash on pickup → preparing |
| POST | /api/orders/:id/proof | Client (owner) | Upload GCash proof (JPG/PNG/WebP ≤ 5 MB) → pending_verification |
| GET | /api/orders/:id/proof | Owner or staff | The proof image (private — served with auth, never static) |
| POST | /api/orders/:id/verify-payment | Cashier/Admin | Approve proof → payment_verified, records the Transaction |
| POST | /api/orders/:id/reject-payment | Cashier/Admin | Reject proof with a reason → back to pending_payment |
| POST | /api/orders/:id/prepare | Cashier/Admin | payment_verified → preparing |
| GET | /api/orders/:id/invoice.pdf | Owner or staff | Server-rendered sales invoice, carrying its verification code and QR |
| GET | /api/orders/:id/export.csv | Owner or staff | The same order as data, line for line with the invoice |
| GET | /api/orders/verify?code= | Public | Check a printed invoice against its recorded totals |

**Checkout flow**: Cart → `/client/checkout` (review, payment method,
notes) → place order → `/client/track?order=` — one order screen that
carries the timeline, the GCash instructions and proof upload, and links to
the invoice. `/client/payment` survives only to redirect links already sent
out. Invoices are rendered server-side to PDF; each carries a verification
code and QR that `/api/orders/verify` checks against the stored order, so a
printed copy can be told apart from an edited one.

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | /api/users | Admin | User directory (role/status filters, search, pagination) |
| GET | /api/users/stats | Admin | Totals, clients vs staff, new this month |
| POST | /api/users | Admin | Create an account (typically staff) |
| PATCH | /api/users/:id | Admin | Edit / role change / deactivate-restore (email immutable) |
| POST | /api/users/:id/reset-password | Admin | Set a new password |
| GET | /api/users/events | Admin | Authentication audit trail (sign-ins, failures, lockouts) |
| GET | /api/settings | Authenticated | System settings (GCash details power the order screen) |
| PATCH | /api/settings | Admin | Update store info, payments, operations |
| GET | /api/reports/sales?days= \| ?from=&to= | Admin | Revenue by day, KPIs, methods, top products, categories — a trailing window or explicit dates |
| GET | /api/reports/sales/export | Admin | The window on screen, as a file |
| GET | /api/reports/inventory | Admin | Stock value by category, restock list |
| PATCH | /api/auth/profile | Authenticated | Self-service name/phone (email immutable) |
| POST | /api/auth/change-password | Authenticated | Change own password (current password required) |
| GET | /api/customers | Cashier/Admin | Customer records with order counts, spend, last order |
| GET | /api/transactions/export | Cashier/Admin | Payment log as CSV (honors method/search filters) |
| GET | /api/transactions/export.xlsx | Cashier/Admin | The same log as a password-protected workbook |
| GET | /api/products/export | Admin | Full inventory as CSV |
| GET | /api/notifications | Authenticated | Own notifications, newest first |
| GET | /api/notifications/unread-count | Authenticated | Badge count for the topbar bell |
| POST | /api/notifications/read-all | Authenticated | Mark every own notification read |

**Admin safety rails**: admins cannot change their own role or deactivate
themselves, and the last active administrator can never be demoted or
deactivated. Deactivation locks a user out on their very next request,
because `requireAuth` re-reads the account from the database each time.

**System settings** are a singleton document (`Setting.get()` upserts
defaults on first use). They drive real behavior: GCash payment
instructions on the payment page and invoices, an accept-online-orders
switch enforced at order placement, and the default low-stock threshold
applied to new products.

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | /api/products/match?hex= | Authenticated | Closest catalog paints to a color, ranked by CIELAB ΔE with match % |
| POST | /api/mixing/requests | Authenticated | Request a custom mix (target color, optional base paint, quantity) |
| GET | /api/mixing/requests | Authenticated | Clients see own; mixer/cashier/admin see all (`status` accepts a value, `active`, or `history`) |
| GET | /api/mixing/stats | Authenticated | Role-shaped: client mix counts vs. bench/queue totals |
| GET | /api/mixing/requests/:id | Authenticated | Detail incl. formula; clients limited to own |
| GET | /api/mixing/ready | Client | Own finished mixes that are now buyable |
| POST | /api/mixing/ready/ack | Client | Acknowledge them, so the news is announced once |
| POST | /api/mixing/requests/:id/start | Mixer/Admin | queued → mixing |
| POST | /api/mixing/requests/:id/complete | Mixer/Admin | Complete, reusing a formula or recording a new one |
| POST | /api/mixing/requests/:id/cancel | Owner or Mixer/Admin | Clients: queued only; staff: queued or mixing |
| GET/POST/PATCH/DELETE | /api/formulas | Mixer/Admin | Formula library CRUD (soft delete) |

**Custom mixes are buyable**: completing a mix publishes a reserved
`Product` (`isCustom: true`, `customFor: <userId>`), priced server-side,
which then moves through the ordinary cart and checkout. Every catalogue
query excludes custom paints, so one customer's mix can never surface in
another's shop — the mixing suite tests exactly that. Sold-out custom
paints retire themselves rather than lingering as unbuyable listings.

**Color science**: photo palette extraction runs entirely in the browser
(median-cut quantization over canvas pixels in `public/js/color-utils.js` —
images never leave the device). Paint matching converts colors to CIELAB
and ranks by ΔE*76 (`src/utils/color.js`), which reflects perceived color
difference far better than RGB distance.

**Mix lifecycle**: `queued → mixing → completed`, `cancelled` allowed
before completion. Completed/cancelled requests form the production log.

### Pages

| Path | Access |
|---|---|
| `/`, `/login`, `/register` | Public — one sign-in for customers and staff alike |
| `/forgot-password`, `/reset-password` | Public — self-service password recovery |
| `/verify` | Public — check a printed sales invoice against its code |
| `/client` | Client only |
| `/client/products` | Client only — browse the catalog, cart, place orders |
| `/client/orders` | Client only — order history, details, cancel pending |
| `/client/checkout` | Client only — cart review, payment method, place order |
| `/client/track?order=` | Client only — the order screen: timeline, payment, invoice |
| `/client/colors` | Client only — Color Studio: color wheel, photo palettes, paint matching, custom mix requests |
| `/invoice?order=` | Owner or staff — printable sales invoice (the API enforces ownership) |
| `/mixer` | Paint Mixer only |
| `/mixing`, `/mixing/formulas`, `/mixing/log` | Paint Mixer + Admin — queue, formula library, production history |
| `/cashier` | Cashier only |
| `/admin` | Admin only |
| `/admin/products` | Admin only — product & inventory management |
| `/admin/users` | Admin only — user & employee management |
| `/admin/reports` | Admin only — sales & inventory reports |
| `/admin/settings` | Admin only — system configuration |
| `/customers` | Cashier + Admin — customer records & order history |
| `/profile` | Any authenticated user — account details & password |
| `/pos` | Cashier + Admin — point of sale |
| `/orders` | Cashier + Admin — process all orders |
| `/transactions` | Cashier + Admin — payment log |
| `/dashboard` | Redirects any logged-in user to their dashboard |

The sidebar on every authenticated page is rendered from a single per-role
nav config (`public/js/nav.js`) — pages shared by cashier and admin adapt
automatically. This is display-only; the page routes above are enforced
server-side.

## Roadmap

- [x] **Phase 1 — Foundation**: three-tier scaffold, session auth, RBAC,
      role dashboards, design system
- [x] **Phase 2 — Product & Inventory**: product catalog CRUD (admin),
      stock tracking with audit trail, low-stock alerts, customer browsing
- [x] **Phase 3 — Orders & Sales**: customer cart & ordering, cashier POS,
      order lifecycle, transactions & payment records
- [x] **Phase 4 — Paint Production & Color Tools**: mixing queue, color
      formulas, production log; Color Studio with interactive color wheel,
      photo color extraction, and perceptual paint matching
- [x] **Phase 5 — Checkout & Order Tracking**: checkout page, payment page
      (GCash proof upload / cash on pickup), printable invoice, payment
      verification workflow, order tracker timeline
- [x] **Phase 6 — Administration**: user/employee management with admin
      safety rails, sales & inventory reports, system settings
- [x] **Phase 7 — Hardening**: proof-upload path traversal closed, uploads
      verified by magic bytes rather than declared type, Origin-check CSRF,
      per-account login lockout and a common-password blocklist, an
      authentication audit trail, session invalidation on password change,
      rate limits, and CI running the suite on every push
- [x] **Phase 8 — Custom mixes end to end**: a finished mix becomes a
      reserved, priced product the customer can actually buy, scoped so it
      never leaks into anyone else's catalogue
- [x] **Phase 9 — Documents & notifications**: server-rendered invoice
      PDFs with a verification code and QR, order-level CSV export at
      invoice parity, password-protected XLSX for staff, transactional
      email, and in-app notifications behind a topbar bell
- [x] **Phase 10 — Interface**: dark mode, skeleton loading, a command
      palette, a collapsible sidebar rail, dashboard widgets for all four
      roles, and an in-app navigation trail so Back always means the
      previous page

### Known before deployment

- `uploads/` is on the local filesystem. On an ephemeral host the payment
  proofs behind verified orders vanish on restart — this needs persistent
  storage or object storage before going live.
- `DOCUMENT_SECRET` is not in `.env.example`, so a fresh clone signs
  invoice verification codes with an undefined secret.

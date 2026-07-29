# Flavor & Color — Paint Shop Management System

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

`npm test` runs 55 Jest + Supertest tests against an in-memory MongoDB
(`mongodb-memory-server`) — no local database or running server needed.
The suites in `tests/` guard the system's core invariants:

- **auth** — registration (role injection blocked), sessions, account
  deactivation, self-service profile and password change
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
  rejection, client scoping

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
│   ├── utils/              # ApiError, asyncHandler
│   └── validators/         # express-validator rule sets
├── public/                 # Presentation layer: static pages & assets
│   ├── css/                # base (design tokens), components, page styles
│   └── js/                 # api client, toast, form utils, page scripts
└── views/                  # Protected dashboards, served only after
                            # server-side session + role verification
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

**Checkout flow**: Cart → `/client/checkout` (review) → place order →
`/client/payment` (method, GCash instructions, proof upload) →
`/invoice?order=` (printable / save-as-PDF via the browser print dialog) →
`/client/track?order=` (timeline tracker).

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | /api/users | Admin | User directory (role/status filters, search, pagination) |
| GET | /api/users/stats | Admin | Totals, clients vs staff, new this month |
| POST | /api/users | Admin | Create an account (typically staff) |
| PATCH | /api/users/:id | Admin | Edit / role change / deactivate-restore (email immutable) |
| POST | /api/users/:id/reset-password | Admin | Set a new password |
| GET | /api/settings | Authenticated | System settings (GCash details power the payment page) |
| PATCH | /api/settings | Admin | Update store info, payments, operations |
| GET | /api/reports/sales?days= | Admin | Revenue by day, KPIs, methods, top products, categories |
| GET | /api/reports/inventory | Admin | Stock value by category, restock list |
| PATCH | /api/auth/profile | Authenticated | Self-service name/phone (email immutable) |
| POST | /api/auth/change-password | Authenticated | Change own password (current password required) |
| GET | /api/customers | Cashier/Admin | Customer records with order counts, spend, last order |
| GET | /api/transactions/export | Cashier/Admin | Payment log as CSV (honors method/search filters) |
| GET | /api/products/export | Admin | Full inventory as CSV |

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
| POST | /api/mixing/requests/:id/start | Mixer/Admin | queued → mixing |
| POST | /api/mixing/requests/:id/complete | Mixer/Admin | Complete, reusing a formula or recording a new one |
| POST | /api/mixing/requests/:id/cancel | Owner or Mixer/Admin | Clients: queued only; staff: queued or mixing |
| GET/POST/PATCH/DELETE | /api/formulas | Mixer/Admin | Formula library CRUD (soft delete) |

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
| `/client` | Client only |
| `/client/products` | Client only — browse the catalog, cart, place orders |
| `/client/orders` | Client only — order history, details, cancel pending |
| `/client/colors` | Client only — Color Studio: color wheel, photo palettes, paint matching, custom mix requests |
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
# ISANDE2-WEBAPP

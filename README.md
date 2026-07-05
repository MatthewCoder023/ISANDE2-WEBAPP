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
```

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

**Order lifecycle**: `pending → ready → completed`, `cancelled` allowed
before completion. Walk-in POS sales are created directly as completed.

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
| `/`, `/login`, `/employee-login`, `/register` | Public |
| `/client` | Client only |
| `/client/products` | Client only — browse the catalog, cart, place orders |
| `/client/orders` | Client only — order history, details, cancel pending |
| `/client/colors` | Client only — Color Studio: color wheel, photo palettes, paint matching, custom mix requests |
| `/mixer` | Paint Mixer only |
| `/mixing`, `/mixing/formulas`, `/mixing/log` | Paint Mixer + Admin — queue, formula library, production history |
| `/cashier` | Cashier only |
| `/admin` | Admin only |
| `/admin/products` | Admin only — product & inventory management |
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
- [ ] **Phase 5 — Administration**: user/employee management, reports,
      system configuration
# ISANDE2-WEBAPP

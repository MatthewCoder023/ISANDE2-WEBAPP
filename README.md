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

### Pages

| Path | Access |
|---|---|
| `/`, `/login`, `/employee-login`, `/register` | Public |
| `/client` | Client only |
| `/mixer` | Paint Mixer only |
| `/cashier` | Cashier only |
| `/admin` | Admin only |
| `/dashboard` | Redirects any logged-in user to their dashboard |

## Roadmap

- [x] **Phase 1 — Foundation**: three-tier scaffold, session auth, RBAC,
      role dashboards, design system
- [ ] **Phase 2 — Product & Inventory**: product catalog CRUD (admin),
      stock tracking, low-stock alerts, customer product browsing
- [ ] **Phase 3 — Orders & Sales**: customer ordering, cashier POS,
      transactions, payment records
- [ ] **Phase 4 — Paint Production**: mixing queue, color formulas,
      production log for the Paint Mixer role
- [ ] **Phase 5 — Administration**: user/employee management, reports,
      system configuration
# ISANDE2-WEBAPP

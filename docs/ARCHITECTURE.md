# Architecture

## Three tiers

```mermaid
flowchart TB
    subgraph P["Presentation — browser"]
        A["Public pages<br/>index · login · register · verify"]
        B["Guarded views<br/>views/ served by role-checked routes"]
        C["ES modules<br/>api · cart · nav · icons · notifications"]
    end

    subgraph L["Application — Node.js / Express"]
        D["Routes<br/>auth · products · orders · mixing · reports"]
        E["Middleware<br/>requireAuth · requireRole · validate · upload · security"]
        F["Controllers<br/>request shaping, role-scoped responses"]
        G["Services<br/>order · inventory · mix-fulfillment · pdf · mail · notify"]
    end

    subgraph D2["Data — MongoDB"]
        H[("Users · Products · Orders<br/>Transactions · MixRequests<br/>ColorFormulas · StockMovements<br/>Notifications · AuthEvents · Settings")]
    end

    P -->|"fetch, session cookie"| D
    D --> E --> F --> G --> H
```

Presentation is vanilla HTML/CSS/ES modules — no framework, no build step.
Every protected page is served by a role-checked Express route rather than
sitting in the public folder, so access control never depends on the client.

## Data model

```mermaid
erDiagram
    USER ||--o{ ORDER : places
    USER ||--o{ MIXREQUEST : requests
    USER ||--o{ NOTIFICATION : receives
    USER ||--o{ STOCKMOVEMENT : performs
    USER ||--o{ PRODUCT : "owns custom mixes"

    PRODUCT ||--o{ STOCKMOVEMENT : "tracked by"
    PRODUCT ||--o{ ORDERITEM : "sold as"
    ORDER ||--|{ ORDERITEM : contains
    ORDER ||--o| TRANSACTION : "paid by"
    ORDER ||--|{ STATUSEVENT : "journey recorded in"

    MIXREQUEST }o--o| PRODUCT : "base paint"
    MIXREQUEST }o--o| COLORFORMULA : "recipe used"
    MIXREQUEST ||--o| PRODUCT : "published as (readyProduct)"

    USER {
        string email UK
        string password "bcrypt, select:false"
        string role "client|paint_mixer|cashier|admin"
        boolean isActive
        number sessionVersion "bumped on password change"
    }
    PRODUCT {
        string sku UK
        string category
        object color "name, hex"
        string finish
        number price
        object stock "quantity, lowStockThreshold"
        boolean isCustom "one-off mix"
        objectId customFor "its only buyer"
        boolean isActive
    }
    ORDER {
        string orderNumber UK
        string type "online|walk_in"
        string status
        array statusHistory
        object payment "method, proof, verifiedBy"
        number total
    }
    ORDERITEM {
        string name "snapshot"
        string sku "snapshot"
        number price "snapshot"
        number quantity
    }
    MIXREQUEST {
        string requestNumber UK
        object targetColor "hex, name"
        number quantity
        string status
        number unitPrice "agreed at completion"
        date addedToCartAt
    }
    TRANSACTION {
        string orderNumber
        number amount
        string method
    }
    NOTIFICATION {
        string type
        string title
        date readAt
        date createdAt "90-day TTL"
    }
```

Order items **snapshot** name, SKU and price. Editing the catalogue later
never rewrites what a customer was charged.

## How a custom mix becomes a purchase

The mixing workshop and the shop were originally separate: a `MixRequest`
had no price and no stock, and the order engine prices strictly from
catalogue products. Rather than teaching orders about mixes — which would
mean rewriting pricing, stock reservation, invoices and reports — completing
a mix *publishes* it as a product reserved for that one customer.

```mermaid
sequenceDiagram
    actor C as Customer
    participant S as Server
    actor M as Mixer

    C->>S: Request mix (colour, quantity)
    S-->>M: Notify: new mix queued
    M->>S: Complete (price optional)
    S->>S: Publish reserved Product<br/>stock = quantity, isCustom, customFor
    S-->>C: Email + in-app: your mix is ready
    C->>S: Any page load → GET /api/mixing/ready
    S-->>C: The finished mix
    Note over C: Merged into the cart, then acknowledged<br/>so removing it stays removed
    C->>S: Checkout (the ordinary path, untouched)
    S->>S: Stock hits zero → archive the one-off batch
```

## Rules the code holds to

| Rule | Where it lives |
|---|---|
| Stock only changes through one audited function | `inventory.service.adjustStock` |
| Order state only changes through one function | `order.service.transition` |
| Prices come from the catalogue, never the client | `order.service.priceItems` |
| A customer's data is scoped in the controller, and a miss is a 404 | every `loadOrderForUser`-style helper |
| Notifications and email can fail without breaking the flow | `notify.service`, `mail.service`, `audit.service` |
| Catalogue queries exclude other people's custom mixes | `isCustom: { $ne: true }` — pre-existing rows have no such field |

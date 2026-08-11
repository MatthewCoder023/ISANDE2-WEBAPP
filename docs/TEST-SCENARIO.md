# End-to-End Test Scenario — Customer to Administrator

A manual acceptance script that follows a single sale through every role that
touches it: a customer places it, a cashier verifies and fulfils it, a paint
mixer makes a custom shade for it, and an administrator sees it in the books
and restocks against it.

It is written to be run by hand, in a browser, in the order given. Steps
depend on the ones before them — TC-2.x cannot pass until TC-1.x has, because
the order it acts on does not exist yet.

Each case lists the role, what to do, and what the system should do in
return. Fill in **Actual result** and **Pass / Fail** as you go.

---

## 1. Preparation

### 1.1 Reset to a known state

```bash
npm run reset-demo
```

This wipes every collection, re-seeds the demo accounts, products,
suppliers and sample orders, and clears uploaded payment proofs. Run it
before the scenario so the numbers quoted below match what you see. It
refuses to run with `NODE_ENV=production`.

Then start the server:

```bash
npm run dev
```

Open `http://localhost:3000`.

### 1.2 Accounts

| Role | Email | Password |
|---|---|---|
| Customer | client@example.com | Client@1234 |
| Paint Mixer | mixer@flavorandcolor.com | Mixer@1234 |
| Cashier / Secretary | cashier@flavorandcolor.com | Cashier@1234 |
| System Administrator | admin@flavorandcolor.com | Admin@1234 |

The scenario registers a **new** customer rather than using the seeded one,
so that the first-run walkthrough and an empty order history can both be
observed. The seeded customer is used later, in TC-5.2, to check that a
customer only ever sees their own orders.

### 1.3 Before you start

- **Four roles, one browser.** Sign out between phases, or keep each role in
  its own browser profile / private window. Signing in as a second role in
  the same window replaces the session.
- **Have a screenshot ready.** TC-2.3 uploads a payment proof; any JPG or PNG
  under 5 MB will do. The server checks the file's actual bytes, not its
  extension, so a renamed `.txt` is expected to be rejected.
- **Email is optional.** With no SMTP configured, notification emails are
  written to the development outbox instead of being sent. In-app
  notifications (the bell) work either way.

### 1.4 How to read a result

A case passes only if the stated result is what actually happens. "The page
did not crash" is not a pass. Where a case says a value should be a specific
number, check the number.

---

## 2. Phase 1 — The customer places an order

**Role: Customer** · Sign in is not needed yet; start signed out at `/`.

### TC-1.1 · Self-registration creates a customer account

| | |
|---|---|
| **Steps** | From the landing page choose **Register**. Fill in first name, last name, email (`newbuyer@example.com`), phone, and a password of at least 8 characters containing at least one letter and one number. Submit. |
| **Expected** | The account is created and signed in immediately, landing on `/client` — the Customer Dashboard. The sidebar shows Dashboard, Browse Products, Color Studio, My Orders, My Profile. The role badge reads **Customer**. |
| **Also check** | `Password123` satisfies every length and character rule and is still refused — it is on the common-password blocklist, checked separately. An email already in use is refused with 409. |

> **Negative case:** attempting to register with `"role": "admin"` in the
> request body still produces a customer. Self-registration can never create
> staff — the role is fixed server-side.

### TC-1.2 · The first-run walkthrough appears

| | |
|---|---|
| **Steps** | Observe the dashboard immediately after TC-1.1. |
| **Expected** | A **Getting started** dialog opens by itself, five steps: welcome, finding paint, Color Studio, checking out, following the order. **Next** and **Back** move between steps; the dots show position; the last step's button reads **Start browsing**. |
| **Then** | Press **Escape** to dismiss it, and reload `/client`. The walkthrough does **not** reappear — dismissing counts as seen. **How ordering works**, under the greeting, reopens it on demand. |
| **Also check** | Sign in as any staff role: no walkthrough appears anywhere. It belongs to the customer module only. |

### TC-1.3 · Browsing the catalogue

| | |
|---|---|
| **Steps** | Go to **Browse Products**. Filter by category and by finish; search for a paint by name. |
| **Expected** | Each product shows its real colour as a swatch, its finish and can size, and its price. Stock is shown only as availability wording (in stock / low / out of stock) — **never a number**. Out-of-stock paints cannot be added to the cart. |

> **Why it matters:** exact stock counts are staff information. A customer
> receiving `stock.quantity` would be a data-scoping defect even though
> nothing visibly breaks.

### TC-1.4 · Cart and checkout

| | |
|---|---|
| **Steps** | Add two different paints, one of them twice. Open the cart, then **Checkout**. |
| **Expected** | The cart merges the duplicate into a single line of quantity 2. The checkout summary lists each line, its unit price and line total, and a grand total that matches. |
| **Steps (cont.)** | Choose **GCash**, add a note (`Pickup Saturday morning`), and **Place Order**. |
| **Expected** | An order number in the form `ORD-YYYYMMDD-NNNN` is issued, and you land on the order screen (`/client/track?order=…`) with status **Pending payment**, the shop's GCash details, and an upload area for the receipt. |

> **Record the order number here — every phase below refers to it.**
> `ORD-________________`

### TC-1.5 · Prices come from the server, not the browser

| | |
|---|---|
| **Steps** | Before placing an order, edit a price in the page (developer tools) or post an order with a `price` field of your own. |
| **Expected** | The order total is unchanged. Only `productId` and `quantity` are read from the request; every price is looked up server-side at the moment the order is created. |

---

## 3. Phase 2 — The cashier verifies and fulfils

### TC-2.1 · Stock was reserved when the order was placed

| | |
|---|---|
| **Role** | Administrator — **Products & Inventory** is admin-only, so this one check is done from that account |
| **Steps** | Note one ordered paint's stock in **Products & Inventory** before and after TC-1.4. |
| **Expected** | Stock has already dropped by the ordered quantity. Placing the order reserves it; payment does not move stock a second time. |

### TC-2.2 · The customer uploads proof of payment

| | |
|---|---|
| **Role** | Customer |
| **Steps** | On the order screen, upload the image from §1.3 and submit. |
| **Expected** | Status becomes **Pending verification**. The timeline gains an entry. |
| **Negative** | Rename a `.txt` file to `.jpg` and upload it: rejected. The server reads the file's magic bytes, so the extension is not evidence of anything. |

### TC-2.3 · The cashier reviews the payment

| | |
|---|---|
| **Role** | Cashier |
| **Steps** | Sign in as the cashier. The Sales Desk shows **Awaiting Verification: 1**. Click that tile, or open **Orders** and filter to `pending_verification`. Open the order and choose **Review Payment**. |
| **Expected** | The uploaded proof is displayed. **Verify Payment** moves the order to **Payment verified** and records a transaction. **Reject** requires a reason and sends the order back to **Pending payment**. |
| **Then** | Verify it. |

### TC-2.4 · Fulfilment moves in one direction only

| | |
|---|---|
| **Role** | Cashier |
| **Steps** | On the same order use **Start Preparing**, then **Mark Ready**, then **Complete**. |
| **Expected** | Status walks `payment_verified → preparing → ready → completed`, each step stamped in the timeline with who did it and when. Skipping a step — asking to mark a `payment_verified` order as `completed` directly — is refused. |

### TC-2.5 · The customer sees the same journey

| | |
|---|---|
| **Role** | Customer |
| **Steps** | Sign back in as `newbuyer@example.com` and open **My Orders**, then the order. |
| **Expected** | The timeline shows the same steps in the same order, ending at Completed. The sales invoice is available as a PDF and its totals match the order. The bell shows notifications for the payment being verified and the order being ready. |

### TC-2.6 · The invoice can be told apart from an edited copy

| | |
|---|---|
| **Steps** | Open the invoice PDF and find its verification code. Visit `/api/orders/verify?code=…`. |
| **Expected** | The endpoint reports the order's recorded totals, which match the printed document. An invented code returns no match. |

---

## 4. Phase 3 — A custom colour, through the mixer

This phase is the second thread through the same system: a colour that is not
on the shelves.

### TC-3.1 · The customer requests a custom mix

| | |
|---|---|
| **Role** | Customer |
| **Steps** | Open **Color Studio**. Pick a colour on the wheel, or upload a photo and take a colour from its palette. Review **Closest paints on our shelves**, then choose **Request a Custom Mix** — give it a name, a base paint (or leave it to the mixer), and 1 can. Submit. |
| **Expected** | A request number `MIX-…` is issued with status **Queued**, listed under **My mix requests**. The dashboard's **Active Custom Mixes** count goes up. |

### TC-3.2 · The mixer works the queue

| | |
|---|---|
| **Role** | Paint Mixer |
| **Steps** | Sign in as the mixer. The Mixing Station shows the request in **Queued Mixes**. Open **Mixing Queue** → **Start Mixing**. |
| **Expected** | Status becomes **Mixing** and the request appears on the bench. |
| **Steps (cont.)** | Choose **Complete Mix**. Attach an existing formula or record a new one (name, colour, components with quantities and units), and set the price. |
| **Expected** | Status becomes **Completed**, the request appears in the **Production Log**, and a saved formula's `timesUsed` increases if you reused one. |

### TC-3.3 · The finished paint reaches the customer, and nobody else

| | |
|---|---|
| **Role** | Customer |
| **Steps** | Sign back in as the customer and open the dashboard, then **Browse Products**. |
| **Expected** | A notification says the mix is ready, and the finished paint is waiting **in the cart** with the price the mixer set. |
| **Critical check** | Sign in as a *different* customer (`client@example.com`) and search the catalogue for that paint. It must not appear. A published custom mix belongs to the customer who ordered it. |

### TC-3.4 · Buying the mix, paying at the counter

| | |
|---|---|
| **Role** | Customer |
| **Steps** | Check out the cart containing the custom paint, this time choosing **Cash on Pickup**. |
| **Expected** | The order is created and moves straight to preparing without a proof upload — there is nothing to verify yet. |
| **Then (Cashier)** | Open the order, **Mark Ready**, then **Complete** and take payment, recording the method. A transaction is written at that point. |

---

## 5. Phase 4 — The administrator: books, stock, and people

### TC-4.1 · The sale shows up in the numbers

| | |
|---|---|
| **Role** | Administrator |
| **Steps** | Sign in as the admin and read the Admin Console. |
| **Expected** | **Revenue This Month** and **Total Orders** include the orders from Phases 2 and 3. **Revenue this week** shows a bar for today. The **Order pipeline** panel agrees with the tiles above it — both are read from one payload, so a disagreement is a defect. |

### TC-4.2 · Transactions and the shared receipt

| | |
|---|---|
| **Steps** | Open **Transactions**. Find the transaction for the Phase 2 order and open its **Receipt**. |
| **Expected** | A receipt PDF with a receipt number, the line items, and the total. |
| **Critical check** | Sign in as the **cashier**, open the same transaction's receipt, and compare. It must be the *same document* — same receipt number, same totals, same bytes — not a second version rendered per role. |

### TC-4.3 · Reports

| | |
|---|---|
| **Steps** | Open **Reports**. Set a date range covering today. Read the sales chart, the top products, and the payment-method breakdown. Export the report. |
| **Expected** | The totals agree with the transactions list for the same range. Top products include the paints bought in Phase 2. |

### TC-4.4 · Restocking through a purchase order

| | |
|---|---|
| **Steps** | Open **Products & Inventory** and note a paint whose stock is low after Phase 2. Open **Purchase Orders** → **New Purchase Order**. Pick a supplier, add that paint with quantity 10 and a unit cost, and save. |
| **Expected** | A PO number is issued with status **Draft**. **Stock has not changed** — raising a purchase order moves no stock. |
| **Steps (cont.)** | **Mark as Ordered**. Confirm stock is still unchanged. Then **Receive**, entering an *actual received quantity of 7* for a line ordered as 10. |
| **Expected** | Stock rises by **7, not 10**. The stock movement is recorded as a restock naming the PO and supplier. The PO shows both figures, ordered and received. |

> **This is the invariant to watch.** Stock follows what physically arrived,
> never what was requested. If receiving 7 of 10 adds 10, the test fails even
> though nothing errors.

### TC-4.5 · Incoming stock is visible to the counter, costs are not

| | |
|---|---|
| **Steps** | Raise a second PO and mark it as ordered, leaving it unreceived. Check the **Incoming stock** panel on the Admin Console — it links to the purchase orders page. |
| **Expected** | The paint appears with the quantity on order and its expected date. |
| **Critical check** | Sign in as the **cashier** and read the same **Incoming stock** panel on the Sales Desk. The quantities and dates are there; the rows are **not links** (there is no cashier purchase-order screen); and no unit cost, line total or order total appears anywhere in the panel or in the response behind it. Requesting `/api/purchase-orders` directly as the cashier returns **403**. |

### TC-4.6 · User management and the audit trail

| | |
|---|---|
| **Steps** | Open **Users & Roles**. Create a new cashier account. Change a user's role. Deactivate an account, then restore it. |
| **Expected** | Each action succeeds, and email is immutable — it is the login identity. A deactivated user cannot sign in; a restored one can. The **Security log** below the table records the sign-ins, failures and account changes from this scenario. |

### TC-4.7 · Settings reach the customer-facing pages

| | |
|---|---|
| **Steps** | Open **Settings** and change the shop name and the GCash account details. |
| **Expected** | The new GCash details appear on a customer's payment screen, and the new shop name appears on the next generated invoice or receipt PDF. |

---

## 6. Phase 5 — Access control (negative cases)

These are the cases most likely to pass by accident in a demo and fail in
review. Run them signed in as the role named — not signed out.

| ID | Signed in as | Attempt | Expected |
|---|---|---|---|
| TC-5.1 | Customer | Open `/admin`, `/cashier`, `/pos`, `/mixing` by typing the URL | Refused by the server, not merely hidden in the menu |
| TC-5.2 | Customer | Open another customer's order via `/client/track?order=<their id>` | **404**, not 403 — a customer is not told that someone else's order exists |
| TC-5.3 | Cashier | Open `/admin/products`, `/admin/purchase-orders`, `/admin/users` | Refused |
| TC-5.4 | Cashier | `GET /api/purchase-orders` | **403** — supplier costs are admin-only |
| TC-5.5 | Paint Mixer | Open `/pos`, `/transactions` | Refused |
| TC-5.6 | Any staff | `POST /api/auth/client-tour/complete` | **403** — the walkthrough belongs to the customer module |
| TC-5.7 | Signed out | Open any dashboard URL | Redirected to sign-in, and the Back button does not return to a signed-in page |

---

## 7. Results

| ID | Case | Actual result | Pass / Fail |
|---|---|---|---|
| TC-1.1 | Registration creates a customer | | |
| TC-1.2 | Walkthrough appears once | | |
| TC-1.3 | Catalogue hides stock counts | | |
| TC-1.4 | Cart, checkout, order number | | |
| TC-1.5 | Prices set server-side | | |
| TC-2.1 | Stock reserved on placement | | |
| TC-2.2 | Proof upload and file-type check | | |
| TC-2.3 | Payment verified / rejected | | |
| TC-2.4 | Status moves one step at a time | | |
| TC-2.5 | Customer sees the same timeline | | |
| TC-2.6 | Invoice verification code | | |
| TC-3.1 | Custom mix requested | | |
| TC-3.2 | Mixer completes and prices it | | |
| TC-3.3 | Mix reaches only its owner | | |
| TC-3.4 | Cash-on-pickup order | | |
| TC-4.1 | Dashboard figures include the sales | | |
| TC-4.2 | One receipt, both roles | | |
| TC-4.3 | Reports agree with transactions | | |
| TC-4.4 | Receiving books the delivered quantity | | |
| TC-4.5 | Incoming stock without costs | | |
| TC-4.6 | User management and audit log | | |
| TC-4.7 | Settings reach customer pages | | |
| TC-5.1 – TC-5.7 | Access control | | |

**Tester:** ______________  **Date:** ____________  **Build / commit:**
____________

---

## 8. Notes

- **Automated coverage.** `npm test` runs the same invariants as integration
  tests — stock movement, order transitions, server-side pricing, custom-mix
  scoping, receipt identity, and the role gates in Phase 5. This document is
  the human-facing counterpart, not a replacement: it checks the parts a test
  suite cannot see, such as whether the walkthrough reads clearly or the
  timeline is legible.
- **Re-running.** `npm run reset-demo` returns the database to §1.1. Order,
  mix, PO and receipt numbers are issued in sequence, so they will differ on
  each run — record the ones you get rather than expecting the numbers above.

# Next.js + Capacitor + shadcn/ui + Tailwind — Offline‑First Personal Finance App (Monorepo)

**Status:** Draft v1 • **Owner:** You • **Last updated:** 2025‑09‑04 • **Scope:** Mobile (iOS/Android) + Web PWA • **Stack:** Next.js (App Router), Capacitor, TailwindCSS, shadcn/ui, TypeScript, pnpm/Turborepo

---

## 1) Executive Summary

We will build a **personal finance management** application that runs as a **mobile-first, offline-first** app packaged with **Capacitor** and as a secondary **Web PWA**. The **mobile app must run 100% without internet** and cannot rely on SSR at all. We will ship the UI as a **static export** (SPA) from Next.js, which Capacitor serves from the device. All reads/writes hit a **local SQLite** database first; a background **sync** process reconciles with the server when online. The **server** is the source of truth for **conflict resolution and policy enforcement**.

**Key choices:**

* **Next.js (App Router)** used **only as a static SPA** via `next export` (no SSR/ISR). Capacitor serves the exported files.
* **Capacitor** for native wrappers/plugins (Network, Background Task, Filesystem, Secure Storage, SQLite).
* **Local-first data**: **SQLite on mobile** (authoritative for the client), **IndexedDB on web** (secondary). A single repository API hides the engine.
* **Sync engine (outbox)** with server-authoritative merges; client applies server decisions.
* **UI stack locked** to **shadcn/ui + Tailwind** exclusively to avoid incompatibilities in mobile packaging.

---

## 2) Goals & Non‑Goals

### Goals

* **Strict offline-first mobile**: zero SSR/ISR; app must fully function offline on device.
* **Local-first writes**: every mutation writes to **SQLite first**; sync later.
* **Server-owned conflict resolution**: server applies policies and returns authoritative state.
* **Monorepo DX**: shared packages; single lint/build/test pipeline.
* **Capacitor Mobile**: identical SPA UI across iOS/Android; native capabilities as needed.
* **Design System**: **shadcn/ui + Tailwind only**; shared theme/tokens in monorepo.
* **Security**: secure storage for secrets; optional DB encryption.
* **Importers**: pluggable sources (CSV/email/bank exports) via shared adapters.

### Non‑Goals (initial phase)

* Any runtime that requires server rendering or network to boot.
* Introducing additional UI libraries beyond shadcn/ui + Tailwind.
* Complex CRDT multi-master semantics (server LWW/policy-based merge is sufficient for MVP).

---

## 3) High‑Level Architecture

```
apps/
  api/           # NestJS server (sync, Prisma/Postgres)
  app/           # (optional web client shell)
  mobile/        # Capacitor project (Android/iOS) consuming ../web/out
  web/           # Next.js SPA (exported) for Web PWA and used by Capacitor
packages/
  ui/            # shadcn/ui component library (Tailwind)
  shared/        # types, zod schemas, constants, domain logic
  data/          # storage & sync abstractions (repositories, outbox)
  api-client/    # centralized API client (shared API calls + generated types)
  db/            # prisma schema & client (for server)
  config/        # tsconfig, eslint, tailwind presets, jest configs
  workers/       # service worker (web PWA), background sync helpers
```

**Data flow**

1. UI always reads/writes from **LocalDB (SQLite on mobile, IndexedDB on web)** via repository APIs.
2. Mutations enqueue **Outbox** entries; the **Sync Engine** pushes to `/sync` when online.
3. **Server** persists, **resolves conflicts/policies**, and returns authoritative deltas since `checkpoint`.
4. Client **applies server decisions** to LocalDB and advances `checkpoint` per collection.

---

## 4) Monorepo Setup (pnpm + Turborepo)

* **Package manager:** `pnpm` (fast, disk‑efficient).
* **Build orchestration:** `turbo` (caching, parallelization).
* **Repo scripts**

  * `pnpm dev` → runs `apps/web` dev, watches shared packages.
  * `pnpm build` → builds shared, then web export, then `cap copy`.
  * `pnpm lint`, `pnpm test`.

**tsconfig paths** (in repo root): map `@acme/*` to `packages/*/src`.

**Tailwind preset** in `packages/config/tailwind-preset.ts`; each app uses `presets: [preset]`.

---

## 5) Next.js App (apps/web)

**Mode:** App Router used strictly as a **static SPA**. **No SSR/ISR**. All pages/components are exportable. Data is loaded from LocalDB at runtime.

* **Routing:** App Router with nested layouts; pages are client components that hydrate from LocalDB.
* **Build:** `next build && next export` → `apps/web/out/` consumed by Capacitor.
* **PWA (web only):** service worker in `packages/workers` for caching static assets and offline use on desktop/web.
* **UI:** **shadcn/ui + Tailwind exclusively** from `@acme/ui`. Avoid additional UI libs to prevent mobile packaging issues.
* **State:** Light React context for session/settings; data via repositories (no server fetch at render time).

> ❗ **Hard constraint**: No server rendering anywhere. The SPA must boot and be fully useable with the device offline.

---

## 6) Capacitor App (apps/mobile)

* **Plugins:** Network (for status), Device, Filesystem, Preferences/Secure Storage, **SQLite**, Background Task.
* **config**: `webDir` → `../web/out` (exported SPA). No in-app network dependency to start.
* **Build pipeline**: export web → `cap copy` → `cap sync` → native builds.
* **Offline boot**: App must launch and operate entirely from local assets and SQLite.

---

## 7) Shared Packages

### `@acme/shared`

* **Types:** domain entities (Account, Transaction, Category, Budget, etc.).
* **Zod Schemas:** validation for inputs, API payloads, importer formats.
* **Constants:** currencies, locales, category enums, recurrence rules.
* **Utilities:** money math, date helpers, ULID generation.

### `@acme/ui`

* **shadcn/ui** components pre‑styled for finance app.
* **Design tokens** via Tailwind preset (`@acme/config`).
* **Patterns:** Page shells, data tables, dialogs/wizards, form primitives bound to Zod.

### `@acme/data`

* **Storage abstraction** (SQLite on mobile, IndexedDB on web).
* **Repositories** for Accounts, Transactions, Budgets, Rules.
* **Sync Engine** (outbox, checkpoints).
* **Importers API**: CSV/OFX, email parsers, bank exports.

### `@acme/api-client`

* **Centralized API client** for all network calls.
* **Shared types**: re-export domain types from server (via OpenAPI/Prisma types or codegen).
* **Usage**: all clients (mobile/web) import API calls from here, avoiding duplication.

### `@acme/config`

* Tailwind preset, ESLint config, tsconfig base, Jest/Vitest config.

### `@acme/workers`

* **Service Worker** (web PWA).
* Background sync helpers.

---

## 8) Domain Model (MVP)

**Core entities:**

* **Account**: id, name, type, currency, institution, balanceComputed.
* **Transaction**: id, accountId, date, amount, type (INCOME/EXPENSE/TRANSFER), categoryId, payee, notes, attachments\[], status, `createdAt/updatedAt/deletedAt`, `version`.
* **Category**: id, name, parentId?, icon, color.
* **Budget**: id, period, allocations, rollovers.
* **Rule**: id, matchers, actions.
* **UserSettings**: currency, locale, privacy flags.

---

## 9) Offline‑First Storage & Sync

### Storage Engine Interface

```ts
export interface StorageEngine {
  init(): Promise<void>
  tx<T>(fn: (db: DB) => Promise<T>): Promise<T>
  changesSince(collection: string, checkpoint: string | null): Promise<Change[]>
  applyChanges(changes: Change[]): Promise<void>
  getOutbox(): Promise<Change[]>
  applyAcks(acks: Ack[]): Promise<void>
  getCheckpoints(): Promise<Record<string,string|null>>
  setCheckpoints(cps: Record<string,string|null>): Promise<void>
}
```

### Outbox Pattern (Client)

* Every mutation writes to the local collection **and** appends an **Outbox** item.
* Sync worker sends outbox + checkpoints to `/sync`.

### Conflict & Policy Handling (Server‑authoritative)

* The **server** resolves conflicts and applies domain policies.
* Client applies server's returned authoritative changes.

---

## 10) Backend (apps/api)

* **Framework:** NestJS + Prisma + Postgres.
* **Auth:** short‑lived tokens; device registration by `clientId`.
* **/sync** endpoint: server receives checkpoints + outbox, returns authoritative changes.
* **Conflict/Policy resolution**: server applies policies, client applies blindly.
* **Webhooks/importers**: write to server; clients receive on next sync.

---

## 11) UI/UX & Design System

* **UI stack (strict):** **shadcn/ui + Tailwind only**.
* **Mobile‑first**: design for small screens and offline usage.
* **Components**: transaction list, editing drawer, category picker, budget progress, month switcher.
* **Theming**: Tailwind preset tokens; dark/light.
* **Accessibility**: Radix primitives; focus management.
* **i18n/currency**: centralized in `@acme/shared`.

---

## 17) MVP Scope — Screens, Navigation & Features

### Bottom Navigation (mobile‑first)

* **Left tab — Transactions**

  * Infinite/virtualized list of **all transactions (income, expenses, transfers/investments)** ordered by date (desc by default).
  * **Filters**: type (income/expense/transfer/investment), account, category, cleared/pending.
  * **Sort**: date (asc/desc), amount (asc/desc).
  * **Quick actions**: tap to view/edit, swipe to delete/duplicate (local‑first; queued to outbox).
* **Right tab — Insights**

  * **Cards** with basic cash‑flow stats: total income, total expenses, net, average per day, top categories.
  * **Date range** picker (start/end) driving all cards (defaults to current month, cached locally).
* **Center FAB (+)**

  * Prominent **floating action button** centered in the bottom bar.
  * Quick add **Income / Expense / Investment** via a sheet/modal.
  * Minimal required fields: amount, date (default today), account, category, optional notes.
  * Saves **locally to SQLite** and enqueues an outbox mutation for later sync.

### Offline‑First Behavior

* App boots offline; all features above operate from SQLite.
* Sync runs opportunistically on resume/online; conflict resolution is server‑side.

### MVP Feature Checklist

* [ ] Bottom navigation with **Transactions** (left) and **Insights** (right) + **center FAB (+)**
* [ ] Transactions list with filters & sorting (local‑first)
* [ ] Quick add sheet for Income/Expense/Investment (local‑first write)
* [ ] Insights cards (cash‑flow) with start/end date range
* [ ] Outbox + Sync (server‑resolved)
* [ ] Service worker + PWA (web only)
* [ ] Capacitor builds (Android + iOS)

---

## 18) Risks & Mitigations

| Risk                            | Impact                     | Mitigation                                                     |
| ------------------------------- | -------------------------- | -------------------------------------------------------------- |
| Accidental SSR usage            | Mobile won't boot offline  | Enforce export‑only builds; lint rule forbidding SSR APIs      |
| Additional UI libs creep in     | Packaging issues           | Enforce shadcn/ui + Tailwind only via lint/code review         |
| SQLite encryption variability   | Sensitive data at rest     | Encrypt blobs, require biometrics/passcode, evaluate SQLCipher |
| Background sync limits          | Data stale until app opens | Trigger on open/resume/online; manual "Sync now"               |
| Large outbox after long offline | Long first sync            | Chunked sync and progress UI                                   |

---
# Capital

**Financial Management for International Service Providers**

Capital is a comprehensive financial management application designed for freelancers and contractors who provide services to clients in other countries. It enables users to track money flow between their business entities and personal finances, supporting multiple currencies and profit distribution.

---

## Table of Contents

- [Overview](#overview)
- [Core Concepts](#core-concepts)
- [Data Model](#data-model)
- [Feature Roadmap](#feature-roadmap)
- [Technical Stack](#technical-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Development Phases](#development-phases)

---

## Overview

### Problem Statement

Freelancers and contractors working internationally face unique financial challenges:

1. **Multiple Income Streams** - Income from various clients in different currencies
2. **Business vs Personal Separation** - Need to track business finances separately from personal
3. **Profit Distribution** - Moving money from business to personal accounts
4. **Multi-Currency Management** - Dealing with exchange rates and currency conversions
5. **Investment Tracking** - Managing investments across both business and personal entities

### Solution

Capital provides a unified platform to:

- Manage multiple business entities
- Track income, expenses, and investments for each entity
- Record transfers between business and personal accounts
- Handle multiple currencies with manual exchange rates
- Visualize capital flow and financial health

---

## Core Concepts

### Entity Types

| Entity | Description |
|--------|-------------|
| **Business** | A company or entity that receives income from clients and incurs expenses. Users can have multiple businesses. |
| **Personal Account** | The user's personal finances. Each user has exactly one personal account. |

### Transaction Types

| Type | Description | Example |
|------|-------------|---------|
| **Income** | Money received | Invoice payment, salary, dividends |
| **Expense** | Money spent | Software subscriptions, taxes, equipment |
| **Investment** | Money allocated to assets | Stocks, crypto, real estate, savings |

### Transfer Types

| Direction | Description | Example |
|-----------|-------------|---------|
| **Profit Distribution** | Business → Personal | Taking profit from your company |
| **Capital Injection** | Personal → Business | Investing in your own company |

### Money Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        BUSINESS ENTITIES                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  Business 1  │  │  Business 2  │  │  Business N  │           │
│  │              │  │              │  │              │           │
│  │  + Income    │  │  + Income    │  │  + Income    │           │
│  │  - Expenses  │  │  - Expenses  │  - Expenses    │           │
│  │  → Invest    │  │  → Invest    │  │  → Invest    │           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
│         │                 │                 │                    │
│         └────────────┬────┴────────────────┘                    │
│                      │                                           │
│              Profit Distribution                                 │
│                      ▼                                           │
└─────────────────────────────────────────────────────────────────┘
                       │
                       │ ◄─── Capital Injection
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PERSONAL ACCOUNT                            │
│                                                                  │
│                      + Income (salary, etc.)                     │
│                      - Expenses (living costs)                   │
│                      → Investments (personal portfolio)          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────────┐       ┌─────────────┐
│    User     │───────│    Business     │───────│ Transaction │
│             │ 1   N │                 │ 1   N │             │
│  - id       │       │  - id           │       │  - id       │
│  - name     │       │  - userId       │       │  - entityId │
│  - email    │       │  - name         │       │  - type     │
│  - baseCurr │       │  - description  │       │  - amount   │
└──────┬──────┘       │  - defaultCurr  │       │  - currency │
       │              │  - createdAt    │       │  - exchRate │
       │              └─────────────────┘       │  - desc     │
       │                                        │  - category │
       │ 1                                      │  - date     │
       │                                        └─────────────┘
       │                                               ▲
       │ 1                                             │
┌──────┴──────┐                                        │
│  Personal   │────────────────────────────────────────┘
│  Account    │ 1                                    N
│             │
│  - id       │       ┌─────────────────┐
│  - userId   │───────│    Transfer     │
│  - defCurr  │ 1   N │                 │
└─────────────┘       │  - id           │
                      │  - fromEntityId │
                      │  - toEntityId   │
                      │  - direction    │
                      │  - amount       │
                      │  - currency     │
                      │  - description  │
                      │  - date         │
                      └─────────────────┘
```

### TypeScript Types

```typescript
// Entity Types
type EntityType = 'business' | 'personal';

// Transaction Types
type TransactionType = 'income' | 'expense' | 'investment';

// Transfer Direction
type TransferDirection = 'profit_distribution' | 'capital_injection';

// Core Entities
interface User {
  id: string;
  name: string;
  email: string;
  baseCurrency: string;
  createdAt: Date;
}

interface Business {
  id: string;
  userId: string;
  name: string;
  description?: string;
  defaultCurrency: string;
  createdAt: Date;
  updatedAt: Date;
}

interface PersonalAccount {
  id: string;
  userId: string;
  defaultCurrency: string;
  createdAt: Date;
}

interface Transaction {
  id: string;
  entityId: string;
  entityType: EntityType;
  type: TransactionType;
  amount: number;
  currency: string;
  exchangeRate: number; // Rate to base currency
  description: string;
  category: string;
  date: Date;
  createdAt: Date;
}

interface Transfer {
  id: string;
  fromEntityId: string;
  fromEntityType: EntityType;
  toEntityId: string;
  toEntityType: EntityType;
  direction: TransferDirection;
  amount: number;
  currency: string;
  description?: string;
  date: Date;
  createdAt: Date;
}

interface Currency {
  code: string;
  name: string;
  symbol: string;
  manualRate: number; // Rate relative to base currency
}
```

---

## Feature Roadmap

### Phase 1 - Foundation (MVP)

**Goal:** Basic functionality with local storage persistence

- [ ] User setup (name, base currency)
- [ ] Business management (create, edit, delete)
- [ ] Personal account setup
- [ ] Transaction entry (income, expense)
- [ ] Dashboard with summary cards
- [ ] Local storage persistence

### Phase 2 - Core Features

**Goal:** Full transaction management and multi-currency support

- [ ] Multi-currency support with manual exchange rates
- [ ] Investment tracking
- [ ] Transfers between business and personal
- [ ] Category management
- [ ] Monthly/yearly reports
- [ ] Data export (CSV)

### Phase 3 - Visualizations

**Goal:** Rich data visualization and insights

- [ ] Balance over time charts
- [ ] Income vs expenses breakdown
- [ ] Cash flow visualization
- [ ] Entity comparison charts
- [ ] Currency distribution pie charts

### Phase 4 - Advanced Features

**Goal:** Power user features and integrations

- [ ] Recurring transactions
- [ ] Budget planning
- [ ] Tax calculation helpers
- [ ] Data sync with backend API
- [ ] Multi-device sync

---

## Technical Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Framework** | Next.js 16 (App Router) | React framework with server components |
| **UI Components** | shadcn/ui | Accessible, customizable components |
| **Styling** | Tailwind CSS | Utility-first CSS framework |
| **State Management** | Zustand | Lightweight state management |
| **Data Persistence** | Local Storage | Client-side persistence (Phase 1) |
| **Forms** | React Hook Form + Zod | Form handling and validation |
| **Charts** | Recharts | Data visualization |
| **Icons** | Lucide React | Icon library |
| **Date Handling** | date-fns | Date utilities |
| **Internationalization** | next-intl | Multi-language support (PT-BR, EN) |

---

## Project Structure

```
apps/capital/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── layout.tsx          # Root layout
│   │   └── [locale]/           # Locale-based routing (pt-BR, en)
│   │       ├── layout.tsx      # Locale layout with i18n provider
│   │       ├── page.tsx        # Home page
│   │       ├── dashboard/      # Dashboard
│   │       ├── businesses/     # Business management
│   │       │   └── [id]/       # Single business
│   │       ├── personal/       # Personal account
│   │       ├── transfers/      # Transfer management
│   │       └── settings/       # App settings
│   │
│   ├── i18n/                   # Internationalization config
│   │   ├── routing.ts          # Locale routing setup
│   │   ├── request.ts          # Server-side i18n config
│   │   └── navigation.ts       # Localized navigation helpers
│   │
│   ├── messages/               # Translation files
│   │   ├── en.json             # English translations
│   │   └── pt-BR.json          # Portuguese (BR) translations
│   │
│   ├── middleware.ts           # Locale detection middleware
│   │
│   ├── components/
│   │   ├── ui/                 # shadcn/ui components
│   │   ├── layout/             # Layout components
│   │   │   ├── sidebar.tsx
│   │   │   ├── header.tsx
│   │   │   └── nav.tsx
│   │   ├── forms/              # Form components
│   │   │   ├── transaction-form.tsx
│   │   │   ├── business-form.tsx
│   │   │   └── transfer-form.tsx
│   │   ├── tables/             # Table components
│   │   │   └── transactions-table.tsx
│   │   ├── cards/              # Card components
│   │   │   ├── summary-card.tsx
│   │   │   └── business-card.tsx
│   │   └── charts/             # Chart components
│   │       ├── balance-chart.tsx
│   │       └── breakdown-chart.tsx
│   │
│   ├── lib/
│   │   ├── store/              # Zustand stores
│   │   │   ├── business-store.ts
│   │   │   ├── transaction-store.ts
│   │   │   ├── transfer-store.ts
│   │   │   └── settings-store.ts
│   │   ├── utils/              # Utility functions
│   │   │   ├── currency.ts
│   │   │   ├── calculations.ts
│   │   │   └── format.ts
│   │   └── validations/        # Zod schemas
│   │       ├── transaction.ts
│   │       ├── business.ts
│   │       └── transfer.ts
│   │
│   └── types/                  # TypeScript types
│       └── index.ts
│
├── public/                     # Static assets
├── package.json
├── tailwind.config.ts
├── next.config.ts
└── README.md
```

---

## Getting Started

### Prerequisites

- Node.js 24+
- pnpm 9+

### Installation

```bash
# From the monorepo root
pnpm install

# Copy env template and start local Postgres
cp apps/capital/.env.example apps/capital/.env
pnpm setup:local

# Run the capital app
pnpm --filter @wallex/capital dev
```

### Development

```bash
# Run development server
pnpm dev

# Build for production
pnpm build

# Run linting
pnpm lint
```

---

## Development Phases

### Phase 0: Documentation + Project Setup ✅

- [x] Create Next.js app with TypeScript
- [x] Configure Tailwind CSS
- [x] Initialize shadcn/ui
- [x] Install core dependencies (Zustand, Recharts, etc.)
- [x] Create comprehensive documentation
- [x] Define TypeScript types
- [x] Set up project structure
- [x] Internationalization (i18n) with next-intl
  - [x] Portuguese (BR) as default language
  - [x] English support
  - [x] Language switcher component
  - [x] All pages translated

### Phase 1: Foundation (MVP)

**Estimated Duration:** 1-2 weeks

1. **Layout & Navigation**
   - Create app shell with sidebar navigation
   - Implement responsive layout
   - Add dark/light mode toggle

2. **State Management**
   - Implement Zustand stores
   - Add localStorage persistence
   - Create initial data seeding

3. **Dashboard**
   - Summary cards (total capital, income, expenses)
   - Recent transactions list
   - Quick actions

4. **Business Management**
   - Business list view
   - Create/edit business form
   - Business detail page

5. **Transaction Management**
   - Transaction form (income/expense)
   - Transactions table with filtering
   - Category selection

### Phase 2: Core Features

**Estimated Duration:** 2-3 weeks

1. **Multi-Currency**
   - Currency settings page
   - Manual exchange rate input
   - Currency conversion in transactions

2. **Investments**
   - Investment transaction type
   - Investment portfolio view
   - Asset categorization

3. **Transfers**
   - Transfer form
   - Transfer history
   - Impact on entity balances

4. **Reports**
   - Monthly summary
   - Yearly overview
   - CSV export

### Phase 3: Visualizations

**Estimated Duration:** 1-2 weeks

1. **Charts**
   - Balance over time (line chart)
   - Income vs expenses (bar chart)
   - Category breakdown (pie chart)

2. **Insights**
   - Spending trends
   - Income sources analysis
   - Entity comparison

---

## UI Design Guidelines

### Color Palette

The app uses a professional, finance-oriented color scheme:

- **Primary:** Slate/Zinc tones for a clean, professional look
- **Success:** Green for income and positive values
- **Danger:** Red for expenses and negative values
- **Accent:** Blue for investments and neutral actions

### Component Patterns

1. **Cards** - Used for summaries and entity displays
2. **Tables** - Used for transaction lists with sorting/filtering
3. **Forms** - Modal-based for quick entry, page-based for complex forms
4. **Charts** - Minimal, focused on key metrics

### Responsive Design

- **Desktop:** Full sidebar navigation, multi-column layouts
- **Tablet:** Collapsible sidebar, adjusted grid layouts
- **Mobile:** Bottom navigation, single-column layouts

---

## Contributing

This app is part of the Wallex monorepo. Please follow the monorepo contribution guidelines.

---

## License

Private - All rights reserved.

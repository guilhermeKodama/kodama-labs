# Wallex Mobile App

A personal finance mobile application built with Next.js, Capacitor, and shadcn/ui.

## Features

- **Offline-first architecture** - Works without internet connection
- **Mobile-optimized UI** - Built with mobile-first design principles
- **Bottom Navigation** - Easy access to Transactions, FAB, and Insights
- **Static Export** - No server-side rendering for optimal mobile performance

## Tech Stack

- **Next.js 14** - React framework with App Router
- **Capacitor 5** - Cross-platform mobile app development
- **shadcn/ui** - Modern UI component library
- **Tailwind CSS** - Utility-first CSS framework
- **TypeScript** - Type-safe development
- **Lucide React** - Beautiful icons

## Development

### Prerequisites

- Node.js 20+ (required by monorepo)
- Yarn package manager
- Xcode (for iOS development)
- CocoaPods (for iOS dependencies)

### Getting Started

1. Install dependencies:
   ```bash
   yarn install --ignore-engines
   ```

2. Start development server:
   ```bash
   yarn dev
   ```

3. Build for production:
   ```bash
   yarn build
   ```

### iOS Development

1. Build and sync with iOS:
   ```bash
   yarn ios:build
   ```

2. Open in Xcode:
   ```bash
   yarn ios:open
   ```

3. Sync changes to iOS (after code changes):
   ```bash
   yarn ios:sync
   ```

## Project Structure

```
src/
├── app/                 # Next.js App Router
│   ├── globals.css     # Global styles and CSS variables
│   ├── layout.tsx      # Root layout component
│   └── page.tsx        # Home page
├── components/         # React components
│   ├── ui/            # shadcn/ui components
│   └── bottom-navigation.tsx
└── lib/               # Utility functions
    └── utils.ts       # Common utilities (cn function)
```

## Configuration

- **Next.js**: Configured for static export (`output: 'export'`)
- **Capacitor**: Points to `out/` directory for web assets
- **Tailwind**: Mobile-first design with custom finance colors
- **TypeScript**: Strict type checking enabled

## Mobile App Features

### Bottom Navigation
- **Transactions Tab**: List of all financial transactions
- **FAB (Floating Action Button)**: Quick add for Income/Expense/Investment
- **Insights Tab**: Financial overview and analytics

### Design System
- Custom color palette for finance categories:
  - Income: Green
  - Expense: Red  
  - Investment: Blue
  - Transfer: Purple
- Mobile-optimized spacing and typography
- Safe area support for modern devices

## Building for Production

The app is configured for static export, making it perfect for:
- Mobile app packaging with Capacitor
- PWA deployment
- CDN hosting

## Next Steps

- [ ] Implement transaction management
- [ ] Add data persistence (local storage)
- [ ] Implement insights and analytics
- [ ] Add transaction categories and tags
- [ ] Implement search and filtering
- [ ] Add data export functionality
'use client';

import {
  Building2,
  User,
  ArrowLeftRight,
  Settings,
  TrendingUp,
  Wallet,
  PiggyBank,
  BarChart3,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { LanguageSwitcher } from '@/components/language-switcher';

const featureIcons = {
  multipleBusinesses: Building2,
  personalFinance: User,
  profitTransfers: ArrowLeftRight,
  multiCurrency: Wallet,
  investmentTracking: PiggyBank,
  reports: BarChart3,
};

const featureKeys = [
  'multipleBusinesses',
  'personalFinance',
  'profitTransfers',
  'multiCurrency',
  'investmentTracking',
  'reports',
] as const;

export default function HomePage() {
  const t = useTranslations();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Language Switcher */}
      <div className="absolute right-6 top-6 z-10">
        <LanguageSwitcher />
      </div>

      {/* Hero Section */}
      <div className="relative overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_110%)]" />
        
        <div className="relative mx-auto max-w-7xl px-6 py-24 sm:py-32 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            {/* Logo */}
            <div className="mb-8 flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 shadow-lg shadow-emerald-500/25">
                <TrendingUp className="h-8 w-8 text-white" />
              </div>
            </div>

            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl">
              <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                {t('common.appName')}
              </span>
            </h1>
            
            <p className="mt-4 text-xl text-slate-400">
              {t('common.tagline')}
            </p>
            
            <p className="mt-6 text-lg leading-8 text-slate-300">
              {t('home.hero.description')}
            </p>

            <div className="mt-10 flex items-center justify-center gap-x-4">
              <Button
                asChild
                size="lg"
                className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
              >
                <Link href="/dashboard">
                  {t('home.hero.getStarted')}
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                className="border border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <Link href="/settings">
                  <Settings className="mr-2 h-4 w-4" />
                  {t('home.hero.settings')}
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {t('home.features.title')}
          </h2>
          <p className="mt-4 text-slate-400">
            {t('home.features.subtitle')}
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {featureKeys.map((key) => {
            const Icon = featureIcons[key];
            return (
              <Card
                key={key}
                className="border-slate-800 bg-slate-900/50 backdrop-blur-sm transition-colors hover:border-slate-700"
              >
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/20 to-cyan-500/20">
                    <Icon className="h-5 w-5 text-emerald-400" />
                  </div>
                  <CardTitle className="text-white">
                    {t(`home.features.${key}.title`)}
                  </CardTitle>
                  <CardDescription className="text-slate-400">
                    {t(`home.features.${key}.description`)}
                  </CardDescription>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Quick Links */}
      <div className="mx-auto max-w-7xl px-6 pb-24 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-white">{t('home.quickNav.title')}</CardTitle>
              <CardDescription className="text-slate-400">
                {t('home.quickNav.subtitle')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Link
                  href="/dashboard"
                  className="flex h-auto flex-col items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 py-4 text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-white"
                >
                  <BarChart3 className="h-5 w-5" />
                  {t('home.quickNav.dashboard')}
                </Link>
                <Link
                  href="/businesses"
                  className="flex h-auto flex-col items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 py-4 text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-white"
                >
                  <Building2 className="h-5 w-5" />
                  {t('home.quickNav.businesses')}
                </Link>
                <Link
                  href="/personal"
                  className="flex h-auto flex-col items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 py-4 text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-white"
                >
                  <User className="h-5 w-5" />
                  {t('home.quickNav.personal')}
                </Link>
                <Link
                  href="/transfers"
                  className="flex h-auto flex-col items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 py-4 text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-white"
                >
                  <ArrowLeftRight className="h-5 w-5" />
                  {t('home.quickNav.transfers')}
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-950">
        <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
          <p className="text-center text-sm text-slate-500">
            {t('home.footer')}
          </p>
        </div>
      </footer>
    </div>
  );
}

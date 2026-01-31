'use client';

import Link from 'next/link';
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
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const features = [
  {
    icon: Building2,
    title: 'Multiple Businesses',
    description: 'Manage multiple business entities with separate tracking',
  },
  {
    icon: User,
    title: 'Personal Finance',
    description: 'Track your personal income, expenses, and investments',
  },
  {
    icon: ArrowLeftRight,
    title: 'Profit Transfers',
    description: 'Record transfers between business and personal accounts',
  },
  {
    icon: Wallet,
    title: 'Multi-Currency',
    description: 'Support for multiple currencies with manual exchange rates',
  },
  {
    icon: PiggyBank,
    title: 'Investment Tracking',
    description: 'Track investments across all your entities',
  },
  {
    icon: BarChart3,
    title: 'Reports & Insights',
    description: 'Visualize your financial health with charts and reports',
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
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
                Capital
              </span>
            </h1>
            
            <p className="mt-4 text-xl text-slate-400">
              Financial Management for International Service Providers
            </p>
            
            <p className="mt-6 text-lg leading-8 text-slate-300">
              Track your business and personal finances in one place. 
              Manage multiple currencies, record profit distributions, 
              and gain insights into your financial health.
            </p>

            <div className="mt-10 flex items-center justify-center gap-x-4">
              <Button
                asChild
                size="lg"
                className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
              >
                <Link href="/dashboard">
                  Get Started
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <Link href="/settings">
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
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
            Everything you need to manage your finances
          </h2>
          <p className="mt-4 text-slate-400">
            Built for freelancers and contractors working internationally
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Card
              key={feature.title}
              className="border-slate-800 bg-slate-900/50 backdrop-blur-sm transition-colors hover:border-slate-700"
            >
              <CardHeader>
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/20 to-cyan-500/20">
                  <feature.icon className="h-5 w-5 text-emerald-400" />
                </div>
                <CardTitle className="text-white">{feature.title}</CardTitle>
                <CardDescription className="text-slate-400">
                  {feature.description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>

      {/* Quick Links */}
      <div className="mx-auto max-w-7xl px-6 pb-24 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-white">Quick Navigation</CardTitle>
              <CardDescription className="text-slate-400">
                Jump to any section of the app
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Link
                  href="/dashboard"
                  className="flex h-auto flex-col items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 py-4 text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-white"
                >
                  <BarChart3 className="h-5 w-5" />
                  Dashboard
                </Link>
                <Link
                  href="/businesses"
                  className="flex h-auto flex-col items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 py-4 text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-white"
                >
                  <Building2 className="h-5 w-5" />
                  Businesses
                </Link>
                <Link
                  href="/personal"
                  className="flex h-auto flex-col items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 py-4 text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-white"
                >
                  <User className="h-5 w-5" />
                  Personal
                </Link>
                <Link
                  href="/transfers"
                  className="flex h-auto flex-col items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 py-4 text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-white"
                >
                  <ArrowLeftRight className="h-5 w-5" />
                  Transfers
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
            Capital - Phase 0: Documentation + Project Setup Complete
          </p>
        </div>
      </footer>
    </div>
  );
}

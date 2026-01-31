'use client';

import Link from 'next/link';
import { ArrowLeft, Construction } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-8">
      <div className="mx-auto max-w-4xl">
        <Button
          asChild
          variant="ghost"
          className="mb-8 text-slate-400 hover:text-white"
        >
          <Link href="/">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Home
          </Link>
        </Button>

        <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20">
              <Construction className="h-8 w-8 text-amber-400" />
            </div>
            <CardTitle className="text-2xl text-white">Dashboard</CardTitle>
            <CardDescription className="text-slate-400">
              Coming in Phase 1
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-slate-300">
              The dashboard will display summary cards showing total capital,
              income, expenses, and recent transactions across all your entities.
            </p>
            <div className="mt-6 rounded-lg border border-dashed border-slate-700 bg-slate-800/50 p-6">
              <h4 className="mb-2 font-medium text-slate-300">Planned Features:</h4>
              <ul className="space-y-1 text-sm text-slate-400">
                <li>• Total capital overview</li>
                <li>• Business summaries</li>
                <li>• Recent transactions</li>
                <li>• Quick actions</li>
                <li>• Balance charts</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

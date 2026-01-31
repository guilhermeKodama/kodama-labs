'use client';

import Link from 'next/link';
import { ArrowLeft, ArrowLeftRight, Construction } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function TransfersPage() {
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
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20">
              <ArrowLeftRight className="h-8 w-8 text-purple-400" />
            </div>
            <CardTitle className="text-2xl text-white">Transfers</CardTitle>
            <CardDescription className="text-slate-400">
              Coming in Phase 2
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-slate-300">
              Record money movements between your business entities and personal
              account. Track profit distributions and capital injections.
            </p>
            <div className="mt-6 rounded-lg border border-dashed border-slate-700 bg-slate-800/50 p-6">
              <h4 className="mb-2 font-medium text-slate-300">Planned Features:</h4>
              <ul className="space-y-1 text-sm text-slate-400">
                <li>• Profit distribution (Business → Personal)</li>
                <li>• Capital injection (Personal → Business)</li>
                <li>• Transfer history</li>
                <li>• Multi-currency transfers</li>
                <li>• Impact tracking on balances</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

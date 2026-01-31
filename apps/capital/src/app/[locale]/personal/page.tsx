'use client';

import { ArrowLeft, User } from 'lucide-react';
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

export default function PersonalPage() {
  const t = useTranslations();

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
            {t('common.backToHome')}
          </Link>
        </Button>

        <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20">
              <User className="h-8 w-8 text-emerald-400" />
            </div>
            <CardTitle className="text-2xl text-white">{t('personal.title')}</CardTitle>
            <CardDescription className="text-slate-400">
              {t('common.comingIn', { phase: t('common.phase1') })}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-slate-300">
              {t('personal.description')}
            </p>
            <div className="mt-6 rounded-lg border border-dashed border-slate-700 bg-slate-800/50 p-6">
              <h4 className="mb-2 font-medium text-slate-300">{t('common.plannedFeatures')}:</h4>
              <ul className="space-y-1 text-sm text-slate-400">
                <li>• {t('personal.features.incomeTracking')}</li>
                <li>• {t('personal.features.expenseCategorization')}</li>
                <li>• {t('personal.features.investmentPortfolio')}</li>
                <li>• {t('personal.features.profitDistributions')}</li>
                <li>• {t('personal.features.netWorth')}</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

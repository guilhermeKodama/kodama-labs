'use client';

import { useTranslations } from 'next-intl';
import { ArrowLeftRight, Construction } from 'lucide-react';
import { AppShell } from '@/components/layout';
import { Header } from '@/components/layout/header';
import { Card, CardContent } from '@/components/ui/card';

export default function TransfersPage() {
  const t = useTranslations();

  return (
    <AppShell>
      <Header
        title={t('transfers.title')}
        description={t('transfers.subtitle')}
      />

      <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
        <CardContent className="py-16 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20">
            <ArrowLeftRight className="h-8 w-8 text-purple-400" />
          </div>
          <h3 className="mb-2 text-lg font-medium text-white">
            {t('transfers.comingSoon.title')}
          </h3>
          <p className="mb-6 text-slate-400">
            {t('transfers.comingSoon.description')}
          </p>
          <div className="mx-auto max-w-md rounded-lg border border-dashed border-slate-700 bg-slate-800/50 p-6">
            <h4 className="mb-3 font-medium text-slate-300">
              {t('common.plannedFeatures')}:
            </h4>
            <ul className="space-y-2 text-left text-sm text-slate-400">
              <li>• {t('transfers.features.profitDistribution')}</li>
              <li>• {t('transfers.features.capitalInjection')}</li>
              <li>• {t('transfers.features.transferHistory')}</li>
              <li>• {t('transfers.features.multiCurrency')}</li>
              <li>• {t('transfers.features.impactTracking')}</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}

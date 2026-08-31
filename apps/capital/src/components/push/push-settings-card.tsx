'use client';

import { useTranslations } from 'next-intl';
import { Bell, BellOff, BellRing } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { usePushSubscription } from './use-push-subscription';

export function PushSettingsCard() {
  const t = useTranslations('settings.notifications');
  const { status, enable, disable } = usePushSubscription();

  return (
    <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm lg:col-span-2">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500/20 to-fuchsia-500/20">
            <Bell className="h-5 w-5 text-purple-400" />
          </div>
          <div>
            <CardTitle className="text-white">{t('title')}</CardTitle>
            <CardDescription className="text-slate-400">{t('description')}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {status === 'subscribed' && (
          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/50 p-3">
            <span className="flex items-center gap-2 text-sm text-emerald-400">
              <BellRing className="h-4 w-4" />
              {t('enabled')}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={disable}
              className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <BellOff className="mr-2 h-4 w-4" />
              {t('disable')}
            </Button>
          </div>
        )}

        {(status === 'not-subscribed' || status === 'subscribing') && (
          <Button
            onClick={enable}
            disabled={status === 'subscribing'}
            size="sm"
            className="bg-gradient-to-r from-purple-500 to-fuchsia-500 text-white hover:from-purple-600 hover:to-fuchsia-600"
          >
            <Bell className="mr-2 h-4 w-4" />
            {status === 'subscribing' ? t('enabling') : t('enable')}
          </Button>
        )}

        {status === 'denied' && <p className="text-sm text-red-400">{t('denied')}</p>}
        {status === 'unsupported' && <p className="text-sm text-slate-400">{t('unsupported')}</p>}
        {status === 'ios-needs-install' && (
          <p className="text-sm text-slate-400">{t('iosInstallHint')}</p>
        )}
        {status === 'error' && <p className="text-sm text-red-400">{t('error')}</p>}
      </CardContent>
    </Card>
  );
}

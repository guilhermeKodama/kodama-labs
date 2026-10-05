'use client';

import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { useUser } from '@/lib/user-context';

/**
 * Placeholder while the new UI (Transações / Investimentos) is built on the
 * v2 API. The assistant keeps working in the meantime.
 */
export default function DashboardPage() {
  const { user } = useUser();
  return (
    <Card className="mx-auto mt-8 max-w-xl border-slate-800 bg-slate-900/60">
      <CardHeader>
        <CardTitle className="text-white">Olá{user?.name ? `, ${user.name}` : ''}</CardTitle>
        <CardDescription className="text-slate-400">
          A nova interface do Capital está sendo construída. Enquanto isso, o assistente continua lendo e importando seus dados.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild className="bg-emerald-500 text-white hover:bg-emerald-600">
          <Link href="/assistant">
            <Sparkles className="mr-2 h-4 w-4" />
            Abrir o assistente
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

import { setRequestLocale } from 'next-intl/server';

import { Home } from '@/components/home';

interface HomePageProps {
  params: Promise<{ locale: string }>;
}

export default async function HomePage({ params }: HomePageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <Home />;
}

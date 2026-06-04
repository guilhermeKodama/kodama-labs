import { setRequestLocale } from 'next-intl/server';

import { Header } from '@/components/nav/header';
import { Hero } from '@/components/sections/hero';
import { Philosophy } from '@/components/sections/philosophy';
import { FlagshipProjects } from '@/components/sections/flagship-projects';
import { PipelineIdeias } from '@/components/sections/pipeline-ideias';
import { Archive } from '@/components/sections/archive';
import { Contact } from '@/components/sections/contact';
import { Footer } from '@/components/sections/footer';

interface HomePageProps {
  params: Promise<{ locale: string }>;
}

export default async function HomePage({ params }: HomePageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <Header />
      <main>
        <Hero />
        <Philosophy />
        <FlagshipProjects />
        <PipelineIdeias />
        <Archive />
        <Contact />
      </main>
      <Footer />
    </>
  );
}

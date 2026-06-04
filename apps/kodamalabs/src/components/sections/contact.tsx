'use client';

import { useTranslations } from 'next-intl';
import { Github, Linkedin, Mail } from 'lucide-react';

import { FadeInSection } from '@/components/animated/fade-in-section';
import { SectionHeader } from './section-header';

const EMAIL = 'contato@kodamalabs.ai';

const SOCIALS = [
  { href: 'https://github.com/guilhermekodama', label: 'GitHub', Icon: Github },
  {
    href: 'https://www.linkedin.com/in/guilhermekodama',
    label: 'LinkedIn',
    Icon: Linkedin,
  },
  { href: 'https://x.com/guilhermekodama', label: 'X', Icon: XIcon },
];

function XIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M18.244 2H21.5l-7.5 8.572L23 22h-6.844l-5.36-7.014L4.7 22H1.443l8.02-9.17L1 2h7.014l4.85 6.412L18.244 2zm-1.2 18h1.86L7.04 4H5.082l11.962 16z" />
    </svg>
  );
}

export function Contact() {
  const t = useTranslations('contact');

  return (
    <section
      id="contact"
      className="relative border-t border-border/40 bg-muted/10 px-6 py-32"
    >
      <div className="mx-auto max-w-4xl">
        <FadeInSection>
          <SectionHeader
            eyebrow={t('eyebrow')}
            title={t('title')}
            subtitle={t('subtitle')}
          />
        </FadeInSection>

        <FadeInSection delay={0.15} className="flex flex-col gap-10">
          <div>
            <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
              {t('emailLabel')}
            </p>
            <a
              href={`mailto:${EMAIL}`}
              className="group inline-flex items-center gap-3 text-2xl font-medium tracking-tight transition-colors hover:text-emerald-300 sm:text-3xl md:text-4xl"
            >
              <Mail className="size-6 text-muted-foreground transition-colors group-hover:text-emerald-300 sm:size-7" />
              {EMAIL}
            </a>
          </div>

          <div>
            <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
              {t('socialsLabel')}
            </p>
            <div className="flex items-center gap-3">
              {SOCIALS.map(({ href, label, Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={label}
                  className="flex size-11 items-center justify-center rounded-full border border-border/60 bg-background/40 text-muted-foreground backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-emerald-400/40 hover:text-foreground"
                >
                  <Icon className="size-4" />
                </a>
              ))}
            </div>
          </div>
        </FadeInSection>
      </div>
    </section>
  );
}

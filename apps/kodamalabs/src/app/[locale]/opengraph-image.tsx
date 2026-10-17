import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';

import { isPublishedLocale } from '@/i18n/locales';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const APP = process.cwd();

/** The light tokens, read from the one file that holds colours. */
async function tokens(): Promise<Record<string, string>> {
  const css = await readFile(path.join(APP, 'src/styles/tokens.css'), 'utf8');
  const light = css.slice(0, css.indexOf('@media'));
  return Object.fromEntries([...light.matchAll(/--kl-([a-z]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!]));
}

function font(file: string): Promise<Buffer> {
  return readFile(path.join(APP, 'src/app/fonts/og', file));
}

export async function generateImageMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isPublishedLocale(locale)) return [];
  const t = await getTranslations({ locale, namespace: 'site.meta' });
  return [{ id: 'share', size, contentType, alt: t('shareAlt') }];
}

/**
 * The image a link to the page unfurls into: the name, one sentence, and the
 * page's notation in one stroke (proposed, the gate on the spine, committed).
 */
export default async function ShareImage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const site = await getTranslations({ locale, namespace: 'site' });
  const hero = await getTranslations({ locale, namespace: 'hero' });
  const [color, serif, mono] = await Promise.all([
    tokens(),
    font('source-serif-4-latin-400-normal.woff'),
    font('ibm-plex-mono-latin-400-normal.woff'),
  ]);

  // The spine sits where it does on the page: 58.5% of the content width,
  // starting under the name, which is the only thing wider than its column.
  const margin = 72;
  const spine = margin + (size.width - 2 * margin) * 0.585;
  const spineTop = 268;
  const strand = 500;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: margin,
          background: color.ground,
          color: color.ink,
          fontFamily: 'Source Serif 4',
        }}
      >
        <svg
          width={size.width}
          height={size.height}
          viewBox={`0 0 ${size.width} ${size.height}`}
          style={{ position: 'absolute', left: 0, top: 0 }}
        >
          <line x1={spine} y1={spineTop} x2={spine} y2={size.height} stroke={color.accent} strokeWidth={2} />
          <line x1={margin} y1={strand} x2={spine - 16} y2={strand} stroke={color.ink} strokeWidth={3} strokeDasharray="10 8" />
          <circle cx={spine} cy={strand} r={12} fill={color.accent} />
          <line x1={spine + 16} y1={strand} x2={size.width - margin} y2={strand} stroke={color.ink} strokeWidth={3} />
        </svg>
        <div style={{ fontFamily: 'IBM Plex Mono', fontSize: 22, color: color.muted }}>{site('brand')}</div>
        <div style={{ marginTop: 44, fontSize: 104, lineHeight: 1, letterSpacing: -3 }}>{hero('name')}</div>
        <div style={{ marginTop: 32, width: spine - margin - 40, fontSize: 30, lineHeight: 1.35 }}>
          {site('meta.description')}
        </div>
        <div
          style={{
            position: 'absolute',
            left: margin,
            top: strand + 24,
            width: size.width - 2 * margin,
            display: 'flex',
            fontFamily: 'IBM Plex Mono',
            fontSize: 20,
            color: color.muted,
          }}
        >
          <div style={{ width: spine - margin + 16 }}>{hero('legend.proposed')}</div>
          <div>{hero('legend.committed')}</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Source Serif 4', data: serif, weight: 400, style: 'normal' },
        { name: 'IBM Plex Mono', data: mono, weight: 400, style: 'normal' },
      ],
    },
  );
}

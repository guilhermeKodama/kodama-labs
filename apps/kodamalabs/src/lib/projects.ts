export type ProjectCategory = 'flagship' | 'pipeline' | 'archive';
export type ProjectStatus = 'live' | 'validating' | 'shipped' | 'archived';
export type ProjectAccent = 'emerald' | 'cyan' | 'violet' | 'amber';

export type Project = {
  /** Slug must match the namespace key in messages/{locale}.json under `projects.<slug>`. */
  slug: string;
  category: ProjectCategory;
  status: ProjectStatus;
  stack: string[];
  links?: { live?: string; repo?: string };
  accent: ProjectAccent;
  /** Optional year, used by archive cards. */
  year?: number;
};

export const projects: Project[] = [
  {
    slug: 'capital',
    category: 'flagship',
    status: 'live',
    stack: ['Next.js', 'Prisma', 'D3 Sankey', 'Claude API', 'Hono'],
    accent: 'emerald',
    links: { live: 'https://app.wallex.com.br/' },
  },
  {
    slug: 'sentinel',
    category: 'flagship',
    status: 'live',
    stack: ['Next.js', 'Prisma', 'Claude API', 'Vercel Cron'],
    accent: 'cyan',
    links: { live: 'https://sentinela-gov.com.br/en/dashboard' },
  },
  {
    slug: 'milhasgrupo',
    category: 'pipeline',
    status: 'validating',
    stack: ['Next.js', 'Telegram Bot', 'Sheets API', 'Meta Pixel'],
    accent: 'violet',
  },
];

/**
 * Archive entries from the previous guilhermekodama.github.io portfolio,
 * ordered newest → oldest. Each entry has a matching `projects.<slug>`
 * namespace in messages/{locale}.json with name, tagline, and description.
 */
export const archiveProjects: Project[] = [
  {
    slug: 'mee',
    category: 'archive',
    status: 'shipped',
    stack: ['Python', 'Apriori', 'scikit-learn', 'Jupyter'],
    accent: 'amber',
    year: 2020,
    links: {
      repo: 'https://github.com/somosmee/mee-public/blob/master/datascience/Associative%20Analysis.ipynb',
    },
  },
  {
    slug: 'pandora',
    category: 'archive',
    status: 'shipped',
    stack: ['Python', 'BioSPPy', 'PhysioBank', 'ML'],
    accent: 'emerald',
    year: 2019,
    links: {
      live: 'https://nbviewer.jupyter.org/github/guilhermeKodama/Pandora/blob/master/python-wavelet/pandora-ecg.ipynb',
    },
  },
  {
    slug: 'closetinn',
    category: 'archive',
    status: 'shipped',
    stack: ['Python', 'Web Scraping', 'Collaborative Filtering'],
    accent: 'cyan',
    year: 2019,
    links: {
      repo: 'https://github.com/guilhermeKodama/Closetinn/tree/master/machineLearning',
    },
  },
  {
    slug: 'petfinder',
    category: 'archive',
    status: 'shipped',
    stack: ['CatBoost', 'CNN', 'TF-IDF', 'PCA'],
    accent: 'violet',
    year: 2019,
    links: {
      live: 'https://www.kaggle.com/guilhermekodama/eda-petfinder-competition-catboost-baseline',
    },
  },
  {
    slug: 'carrercon',
    category: 'archive',
    status: 'shipped',
    stack: ['Random Forest', 'Time Series', 'IMU Sensors'],
    accent: 'amber',
    year: 2019,
    links: {
      live: 'https://www.kaggle.com/guilhermekodama/carrercon-rf-baseline-and-simple-features',
    },
  },
];

export const accentClasses: Record<
  ProjectAccent,
  { ring: string; glow: string; text: string; dot: string }
> = {
  emerald: {
    ring: 'hover:border-emerald-400/40',
    glow: 'hover:shadow-[0_0_60px_-15px_oklch(0.7_0.18_160_/_0.5)]',
    text: 'text-emerald-300',
    dot: 'bg-emerald-400',
  },
  cyan: {
    ring: 'hover:border-cyan-400/40',
    glow: 'hover:shadow-[0_0_60px_-15px_oklch(0.7_0.18_220_/_0.5)]',
    text: 'text-cyan-300',
    dot: 'bg-cyan-400',
  },
  violet: {
    ring: 'hover:border-violet-400/40',
    glow: 'hover:shadow-[0_0_60px_-15px_oklch(0.65_0.2_290_/_0.5)]',
    text: 'text-violet-300',
    dot: 'bg-violet-400',
  },
  amber: {
    ring: 'hover:border-amber-400/40',
    glow: 'hover:shadow-[0_0_60px_-15px_oklch(0.78_0.18_70_/_0.5)]',
    text: 'text-amber-300',
    dot: 'bg-amber-400',
  },
};

export function projectsByCategory(category: ProjectCategory): Project[] {
  return projects.filter((p) => p.category === category);
}

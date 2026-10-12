/** Addresses and profiles. Facts, not copy: they are the same in every locale. */
export const SITE_URL = 'https://kodamalabs.ai';

export const EMAIL = 'contato@kodamalabs.ai';

export const LINKS = {
  email: `mailto:${EMAIL}`,
  github: 'https://github.com/guilhermeKodama',
  linkedin: 'https://www.linkedin.com/in/guilhermekodama',
} as const;

/** In-page anchors. Each value is the `id` of an element on the homepage. */
export const SECTIONS = {
  top: 'top',
  content: 'content',
  capital: 'capital',
  sentinel: 'sentinel',
  cosmos: 'cosmos',
  lab: 'lab',
  triage: 'triage',
  playbook: 'playbook',
  method: 'method',
  agents: 'agents',
  production: 'production',
  about: 'about',
  contact: 'contact',
} as const;

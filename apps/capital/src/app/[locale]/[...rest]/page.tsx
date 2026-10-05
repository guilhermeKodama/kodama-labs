import { notFound } from 'next/navigation';

// Any path no route matches (/dashboard is redirected in next.config.ts;
// this is for typos and removed pages): the localized 404.
export default function CatchAll() {
  notFound();
}

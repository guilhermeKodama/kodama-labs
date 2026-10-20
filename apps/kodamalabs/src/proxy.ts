import createIntlMiddleware from 'next-intl/middleware';

import { routing } from './i18n/routing';

// Next 16 renamed the `middleware` file convention to `proxy`. next-intl still
// ships the handler under `next-intl/middleware`; it is a plain request handler.
export default createIntlMiddleware(routing);

export const config = {
  // Skip the API, Next internals, anything with a file extension, and the
  // share image, which link previews fetch by its full path and must not be
  // redirected.
  matcher: ['/((?!api|_next|.*opengraph-image.*|.*\\..*).*)', '/'],
};

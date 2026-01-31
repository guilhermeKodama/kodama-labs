import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { SocialSignInView } from 'src/sections/auth/social/social-sign-in-view';

// ----------------------------------------------------------------------

const metadata = { title: `Social Sign in | Firebase - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>
      <SocialSignInView />
    </>
  );
}

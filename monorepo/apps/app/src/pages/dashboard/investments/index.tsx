import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import InvestmentsView from 'src/sections/investments/investments-view';

// ----------------------------------------------------------------------

const metadata = { title: `Investimentos | Dashboard - ${CONFIG.site.name}` };

export default function Page() {
  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <InvestmentsView />
    </>
  );
} 
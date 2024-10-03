import 'src/global.css';

// ----------------------------------------------------------------------

import { Router } from 'src/routes/sections';

import { useScrollToTop } from 'src/hooks/use-scroll-to-top';

import { LocalizationProvider } from 'src/locales';
import { I18nProvider } from 'src/locales/i18n-provider';
import { ThemeProvider } from 'src/theme/theme-provider';

import { Snackbar } from 'src/components/snackbar';
import { ProgressBar } from 'src/components/progress-bar';
import { MotionLazy } from 'src/components/animate/motion-lazy';
import { SettingsDrawer, defaultSettings, SettingsProvider } from 'src/components/settings';

import { AuthProvider } from 'src/auth/context/jwt';
import { useEffect } from 'react';
import { TransactionProvider } from './pages/dashboard/invoice/transaction-context';
import { initGA, logPageView } from './utils/analytics';

// ----------------------------------------------------------------------

export default function App() {
  useEffect(() => {
    initGA(); // Inicializa o Google Analytics

    // Registra uma nova visita de página a cada mudança de rota
    logPageView(window.location.pathname);
  }, []);

  useScrollToTop();

  return (
    <I18nProvider>
      <LocalizationProvider>
        <AuthProvider>
          <SettingsProvider settings={defaultSettings}>
            <ThemeProvider>
              <TransactionProvider>
                <MotionLazy>
                  <Snackbar />
                  <ProgressBar />
                  <SettingsDrawer />
                  <Router />
                </MotionLazy>
              </TransactionProvider>
            </ThemeProvider>
          </SettingsProvider>
        </AuthProvider>
      </LocalizationProvider>
    </I18nProvider>
  );
}

import ReactGA from 'react-ga4';
import Hotjar from '@hotjar/browser';

// Inicializa o Google Analytics com o ID de acompanhamento
export const initGA = () => {
  ReactGA.initialize('G-B8PFR53CKJ'); // Substitua pelo seu próprio ID
};

export const initHotjar = () => {
  const siteId = 5176402;
  const hotjarVersion = 6;

  Hotjar.init(siteId, hotjarVersion);

  // Initializing with `debug` option:
  Hotjar.init(siteId, hotjarVersion, {
    debug: true,
  });
};

// Função para registrar visitas de página
export const logPageView = (page: any) => {
  ReactGA.send({ hitType: 'pageview', page });
};

export const sendEvent = (data: any) => {
  ReactGA.event(data);
};

export const logSignUp = () => {
  ReactGA.event({
    category: 'engagement',
    action: 'sign_up',
    label: 'User Signup',
  });

  // Log conversion event to Google Ads
  // @ts-ignore
  if (!window.gtag) {
    console.error('Google Ads tracking (gtag) is not initialized');
  } else {
    // @ts-ignore
    window.gtag('event', 'conversion', {
      send_to: 'AW-955286068/xZRGCILt694ZELSEwscD',
      event_callback: () => {},
    });
  }
};

export const logPurchase = () => {
  ReactGA.event({
    category: 'ecommerce',
    action: 'purchase',
    label: 'Purchase Completed',
  });
};

export const identifyUser = (userId: string, email: string) => {
  Hotjar.identify(userId, {
    email,
  });
};

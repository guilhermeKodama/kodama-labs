import Script from "next/script";

type FbqCommand = "init" | "track" | "trackCustom";
type GtagCommand = "config" | "event" | "js" | "set";

declare global {
  interface Window {
    fbq?: (command: FbqCommand, ...args: unknown[]) => void;
    gtag?: (command: GtagCommand, ...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
const gaId = process.env.NEXT_PUBLIC_GA_ID;
const adsId = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
const adsLeadLabel = process.env.NEXT_PUBLIC_GOOGLE_ADS_LEAD_LABEL;

export function Analytics() {
  const needsGtagLoader = Boolean(gaId || adsId);
  const gtagLoaderId = gaId || adsId;

  return (
    <>
      {pixelId ? (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${pixelId}');
            fbq('track', 'PageView');
          `}
        </Script>
      ) : null}

      {needsGtagLoader ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${gtagLoaderId}`}
            strategy="afterInteractive"
          />
          <Script id="gtag-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              window.gtag = gtag;
              gtag('js', new Date());
              ${gaId ? `gtag('config', '${gaId}');` : ""}
              ${adsId ? `gtag('config', '${adsId}');` : ""}
            `}
          </Script>
        </>
      ) : null}
    </>
  );
}

export function trackViewContent(name: string) {
  if (typeof window === "undefined") return;
  window.fbq?.("track", "ViewContent", { content_name: name });
  window.gtag?.("event", "view_content", { content_name: name });
}

export function trackLead(value?: number) {
  if (typeof window === "undefined") return;
  window.fbq?.("track", "Lead", value !== undefined ? { value, currency: "BRL" } : undefined);
  window.gtag?.("event", "generate_lead", value !== undefined ? { value, currency: "BRL" } : undefined);
  if (adsId && adsLeadLabel) {
    window.gtag?.("event", "conversion", {
      send_to: `${adsId}/${adsLeadLabel}`,
      ...(value !== undefined ? { value, currency: "BRL" } : {}),
    });
  }
}

export function trackCompleteRegistration() {
  if (typeof window === "undefined") return;
  window.fbq?.("track", "CompleteRegistration");
  window.gtag?.("event", "sign_up");
}

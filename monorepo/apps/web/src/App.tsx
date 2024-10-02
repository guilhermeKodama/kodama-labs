import React, { useEffect } from "react";
import { BrowserRouter, useLocation } from "react-router-dom";
import Routes from "./Routes";
import { Analytics } from "@vercel/analytics/react";

import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import "aos/dist/aos.css";
import { initGA, logPageView } from "services/analytics";

const App = () => {
  useEffect(() => {
    initGA(); // Inicializa o Google Analytics

    // Registra uma nova visita de página a cada mudança de rota
    logPageView(window.location.pathname);
  }, []);

  return (
    <BrowserRouter>
      <Analytics />
      <Routes />
    </BrowserRouter>
  );
};

export default App;

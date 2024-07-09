import React from "react";
import { BrowserRouter } from "react-router-dom";
import Routes from "./Routes";
import { Analytics } from "@vercel/analytics/react";

import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import "aos/dist/aos.css";

const App = () => {
  return (
    <BrowserRouter>
      <Analytics />
      <Routes />
    </BrowserRouter>
  );
};

export default App;

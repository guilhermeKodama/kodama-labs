import React, { useState, useEffect } from "react";
import { ThemeProvider } from "@mui/material/styles";
import Paper from "@mui/material/Paper";
import CssBaseline from "@mui/material/CssBaseline";
import getTheme from "./theme";
import AOS from "aos";
import { PaletteMode } from "@mui/material";

type Props = {
  component: React.ElementType;
  layout: React.ElementType;
};

export const useDarkMode = () => {
  const [themeMode, setTheme] = useState<PaletteMode>("dark");
  const [mountedComponent, setMountedComponent] = useState(false);

  const setMode = (mode: PaletteMode) => {
    window.localStorage.setItem("themeMode", mode);
    setTheme(mode);
  };

  const themeToggler = () => {
    themeMode === "light" ? setMode("dark") : setMode("light");
  };

  useEffect(() => {
    const localTheme = window.localStorage.getItem("themeMode") as PaletteMode;
    localTheme ? setTheme(localTheme) : setMode("dark");
    setMountedComponent(true);
  }, []);

  return [themeMode, themeToggler, mountedComponent];
};

export default function WithLayout({
  component: Component,
  layout: Layout,
  ...rest
}: Props) {
  React.useEffect(() => {
    // Remove the server-side injected CSS.
    const jssStyles = document.querySelector("#jss-server-side");
    if (jssStyles) {
      jssStyles.parentElement?.removeChild(jssStyles);
    }

    AOS.init({
      once: true,
      delay: 50,
      duration: 500,
      easing: "ease-in-out",
    });
  }, []);

  const [themeMode, themeToggler, mountedComponent] = useDarkMode();

  useEffect(() => {
    AOS.refresh();
  }, [mountedComponent, themeMode]);

  return (
    <ThemeProvider theme={getTheme(themeMode as PaletteMode)}>
      {/* CssBaseline kickstart an elegant, consistent, and simple baseline to build upon. */}
      <CssBaseline />
      <Paper elevation={0}>
        <Layout themeMode={themeMode} themeToggler={themeToggler}>
          <Component themeMode={themeMode} {...rest} />
        </Layout>
      </Paper>
    </ThemeProvider>
  );
}

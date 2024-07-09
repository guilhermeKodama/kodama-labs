import { PaletteMode, responsiveFontSizes } from "@mui/material";
import { createTheme, Theme, ThemeOptions } from "@mui/material/styles";
import shadows from "./shadows";
import palette from "./palette";

declare module "@mui/material/styles" {
  interface Palette {
    alternate: Palette["primary"];
  }
  interface PaletteOptions {
    alternate?: PaletteOptions["primary"];
  }
}

interface Layout {
  contentWidth: number;
}

// Extend ThemeOptions to include layout
interface CustomThemeOptions extends ThemeOptions {
  layout?: Layout;
}

interface CustomTheme extends Theme {
  layout: Layout;
}

const getTheme = (mode: PaletteMode): CustomTheme =>
  responsiveFontSizes(
    createTheme({
      palette: palette(mode),
      layout: {
        contentWidth: 1236,
      }, // Ensure proper type for layout
      shadows: shadows(mode),
      typography: {
        fontFamily: '"Manrope", sans-serif',
        button: {
          textTransform: "none",
          fontWeight: "medium",
        },
      },
      zIndex: {
        appBar: 1200,
        drawer: 1300,
      },
      components: {
        MuiButton: {
          styleOverrides: {
            root: {
              fontWeight: 600,
            },
            containedSecondary: mode === "light" ? { color: "white" } : {},
          },
        },
      },
    } as CustomThemeOptions) // Type assertion to CustomThemeOptions
  ) as CustomTheme;

export default getTheme;

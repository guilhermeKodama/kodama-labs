import { PaletteOptions } from "@mui/material/styles";
import { light, dark } from "./colors";
import { PaletteMode } from "@mui/material";

const palette = (themeMode: PaletteMode = "light"): PaletteOptions => {
  return {
    mode: themeMode,
    primary: themeMode === "dark" ? dark.primary : light.primary,
    secondary: themeMode === "dark" ? dark.secondary : light.secondary,
    background: {
      default:
        themeMode === "dark"
          ? dark.background.default
          : light.background.default,
      paper:
        themeMode === "dark" ? dark.background.paper : light.background.paper,
    },
    text: {
      primary: themeMode === "dark" ? dark.text.primary : light.text.primary,
      secondary:
        themeMode === "dark" ? dark.text.secondary : light.text.secondary,
    },
    divider: themeMode === "dark" ? dark.divider : light.divider,
    alternate: themeMode === "dark" ? dark.alternate : light.alternate,
  };
};

export default palette;

import React, { useState } from "react";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import Divider from "@mui/material/Divider";
import AppBar from "@mui/material/AppBar";
import Container from "common/Container";
import { Topbar, Sidebar, Footer } from "./components";
import { pages } from "../navigation--docs";
import { Box } from "@mui/material";

type Props = {
  children: React.ReactNode;
  themeToggler: () => void;
  themeMode: string;
  setThemePalette: (paletteType: string) => void;
  paletteType: string;
};

const Fixed = ({ children, themeToggler, themeMode, paletteType }: Props) => {
  const theme = useTheme();
  const isMd = useMediaQuery(theme.breakpoints.up("md"), {
    defaultMatches: true,
  });
  const [openSidebar, setOpenSidebar] = useState(false);

  const handleSidebarOpen = () => {
    setOpenSidebar(true);
  };

  const handleSidebarClose = () => {
    setOpenSidebar(false);
  };

  return (
    <Box height="100%" overflow="hidden" width="100%">
      <AppBar
        position={"fixed"}
        sx={{
          backgroundColor: theme.palette.background.paper,
        }}
        elevation={0}
      >
        <Container paddingY={{ xs: 1 / 2, sm: 1 }} maxWidth={{ md: "100%" }}>
          <Topbar
            onSidebarOpen={handleSidebarOpen}
            themeMode={themeMode}
            themeToggler={themeToggler}
          />
        </Container>
        <Divider />
      </AppBar>
      <Sidebar
        onClose={handleSidebarClose}
        open={openSidebar}
        variant={isMd ? "permanent" : "temporary"}
        pages={pages}
      />
      <main>
        <Box height={{ xs: 56, sm: 64 }} />
        <Box
          display="flex"
          flex="1 1 auto"
          overflow="hidden"
          paddingLeft={{ md: "256px" }}
        >
          <Box display="flex" flex="1 1 auto" overflow="hidden">
            <Box flex="1 1 auto" height="100%" overflow="auto">
              {children}
              <Divider />
              <Container paddingY={4}>
                <Footer />
              </Container>
            </Box>
          </Box>
        </Box>
      </main>
    </Box>
  );
};

export default Fixed;

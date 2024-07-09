import React, { useState } from "react";
import AppBar from "@mui/material/AppBar";
import Divider from "@mui/material/Divider";
import { Topbar, Sidebar, Footer } from "./components";
import Container from "common/Container";
import { pages } from "../navigation";

type Props = {
  children: React.ReactNode;
  themeToggler: () => void;
  themeMode: string;
  setThemePalette: (paletteType: string) => void;
  paletteType: string;
};

const Fluid = ({
  children,
  themeToggler,
  themeMode,
  setThemePalette,
  paletteType,
}: Props) => {
  const [openSidebar, setOpenSidebar] = useState(false);

  const handleSidebarOpen = () => {
    setOpenSidebar(true);
  };

  const handleSidebarClose = () => {
    setOpenSidebar(false);
  };

  return (
    <div>
      <AppBar
        position={"fixed"}
        sx={{
          backgroundColor: "transparent",
        }}
        elevation={0}
      >
        <Container paddingY={{ xs: 1 / 2, sm: 1 }} maxWidth={"100%"}>
          <Topbar
            onSidebarOpen={handleSidebarOpen}
            themeMode={themeMode}
            themeToggler={themeToggler}
          />
        </Container>
      </AppBar>
      <Sidebar
        onClose={handleSidebarClose}
        open={openSidebar}
        variant="temporary"
        pages={pages}
      />
      <main>{children}</main>
      <Divider />
      <Container paddingY={4}>
        <Footer />
      </Container>
    </div>
  );
};

export default Fluid;

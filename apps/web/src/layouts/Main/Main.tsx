import React, { useState } from "react";
import { useTheme } from "@mui/material/styles";
import Divider from "@mui/material/Divider";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import { Topbar, Sidebar, Footer } from "./components";
import Container from "common/Container";
import { pages } from "../navigation";

type Props = {
  children: React.ReactNode;
  themeToggler: () => void;
  themeMode: string;
};

const Main = ({ children, themeToggler, themeMode }: Props) => {
  const theme = useTheme();
  const [openSidebar, setOpenSidebar] = useState(false);

  const handleSidebarOpen = () => {
    setOpenSidebar(true);
  };

  const handleSidebarClose = () => {
    setOpenSidebar(false);
  };

  return (
    <div>
      <Box>
        <AppBar
          position={"fixed"}
          sx={{
            backgroundColor: theme.palette.background.paper,
          }}
          elevation={1}
        >
          <Container paddingY={{ xs: 1 / 2, sm: 2 }}>
            <Topbar
              onSidebarOpen={handleSidebarOpen}
              themeMode={themeMode}
              themeToggler={themeToggler}
            />
          </Container>
        </AppBar>
      </Box>
      <Sidebar
        onClose={handleSidebarClose}
        open={openSidebar}
        variant="temporary"
        pages={pages}
      />
      <main>
        <Box height={{ xs: 56, sm: 64 }} />
        {children}
        <Divider />
      </main>
      <Container paddingY={4}>
        <Footer />
      </Container>
    </div>
  );
};

export default Main;

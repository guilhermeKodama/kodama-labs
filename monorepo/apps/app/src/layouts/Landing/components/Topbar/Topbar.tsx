import React from "react";
import Box from "@mui/material/Box";
import WebbeeLogo from "svg/logos/Webbee";

const Topbar = () => {
  return (
    <Box
      display={"flex"}
      justifyContent={"space-between"}
      alignItems={"center"}
      width={"100%"}
    >
      <Box display={"flex"} alignItems={"center"}>
        <Box
          display={"flex"}
          alignItems="baseline"
          component="a"
          href="/"
          title="webbee"
          height={{ xs: 28, md: 32 }}
          width={45}
        >
          <WebbeeLogo height={"100%"} width={"100%"} />
        </Box>
      </Box>
      <Box display="flex" alignItems={"center"}></Box>
    </Box>
  );
};

export default Topbar;

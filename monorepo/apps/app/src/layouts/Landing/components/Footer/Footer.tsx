import React from "react";
import Grid from "@mui/material/Grid";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import WebbeeLogo from "svg/logos/Webbee";

const Footer = () => (
  <Grid container spacing={2}>
    <Grid item xs={12}>
      <Box
        display={"flex"}
        justifyContent={"space-between"}
        alignItems={"center"}
        width={"100%"}
        flexDirection={{ xs: "column", sm: "row" }}
      >
        <Box
          display={"flex"}
          component="a"
          href="/"
          title="webbee"
          height={24}
          width={35}
        >
          <WebbeeLogo height={"100%"} width={"100%"} />
        </Box>
        <Box display="flex" flexWrap={"wrap"} alignItems={"center"}></Box>
      </Box>
    </Grid>
    <Grid item xs={12}>
      <Typography
        align={"center"}
        variant={"subtitle2"}
        color="textSecondary"
        gutterBottom
      >
        &copy; Meelo. 2024. Todos os direitos reservados.
      </Typography>
      <Typography
        align={"center"}
        variant={"caption"}
        color="textSecondary"
        component={"p"}
      >
        Quando você visita ou interage com nossos sites, serviços ou
        ferramentas, nós ou nossos provedores de serviços autorizados podemos
        usar cookies para armazenar informações que ajudem a fornecer uma
        experiência melhor, mais rápida e mais segura, e para fins de marketing.
      </Typography>
    </Grid>
  </Grid>
);

export default Footer;

import React, { useState } from "react";
import Grid from "@mui/material/Grid";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
// import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import WebbeeLogo from "svg/logos/Webbee";
import { Alert, Link, Snackbar } from "@mui/material";
import supabase from "common/supabase";
import Dialog from "common/Dialog";

const Footer = () => {
  /**
   * State
   */

  const [isOpen, setIsOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  /**
   * Handlers
   */

  const onDialogSubmit = async (data: { email: string }) => {
    const { error } = await supabase
      .from("User")
      .insert({ email: data.email })
      .select();

    if (error) {
      console.error("error", error);
      return;
    }

    setAlertMessage("Email cadastrado com sucesso!");

    setIsOpen(true);
    setIsDialogOpen(false);
  };

  const handleClose = () => {
    setIsOpen(false);
    setIsDialogOpen(false);
  };

  const renderTerms = (
    <Typography
      component="div"
      sx={{
        mt: 3,
        textAlign: "center",
        typography: "caption",
        color: "text.secondary",
      }}
    >
      {
        "Ao visitar ou interagir com nossos sites, serviços ou ferramentas, eu concordo com os "
      }
      <Link
        underline="always"
        color="text.primary"
        href="https://www.wallex.com.br/page-terms"
        target="_blank"
      >
        Termos de Serviço
      </Link>
      {" e a "}
      <Link
        underline="always"
        color="text.primary"
        href="https://www.wallex.com.br/page-privacy"
        target="_blank"
      >
        Política de Privacidade
      </Link>
      .
    </Typography>
  );

  return (
    <Grid container spacing={2}>
      <Dialog
        open={isDialogOpen}
        onSubmit={onDialogSubmit}
        onClose={handleClose}
      />
      <Snackbar
        open={isOpen}
        autoHideDuration={6000}
        onClose={handleClose}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
      >
        <Alert
          onClose={handleClose}
          severity="success"
          variant="filled"
          sx={{ width: "100%" }}
        >
          {alertMessage}
        </Alert>
      </Snackbar>
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
          <Box display="flex" flexWrap={"wrap"} alignItems={"center"}>
            {/* <Box marginTop={1} marginRight={2}>
              <Link
                underline="none"
                component="a"
                href="/"
                color="textPrimary"
                variant={"subtitle2"}
              >
                Home
              </Link>
            </Box>
            <Box marginTop={1} marginRight={2}>
              <Link
                underline="none"
                component="a"
                href="/docs-introduction"
                color="textPrimary"
                variant={"subtitle2"}
              >
                Documentation
              </Link>
            </Box> */}
            <Box marginTop={1}>
              <Button
                variant="outlined"
                color="primary"
                component="a"
                href="https://app.wallex.com.br"
                size="small"
              >
                Inscreva-se Agora
              </Button>
            </Box>
          </Box>
        </Box>
      </Grid>
      <Grid item xs={12}>
        <Typography
          align={"center"}
          variant={"subtitle2"}
          color="textSecondary"
          gutterBottom
        >
          &copy; Wallex. 2024, Brazil. Todos os direitos reservados.
        </Typography>
        <Typography
          align={"center"}
          variant={"caption"}
          color="textSecondary"
          component={"p"}
        >
          Ao visitar ou interagir com nossos sites, serviços ou ferramentas, nós
          ou nossos provedores de serviços autorizados podemos usar cookies para
          armazenar informações que ajudem a fornecer uma experiência melhor,
          mais rápida e mais segura, além de para fins de marketing.
        </Typography>
        {renderTerms}
      </Grid>
    </Grid>
  );
};

export default Footer;

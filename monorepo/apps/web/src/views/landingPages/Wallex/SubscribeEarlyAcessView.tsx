import React, { useState } from "react";
import { useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Container from "common/Container";
import {
  Hero,
  Partners,
  Platforms,
  HowItWorks,
  Features,
  CtaSection,
} from "./components";
import Dialog from "common/Dialog";
import supabase from "common/supabase";
import { Alert, Snackbar } from "@mui/material";

const Payment = () => {
  const theme = useTheme();

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

  const onRegisterClick = () => {
    setIsDialogOpen(true);
  };

  const handleClose = () => {
    setIsOpen(false);
    setIsDialogOpen(false);
  };

  return (
    <Box>
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
      <Container>
        <Hero onClick={onRegisterClick} />
      </Container>
      <Box maxWidth={"100%"} bgcolor={theme.palette.primary.main}>
        <Container>
          <Partners />
        </Container>
      </Box>
      <Container>
        <HowItWorks />
      </Container>
      <Divider />
      <Container>
        <Features />
      </Container>

      <Box bgcolor={theme.palette.alternate?.main}>
        <Container>
          <Platforms />
        </Container>
      </Box>
      {/* <Container>
        <Reviews />
      </Container> */}
      <Box maxWidth={"100%"} bgcolor={theme.palette.alternate?.main}>
        <Container>
          <CtaSection onClick={onRegisterClick} />
        </Container>
      </Box>
    </Box>
  );
};

export default Payment;

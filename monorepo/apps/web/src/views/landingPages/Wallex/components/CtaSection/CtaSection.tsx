import React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";

type Props = {
  onClick: () => void;
};

const CtaSection = ({ onClick }: Props) => (
  <Box
    display={"flex"}
    justifyContent={"space-between"}
    alignItems={{ xs: "flex-start", sm: "center" }}
    flexDirection={{ xs: "column", sm: "row" }}
  >
    <Box>
      <Typography fontWeight={700} variant={"h6"} gutterBottom>
        Registre-se hoje e garanta acesso antecipado a platforma.
      </Typography>
      <Typography>
        Você está a um passo de simplificar a sua vida financeira.
      </Typography>
    </Box>
    <Box marginTop={{ xs: 2, sm: 0 }}>
      <Button variant="contained" size="large" href="https://app.wallex.com.br">
        Inscreva-se agora
      </Button>
    </Box>
  </Box>
);

export default CtaSection;

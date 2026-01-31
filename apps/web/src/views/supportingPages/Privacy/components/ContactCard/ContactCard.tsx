import React from "react";
import { useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";

const ContactCard = () => {
  const theme = useTheme();

  return (
    <Box
      component={Card}
      boxShadow={0}
      border={{
        xs: 0,
        md: `1px solid ${theme.palette.divider}`,
      }}
    >
      <Box
        paddingX={{ xs: 0, md: 3 }}
        paddingTop={3}
        paddingBottom={{ xs: 0, md: 3 }}
      >
        <Typography
          sx={{
            fontWeight: "700",
          }}
          gutterBottom
        >
          Como você pode nos contatar sobre este documento?
        </Typography>
        <Typography
          variant={"body2"}
          color={"textSecondary"}
          sx={{
            marginBottom: 2,
          }}
        >
          Se você tiver quaisquer perguntas ou preocupações sobre a política de
          privacidade, por favor, entre em contato conosco.
        </Typography>
        <Typography variant={"subtitle2"}>
          guilherme.kodama@gmail.com
        </Typography>
      </Box>
    </Box>
  );
};

export default ContactCard;

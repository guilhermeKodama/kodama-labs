import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Avatar from "@mui/material/Avatar";
import Grid from "@mui/material/Grid";
import GmailIcon from "../../../../../svg/icons/gmail_icon.svg";
import GoogleCalendarIcon from "../../../../../svg/icons/google_calendar_icon.svg";
import WhatsAppIcon from "../../../../../svg/icons/wpp_icon.svg";

const Platforms = () => {
  return (
    <Box>
      <Box marginBottom={4}>
        <Typography
          sx={{
            textTransform: "uppercase",
            fontWeight: "medium",
          }}
          gutterBottom
          color={"secondary"}
          align={"center"}
        >
          Integrações
        </Typography>
        <Box
          component={Typography}
          fontWeight={700}
          variant={"h3"}
          align={"center"}
          gutterBottom
        >
          Sincronize com suas ferramentas favoritas
        </Box>
        <Typography
          variant={"h6"}
          component={"p"}
          color={"textSecondary"}
          align={"center"}
        >
          A Wallex se integra com suas ferramentas favoritas para facilitar o
          seu dia a dia.
        </Typography>
      </Box>
      <Grid container spacing={2}>
        {[
          {
            title: "Gmail",
            subtitle:
              "Sincronize todos seus boletos e faturas a partir do seu email.",
            icon: GmailIcon,
            size: { width: 90, height: 70 },
          },
          {
            title: "Google Calendar",
            subtitle:
              "(em breve) Sincronize automaticamente todos suas contas e vencimentos na sua agenda.",
            icon: GoogleCalendarIcon,
          },
          {
            title: "WhatsApp",
            subtitle:
              "(em breve) Adicione seus gastos e receitas diretamente do seu WhatsApp.",
            icon: WhatsAppIcon,
          },
        ].map((item, i) => (
          <Grid item xs={12} md={4} key={i}>
            <Box width={1} height={"100%"} data-aos={"fade-up"}>
              <Box
                display={"flex"}
                flexDirection={"column"}
                alignItems={"center"}
              >
                <Box
                  component={Avatar}
                  width={item.size?.width || 90}
                  height={item.size?.height || 90}
                  marginBottom={2}
                  borderRadius={0}
                  src={item.icon}
                />
                <Typography
                  variant={"h6"}
                  gutterBottom
                  fontWeight={500}
                  align={"center"}
                >
                  {item.title}
                </Typography>
                <Typography align={"center"} color="textSecondary">
                  {item.subtitle}
                </Typography>
              </Box>
            </Box>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default Platforms;

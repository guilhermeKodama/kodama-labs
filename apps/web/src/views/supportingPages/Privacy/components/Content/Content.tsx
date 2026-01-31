import React from "react";
import PropTypes from "prop-types";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

const PrivacySection = ({
  title,
  description,
}: {
  title: string;
  description: string;
}) => {
  return (
    <Box>
      <Typography
        variant={"h6"}
        gutterBottom
        sx={{
          fontWeight: "medium",
        }}
      >
        {title}
      </Typography>
      <Typography component={"p"} color={"textSecondary"}>
        {description}
      </Typography>
    </Box>
  );
};

PrivacySection.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
};

const Content = () => {
  const data = [
    {
      title: "1. Informações que Coletamos",
      description: "",
    },
    {
      title: "1.1 Informações Pessoais",
      description:
        "Quando você usa o Wallex, podemos coletar informações de identificação pessoal, como seu nome, endereço de email e outras informações de contato.",
    },
    {
      title: "1.2 Informações de Sincronização de Emails",
      description:
        "Para proporcionar a automação do controle financeiro pessoal, coletamos e processamos automaticamente os emails recebidos de bancos. Esses emails são sincronizados com a nossa base de dados para identificar transações financeiras e facilitar a gestão de suas finanças.",
    },
    {
      title: "1.3 Informações de Uso",
      description:
        "Podemos coletar informações sobre como você usa o Wallex, incluindo as páginas visualizadas, as funcionalidades utilizadas, e outras atividades dentro do aplicativo.",
    },
    {
      title: "2. Como Usamos Suas Informações",
      description: "",
    },
    {
      title: "2.1 Processamento de Emails",
      description:
        "Os emails sincronizados de sua conta bancária são processados exclusivamente para automatizar seu controle financeiro pessoal. Não utilizamos essas informações para qualquer outra finalidade sem o seu consentimento expresso.",
    },
    {
      title: "2.2 Melhorias no Serviço",
      description:
        "Podemos usar as informações coletadas para melhorar nosso aplicativo, personalizar sua experiência e desenvolver novos recursos.",
    },
    {
      title: "2.3 Comunicação",
      description:
        "Podemos usar suas informações para enviar atualizações, notificações ou outras comunicações relacionadas ao Wallex. Você pode optar por não receber essas comunicações a qualquer momento.",
    },
    {
      title: "3. Armazenamento e Proteção das Informações",
      description: "",
    },
    {
      title: "3.1 Segurança",
      description:
        "Implementamos medidas de segurança técnicas e organizacionais adequadas para proteger suas informações contra acesso não autorizado, alteração, divulgação ou destruição. Isso inclui, mas não se limita a, criptografia de dados e autenticação robusta.",
    },
    {
      title: "3.2 Retenção de Dados",
      description:
        "Manteremos suas informações pelo tempo necessário para cumprir os propósitos descritos nesta política, a menos que um período de retenção maior seja exigido ou permitido por lei.",
    },
    {
      title: "4. Compartilhamento de Informações",
      description: "",
    },
    {
      title: "4.1 Terceiros",
      description:
        "Não vendemos, comercializamos ou transferimos suas informações pessoais para terceiros, exceto para provedores de serviços que nos auxiliam na operação do Wallex e que concordam em manter essas informações confidenciais.",
    },
    {
      title: "4.2 Requisitos Legais",
      description:
        "Podemos divulgar suas informações se acreditarmos que é necessário para cumprir a lei, proteger nossos direitos, ou responder a processos legais.",
    },
    {
      title: "5. Direitos dos Usuários",
      description: "",
    },
    {
      title: "5.1 Acesso e Correção",
      description:
        "Você tem o direito de acessar e corrigir suas informações pessoais que mantemos. Para fazer isso, entre em contato conosco usando as informações abaixo.",
    },
    {
      title: "5.2 Exclusão e Portabilidade",
      description:
        "Você pode solicitar a exclusão de suas informações pessoais ou a portabilidade dos seus dados em um formato estruturado e de uso comum. Entre em contato conosco para exercer esses direitos.",
    },
    {
      title: "6. Alterações nesta Política de Privacidade",
      description:
        "Podemos atualizar esta Política de Privacidade periodicamente para refletir mudanças em nossas práticas ou por outros motivos operacionais, legais ou regulamentares. Quando fizermos alterações, notificaremos você através do aplicativo ou por email.",
    },
    {
      title: "7. Contato",
      description:
        "Se você tiver dúvidas ou preocupações sobre esta Política de Privacidade, ou se desejar exercer seus direitos, entre em contato conosco: Wallex, guilherme.kodama@gmail.com, (11) 98776-2113.",
    },
  ];
  return (
    <Box>
      {data.map((item, i) => (
        <Box key={i} marginBottom={i < data.length - 1 ? 4 : 0}>
          <PrivacySection {...item} />
        </Box>
      ))}
    </Box>
  );
};

export default Content;

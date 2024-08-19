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
      title: "1. Aceitação dos Termos",
      description:
        "Ao criar uma conta, acessar ou utilizar o Wallex, você aceita e concorda em cumprir estes Termos de Serviço e todas as leis e regulamentos aplicáveis. Caso você não concorde com estes termos, não utilize o serviço.",
    },
    {
      title: "2. Modificações nos Termos",
      description:
        "Nós nos reservamos o direito de revisar e alterar estes Termos de Serviço a qualquer momento. As alterações serão publicadas nesta página, e notificaremos você por email ou através do aplicativo se as alterações forem significativas. O uso contínuo do Wallex após a publicação de qualquer alteração constitui sua aceitação dos novos Termos de Serviço.",
    },
    {
      title: "3. Descrição do Serviço",
      description:
        "O Wallex oferece uma plataforma que visa simplificar o controle financeiro pessoal através de automatizações que te permitem economizar tempo e energia para manter seu controle financeiro em dia. Nos esforçamos para garantir a disponibilidade e precisão do serviço, mas não garantimos que o serviço será ininterrupto ou livre de erros.",
    },
    {
      title: "4. Cadastro e Conta de Usuário",
      description: "",
    },
    {
      title: "4.1 Elegibilidade",
      description:
        "Para usar o Wallex, você deve ter pelo menos 14 anos. Ao criar uma conta, você confirma que cumpre este requisito.",
    },
    {
      title: "4.2 Responsabilidade da Conta",
      description:
        "Você concorda em fornecer informações verdadeiras, precisas e completas ao criar sua conta e em mantê-las atualizadas. Você é responsável por todas as atividades que ocorrem sob sua conta, devendo manter sua senha segura. Notifique-nos imediatamente em caso de uso não autorizado de sua conta.",
    },
    {
      title: "5. Uso Aceitável",
      description: "",
    },
    {
      title: "5.1 Regras de Conduta",
      description:
        "Você concorda em utilizar o Wallex de maneira legal e respeitosa. É proibido: Usar o serviço para qualquer atividade ilegal ou não autorizada. Interferir ou tentar interromper o funcionamento do Wallex. Violar a privacidade ou direitos de outros usuários.",
    },
    {
      title: "5.2 Suspensão ou Rescisão de Conta",
      description:
        "Reservamo-nos o direito de suspender ou encerrar sua conta a qualquer momento, sem aviso prévio, se acreditarmos que você violou estes Termos de Serviço.",
    },
    {
      title: "6. Propriedade Intelectual",
      description:
        "Todo o conteúdo e materiais disponíveis no Wallex, incluindo textos, gráficos, logotipos, ícones, imagens, clipes de áudio, compilações de dados e software, são de propriedade exclusiva de Wallex ou de seus licenciadores, e são protegidos por leis de direitos autorais, marcas registradas e outras leis de propriedade intelectual. Você não pode copiar, modificar, distribuir, vender ou alugar qualquer parte de nossos serviços ou do software incluído.",
    },
    {
      title: "7. Privacidade",
      description:
        "A proteção de sua privacidade é importante para nós. Por favor, consulte nossa Política de Privacidade para entender como coletamos, usamos e protegemos suas informações pessoais.",
    },
    {
      title: "8. Limitação de Responsabilidade",
      description: "",
    },
    {
      title: "8.1 Isenção de Garantias",
      description:
        "O Wallex é fornecido 'como está' e 'conforme disponível'. Não garantimos que o serviço será ininterrupto, livre de erros, seguro ou que qualquer informação obtida através do serviço seja precisa ou confiável.",
    },
    {
      title: "8.2 Limitação de Responsabilidade",
      description:
        "Em nenhum caso, Wallex, seus diretores, funcionários, parceiros ou fornecedores serão responsáveis por quaisquer danos indiretos, incidentais, especiais, consequenciais ou punitivos decorrentes do uso ou incapacidade de uso do Wallex.",
    },
    {
      title: "9. Indenização",
      description:
        "Você concorda em defender, indenizar e isentar Wallex e seus funcionários, diretores, agentes, parceiros e licenciadores de qualquer reivindicação, dano, obrigação, perda, responsabilidade, custo ou dívida, e despesa (incluindo, mas não limitado a, honorários advocatícios) decorrentes de: Seu uso e acesso ao Wallex. Sua violação de qualquer termo destes Termos de Serviço. Sua violação de qualquer direito de terceiros, incluindo, sem limitação, qualquer direito de privacidade ou propriedade intelectual.",
    },
    {
      title: "10. Alterações no Serviço",
      description:
        "Nós nos reservamos o direito de modificar ou descontinuar o Wallex ou qualquer serviço associado, no todo ou em parte, a qualquer momento, sem aviso prévio.",
    },
    {
      title: "11. Lei Aplicável e Jurisdição",
      description:
        "Estes Termos de Serviço são regidos e interpretados de acordo com as leis do Brazil/SP, sem considerar os conflitos de leis. Você concorda que qualquer disputa ou reivindicação decorrente ou relacionada a estes Termos de Serviço será resolvida exclusivamente nos tribunais localizados em São Paulo/SP.",
    },
    {
      title: "12. Disposições Gerais",
      description: "",
    },
    {
      title: "12.1 Acordo Integral",
      description:
        "Estes Termos de Serviço constituem o acordo integral entre você e Wallex em relação ao uso do Wallex, substituindo qualquer acordo anterior.",
    },
    {
      title: "12.2 Divisibilidade",
      description:
        "Se qualquer disposição destes Termos de Serviço for considerada inválida ou inexequível, as disposições restantes continuarão em pleno vigor e efeito.",
    },
    {
      title: "12.3 Renúncia",
      description:
        "Nossa falha em exercer ou fazer cumprir qualquer direito ou disposição destes Termos de Serviço não constituirá uma renúncia a esse direito ou disposição.",
    },
    {
      title: "13. Contato",
      description:
        "Se você tiver quaisquer dúvidas sobre estes Termos de Serviço, por favor, entre em contato conosco: Wallex, guilherme.kodama@gmail.com, (11) 98776-2113.",
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

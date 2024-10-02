import ReactGA from "react-ga4";

// Inicializa o Google Analytics com o ID de acompanhamento
export const initGA = () => {
  ReactGA.initialize("G-B8PFR53CKJ"); // Substitua pelo seu próprio ID
};

// Função para registrar visitas de página
export const logPageView = (page: any) => {
  ReactGA.send({ hitType: "pageview", page: page });
};

export const sendEvent = (data: any) => {
  ReactGA.event(data);
};

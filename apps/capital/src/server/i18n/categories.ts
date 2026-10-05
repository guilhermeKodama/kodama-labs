import { defineDictionary } from "./define";

/**
 * System category names by systemKey (src/server/modules/categories/lib/system-categories.ts).
 * The en names are the catalog's own names, which legacy rows are matched by.
 * pt-BR follows the mockup's vocabulary (Mercado, Restaurantes, Saúde, ...).
 */
export const categories = defineDictionary(
  {
    system: {
      client_payment: "Receita de serviços",
      salary: "Salário",
      dividends: "Dividendos",
      interest: "Rendimentos",
      refund: "Reembolsos",
      other_income: "Outras receitas",

      software_tools: "Software",
      hardware: "Equipamentos",
      office: "Escritório",
      travel_default: "Viagens",
      marketing: "Marketing",
      legal_accounting: "Contabilidade",
      taxes: "Impostos",
      insurance: "Seguros",
      utilities: "Contas de consumo",
      other_expense: "Outras despesas",

      stocks: "Ações",
      bonds: "Renda fixa",
      crypto: "Cripto",
      real_estate: "Imóveis",
      savings: "Poupança",
      retirement: "Previdência",
      other_investment: "Outros investimentos",

      credit_card: "Cartão de crédito",
      subscriptions: "Assinaturas",
      groceries: "Mercado",
      restaurants_dining: "Restaurantes",
      transportation: "Transporte",
      shopping: "Compras",
      entertainment: "Lazer",
      health_pharmacy: "Saúde",
      education: "Educação",
      personal_care: "Cuidados pessoais",
      home: "Casa",
      fees_charges: "Tarifas",
      other_system: "Outros",
    },
  },
  {
    system: {
      client_payment: "Client Payment",
      salary: "Salary",
      dividends: "Dividends",
      interest: "Interest",
      refund: "Refund",
      other_income: "Other Income",

      software_tools: "Software & Tools",
      hardware: "Hardware",
      office: "Office",
      travel_default: "Travel",
      marketing: "Marketing",
      legal_accounting: "Legal & Accounting",
      taxes: "Taxes",
      insurance: "Insurance",
      utilities: "Utilities",
      other_expense: "Other Expense",

      stocks: "Stocks",
      bonds: "Bonds",
      crypto: "Crypto",
      real_estate: "Real Estate",
      savings: "Savings",
      retirement: "Retirement",
      other_investment: "Other Investment",

      credit_card: "Credit Card",
      subscriptions: "Subscriptions",
      groceries: "Groceries",
      restaurants_dining: "Restaurants & Dining",
      transportation: "Transportation",
      shopping: "Shopping",
      entertainment: "Entertainment",
      health_pharmacy: "Health & Pharmacy",
      education: "Education",
      personal_care: "Personal Care",
      home: "Home",
      fees_charges: "Fees & Charges",
      other_system: "Other",
    },
  }
);

export type SystemCategoryNameKey = keyof (typeof categories)["pt-BR"]["system"];

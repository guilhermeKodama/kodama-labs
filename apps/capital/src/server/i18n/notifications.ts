import { defineDictionary } from "./define";

/**
 * Push notification texts (recurring-bill reminders, card bill closed,
 * budget threshold, weekly summary), in the user's locale. Amounts and
 * dates arrive already formatted with the user's preferences.
 */
export const notifications = defineDictionary(
  {
    reminder: {
      title: "Lembrete: {description}",
      overdueTitle: "Atrasado: {description}",
      dueToday: "Vence hoje",
      dueTomorrow: "Vence amanhã",
      dueInDays: "Vence em {days} dias",
      body: "{when} — ~{amount} ({category})",
      overdueOne: "Venceu há 1 dia — ~{amount} ({category}). Marque como pago ou concluído.",
      overdueMany: "Venceu há {days} dias — ~{amount} ({category}). Marque como pago ou concluído.",
      uncategorized: "Sem categoria",
    },
    billClosed: {
      title: "Fatura do {card} fechou",
      body: "{amount} · vence {due}",
      bodyNoDue: "{amount} em {count} compras",
    },
    budget: {
      title: "Orçamento de {category} passou de {threshold}",
      body: "{spent} de {budget} em {month}",
    },
    weekly: {
      title: "Resumo semanal",
      body: "{from} a {to}: {expense} em saídas · {income} em entradas",
    },
  },
  {
    reminder: {
      title: "Reminder: {description}",
      overdueTitle: "Overdue: {description}",
      dueToday: "Due today",
      dueTomorrow: "Due tomorrow",
      dueInDays: "Due in {days} days",
      body: "{when} — ~{amount} ({category})",
      overdueOne: "Due 1 day ago — ~{amount} ({category}). Mark it as paid or done.",
      overdueMany: "Due {days} days ago — ~{amount} ({category}). Mark it as paid or done.",
      uncategorized: "Uncategorized",
    },
    billClosed: {
      title: "{card} statement closed",
      body: "{amount} · due {due}",
      bodyNoDue: "{amount} in {count} purchases",
    },
    budget: {
      title: "{category} budget passed {threshold}",
      body: "{spent} of {budget} in {month}",
    },
    weekly: {
      title: "Weekly summary",
      body: "{from} to {to}: {expense} out · {income} in",
    },
  }
);

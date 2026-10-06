/**
 * The kind label the Negócios e PF list shows on the right: "Pessoa física",
 * "Empresa (Brasil)", "Empresa (EUA)", derived from the entity's default
 * currency (entities have no country). Message keys: settings.ent.kind.<key>.
 */
export type EntityKindLabel = { key: "personal" } | { key: "businessBR" } | { key: "businessUS" } | { key: "business"; currency: string };

export function entityKindLabel(entity: { kind: "personal" | "business"; defaultCurrency: string }): EntityKindLabel {
  if (entity.kind === "personal") return { key: "personal" };
  const currency = entity.defaultCurrency.toUpperCase();
  if (currency === "BRL") return { key: "businessBR" };
  if (currency === "USD") return { key: "businessUS" };
  return { key: "business", currency };
}

import type { AccountRecord, AccountType, CategoryRecord, CategoryType } from "@/lib/api/catalog";
import type { SessionEntity } from "@/lib/api/session";
import type { ComboboxOption } from "@/lib/combobox";

/**
 * Option lists for the domain pickers (src/components/pickers), from the
 * catalog queries. Pure, so the filtering is tested without a session or
 * data; the components pass in the translated labels.
 */

/** Short label per entity ("PF" for the personal one), used in badges and pickers. */
export function entityLabel(entity: { kind: string; name: string }): string {
  return entity.kind === "personal" ? "PF" : entity.name;
}

/**
 * CategoryCombobox: categories of `types` (all when null), archived ones
 * hidden except the current value, which is marked archived. The type is
 * the hint when more than one type is listed.
 */
export function categoryOptions(
  categories: readonly CategoryRecord[],
  {
    types,
    value,
    archivedLabel,
    typeLabel,
  }: {
    types: readonly CategoryType[] | null;
    value: string | null;
    archivedLabel: string;
    typeLabel: (type: CategoryType) => string;
  },
): ComboboxOption[] {
  return categories
    .filter((category) => (!types || types.includes(category.type)) && (!category.isArchived || category.id === value))
    .map((category) => ({
      value: category.id,
      label: category.name,
      hint: category.isArchived ? archivedLabel : !types || types.length > 1 ? typeLabel(category.type) : undefined,
    }));
}

/**
 * AccountCombobox: accounts of `entityIds` and `types` (all when null),
 * archived ones hidden except the current value. The entity is the hint
 * unless the list is limited to one entity; entity, institution and
 * account type are also searchable.
 */
export function accountOptions(
  accounts: readonly AccountRecord[],
  {
    entityIds,
    types,
    value,
    entities,
    archivedLabel,
    typeLabel,
  }: {
    entityIds: readonly string[] | null;
    types: readonly AccountType[] | null;
    value: string | null;
    /** The session's entities, for the hint. */
    entities: readonly SessionEntity[];
    archivedLabel: string;
    typeLabel: (type: AccountType) => string;
  },
): ComboboxOption[] {
  const labels = new Map(entities.map((entity) => [entity.id, entityLabel(entity)]));
  return accounts
    .filter(
      (account) =>
        (!entityIds || entityIds.includes(account.entityId)) &&
        (!types || types.includes(account.type)) &&
        (!account.archivedAt || account.id === value),
    )
    .map((account) => {
      const entity = labels.get(account.entityId) ?? "";
      return {
        value: account.id,
        label: account.name,
        // With one entity the hint would repeat on every row.
        hint: account.archivedAt ? archivedLabel : entityIds?.length === 1 ? undefined : entity,
        keywords: [entity, account.institution ?? "", typeLabel(account.type)],
      };
    });
}

/** EntitySelect: entities of `kinds` (all when null); one outside the base currency shows it as the hint. */
export function entityOptions(
  entities: readonly SessionEntity[],
  { kinds, baseCurrency }: { kinds: readonly SessionEntity["kind"][] | null; baseCurrency: string | undefined },
): { value: string; label: string; hint?: string }[] {
  return entities
    .filter((entity) => !kinds || kinds.includes(entity.kind))
    .map((entity) => ({
      value: entity.id,
      label: entityLabel(entity),
      hint: entity.defaultCurrency !== baseCurrency ? entity.defaultCurrency : undefined,
    }));
}

/**
 * Ownership filter for a bill line item, whether it hangs off a legacy bill
 * or a credit card statement. #64 cascade sites can reuse this after the merge
 * so a rename/delete/merge matches both parents.
 */
export function billTransactionOwnedBy(userId: string, creditCardId?: string) {
  const card = () => ({
    ...(creditCardId ? { id: creditCardId } : {}),
    OR: [{ business: { userId } }, { personalAccount: { userId } }],
  });
  return {
    OR: [
      { bill: { creditCard: card() } },
      { statement: { creditCard: card() } },
    ],
  };
}

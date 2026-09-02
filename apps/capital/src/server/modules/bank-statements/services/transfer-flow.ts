/**
 * Which way the money actually moved, seen from the entity whose
 * statement is being imported: "outflow" = it left that account,
 * "inflow" = it arrived in it.
 *
 * This is a FACT read off the statement row (expense -> outflow, income
 * -> inflow), never an inference. `direction` is a different thing: the
 * *reason* the money moved. The two are independent, because the same
 * reason is an outflow on one side's statement and an inflow on the
 * other's - a profit distribution leaves the business account and
 * arrives in the personal one, so "profit_distribution" alone says
 * nothing about which way the cash went on the file you are importing.
 *
 * Deriving the flow from the label (`isOutgoing = direction ===
 * "capital_injection"`) is what let an outgoing profit distribution on a
 * business statement be written as money coming IN. Every writer takes
 * the flow from the row and uses `direction` only as a label.
 */
export type TransferFlow = "outflow" | "inflow";

export type TransferEntityType = "business" | "personal";

export type EntityTransferDirection =
  | "profit_distribution"
  | "capital_injection"
  | "reimbursement";

export type InvestmentTransferDirection = "investment_deposit" | "investment_withdrawal";

/** The only place a flow may come from: the sign of the parsed row. */
export function flowForRowType(type: "income" | "expense"): TransferFlow {
  return type === "expense" ? "outflow" : "inflow";
}

/**
 * Investment transfers are the one case where the label DOES fix the
 * flow: an aporte always leaves the entity's account, a resgate always
 * arrives in it. There is no second statement side to confuse it with,
 * because the investment account is not an entity with its own import.
 */
export function flowForInvestmentDirection(direction: InvestmentTransferDirection): TransferFlow {
  return direction === "investment_deposit" ? "outflow" : "inflow";
}

/**
 * Which entity role each direction implies. `Transfer.from*` is always
 * the payer and `to*` the payee, so these are the shapes a direction is
 * allowed to end up with - the same table `directionMatchesExistingShape`
 * enforces in execute-import.ts for transfer reconciliations.
 */
const DIRECTION_ROLES: Record<
  EntityTransferDirection,
  { from: TransferEntityType; to: TransferEntityType }
> = {
  profit_distribution: { from: "business", to: "personal" },
  reimbursement: { from: "business", to: "personal" },
  capital_injection: { from: "personal", to: "business" },
};

export interface TransferSidesInput {
  flow: TransferFlow;
  /** The entity whose statement is being imported. */
  entityType: TransferEntityType;
  entityId: string;
  counterpartyEntityType: TransferEntityType;
  counterpartyEntityId: string;
}

export interface TransferSides {
  fromEntityType: TransferEntityType;
  fromEntityId: string;
  toEntityType: TransferEntityType;
  toEntityId: string;
}

/** Payer/payee follow from the flow alone - the label never enters into it. */
export function resolveTransferSides(input: TransferSidesInput): TransferSides {
  const outgoing = input.flow === "outflow";
  return {
    fromEntityType: outgoing ? input.entityType : input.counterpartyEntityType,
    fromEntityId: outgoing ? input.entityId : input.counterpartyEntityId,
    toEntityType: outgoing ? input.counterpartyEntityType : input.entityType,
    toEntityId: outgoing ? input.counterpartyEntityId : input.entityId,
  };
}

export type DirectionCheck =
  | { status: "ok" }
  /** Both sides are the same kind of entity, so the label can't be checked. */
  | { status: "unverifiable" }
  | { status: "violation"; message: string };

/**
 * Does the label agree with who ended up paying whom? A
 * `capital_injection` whose payer is a business is a contradiction: the
 * label says the person funded the company, the cash says the opposite.
 * Business<->business movements are unverifiable - none of the three
 * labels encodes roles for them.
 */
export function checkTransferDirection(
  direction: EntityTransferDirection,
  sides: Pick<TransferSides, "fromEntityType" | "toEntityType">
): DirectionCheck {
  if (sides.fromEntityType === sides.toEntityType) return { status: "unverifiable" };

  const roles = DIRECTION_ROLES[direction];
  if (roles.from === sides.fromEntityType && roles.to === sides.toEntityType) {
    return { status: "ok" };
  }
  return {
    status: "violation",
    message: `direction "${direction}" means ${roles.from} -> ${roles.to}, but this transfer is ${sides.fromEntityType} -> ${sides.toEntityType}`,
  };
}

/**
 * The labels that are legal once the flow and the two entity types are
 * known. Empty is impossible: every business<->personal pair has at
 * least one, and same-type pairs accept all of them.
 */
export function allowedDirectionsForFlow(
  flow: TransferFlow,
  entityType: TransferEntityType,
  counterpartyEntityType: TransferEntityType
): EntityTransferDirection[] {
  const sides = resolveTransferSides({
    flow,
    entityType,
    entityId: "",
    counterpartyEntityType,
    counterpartyEntityId: "",
  });
  const all = Object.keys(DIRECTION_ROLES) as EntityTransferDirection[];
  return all.filter((d) => checkTransferDirection(d, sides).status !== "violation");
}

/**
 * Best-effort label for a row the classifier matched to one of the
 * user's entities. Only a suggestion - the flow is the part that must be
 * right, and it comes from the row, not from here.
 */
export function suggestDirectionForFlow(
  flow: TransferFlow,
  entityType: TransferEntityType,
  counterpartyEntityType: TransferEntityType
): EntityTransferDirection {
  if (entityType === counterpartyEntityType) {
    // Same-type pair: nothing to derive, keep the historical guess.
    return flow === "outflow" ? "capital_injection" : "profit_distribution";
  }
  // profit_distribution before reimbursement - both are business ->
  // personal, and the former is the far more common reading.
  return allowedDirectionsForFlow(flow, entityType, counterpartyEntityType)[0];
}

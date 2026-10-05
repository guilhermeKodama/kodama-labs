import type { EntityType, TransactionType, AssetClass, AllocationClass } from "@/generated/prisma";

export interface BulkCreateTransactionItem {
  entityType: EntityType;
  type: TransactionType;
  amount: number;
  currency: string;
  exchangeRate?: number;
  description: string;
  category: string;
  date: string; // ISO date string
  isTaxDeductible?: boolean;
  businessId?: string;
  personalAccountId?: string;
}

export interface BulkCreateResult {
  created: Array<{
    id: string;
    description: string;
    amount: number;
    date: string;
  }>;
  duplicates: Array<{
    description: string;
    amount: number;
    date: string;
    existingId: string;
  }>;
  errors: Array<{
    item: BulkCreateTransactionItem;
    error: string;
  }>;
}

export interface ListTransactionsParams {
  dateFrom?: string;
  dateTo?: string;
  type?: TransactionType;
  category?: string;
  entityType?: EntityType;
  businessId?: string;
  personalAccountId?: string;
}

export interface TransactionSummary {
  type: TransactionType;
  category: string;
  total: number;
  count: number;
  currency: string;
}

export interface InvestmentPosition {
  id: string;
  ticker: string | null;
  name: string;
  assetClass: AssetClass;
  /** Portfolio class (one of six) the asset counts under on the investments screen. */
  allocationClass: AllocationClass;
  currentQuantity: number;
  averageCost: number;
  totalInvested: number;
  currentPrice: number | null;
  currentValue: number | null;
  unrealizedGain: number | null;
  currency: string;
  accountName: string;
}

export interface AdjustPositionParams {
  holdingId: string;
  currentQuantity: number;
  averageCost: number;
  notes?: string;
}

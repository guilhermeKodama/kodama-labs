'use client';

import { useState, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  Upload,
  FileText,
  Loader2,
  Check,
  CreditCard,
  ArrowRight,
  ArrowLeft,
  X,
  Sparkles,
  AlertTriangle,
  ArrowLeftRight,
  Wallet,
  Plus,
  RefreshCw,
  HelpCircle,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Business, EntityType, CreditCard as CreditCardType, InvestmentAccount } from '@/types';
import { client } from '@/lib/api-client';
import {
  flowForRowType,
  allowedDirectionsForFlow,
} from '@capital/server/modules/bank-statements/services/transfer-flow';
import { useInvestmentStore } from '@/lib/store';

// ---------------------------------------------------------------------------
// Types for the enriched parse response
// ---------------------------------------------------------------------------

interface ClassificationCandidate {
  type: 'regular_transaction' | 'entity_transfer' | 'investment_transfer' | 'credit_card_payment';
  confidence: 'high' | 'medium' | 'low';
  transferDetails?: {
    suggestedEntityId: string;
    suggestedEntityName: string;
    suggestedEntityType: 'business' | 'personal';
    suggestedFlow: 'outflow' | 'inflow';
    suggestedDirection: 'profit_distribution' | 'capital_injection' | 'reimbursement';
  };
  investmentDetails?: {
    direction: 'investment_deposit' | 'investment_withdrawal';
    suggestedAccountId?: string;
  };
  creditCardDetails?: {
    suggestedBankName: string;
    dueDay: number;
    closingDay: number;
  };
}

interface FieldDiff {
  field: 'amount' | 'date' | 'description';
  existingValue: string;
  ofxValue: string;
}

interface FuzzyMatchedTransaction {
  id: string;
  description: string;
  amount: number;
  date: string;
  type: 'income' | 'expense';
}

interface ParsedTransaction {
  fitId: string;
  date: string;
  description: string;
  fullDescription: string;
  amount: number;
  type: 'income' | 'expense';
  reconciliationStatus: 'new' | 'duplicate' | 'changed' | 'fuzzy_match';
  existingTransactionId?: string;
  diffs?: FieldDiff[];
  fuzzyMatchedTransaction?: FuzzyMatchedTransaction;
  candidates: ClassificationCandidate[];
  resolvedClassification?: string;
  needsResolution: boolean;
  isDuplicate: boolean;
  selected: boolean;
}

interface ParseResult {
  bankName: string;
  accountId: string;
  currency: string;
  ledgerBalance: number;
  transactions: ParsedTransaction[];
  summary: {
    totalIncome: number;
    totalExpenses: number;
    newCount: number;
    duplicateCount: number;
    changedCount: number;
    fuzzyMatchCount: number;
    needsResolutionCount: number;
  };
}

// Client-side resolution state for each transaction
interface Resolution {
  classification: ClassificationCandidate['type'];
  // For entity_transfer
  entityId?: string;
  entityName?: string;
  entityType?: 'business' | 'personal';
  direction?: 'profit_distribution' | 'capital_injection' | 'reimbursement';
  // For investment_transfer
  investmentAccountId?: string;
  investmentDirection?: 'investment_deposit' | 'investment_withdrawal';
  // For credit_card_payment
  creditCard?: {
    bankName: string;
    lastFourDigits: string;
    closingDay: number;
    dueDay: number;
    currency: string;
  };
}

// Reconciliation: which changed transactions to update
interface ReconciliationChoice {
  existingTransactionId: string;
  externalId: string;
  action: 'update' | 'keep';
  updates: {
    amount?: number;
    date?: string;
    description?: string;
  };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StatementUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businesses: Business[];
  personalAccountId: string | null;
  existingCreditCards: CreditCardType[];
  investmentAccounts: InvestmentAccount[];
  defaultEntityType?: EntityType;
  defaultEntityId?: string;
  onImportComplete: () => void;
  currentBalance?: number;
}

type Step = 'upload' | 'entity' | 'dedup' | 'resolve' | 'preview' | 'confirm';

const STEPS: Step[] = ['upload', 'entity', 'dedup', 'resolve', 'preview', 'confirm'];

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function StatementUploadDialog({
  open,
  onOpenChange,
  businesses,
  personalAccountId,
  existingCreditCards,
  investmentAccounts: initialInvestmentAccounts,
  defaultEntityType,
  defaultEntityId,
  onImportComplete,
  currentBalance,
}: StatementUploadDialogProps) {
  const t = useTranslations('bankStatements');
  const tCommon = useTranslations('common');
  const { addAccount: addInvestmentAccount } = useInvestmentStore();

  // Step state
  const [currentStep, setCurrentStep] = useState<Step>('upload');

  // Upload state
  const [files, setFiles] = useState<Array<{ name: string; content: string }>>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse result
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);

  // Entity state
  const [entityType, setEntityType] = useState<EntityType>(defaultEntityType ?? 'personal');

  // The parser suggests a direction without knowing whose statement this
  // is; once the entity is picked, only some labels still agree with the
  // row's sign. Keep the suggestion when it survives, else take the
  // first label that does.
  const pickDirection = (
    txType: 'income' | 'expense',
    counterpartyEntityType: 'business' | 'personal',
    suggested: 'profit_distribution' | 'capital_injection' | 'reimbursement'
  ) => {
    const allowed = allowedDirectionsForFlow(
      flowForRowType(txType),
      entityType,
      counterpartyEntityType
    );
    return allowed.includes(suggested) ? suggested : allowed[0];
  };
  const [entityId, setEntityId] = useState<string>(defaultEntityId ?? personalAccountId ?? '');

  // Fuzzy duplicate decisions: map fitId -> 'same' (skip import) | 'different' (import as new)
  const [fuzzyDecisions, setFuzzyDecisions] = useState<Map<string, 'same' | 'different'>>(new Map());

  // Resolution state: map fitId -> user's classification choice
  const [resolutions, setResolutions] = useState<Map<string, Resolution>>(new Map());

  // Reconciliation choices: map fitId -> update/keep choice
  const [reconciliationChoices, setReconciliationChoices] = useState<Map<string, ReconciliationChoice>>(new Map());

  // Inline entity creation state
  const [creatingEntityForFitId, setCreatingEntityForFitId] = useState<string | null>(null);
  const [newBusinessName, setNewBusinessName] = useState('');
  const [isCreatingBusiness, setIsCreatingBusiness] = useState(false);
  const [newInvestmentAccountName, setNewInvestmentAccountName] = useState('');
  const [newInvestmentAccountBroker, setNewInvestmentAccountBroker] = useState('');
  const [isCreatingInvestmentAccount, setIsCreatingInvestmentAccount] = useState(false);
  const [creatingInvAccountForFitId, setCreatingInvAccountForFitId] = useState<string | null>(null);

  // Track locally created investment accounts
  const [localInvestmentAccounts, setLocalInvestmentAccounts] = useState<InvestmentAccount[]>([]);
  const allInvestmentAccounts = [...initialInvestmentAccounts, ...localInvestmentAccounts];

  // Track locally created businesses
  const [localBusinesses, setLocalBusinesses] = useState<Business[]>([]);
  const allBusinesses = [...businesses, ...localBusinesses];

  // Import state
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    imported: number;
    duplicatesSkipped: number;
    reconciled: number;
    transfersCreated: number;
    creditCardsCreated: number;
    investmentTransfersCreated: number;
    fuzzyDuplicatesLinked: number;
  } | null>(null);

  const reset = useCallback(() => {
    setCurrentStep('upload');
    setFiles([]);
    setIsParsing(false);
    setParseError(null);
    setParseResult(null);
    setEntityType(defaultEntityType ?? 'personal');
    setEntityId(defaultEntityId ?? personalAccountId ?? '');
    setFuzzyDecisions(new Map());
    setResolutions(new Map());
    setReconciliationChoices(new Map());
    setCreatingEntityForFitId(null);
    setNewBusinessName('');
    setIsCreatingBusiness(false);
    setNewInvestmentAccountName('');
    setNewInvestmentAccountBroker('');
    setIsCreatingInvestmentAccount(false);
    setCreatingInvAccountForFitId(null);
    setLocalInvestmentAccounts([]);
    setLocalBusinesses([]);
    setIsImporting(false);
    setImportResult(null);
  }, [defaultEntityType, defaultEntityId, personalAccountId]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
    setTimeout(reset, 300);
  }, [onOpenChange, reset]);

  // ---------------------------------------------------------------------------
  // File upload
  // ---------------------------------------------------------------------------

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;
    const newFiles: Array<{ name: string; content: string }> = [];
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const content = await file.text();
      newFiles.push({ name: file.name, content });
    }
    setFiles((prev) => [...prev, ...newFiles]);
    setParseError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleParse = async () => {
    if (files.length === 0) return;
    setIsParsing(true);
    setParseError(null);

    try {
      const res = await client.v1['bank-statements'].parse.$post({
        json: { files: files.map((f) => ({ content: f.content, fileName: f.name })) },
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? 'Failed to parse files');
      }
      const data = await res.json();
      const transactions: ParsedTransaction[] = data.transactions.map((tx) => ({
        ...tx,
        selected: tx.reconciliationStatus !== 'duplicate',
      }));
      setParseResult({ ...data, transactions });

      // Auto-populate fuzzy decisions: default to 'same' (skip)
      const autoFuzzy = new Map<string, 'same' | 'different'>();
      for (const tx of data.transactions) {
        if (tx.reconciliationStatus === 'fuzzy_match') {
          autoFuzzy.set(tx.fitId, 'same');
        }
      }
      setFuzzyDecisions(autoFuzzy);

      // Auto-populate resolutions from server-resolved classifications
      const autoResolutions = new Map<string, Resolution>();
      for (const tx of data.transactions) {
        if (tx.resolvedClassification && !tx.needsResolution) {
          const candidate = tx.candidates.find((c) => c.type === tx.resolvedClassification);
          if (candidate) {
            const resolution: Resolution = { classification: candidate.type };
            if (candidate.type === 'entity_transfer' && candidate.transferDetails) {
              resolution.entityId = candidate.transferDetails.suggestedEntityId;
              resolution.entityName = candidate.transferDetails.suggestedEntityName;
              resolution.entityType = candidate.transferDetails.suggestedEntityType;
              resolution.direction = pickDirection(
                tx.type,
                candidate.transferDetails.suggestedEntityType,
                candidate.transferDetails.suggestedDirection
              );
            }
            if (candidate.type === 'investment_transfer' && candidate.investmentDetails) {
              resolution.investmentDirection = candidate.investmentDetails.direction;
              resolution.investmentAccountId = candidate.investmentDetails.suggestedAccountId;
            }
            if (candidate.type === 'credit_card_payment' && candidate.creditCardDetails) {
              const hasExisting = existingCreditCards.some(
                (cc) => cc.bankName.toUpperCase().includes((candidate.creditCardDetails?.suggestedBankName ?? '').toUpperCase().split(' ')[0] ?? '')
              );
              if (!hasExisting) {
                resolution.creditCard = {
                  bankName: candidate.creditCardDetails.suggestedBankName,
                  lastFourDigits: '',
                  closingDay: candidate.creditCardDetails.closingDay,
                  dueDay: candidate.creditCardDetails.dueDay,
                  currency: data.currency,
                };
              }
            }
            autoResolutions.set(tx.fitId, resolution);
          }
        }
      }
      setResolutions(autoResolutions);

      // Auto-populate reconciliation choices: default to "update" for changed txs
      const autoReconciliations = new Map<string, ReconciliationChoice>();
      for (const tx of data.transactions) {
        if (tx.reconciliationStatus === 'changed' && tx.existingTransactionId && tx.diffs) {
          const updates: ReconciliationChoice['updates'] = {};
          for (const diff of tx.diffs) {
            if (diff.field === 'amount') updates.amount = tx.amount;
            if (diff.field === 'date') updates.date = tx.date;
            if (diff.field === 'description') updates.description = tx.description;
          }
          autoReconciliations.set(tx.fitId, {
            existingTransactionId: tx.existingTransactionId,
            externalId: tx.fitId,
            action: 'update',
            updates,
          });
        }
      }
      setReconciliationChoices(autoReconciliations);

      setCurrentStep('entity');
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'Failed to parse files');
    } finally {
      setIsParsing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const needsDedupStep = parseResult
    ? parseResult.summary.fuzzyMatchCount > 0
    : false;

  const needsResolveStep = parseResult
    ? parseResult.transactions.some((t) => t.needsResolution)
    : false;

  const shouldSkipStep = (step: Step): boolean => {
    if (step === 'dedup' && !needsDedupStep) return true;
    if (step === 'resolve' && !needsResolveStep) return true;
    return false;
  };

  const goToStep = (step: Step) => {
    if (shouldSkipStep(step)) {
      const idx = STEPS.indexOf(step);
      for (let i = idx + 1; i < STEPS.length; i++) {
        if (!shouldSkipStep(STEPS[i])) {
          setCurrentStep(STEPS[i]);
          return;
        }
      }
    }
    setCurrentStep(step);
  };

  const goNext = () => {
    const idx = STEPS.indexOf(currentStep);
    if (idx < STEPS.length - 1) goToStep(STEPS[idx + 1]);
  };

  const goPrev = () => {
    const idx = STEPS.indexOf(currentStep);
    for (let i = idx - 1; i >= 0; i--) {
      if (!shouldSkipStep(STEPS[i])) {
        setCurrentStep(STEPS[i]);
        return;
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Resolution management
  // ---------------------------------------------------------------------------

  const setResolution = (fitId: string, resolution: Resolution) => {
    setResolutions((prev) => {
      const next = new Map(prev);
      next.set(fitId, resolution);
      return next;
    });
  };

  const getResolution = (fitId: string): Resolution | undefined => resolutions.get(fitId);

  // ---------------------------------------------------------------------------
  // Inline entity creation
  // ---------------------------------------------------------------------------

  const handleCreateBusiness = async (fitId: string) => {
    if (!newBusinessName.trim()) return;
    setIsCreatingBusiness(true);
    try {
      const res = await client.v1.businesses.$post({
        json: { name: newBusinessName.trim(), defaultCurrency: parseResult?.currency ?? 'BRL' },
      });
      if (res.ok) {
        const created = await res.json();
        setLocalBusinesses((prev) => [...prev, created as unknown as Business]);
        setResolution(fitId, {
          ...getResolution(fitId)!,
          entityId: (created as unknown as { id: string }).id,
          entityName: newBusinessName.trim(),
          entityType: 'business',
        });
        setCreatingEntityForFitId(null);
        setNewBusinessName('');
      }
    } finally {
      setIsCreatingBusiness(false);
    }
  };

  const handleCreateInvestmentAccount = async (fitId: string) => {
    if (!newInvestmentAccountName.trim()) return;
    setIsCreatingInvestmentAccount(true);
    try {
      const created = await addInvestmentAccount({
        name: newInvestmentAccountName.trim(),
        broker: newInvestmentAccountBroker.trim() || undefined,
        entityType,
        currency: parseResult?.currency ?? 'BRL',
        businessId: entityType === 'business' ? entityId : undefined,
        personalAccountId: entityType === 'personal' ? entityId : undefined,
      });
      if (created) {
        setLocalInvestmentAccounts((prev) => [...prev, created]);
        setResolution(fitId, {
          ...getResolution(fitId)!,
          investmentAccountId: created.id,
        });
        setCreatingInvAccountForFitId(null);
        setNewInvestmentAccountName('');
        setNewInvestmentAccountBroker('');
      }
    } finally {
      setIsCreatingInvestmentAccount(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Reconciliation management
  // ---------------------------------------------------------------------------

  const toggleReconciliation = (fitId: string) => {
    setReconciliationChoices((prev) => {
      const next = new Map(prev);
      const current = next.get(fitId);
      if (current) {
        next.set(fitId, { ...current, action: current.action === 'update' ? 'keep' : 'update' });
      }
      return next;
    });
  };

  // ---------------------------------------------------------------------------
  // Computed: build import payload
  // ---------------------------------------------------------------------------

  const resolvedTransfers: Array<{
    externalId: string;
    date: string;
    amount: number;
    description: string;
    flow: 'outflow' | 'inflow';
    direction: 'profit_distribution' | 'capital_injection' | 'reimbursement';
    counterpartyEntityType: 'business' | 'personal';
    counterpartyEntityId: string;
  }> = [];

  const resolvedInvestmentTransfers: Array<{
    externalId: string;
    date: string;
    amount: number;
    description: string;
    direction: 'investment_deposit' | 'investment_withdrawal';
    investmentAccountId: string;
  }> = [];

  const resolvedCreditCards: Array<{
    bankName: string;
    lastFourDigits: string;
    closingDay: number;
    dueDay: number;
    currency: string;
  }> = [];

  const resolvedFitIds = new Set<string>();
  const creditCardBanksSeen = new Set<string>();

  if (parseResult) {
    for (const tx of parseResult.transactions) {
      if (tx.reconciliationStatus === 'duplicate') continue;
      const res = getResolution(tx.fitId);
      if (!res) continue;

      if (res.classification === 'entity_transfer' && res.entityId && res.direction && res.entityType) {
        // The row's sign is the flow, full stop. The label only gets to
        // say why the money moved, so a label that disagrees with the
        // sign is replaced rather than sent - the server rejects it.
        const flow = flowForRowType(tx.type);
        const allowed = allowedDirectionsForFlow(flow, entityType, res.entityType);
        resolvedTransfers.push({
          externalId: tx.fitId,
          date: tx.date,
          amount: tx.amount,
          description: tx.description,
          flow,
          direction: allowed.includes(res.direction) ? res.direction : allowed[0],
          counterpartyEntityType: res.entityType,
          counterpartyEntityId: res.entityId,
        });
        resolvedFitIds.add(tx.fitId);
      } else if (res.classification === 'investment_transfer' && res.investmentAccountId && res.investmentDirection) {
        resolvedInvestmentTransfers.push({
          externalId: tx.fitId,
          date: tx.date,
          amount: tx.amount,
          description: tx.description,
          direction: res.investmentDirection,
          investmentAccountId: res.investmentAccountId,
        });
        resolvedFitIds.add(tx.fitId);
      } else if (res.classification === 'credit_card_payment' && res.creditCard && res.creditCard.lastFourDigits.length === 4) {
        const key = res.creditCard.bankName;
        if (!creditCardBanksSeen.has(key)) {
          creditCardBanksSeen.add(key);
          resolvedCreditCards.push(res.creditCard);
        }
        resolvedFitIds.add(tx.fitId);
      }
    }
  }

  // Fuzzy matches the user confirmed as "different" (import as new)
  const fuzzyAsNew = new Set<string>();
  // Fuzzy matches the user confirmed as "same" (link externalId, skip import)
  const confirmedFuzzyDuplicates: Array<{ existingTransactionId: string; externalId: string }> = [];

  if (parseResult) {
    for (const tx of parseResult.transactions) {
      if (tx.reconciliationStatus === 'fuzzy_match' && tx.existingTransactionId) {
        const decision = fuzzyDecisions.get(tx.fitId) ?? 'same';
        if (decision === 'different') {
          fuzzyAsNew.add(tx.fitId);
        } else {
          confirmedFuzzyDuplicates.push({
            existingTransactionId: tx.existingTransactionId,
            externalId: tx.fitId,
          });
        }
      }
    }
  }

  const selectedTransactions = (parseResult?.transactions ?? []).filter(
    (t) =>
      t.selected &&
      !resolvedFitIds.has(t.fitId) &&
      (t.reconciliationStatus === 'new' || fuzzyAsNew.has(t.fitId))
  );

  const reconciliationsToApply = Array.from(reconciliationChoices.values()).filter(
    (r) => r.action === 'update'
  );

  // ---------------------------------------------------------------------------
  // Projected balance after import
  // ---------------------------------------------------------------------------

  const projectedBalance = (() => {
    if (currentBalance === undefined || !parseResult) return undefined;

    let netImpact = 0;

    for (const tx of selectedTransactions) {
      netImpact += tx.type === 'income' ? tx.amount : -tx.amount;
    }

    for (const tr of resolvedTransfers) {
      netImpact += tr.flow === 'outflow' ? -tr.amount : tr.amount;
    }

    for (const it of resolvedInvestmentTransfers) {
      if (it.direction === 'investment_deposit') {
        netImpact -= it.amount;
      } else {
        netImpact += it.amount;
      }
    }

    return Math.round((currentBalance + netImpact) * 100) / 100;
  })();

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------

  const handleImport = async () => {
    if (!parseResult) return;
    setIsImporting(true);
    try {
      const res = await client.v1['bank-statements'].import.$post({
        json: {
          entityType,
          entityId,
          currency: parseResult.currency,
          bankName: parseResult.bankName,
          fileName: files.map((f) => f.name).join(', '),
          ledgerBalance: parseResult.ledgerBalance,
          transactions: selectedTransactions.map((txn) => ({
            externalId: txn.fitId,
            date: txn.date,
            description: txn.description,
            amount: txn.amount,
            type: txn.type,
          })),
          transfers: resolvedTransfers.length > 0 ? resolvedTransfers : undefined,
          creditCards: resolvedCreditCards.length > 0 ? resolvedCreditCards : undefined,
          investmentTransfers: resolvedInvestmentTransfers.length > 0
            ? resolvedInvestmentTransfers
            : undefined,
          reconciliations: reconciliationsToApply.length > 0
            ? reconciliationsToApply.map((r) => ({
                existingTransactionId: r.existingTransactionId,
                externalId: r.externalId,
                updates: r.updates,
              }))
            : undefined,
          fuzzyDuplicates: confirmedFuzzyDuplicates.length > 0
            ? confirmedFuzzyDuplicates
            : undefined,
        },
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? 'Import failed');
      }
      const data = await res.json();
      setImportResult(data);
      setCurrentStep('confirm');
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'Import failed');
    } finally {
      setIsImporting(false);
    }
  };

  const handleDone = () => {
    onImportComplete();
    handleClose();
  };

  // ---------------------------------------------------------------------------
  // Toggle transaction selection
  // ---------------------------------------------------------------------------

  const toggleTransaction = (fitId: string) => {
    if (!parseResult) return;
    setParseResult({
      ...parseResult,
      transactions: parseResult.transactions.map((t) =>
        t.fitId === fitId ? { ...t, selected: !t.selected } : t
      ),
    });
  };

  const toggleAllNew = () => {
    if (!parseResult) return;
    const newTxs = parseResult.transactions.filter(
      (t) => t.reconciliationStatus === 'new' && !resolvedFitIds.has(t.fitId)
    );
    const allSelected = newTxs.every((t) => t.selected);
    setParseResult({
      ...parseResult,
      transactions: parseResult.transactions.map((t) =>
        t.reconciliationStatus === 'new' && !resolvedFitIds.has(t.fitId)
          ? { ...t, selected: !allSelected }
          : t
      ),
    });
  };

  // ---------------------------------------------------------------------------
  // Step indicators
  // ---------------------------------------------------------------------------

  const visibleSteps = STEPS.filter((s) => !shouldSkipStep(s));
  const stepNumber = visibleSteps.indexOf(currentStep) + 1;
  const totalSteps = visibleSteps.length;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="flex h-dvh max-h-dvh w-full max-w-full flex-col overflow-hidden rounded-none border-slate-800 bg-slate-900 sm:h-auto sm:max-h-[90dvh] sm:max-w-2xl sm:rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-white">
            {importResult ? t('success.title') : t('title')}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {importResult
              ? t('success.description')
              : `${t('step')} ${stepNumber} ${t('of')} ${totalSteps}`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-2">
          {/* ============================================================ */}
          {/* STEP: Upload                                                 */}
          {/* ============================================================ */}
          {currentStep === 'upload' && (
            <div className="space-y-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-700 bg-slate-800/50 p-8 transition-colors hover:border-slate-600"
              >
                <Upload className="mb-3 h-10 w-10 text-slate-500" />
                <p className="text-sm text-slate-400">{t('upload.dropzone')}</p>
                <p className="mt-1 text-xs text-slate-500">{t('upload.formats')}</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".ofx,.qfx"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
              {files.length > 0 && (
                <div className="space-y-2">
                  {files.map((file, idx) => (
                    <div key={idx} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2">
                      <div className="flex items-center gap-2 text-emerald-400">
                        <FileText className="h-4 w-4" />
                        <span className="text-sm">{file.name}</span>
                      </div>
                      <button onClick={() => removeFile(idx)} className="text-slate-500 hover:text-slate-300">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {parseError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <p className="text-xs text-red-300">{parseError}</p>
                </div>
              )}
            </div>
          )}

          {/* ============================================================ */}
          {/* STEP: Entity selection                                       */}
          {/* ============================================================ */}
          {currentStep === 'entity' && parseResult && (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
                <p className="text-sm text-slate-400">{t('entity.detected')}</p>
                <p className="mt-1 text-lg font-medium text-white">{parseResult.bankName}</p>
                <p className="text-sm text-slate-400">
                  {t('entity.account')}: {parseResult.accountId} · {parseResult.currency}
                </p>
              </div>
              <div className="space-y-3">
                <Label className="text-slate-300">{t('entity.selectEntity')}</Label>
                <Select value={entityType} onValueChange={(v) => {
                  setEntityType(v as EntityType);
                  if (v === 'personal' && personalAccountId) setEntityId(personalAccountId);
                  else setEntityId('');
                }}>
                  <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-slate-700 bg-slate-800">
                    {personalAccountId && <SelectItem value="personal">{t('entity.personal')}</SelectItem>}
                    {businesses.length > 0 && <SelectItem value="business">{t('entity.business')}</SelectItem>}
                  </SelectContent>
                </Select>
                {entityType === 'business' && (
                  <Select value={entityId} onValueChange={setEntityId}>
                    <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                      <SelectValue placeholder={t('entity.selectBusiness')} />
                    </SelectTrigger>
                    <SelectContent className="border-slate-700 bg-slate-800">
                      {businesses.map((biz) => (
                        <SelectItem key={biz.id} value={biz.id}>{biz.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* STEP: Review fuzzy duplicates                                */}
          {/* ============================================================ */}
          {currentStep === 'dedup' && parseResult && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />
                <div>
                  <p className="text-sm font-medium text-orange-300">{t('dedup.title')}</p>
                  <p className="mt-1 text-xs text-orange-400">
                    {t('dedup.description', { count: parseResult.summary.fuzzyMatchCount })}
                  </p>
                </div>
              </div>

              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {parseResult.transactions
                  .filter((tx) => tx.reconciliationStatus === 'fuzzy_match' && tx.fuzzyMatchedTransaction)
                  .map((tx) => {
                    const match = tx.fuzzyMatchedTransaction!;
                    const decision = fuzzyDecisions.get(tx.fitId) ?? 'same';
                    return (
                      <div key={tx.fitId} className="rounded-lg border border-slate-700 bg-slate-800/30 p-4 space-y-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {/* OFX (imported) side */}
                          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3 space-y-1">
                            <p className="text-[10px] font-medium uppercase tracking-wider text-blue-400">{t('dedup.bankStatement')}</p>
                            <p className="text-sm font-medium text-white truncate" title={tx.fullDescription}>{tx.description}</p>
                            <p className="text-xs text-slate-400">{tx.date}</p>
                            <p className={`text-sm font-medium ${tx.type === 'income' ? 'text-emerald-400' : 'text-red-400'}`}>
                              {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount, parseResult.currency)}
                            </p>
                          </div>
                          {/* Existing (manual) side */}
                          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-3 space-y-1">
                            <p className="text-[10px] font-medium uppercase tracking-wider text-purple-400">{t('dedup.existingEntry')}</p>
                            <p className="text-sm font-medium text-white truncate" title={match.description}>{match.description}</p>
                            <p className="text-xs text-slate-400">{match.date}</p>
                            <p className={`text-sm font-medium ${match.type === 'income' ? 'text-emerald-400' : 'text-red-400'}`}>
                              {match.type === 'income' ? '+' : '-'}{formatCurrency(match.amount, parseResult.currency)}
                            </p>
                          </div>
                        </div>
                        {/* Decision buttons */}
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant={decision === 'same' ? 'default' : 'outline'}
                            className={`h-7 text-xs flex-1 ${decision === 'same' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'border-slate-700 text-slate-400'}`}
                            onClick={() => setFuzzyDecisions((prev) => { const next = new Map(prev); next.set(tx.fitId, 'same'); return next; })}
                          >
                            <Check className="mr-1 h-3 w-3" /> {t('dedup.sameTransaction')}
                          </Button>
                          <Button
                            size="sm"
                            variant={decision === 'different' ? 'default' : 'outline'}
                            className={`h-7 text-xs flex-1 ${decision === 'different' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'border-slate-700 text-slate-400'}`}
                            onClick={() => setFuzzyDecisions((prev) => { const next = new Map(prev); next.set(tx.fitId, 'different'); return next; })}
                          >
                            <Plus className="mr-1 h-3 w-3" /> {t('dedup.differentTransaction')}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* STEP: Resolve ambiguous transactions                         */}
          {/* ============================================================ */}
          {currentStep === 'resolve' && parseResult && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  <p className="text-sm font-medium text-amber-300">{t('resolve.title')}</p>
                  <p className="mt-1 text-xs text-amber-400">
                    {t('resolve.needsResolution', { count: parseResult.summary.needsResolutionCount })}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {parseResult.transactions
                  .filter((tx) => tx.needsResolution && tx.reconciliationStatus !== 'duplicate')
                  .map((tx) => {
                    const resolution = getResolution(tx.fitId);
                    return (
                      <div key={tx.fitId} className="rounded-lg border border-slate-700 bg-slate-800/30 p-4 space-y-3">
                        {/* Transaction header */}
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-xs text-slate-400">{tx.date}</span>
                            <p className="text-sm font-medium text-white">{tx.description}</p>
                            <p className="text-xs text-slate-500 truncate max-w-md" title={tx.fullDescription}>
                              {tx.fullDescription}
                            </p>
                          </div>
                          <span className={`text-sm font-medium ${tx.type === 'income' ? 'text-emerald-400' : 'text-red-400'}`}>
                            {tx.type === 'income' ? '+' : '-'}
                            {formatCurrency(tx.amount, parseResult.currency)}
                          </span>
                        </div>

                        {/* Classification options */}
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-slate-400">{t('resolve.classifyAs')}</p>
                          {tx.candidates.map((candidate, ci) => {
                            const isSelected = resolution?.classification === candidate.type;
                            return (
                              <div key={ci}>
                                <label
                                  className={`flex items-start gap-2 rounded-md border px-3 py-2 cursor-pointer transition-colors ${
                                    isSelected
                                      ? 'border-emerald-500/50 bg-emerald-500/10'
                                      : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                                  }`}
                                  onClick={() => {
                                    const newRes: Resolution = { classification: candidate.type };
                                    if (candidate.type === 'entity_transfer' && candidate.transferDetails) {
                                      newRes.entityId = candidate.transferDetails.suggestedEntityId;
                                      newRes.entityName = candidate.transferDetails.suggestedEntityName;
                                      newRes.entityType = candidate.transferDetails.suggestedEntityType;
                                      newRes.direction = pickDirection(
                                        tx.type,
                                        candidate.transferDetails.suggestedEntityType,
                                        candidate.transferDetails.suggestedDirection
                                      );
                                    }
                                    if (candidate.type === 'investment_transfer' && candidate.investmentDetails) {
                                      newRes.investmentDirection = candidate.investmentDetails.direction;
                                      newRes.investmentAccountId = candidate.investmentDetails.suggestedAccountId;
                                    }
                                    setResolution(tx.fitId, newRes);
                                  }}
                                >
                                  <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                                    isSelected ? 'border-emerald-500 bg-emerald-500' : 'border-slate-500'
                                  }`}>
                                    {isSelected && <Check className="h-3 w-3 text-white" />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <span className="text-sm text-slate-200">
                                      {candidate.type === 'regular_transaction' && t('resolve.regularTransaction')}
                                      {candidate.type === 'entity_transfer' && (
                                        <>
                                          {t('resolve.entityTransfer')}
                                          {candidate.transferDetails && (
                                            <span className="text-slate-400"> — {candidate.transferDetails.suggestedEntityName}</span>
                                          )}
                                        </>
                                      )}
                                      {candidate.type === 'investment_transfer' && (
                                        <>
                                          {t('resolve.investmentTransfer')}
                                          {candidate.investmentDetails && (
                                            <span className="text-slate-400">
                                              {' '}— {candidate.investmentDetails.direction === 'investment_deposit'
                                                ? t('investmentTransfers.deposit')
                                                : t('investmentTransfers.withdrawal')}
                                            </span>
                                          )}
                                        </>
                                      )}
                                      {candidate.type === 'credit_card_payment' && t('resolve.creditCardPayment')}
                                    </span>
                                  </div>
                                </label>

                                {/* Sub-options when this candidate is selected */}
                                {isSelected && candidate.type === 'entity_transfer' && (
                                  <div className="ml-6 mt-2 space-y-2">
                                    <Select
                                      value={resolution?.entityId ?? ''}
                                      onValueChange={(v) => {
                                        const biz = allBusinesses.find((b) => b.id === v);
                                        if (biz) {
                                          setResolution(tx.fitId, {
                                            ...resolution!,
                                            entityId: v,
                                            entityName: biz.name,
                                            entityType: 'business',
                                          });
                                        }
                                      }}
                                    >
                                      <SelectTrigger className="h-8 border-slate-700 bg-slate-800 text-white text-xs">
                                        <SelectValue placeholder={t('resolve.selectEntity')} />
                                      </SelectTrigger>
                                      <SelectContent className="border-slate-700 bg-slate-900">
                                        {allBusinesses.map((biz) => (
                                          <SelectItem key={biz.id} value={biz.id}>{biz.name}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <Select
                                      value={resolution?.direction ?? ''}
                                      onValueChange={(v) =>
                                        setResolution(tx.fitId, {
                                          ...resolution!,
                                          direction: v as Resolution['direction'],
                                        })
                                      }
                                    >
                                      <SelectTrigger className="h-8 border-slate-700 bg-slate-800 text-white text-xs">
                                        <SelectValue placeholder={t('resolve.direction')} />
                                      </SelectTrigger>
                                      <SelectContent className="border-slate-700 bg-slate-900">
                                        {allowedDirectionsForFlow(
                                          flowForRowType(tx.type),
                                          entityType,
                                          resolution?.entityType ?? 'business'
                                        ).map((d) => (
                                          <SelectItem key={d} value={d}>
                                            {t(`transfers.directionOptions.${d}` as Parameters<typeof t>[0])}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>

                                    {creatingEntityForFitId === tx.fitId ? (
                                      <div className="space-y-2 rounded-md border border-slate-700 bg-slate-800/50 p-2">
                                        <Input
                                          value={newBusinessName}
                                          onChange={(e) => setNewBusinessName(e.target.value)}
                                          placeholder={t('resolve.businessName')}
                                          className="h-8 border-slate-700 bg-slate-800 text-white text-xs"
                                        />
                                        <div className="flex gap-2">
                                          <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-400" onClick={() => setCreatingEntityForFitId(null)}>
                                            {tCommon('cancel')}
                                          </Button>
                                          <Button size="sm" className="h-7 text-xs bg-emerald-600 text-white hover:bg-emerald-700"
                                            disabled={!newBusinessName.trim() || isCreatingBusiness}
                                            onClick={() => handleCreateBusiness(tx.fitId)}>
                                            {isCreatingBusiness ? <Loader2 className="h-3 w-3 animate-spin" /> : t('resolve.createBusiness')}
                                          </Button>
                                        </div>
                                      </div>
                                    ) : (
                                      <Button size="sm" variant="outline" className="h-7 text-xs w-full border-dashed border-slate-700 text-slate-400"
                                        onClick={() => setCreatingEntityForFitId(tx.fitId)}>
                                        <Plus className="mr-1 h-3 w-3" /> {t('resolve.createBusiness')}
                                      </Button>
                                    )}
                                  </div>
                                )}

                                {isSelected && candidate.type === 'investment_transfer' && (
                                  <div className="ml-6 mt-2 space-y-2">
                                    {allInvestmentAccounts.length > 0 && (
                                      <Select
                                        value={resolution?.investmentAccountId ?? ''}
                                        onValueChange={(v) =>
                                          setResolution(tx.fitId, { ...resolution!, investmentAccountId: v })
                                        }
                                      >
                                        <SelectTrigger className="h-8 border-slate-700 bg-slate-800 text-white text-xs">
                                          <SelectValue placeholder={t('resolve.selectAccount')} />
                                        </SelectTrigger>
                                        <SelectContent className="border-slate-700 bg-slate-900">
                                          {allInvestmentAccounts.map((acc) => (
                                            <SelectItem key={acc.id} value={acc.id}>
                                              {acc.name}{acc.broker ? ` (${acc.broker})` : ''}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    )}
                                    {creatingInvAccountForFitId === tx.fitId ? (
                                      <div className="space-y-2 rounded-md border border-slate-700 bg-slate-800/50 p-2">
                                        <Input
                                          value={newInvestmentAccountName}
                                          onChange={(e) => setNewInvestmentAccountName(e.target.value)}
                                          placeholder={t('investmentTransfers.accountName')}
                                          className="h-8 border-slate-700 bg-slate-800 text-white text-xs"
                                        />
                                        <Input
                                          value={newInvestmentAccountBroker}
                                          onChange={(e) => setNewInvestmentAccountBroker(e.target.value)}
                                          placeholder={t('investmentTransfers.broker')}
                                          className="h-8 border-slate-700 bg-slate-800 text-white text-xs"
                                        />
                                        <div className="flex gap-2">
                                          <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-400" onClick={() => setCreatingInvAccountForFitId(null)}>
                                            {tCommon('cancel')}
                                          </Button>
                                          <Button size="sm" className="h-7 text-xs bg-amber-600 text-white hover:bg-amber-700"
                                            disabled={!newInvestmentAccountName.trim() || isCreatingInvestmentAccount}
                                            onClick={() => handleCreateInvestmentAccount(tx.fitId)}>
                                            {isCreatingInvestmentAccount ? <Loader2 className="h-3 w-3 animate-spin" /> : t('resolve.createInvestmentAccount')}
                                          </Button>
                                        </div>
                                      </div>
                                    ) : (
                                      <Button size="sm" variant="outline" className="h-7 text-xs w-full border-dashed border-slate-700 text-slate-400"
                                        onClick={() => setCreatingInvAccountForFitId(tx.fitId)}>
                                        <Plus className="mr-1 h-3 w-3" /> {t('resolve.createInvestmentAccount')}
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* STEP: Preview                                                */}
          {/* ============================================================ */}
          {currentStep === 'preview' && parseResult && (
            <div className="space-y-4">
              {/* Summary bar */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-center">
                  <p className="text-xs text-slate-400">{t('preview.new')}</p>
                  <p className="text-lg font-bold text-emerald-400">{selectedTransactions.length}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-center">
                  <p className="text-xs text-slate-400">{t('preview.duplicates')}</p>
                  <p className="text-lg font-bold text-slate-500">
                    {parseResult.summary.duplicateCount + confirmedFuzzyDuplicates.length}
                  </p>
                </div>
                {parseResult.summary.changedCount > 0 && (
                  <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-center">
                    <p className="text-xs text-slate-400">{t('preview.changed')}</p>
                    <p className="text-lg font-bold text-amber-400">{parseResult.summary.changedCount}</p>
                  </div>
                )}
                <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-center">
                  <p className="text-xs text-slate-400">{t('preview.income')}</p>
                  <p className="text-lg font-bold text-emerald-400">
                    {formatCurrency(
                      selectedTransactions.filter((st) => st.type === 'income').reduce((s, st) => s + st.amount, 0),
                      parseResult.currency
                    )}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-center">
                  <p className="text-xs text-slate-400">{t('preview.expenses')}</p>
                  <p className="text-lg font-bold text-red-400">
                    {formatCurrency(
                      selectedTransactions.filter((st) => st.type === 'expense').reduce((s, st) => s + st.amount, 0),
                      parseResult.currency
                    )}
                  </p>
                </div>
              </div>

              {/* Balance projection */}
              {projectedBalance !== undefined && parseResult && (
                <div className={`rounded-lg border p-3 ${
                  Math.abs(projectedBalance - parseResult.ledgerBalance) < 0.01
                    ? 'border-emerald-500/30 bg-emerald-500/10'
                    : 'border-amber-500/30 bg-amber-500/10'
                }`}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">{t('preview.currentBalance')}</span>
                        <span className="font-medium text-slate-300">{formatCurrency(currentBalance!, parseResult.currency)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">{t('preview.projectedBalance')}</span>
                        <span className="font-bold text-white">{formatCurrency(projectedBalance, parseResult.currency)}</span>
                      </div>
                      <div className="border-t border-slate-700 pt-1 flex items-center justify-between text-xs">
                        <span className="text-slate-400">{t('preview.bankBalance')}</span>
                        <span className="font-medium text-slate-300">{formatCurrency(parseResult.ledgerBalance, parseResult.currency)}</span>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {Math.abs(projectedBalance - parseResult.ledgerBalance) < 0.01 ? (
                        <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-1">
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                          <span className="text-xs font-medium text-emerald-400">{t('preview.balanceMatch')}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2.5 py-1">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                          <span className="text-xs font-medium text-amber-400">
                            {formatCurrency(Math.abs(projectedBalance - parseResult.ledgerBalance), parseResult.currency)} {t('preview.balanceDiff')}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Transfers / Investment transfers banners */}
              {resolvedTransfers.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-purple-500/30 bg-purple-500/10 p-3">
                  <ArrowLeftRight className="mt-0.5 h-4 w-4 shrink-0 text-purple-400" />
                  <div>
                    <p className="text-sm font-medium text-purple-300">{t('transfers.detected')}</p>
                    <p className="mt-0.5 text-xs text-purple-400">{t('transfers.confirmedCount', { count: resolvedTransfers.length })}</p>
                  </div>
                </div>
              )}
              {resolvedInvestmentTransfers.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <div>
                    <p className="text-sm font-medium text-amber-300">{t('investmentTransfers.detected')}</p>
                    <p className="mt-0.5 text-xs text-amber-400">{t('investmentTransfers.confirmedCount', { count: resolvedInvestmentTransfers.length })}</p>
                  </div>
                </div>
              )}

              {/* Changed transactions (reconciliation) */}
              {parseResult.summary.changedCount > 0 && (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                    <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <div>
                      <p className="text-sm font-medium text-amber-300">{t('reconciliation.changedCount', { count: parseResult.summary.changedCount })}</p>
                    </div>
                  </div>
                  {parseResult.transactions
                    .filter((tx) => tx.reconciliationStatus === 'changed')
                    .map((tx) => {
                      const choice = reconciliationChoices.get(tx.fitId);
                      return (
                        <div key={tx.fitId} className="rounded-lg border border-amber-500/20 bg-slate-800/50 p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-xs text-slate-400">{tx.date}</span>
                              <p className="text-sm text-white">{tx.description}</p>
                            </div>
                            <span className={`text-sm font-medium ${tx.type === 'income' ? 'text-emerald-400' : 'text-red-400'}`}>
                              {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount, parseResult.currency)}
                            </span>
                          </div>
                          {tx.diffs && tx.diffs.map((diff, di) => (
                            <div key={di} className="flex items-center gap-2 text-xs">
                              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-300 font-medium">
                                {t(`reconciliation.field${diff.field.charAt(0).toUpperCase() + diff.field.slice(1)}` as Parameters<typeof t>[0])}
                              </span>
                              <span className="text-slate-400 line-through">{diff.existingValue}</span>
                              <ArrowRight className="h-3 w-3 text-slate-500" />
                              <span className="text-white">{diff.ofxValue}</span>
                            </div>
                          ))}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant={choice?.action === 'update' ? 'default' : 'outline'}
                              className={`h-7 text-xs ${choice?.action === 'update' ? 'bg-amber-600 text-white hover:bg-amber-700' : 'border-slate-700 text-slate-400'}`}
                              onClick={() => choice?.action !== 'update' && toggleReconciliation(tx.fitId)}
                            >
                              {t('reconciliation.updateToMatch')}
                            </Button>
                            <Button
                              size="sm"
                              variant={choice?.action === 'keep' ? 'default' : 'outline'}
                              className={`h-7 text-xs ${choice?.action === 'keep' ? 'bg-slate-600 text-white hover:bg-slate-700' : 'border-slate-700 text-slate-400'}`}
                              onClick={() => choice?.action !== 'keep' && toggleReconciliation(tx.fitId)}
                            >
                              {t('reconciliation.keepCurrent')}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}

              {/* Select all toggle */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{t('preview.transactions')}</span>
                <button onClick={toggleAllNew} className="text-xs text-emerald-400 hover:text-emerald-300">
                  {t('preview.toggleAll')}
                </button>
              </div>

              {/* Transaction list */}
              <div className="max-h-[300px] overflow-y-auto space-y-1 rounded-lg border border-slate-700">
                {parseResult.transactions.map((tx) => {
                  const isResolvedSpecial = resolvedFitIds.has(tx.fitId);
                  const resolution = getResolution(tx.fitId);
                  const isTransfer = isResolvedSpecial && resolution?.classification === 'entity_transfer';
                  const isInvestment = isResolvedSpecial && resolution?.classification === 'investment_transfer';
                  const isCCPayment = isResolvedSpecial && resolution?.classification === 'credit_card_payment';
                  const isExcluded = isResolvedSpecial;

                  return (
                    <div
                      key={tx.fitId}
                      onClick={() => !tx.isDuplicate && !isExcluded && tx.reconciliationStatus !== 'changed' && toggleTransaction(tx.fitId)}
                      className={`flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
                        tx.reconciliationStatus === 'duplicate'
                          ? 'bg-slate-800/30 opacity-50'
                          : tx.reconciliationStatus === 'changed'
                            ? 'bg-amber-900/10 border-l-2 border-l-amber-500'
                            : isTransfer
                              ? 'bg-purple-900/20 border-l-2 border-l-purple-500'
                              : isInvestment
                                ? 'bg-amber-900/20 border-l-2 border-l-amber-500'
                                : isCCPayment
                                  ? 'bg-blue-900/20 border-l-2 border-l-blue-500'
                                  : tx.selected
                                    ? 'bg-slate-800/50 cursor-pointer hover:bg-slate-800/70'
                                    : 'bg-slate-800/20 cursor-pointer hover:bg-slate-800/40'
                      }`}
                    >
                      {/* Icon / checkbox */}
                      {tx.reconciliationStatus === 'changed' ? (
                        <RefreshCw className="h-4 w-4 shrink-0 text-amber-400" />
                      ) : isInvestment ? (
                        <Wallet className="h-4 w-4 shrink-0 text-amber-400" />
                      ) : isTransfer ? (
                        <ArrowLeftRight className="h-4 w-4 shrink-0 text-purple-400" />
                      ) : isCCPayment ? (
                        <CreditCard className="h-4 w-4 shrink-0 text-blue-400" />
                      ) : (
                        <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          tx.isDuplicate ? 'border-slate-600 bg-slate-700'
                            : tx.selected ? 'border-emerald-500 bg-emerald-500'
                            : 'border-slate-600'
                        }`}>
                          {(tx.selected || tx.isDuplicate) && <Check className="h-3 w-3 text-white" />}
                        </div>
                      )}

                      <span className="w-20 shrink-0 text-slate-400">{tx.date}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-300" title={tx.fullDescription}>
                        {tx.description}
                      </span>

                      <div className="flex shrink-0 items-center gap-2">
                        {tx.isDuplicate && (
                          <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[10px] text-slate-400">
                            {t('preview.duplicate')}
                          </span>
                        )}
                        {tx.reconciliationStatus === 'changed' && (
                          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300">
                            {t('reconciliation.changed')}
                          </span>
                        )}
                        {isTransfer && resolution && (
                          <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-[10px] text-purple-300">
                            {t(`transfers.directionOptions.${resolution.direction}` as Parameters<typeof t>[0])}
                          </span>
                        )}
                        {isInvestment && (
                          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300">
                            {resolution?.investmentDirection === 'investment_deposit'
                              ? t('investmentTransfers.deposit')
                              : t('investmentTransfers.withdrawal')}
                          </span>
                        )}
                        {isCCPayment && (
                          <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] text-blue-300">
                            {t('resolve.creditCardPayment')}
                          </span>
                        )}
                        <span className={`font-medium ${tx.type === 'income' ? 'text-emerald-400' : 'text-red-400'}`}>
                          {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount, parseResult.currency)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* STEP: Confirm (result)                                       */}
          {/* ============================================================ */}
          {currentStep === 'confirm' && importResult && (
            <div className="flex flex-col items-center justify-center space-y-4 py-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
                <Sparkles className="h-8 w-8 text-emerald-400" />
              </div>
              <div className="text-center">
                <p className="text-lg font-medium text-white">
                  {t('success.imported', { count: importResult.imported })}
                </p>
                {importResult.reconciled > 0 && (
                  <p className="mt-1 text-sm text-amber-300">
                    {t('success.reconciled', { count: importResult.reconciled })}
                  </p>
                )}
                {importResult.duplicatesSkipped > 0 && (
                  <p className="mt-1 text-sm text-slate-400">
                    {t('success.duplicatesSkipped', { count: importResult.duplicatesSkipped })}
                  </p>
                )}
                {importResult.transfersCreated > 0 && (
                  <p className="mt-1 text-sm text-purple-300">
                    {t('success.transfersCreated', { count: importResult.transfersCreated })}
                  </p>
                )}
                {importResult.creditCardsCreated > 0 && (
                  <p className="mt-1 text-sm text-slate-400">
                    {t('success.creditCardsCreated', { count: importResult.creditCardsCreated })}
                  </p>
                )}
                {importResult.investmentTransfersCreated > 0 && (
                  <p className="mt-1 text-sm text-amber-300">
                    {t('success.investmentTransfersCreated', { count: importResult.investmentTransfersCreated })}
                  </p>
                )}
                {importResult.fuzzyDuplicatesLinked > 0 && (
                  <p className="mt-1 text-sm text-orange-300">
                    {t('success.fuzzyDuplicatesLinked', { count: importResult.fuzzyDuplicatesLinked })}
                  </p>
                )}
                {importResult.imported > 0 && (
                  <p className="mt-3 text-sm text-slate-400">
                    <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                    {t('success.categorizing')}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ============================================================ */}
        {/* Footer with navigation                                       */}
        {/* ============================================================ */}
        <DialogFooter className="flex-row justify-between sm:justify-between gap-2">
          {currentStep === 'confirm' && importResult ? (
            <div className="flex w-full justify-end">
              <Button onClick={handleDone} className="bg-emerald-600 text-white hover:bg-emerald-700">
                {tCommon('done')}
              </Button>
            </div>
          ) : (
            <>
              <div>
                {currentStep !== 'upload' && (
                  <Button variant="outline" onClick={goPrev} className="border-slate-700 text-slate-300 hover:bg-slate-800">
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    {tCommon('back')}
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleClose} className="border-slate-700 text-slate-300 hover:bg-slate-800">
                  {tCommon('cancel')}
                </Button>

                {currentStep === 'upload' && (
                  <Button onClick={handleParse} disabled={files.length === 0 || isParsing} className="bg-emerald-600 text-white hover:bg-emerald-700">
                    {isParsing ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> {t('upload.parsing')}
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <ArrowRight className="h-4 w-4" /> {t('upload.continue')}
                      </span>
                    )}
                  </Button>
                )}

                {currentStep === 'entity' && (
                  <Button onClick={goNext} disabled={!entityId} className="bg-emerald-600 text-white hover:bg-emerald-700">
                    <ArrowRight className="mr-1 h-4 w-4" /> {tCommon('next')}
                  </Button>
                )}

                {currentStep === 'dedup' && (
                  <Button onClick={goNext} className="bg-emerald-600 text-white hover:bg-emerald-700">
                    <ArrowRight className="mr-1 h-4 w-4" /> {tCommon('next')}
                  </Button>
                )}

                {currentStep === 'resolve' && (
                  <Button onClick={goNext} className="bg-emerald-600 text-white hover:bg-emerald-700">
                    <ArrowRight className="mr-1 h-4 w-4" /> {tCommon('next')}
                  </Button>
                )}

                {currentStep === 'preview' && (
                  <Button
                    onClick={handleImport}
                    disabled={
                      (selectedTransactions.length === 0 &&
                        resolvedTransfers.length === 0 &&
                        resolvedInvestmentTransfers.length === 0 &&
                        reconciliationsToApply.length === 0) ||
                      isImporting
                    }
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    {isImporting ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> {t('preview.importing')}
                      </span>
                    ) : (resolvedTransfers.length > 0 || resolvedInvestmentTransfers.length > 0) ? (
                      <span className="flex items-center gap-2">
                        <Upload className="h-4 w-4" />
                        {t('preview.importWithTransfers', {
                          txCount: selectedTransactions.length,
                          trCount: resolvedTransfers.length + resolvedInvestmentTransfers.length,
                        })}
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Upload className="h-4 w-4" />
                        {t('preview.import', { count: selectedTransactions.length })}
                      </span>
                    )}
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

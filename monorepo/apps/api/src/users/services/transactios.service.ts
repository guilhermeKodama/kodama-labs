import { Injectable, Logger } from '@nestjs/common';
import {
  Email,
  Prisma,
  Transaction,
  TransactionStatus,
  TransactionType,
  TransactionLogStatus,
  User,
} from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { NERService } from 'src/nlp/ner/ner.service';
import { ExpenseCategory } from '../types/transaction.enum';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);
  constructor(
    private prisma: PrismaService, 
    private nerService: NERService
  ) {}

  /**
   * Database
   */
  async transaction(
    userWhereUniqueInput: Prisma.TransactionWhereUniqueInput,
    selectFields?: Prisma.TransactionSelect,
  ): Promise<
    (Transaction & { subItems?: Transaction[]; email?: Email }) | null
  > {
    return this.prisma.transaction.findUnique({
      where: userWhereUniqueInput,
      select: selectFields,
    });
  }

  async upsertTransaction(input: {
    where: Prisma.TransactionWhereUniqueInput;
    create: Prisma.TransactionCreateInput;
    update: Prisma.TransactionUpdateInput;
  }) {
    return this.prisma.transaction.upsert({
      where: input.where,
      create: input.create,
      update: input.update,
    });
  }

  async updateTransaction(params: {
    where: Prisma.TransactionWhereUniqueInput;
    data: Prisma.TransactionUpdateInput;
  }): Promise<Transaction> {
    const { where, data } = params;
    return this.prisma.transaction.update({
      data,
      where,
    });
  }

  async createTransaction(
    data: Prisma.TransactionCreateInput,
  ): Promise<Transaction> {
    return this.prisma.transaction.create({
      data,
    });
  }

  async createTransactions(data: Prisma.TransactionCreateManyInput[]) {
    return this.prisma.transaction.createMany({
      data,
    });
  }

  async createTransactionsFromCsv(params: {
    transactions: Array<{
      description: string;
      dueAt: string;
      amount: number;
      category: string;
      type: TransactionType;
    }>;
    userId: string;
    defaultStatus: TransactionStatus;
  }): Promise<Transaction[]> {
    const { transactions, userId, defaultStatus } = params;

    this.logger.log(`Creating ${transactions.length} transactions from CSV for user ${userId}`);

    // Create transactions one by one to get the full objects back
    const createdTransactions: Transaction[] = [];
    
    for (const tx of transactions) {
      const transaction = await this.prisma.transaction.create({
        data: {
          description: tx.description,
          amount: tx.amount,
          category: tx.category,
          type: tx.type,
          status: defaultStatus,
          dueAt: new Date(tx.dueAt),
          user: { connect: { id: userId } },
        },
        include: {
          subItems: true,
        },
      });
      createdTransactions.push(transaction);
    }

    this.logger.log(`Successfully created ${createdTransactions.length} transactions from CSV`);
    
    return createdTransactions;
  }

  async deleteTransaction(
    where: Prisma.TransactionWhereUniqueInput,
  ): Promise<Transaction> {
    return this.prisma.transaction.delete({
      where,
    });
  }

  async deleteTransactions(params: {
    where: { id: { in: string[] }; userId: string };
  }) {
    const { where } = params;
    return this.prisma.transaction.deleteMany({
      where: {
        id: { in: where.id.in },
        userId: where.userId,
      },
    });
  }

  /**
   * Business Logic
   */

  async saveTransactionsFromEmail(
    email: Email,
    user: User,
    total: number,
    dueAt: Date,
  ) {
    // Validate that we have a valid total amount
    if (!total || total <= 0) {
      this.logger.warn('Cannot process email without valid total amount', {
        emailId: email.id,
        total,
        emailSubject: email.snippet?.substring(0, 100),
      });
      return;
    }

    let parentTransaction = await this.prisma.transaction.findFirst({
      where: { emailId: email.id, parentId: null },
    });

    const subItemsRecord = parentTransaction
      ? await this.prisma.transaction.findMany({
          where: { emailId: email.id, parentId: parentTransaction.id },
        })
      : [];

    /**
     * Extract sub items
     */

    const subItems = this.nerService.extractSubItems(email);

    this.logger.debug({
      parentTransaction: parentTransaction?.id,
      subItems: subItems.length,
      pdfTextLength: email.pdfText?.length || 0,
      hasPdfText: !!email.pdfText,
    });

    /**
     * Parent transaction
     */

    if (!parentTransaction) {
      parentTransaction = await this.createTransaction({
        status: TransactionStatus.PENDING,
        amount: total,
        dueAt: dueAt,
        createdAt: email.internalDate,
        description: this.nerService.getDescriptionFromCreditCardBill(email),
        category: ExpenseCategory.CREDIT_CARD,
        email: { connect: { id: email.id } },
        user: { connect: { id: user.id } },
      });
    }

    let subItemsTotal = subItems.reduce(
      (acc, subItem) => acc + subItem.value,
      0,
    );

    subItemsTotal = Math.round(subItemsTotal * 100) / 100;
    const parentTotal = Math.round(parentTransaction.amount * 100) / 100;

    const truncatedSubItemsTotal = Math.floor(subItemsTotal);
    const truncatedParentTotal = Math.floor(parentTotal);

    // If we have sub-items, validate the totals match
    if (subItems.length > 0 && truncatedSubItemsTotal !== truncatedParentTotal) {
      this.logger.error('Subitems total are diff from parent transaction', {
        subItemsTotal,
        parentTotal,
        subItemsCount: subItems.length,
      });

      await this.prisma.transactionLog.upsert({
        where: {
          transactionId: parentTransaction.id,
        },
        update: {
          status: TransactionLogStatus.ERROR,
          data: { subItems, subItemsTotal, parentTotal },
        },
        create: {
          transactionId: parentTransaction.id,
          status: TransactionLogStatus.ERROR,
          data: { subItems, subItemsTotal, parentTotal },
        },
      });
    } else {
      // Only create sub-items if we have them and they don't already exist
      if (subItemsRecord.length === 0 && subItems.length > 0) {
        this.logger.debug(`Creating ${subItems.length} sub-items for transaction ${parentTransaction.id}`);
        
        const transactionsInput = subItems.map((subItem) => ({
          parentId: parentTransaction.id,
          status: TransactionStatus.PENDING,
          amount: subItem.value,
          dueAt: dueAt,
          createdAt: subItem.date,
          description: subItem.description,
          category: ExpenseCategory.CREDIT_CARD,
          userId: user.id,
          emailId: email.id,
        }));

        await this.createTransactions(transactionsInput);
      } else if (subItems.length === 0) {
        this.logger.log('No sub-items extracted from PDF - transaction will be processed without detailed breakdown', {
          emailId: email.id,
          pdfTextLength: email.pdfText?.length || 0,
          sender: email.sender,
        });
      }

      // Update the parent transaction with latest data
      await this.prisma.transaction.update({
        where: { id: parentTransaction.id },
        data: {
          amount: total,
          dueAt: dueAt,
        },
      });
    }
  }

  extractTotalFromEmail(email: Email) {
    // Use the NER service wrapper which delegates to the appropriate specialized service
    const total = this.nerService.extractMainBillTotal(
      `${email.snippet}  ${email.body} ${email.pdfText}`,
      email.sender
    );
    
    // Validate that we have a valid numeric amount
    if (total === undefined || total === null || isNaN(total) || total <= 0) {
      this.logger.warn('Could not extract valid amount from email', {
        emailId: email.id,
        total,
        sender: email.sender,
        snippet: email.snippet?.substring(0, 100),
        body: email.body?.substring(0, 100),
        pdfText: email.pdfText?.substring(0, 100),
      });
      return null;
    }
    
    return total;
  }

  extractDueAtFromEmail(email: Email) {
    // Prioritize PDF text over email body since due dates are typically in the PDF
    const textToSearch = email.pdfText || email.body;
    const dueDates = this.nerService.extractDates(textToSearch, email.sender);

    let dueAt = null;

    if (dueDates.length > 0) {
      dueAt = dueDates[0];
    } else {
      dueAt = new Date(email.internalDate.getTime() + 5 * 24 * 60 * 60 * 1000);
    }

    return dueAt;
  }
}

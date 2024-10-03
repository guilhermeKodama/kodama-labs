import { Injectable, Logger } from '@nestjs/common';
import {
  Email,
  Prisma,
  Transaction,
  TransactionStatus,
  TransactionLogStatus,
  User,
} from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { NERService } from 'src/nlp/ner/ner.service';
import { ExpenseCategory } from '../types/transaction.enum';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);
  constructor(private prisma: PrismaService, private nerService: NERService) {}

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

    if (truncatedSubItemsTotal !== truncatedParentTotal) {
      this.logger.error('Subitems total are diff from parent transaction', {
        subItemsTotal,
        parentTotal,
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
      if (subItemsRecord.length === 0 && subItems.length > 0) {
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
      }

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
    const values = this.nerService.extractValues(
      `${email.snippet}  ${email.body} ${email.pdfText}`,
    );

    const total = values[0];
    return total;
  }

  extractDueAtFromEmail(email: Email) {
    const dueDates = this.nerService.extractDates(email.body);

    let dueAt = null;

    if (dueDates.length > 0) {
      dueAt = dueDates[0];
    } else {
      dueAt = new Date(email.internalDate.getTime() + 5 * 24 * 60 * 60 * 1000);
    }

    return dueAt;
  }
}

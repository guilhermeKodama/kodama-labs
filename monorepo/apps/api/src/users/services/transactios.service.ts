import { Injectable } from '@nestjs/common';
import {
  Email,
  Prisma,
  Transaction,
  TransactionStatus,
  User,
} from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { NERService } from 'src/nlp/ner/ner.service';
import { ExpenseCategory } from '../types/transaction.enum';

@Injectable()
export class TransactionsService {
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

  async saveTransactionFromEmail(
    data: Prisma.TransactionCreateInput,
  ): Promise<Transaction & { subItems: Transaction[] }> {
    const transaction = await this.prisma.transaction.findFirst({
      where: { emailId: data.email.connect.id },
    });

    if (transaction) {
      return this.prisma.transaction.update({
        where: { id: transaction.id },
        include: {
          subItems: true,
        },
        data,
      });
    }

    return this.prisma.transaction.create({
      data,
      include: {
        subItems: true,
      },
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

    /**
     * Parent transaction
     */

    if (!parentTransaction) {
      parentTransaction = await this.saveTransactionFromEmail({
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

    if (subItemsRecord.length === 0 && subItems.length > 0) {
      for (const subItem of subItems) {
        await this.createTransaction({
          parent: { connect: { id: parentTransaction.id } },
          status: TransactionStatus.PENDING,
          amount: subItem.value,
          dueAt: dueAt,
          createdAt: subItem.date,
          description: subItem.description,
          category: ExpenseCategory.CREDIT_CARD,
          email: { connect: { id: email.id } },
          user: { connect: { id: user.id } },
        });
      }
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

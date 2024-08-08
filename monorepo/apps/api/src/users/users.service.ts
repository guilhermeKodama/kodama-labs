import { Injectable } from '@nestjs/common';
import { User, Prisma, Transaction } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async user(
    userWhereUniqueInput: Prisma.UserWhereUniqueInput,
    selectFields?: Prisma.UserSelect,
  ): Promise<(User & { transactions?: Transaction[] }) | null> {
    return this.prisma.user.findUnique({
      where: userWhereUniqueInput,
      select: selectFields,
    });
  }

  async users(params: {
    skip?: number;
    take?: number;
    cursor?: Prisma.UserWhereUniqueInput;
    where?: Prisma.UserWhereInput;
    orderBy?: Prisma.UserOrderByWithRelationInput;
  }): Promise<User[]> {
    const { skip, take, cursor, where, orderBy } = params;
    return this.prisma.user.findMany({
      skip,
      take,
      cursor,
      where,
      orderBy,
    });
  }

  async createUser(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({
      data,
    });
  }

  async updateUser(params: {
    where: Prisma.UserWhereUniqueInput;
    data: Prisma.UserUpdateInput;
  }): Promise<User> {
    const { where, data } = params;
    return this.prisma.user.update({
      data,
      where,
    });
  }

  async deleteUser(where: Prisma.UserWhereUniqueInput): Promise<User> {
    return this.prisma.user.delete({
      where,
    });
  }

  async saveEmail(data: Prisma.EmailCreateInput) {
    const email = await this.prisma.email.findUnique({
      where: { messageId: data.messageId },
    });

    if (email) {
      return this.prisma.email.update({
        where: { id: email.id },
        data,
      });
    }

    return this.prisma.email.create({
      data,
    });
  }

  async saveTransactionFromEmail(data: Prisma.TransactionCreateInput) {
    const transaction = await this.prisma.transaction.findFirst({
      where: { emailId: data.email.connect.id },
    });

    if (transaction) {
      return this.prisma.transaction.update({
        where: { id: transaction.id },
        data,
      });
    }

    return this.prisma.transaction.create({
      data,
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
}

import { Injectable } from '@nestjs/common';
import { User, Prisma, Transaction, Email } from '@prisma/client';
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

  async updateEmail(data: Prisma.EmailUpdateArgs) {
    return this.prisma.email.update(data);
  }

  async email(
    emailWhereUniqueInput: Prisma.EmailWhereUniqueInput,
    selectFields?: Prisma.EmailSelect,
  ) {
    return this.prisma.email.findUnique({
      where: emailWhereUniqueInput,
      select: selectFields,
    });
  }

  async emails(params: {
    skip?: number;
    take?: number;
    cursor?: Prisma.EmailWhereUniqueInput;
    where?: Prisma.EmailWhereInput;
    orderBy?: Prisma.EmailOrderByWithRelationInput;
    select?: Prisma.EmailSelect;
  }): Promise<Email[]> {
    const { skip, take, cursor, where, orderBy, select } = params;
    return this.prisma.email.findMany({
      skip,
      take,
      cursor,
      where,
      orderBy,
      select,
    });
  }
}

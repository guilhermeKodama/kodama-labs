import { Injectable } from '@nestjs/common';
import { User, Prisma, Transaction, Email } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { EventsGateway } from 'src/events/events.gateway';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
  ) {}

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
    const updatedUser = await this.prisma.user.update({
      data,
      where,
    });

    if ('hasPendingProcess' in data) {
      this.eventsGateway.notifyUserHasPendingProcessChanged(
        updatedUser.id,
        updatedUser.hasPendingProcess,
      );
    }

    return updatedUser;
  }

  async deleteUser(where: Prisma.UserWhereUniqueInput): Promise<User> {
    return this.prisma.user.delete({
      where,
    });
  }

  async upsertEmail(input: {
    where: Prisma.EmailWhereUniqueInput;
    create: Prisma.EmailCreateInput;
    update: Prisma.EmailUpdateInput;
  }) {
    return this.prisma.email.upsert({
      where: input.where,
      create: input.create,
      update: input.update,
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

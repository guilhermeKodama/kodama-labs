import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards';
import { UsersService } from './users.service';
import { CreateTransactionDto } from './types/create-transaction.dto';
import { UpdateTransactionDto } from './types/update-transaction.dto';

const TransactionSubItemSelect = {
  select: {
    id: true,
    amount: true,
    description: true,
    dueAt: true,
    status: true,
    category: true,
    email: {
      select: {
        id: true,
        sender: true,
        snippet: true,
        internalDate: true,
      },
    },
  },
};

@Controller('user')
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(private readonly usersService: UsersService) {}
  @Get('transactions')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Req() request: Request & { user: { id } }) {
    const userId = request.user?.id;

    const user = await this.usersService.user(
      { id: userId },
      {
        id: true,
        email: true,
        photo: true,
        transactions: {
          where: { parentId: null },
          include: {
            email: {
              select: {
                id: true,
                sender: true,
                snippet: true,
                internalDate: true,
                pdfNeedsPassword: true,
                createdAt: true,
              },
            },
            subItems: TransactionSubItemSelect,
          },
        },
      },
    );

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return { transactions: user.transactions || [] };
  }

  @Post('/transaction')
  @UseGuards(JwtAuthGuard)
  async createTransaction(
    @Req() request: Request & { user: { id: string } },
    @Body() createTransactionDto: CreateTransactionDto,
  ) {
    const userId = request.user.id;
    if (!userId) {
      throw new UnauthorizedException('User not found');
    }

    const transaction = await this.usersService.createTransaction({
      ...createTransactionDto,
      user: { connect: { id: userId } },
      subItems: {
        create: createTransactionDto.subItems.map((subItem) => ({
          amount: subItem.amount,
          description: subItem.description,
          category: subItem.category || createTransactionDto.category,
          type: createTransactionDto.type, // inherit type from the parent
          status: createTransactionDto.status, // inherit status from the parent
          dueAt: createTransactionDto.dueAt, // inherit due date
          user: { connect: { id: userId } },
        })),
      },
    });

    return { transaction };
  }

  @Put('/transaction')
  @UseGuards(JwtAuthGuard)
  async updateTransaction(
    @Req() request: Request & { user: { id: string } },
    @Body() updateTransactionDto: UpdateTransactionDto,
  ) {
    const userId = request.user.id;
    if (!userId) {
      throw new UnauthorizedException('User not found');
    }

    const { id, subItems, ...data } = updateTransactionDto;

    const existingTransaction = await this.usersService.transaction(
      {
        id,
        userId,
      },
      {
        id: true,
        subItems: TransactionSubItemSelect,
      },
    );

    if (!existingTransaction) {
      throw new NotFoundException('Transaction not found');
    }

    const existingSubItemIds = existingTransaction.subItems.map(
      (subItem) => subItem.id,
    );
    const incomingSubItemIds = subItems
      .map((subItem) => subItem.id)
      .filter(Boolean);

    // Find the IDs of subItems that need to be deleted
    const subItemsToDelete = existingSubItemIds.filter(
      (subItemId) => !incomingSubItemIds.includes(subItemId),
    );

    this.logger.debug({ subItemsToDelete });

    const transaction = await this.usersService.updateTransaction({
      where: { id, userId },
      data: {
        ...data,
        subItems: {
          upsert: subItems.map((subItem) => ({
            where: { id: subItem.id || '' }, // `id` of the subItem (if exists)
            update: {
              description: subItem.description,
              amount: subItem.amount,
              category: subItem.category,
            },
            create: {
              description: subItem.description,
              amount: subItem.amount,
              category: subItem.category || updateTransactionDto.category,
              type: updateTransactionDto.type, // inherit type from the parent
              status: updateTransactionDto.status, // inherit status from the parent
              dueAt: updateTransactionDto.dueAt, // inherit due date
              user: { connect: { id: userId } },
            },
          })),
          deleteMany: {
            id: { in: subItemsToDelete }, // Delete subItems that are not in the DTO
          },
        },
      },
    });

    return { transaction };
  }

  @Delete('/transaction/:id')
  @UseGuards(JwtAuthGuard)
  async deleteTransaction(
    @Req() request: Request & { user: { id: string } },
    @Param('id') id: string,
  ) {
    const userId = request.user.id;
    if (!userId) {
      throw new UnauthorizedException('User not found');
    }

    const transaction = await this.usersService.deleteTransaction({
      id,
      user: { id: userId },
    });

    return { transaction };
  }

  @Delete('/transactions')
  @UseGuards(JwtAuthGuard)
  async deleteTransactions(
    @Req() request: Request & { user: { id: string } },
    @Query('ids') ids: string,
  ) {
    const userId = request.user.id;
    if (!userId) {
      throw new UnauthorizedException('User not found');
    }

    if (!ids) {
      throw new BadRequestException('No transaction IDs provided');
    }

    const idsArray = ids.split(',').map((id) => id.trim());
    if (idsArray.length === 0) {
      throw new BadRequestException('No valid transaction IDs provided');
    }

    const transactions = await this.usersService.deleteTransactions({
      where: {
        id: { in: idsArray },
        userId,
      },
    });

    return { transactions };
  }
}

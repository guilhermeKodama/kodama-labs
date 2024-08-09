import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
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

@Controller('user')
export class UserController {
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
          include: {
            email: {
              select: {
                id: true,
                sender: true,
                snippet: true,
                internalDate: true,
                createdAt: true,
              },
            },
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

    const { id, ...data } = updateTransactionDto;

    const transaction = await this.usersService.updateTransaction({
      where: { id, user: { id: userId } },
      data,
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

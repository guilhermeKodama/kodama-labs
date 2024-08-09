import { TransactionStatus, TransactionType } from '@prisma/client';
import { IsNumber, IsString, IsNotEmpty, IsDate } from 'class-validator';
import { ExpenseCategory, IncomeCategory } from './transaction.enum';
import { IsValidCategory } from '../decorators/is-category-valid.decorator';

export class UpdateTransactionDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  type: TransactionType;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @IsNumber()
  @IsNotEmpty()
  status: TransactionStatus;

  @IsDate()
  @IsNotEmpty()
  dueAt: Date;

  @IsString()
  @IsValidCategory({
    message: 'Category is not valid for the given transaction type.',
  })
  category: string;
}

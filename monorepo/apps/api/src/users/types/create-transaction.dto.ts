import { TransactionStatus, TransactionType } from '@prisma/client';
import { IsNumber, IsString, IsNotEmpty, IsDate } from 'class-validator';
import { IsValidCategory } from '../decorators/is-category-valid.decorator';

export class CreateTransactionDto {
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

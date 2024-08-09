import { TransactionStatus, TransactionType } from '@prisma/client';
import { IsNumber, IsString, IsNotEmpty, IsDate } from 'class-validator';
import { ExpenseCategory, IncomeCategory } from './transaction.enum';

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
  category: string;

  validateCategory() {
    if (this.type === TransactionType.INCOME) {
      if (
        !Object.values(IncomeCategory).includes(this.category as IncomeCategory)
      ) {
        throw new Error(`Invalid category for INCOME: ${this.category}`);
      }
    } else if (this.type === TransactionType.EXPENSE) {
      if (
        !Object.values(ExpenseCategory).includes(
          this.category as ExpenseCategory,
        )
      ) {
        throw new Error(`Invalid category for EXPENSE: ${this.category}`);
      }
    } else {
      throw new Error(`Invalid transaction type: ${this.type}`);
    }
  }
}

import { TransactionStatus, TransactionType } from '@prisma/client';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsDateString,
  IsEnum,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { IsValidCategory } from '../decorators/is-category-valid.decorator';
import { Type } from 'class-transformer';

export class ImportCsvTransactionDto {
  @IsString()
  @IsNotEmpty()
  description: string;

  @IsDateString()
  @IsNotEmpty()
  dueAt: string;

  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @IsString()
  @IsValidCategory({
    message: 'Category is not valid for the given transaction type.',
  })
  category: string;

  @IsEnum(TransactionType)
  @IsNotEmpty()
  type: TransactionType;
}

export class ImportCsvTransactionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportCsvTransactionDto)
  @IsNotEmpty()
  transactions: ImportCsvTransactionDto[];

  @IsEnum(TransactionStatus)
  @IsNotEmpty()
  defaultStatus: TransactionStatus;
}

import { TransactionStatus, TransactionType } from '@prisma/client';
import {
  IsNumber,
  IsString,
  IsNotEmpty,
  IsDate,
  IsArray,
  ValidateNested,
  IsDateString,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { IsValidCategory } from '../decorators/is-category-valid.decorator';
import { Type } from 'class-transformer';

export class CreateSubItemDto {
  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsValidCategory({
    message: 'Category is not valid for the subItem.',
  })
  category: string;

  @IsNumber()
  @IsNotEmpty()
  amount: number;
}

export class CreateSubTransactionDto {
  @IsString()
  description: string;

  @IsNumber()
  amount: number;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  symbol?: string;

  @IsNumber()
  @IsOptional()
  quantity?: number;
}

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

  @IsString()
  @IsOptional()
  symbol?: string;

  @IsNumber()
  @IsOptional()
  quantity?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSubTransactionDto)
  @IsOptional()
  subItems?: CreateSubTransactionDto[];
}

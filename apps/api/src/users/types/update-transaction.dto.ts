import { TransactionStatus, TransactionType } from '@prisma/client';
import {
  IsNumber,
  IsString,
  IsNotEmpty,
  IsDate,
  IsArray,
  ValidateNested,
  IsBoolean,
  IsOptional,
  IsDateString,
  IsEnum,
} from 'class-validator';
import { IsValidCategory } from '../decorators/is-category-valid.decorator';
import { Type } from 'class-transformer';

export class UpdateSubItemDto {
  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @IsString()
  @IsOptional()
  category?: string;

  @IsBoolean()
  @IsOptional()
  hasChanged?: boolean;

  @IsString()
  @IsOptional()
  symbol?: string;

  @IsNumber()
  @IsOptional()
  quantity?: number;
}

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

  @IsDateString()
  @IsNotEmpty()
  dueAt: string;

  @IsString()
  @IsValidCategory({
    message: 'Category is not valid for the given transaction type.',
  })
  category: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateSubItemDto)
  subItems: UpdateSubItemDto[];
}

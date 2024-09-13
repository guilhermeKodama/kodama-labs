import { TransactionStatus, TransactionType } from '@prisma/client';
import {
  IsNumber,
  IsString,
  IsNotEmpty,
  IsDate,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { IsValidCategory } from '../decorators/is-category-valid.decorator';
import { Type } from 'class-transformer';

export class UpdateSubItemDto {
  @IsString()
  @IsNotEmpty()
  id: string;

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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateSubItemDto)
  subItems: UpdateSubItemDto[];
}

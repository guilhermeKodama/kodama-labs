import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';
import { TransactionType } from '@prisma/client';
import { ExpenseCategory, IncomeCategory, InvestmentCategory } from '../types/transaction.enum';

export function IsValidCategory(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidCategory',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(category: any, args: ValidationArguments) {
          const transaction = args.object as { type: TransactionType };
          if (transaction.type === TransactionType.INCOME) {
            return Object.values(IncomeCategory).includes(
              category as IncomeCategory,
            );
          } else if (transaction.type === TransactionType.EXPENSE) {
            return Object.values(ExpenseCategory).includes(
              category as ExpenseCategory,
            );
          } else if (transaction.type === TransactionType.INVESTMENT) {
            return Object.values(InvestmentCategory).includes(
              category as InvestmentCategory,
            );
          }
          return false;
        },
        defaultMessage(args: ValidationArguments) {
          const transaction = args.object as { type: TransactionType };
          if (transaction.type === TransactionType.INCOME) {
            return `Category must be one of: ${Object.values(
              IncomeCategory,
            ).join(', ')}`;
          } else if (transaction.type === TransactionType.EXPENSE) {
            return `Category must be one of: ${Object.values(
              ExpenseCategory,
            ).join(', ')}`;
          }
          return 'Invalid category for the given transaction type.';
        },
      },
    });
  };
}

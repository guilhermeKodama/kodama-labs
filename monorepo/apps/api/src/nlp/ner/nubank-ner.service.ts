/**
 * @name NubankNERService
 * @summary This service is responsible for extracting relevant information from Nubank emails.
 */

import { Injectable, Logger } from '@nestjs/common';
import { SubItem } from '../types/email.interface';

@Injectable()
export class NubankNERService {
  private readonly logger = new Logger(NubankNERService.name);

  extractSubItemsFromCreditCardPDFText(text: string): SubItem[] {
    const transactions: SubItem[] = [];
    const transactionPattern = /(\d{2} \w{3})\n(.*?)(-?\R\$ [\d.,]+)/g;
    let match;

    while ((match = transactionPattern.exec(text)) !== null) {
      const [_, date, name, value] = match;

      // Convert BRL value format to a format that parseFloat can understand
      const numericValue = parseFloat(
        value
          .replace(/\./g, '') // Remove all periods (thousands separators)
          .replace(',', '.') // Replace the comma with a period (decimal separator)
          .replace('R$', '') // Remove the "R$" currency symbol
          .trim(), // Trim any whitespace
      );

      // Convert the captured date to a Date object
      const [day, monthStr] = date.split(' ');
      const month = this.convertMonthStringToNumber(monthStr);
      const currentYear = new Date().getFullYear();
      const dateObject = new Date(
        Date.UTC(currentYear, month, parseInt(day, 10), 12, 0, 0),
      );

      transactions.push({
        description: name.trim(),
        date: dateObject,
        value: numericValue,
      });
    }

    // Remove the first transaction
    transactions.shift();

    return transactions.filter((transaction) => !isNaN(transaction.value));
  }

  private convertMonthStringToNumber(monthStr: string): number {
    const monthMap: { [key: string]: number } = {
      JAN: 0,
      FEB: 1,
      MAR: 2,
      APR: 3,
      MAY: 4,
      JUN: 5,
      JUL: 6,
      AUG: 7,
      SEP: 8,
      OCT: 9,
      NOV: 10,
      DEC: 11,
    };
    return monthMap[monthStr.toUpperCase()] || 0;
  }
}

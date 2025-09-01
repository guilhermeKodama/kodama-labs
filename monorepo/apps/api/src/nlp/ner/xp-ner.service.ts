/**
 * @name XPNERService
 * @summary This service is responsible for extracting relevant information from XP emails or PDF statements.
 */

import { Injectable, Logger } from '@nestjs/common';
import { SubItem } from '../types/email.interface';
import { Email } from '@prisma/client';

@Injectable()
export class XPNERService {
  private readonly logger = new Logger(XPNERService.name);
  /**
   * 18/08/24BACIO DI LATTE-LJ006464,900,00
   */
  private readonly BLACK_LIST_TERMS = [/LJ\d{4}/g];

  /**
   * Extract the main bill total from XP PDF text
   */
  extractMainBillTotal(text: string): number | null {
    // First, extract all monetary values from the text
    const values = this.extractAllMonetaryValues(text);
    
    if (values.length === 0) {
      return null;
    }

    if (values.length === 1) {
      return values[0];
    }

    // If we have multiple values, try to find the most likely total
    this.logger.debug('Multiple monetary values found, attempting to identify the main total', {
      allValues: values,
      valuesCount: values.length,
    });

    // For XP, we'll use the largest value as the main total since XP PDFs typically
    // have the total at the bottom and it's usually the largest amount
    const mainTotal = Math.max(...values);
    
    this.logger.debug('Selected largest value as main total for XP PDF', {
      selectedTotal: mainTotal,
      allValues: values,
    });
    
    return mainTotal;
  }

  /**
   * Extract all monetary values from text (helper method for extractMainBillTotal)
   */
  extractAllMonetaryValues(text: string): number[] {
    // Regular expression to match prices in the format: "123.123,23" (XP format)
    const priceRegex = /(\d{1,3}(?:\.\d{3})*,\d{2})/g;

    // Array to store matched prices
    const values: number[] = [];

    // Execute the regex on the text
    const matches = text.match(priceRegex);

    if (matches) {
      // Process each match and extract the numeric value
      for (const match of matches) {
        const numericValue = parseFloat(
          match.replace(/\./g, '').replace(',', '.'),
        );

        if (!isNaN(numericValue)) {
          values.push(numericValue);
        }
      }
    }

    return values;
  }

  /**
   * Extract dates from XP PDF text
   */
  extractDates(text: string): Date[] {
    // XP PDFs use DD/MM/YY format
    const dateRegex = /(\d{2})\/(\d{2})\/(\d{2})/g;
    
    const dates: Date[] = [];

    // Execute the regex on the text
    const matches = [...text.matchAll(dateRegex)];

    if (matches) {
      for (const match of matches) {
        const day = parseInt(match[1], 10);
        const month = parseInt(match[2], 10) - 1; // Month is 0-indexed
        const year = parseInt(`20${match[3]}`, 10);

        if (!isNaN(day) && !isNaN(month) && month >= 0 && month <= 11) {
          // Create date in UTC to avoid timezone issues
          const date = new Date(Date.UTC(year, month, day));
          dates.push(date);
        }
      }
    }

    if (dates.length === 0) {
      this.logger.warn('No dates found in XP PDF text', { 
        text: text.substring(0, 200),
        textLength: text.length 
      });
    } else {
      this.logger.debug('Extracted dates from XP PDF text', { 
        dates: dates.map(d => d.toISOString()),
        count: dates.length 
      });
    }

    return dates;
  }

  /**
   * Get description from XP credit card bill
   */
  getDescriptionFromCreditCardBill(email: Email): string {
    // Try to extract a meaningful description from the PDF content first
    if (email.pdfText) {
      // Look for patterns that indicate the bill description
      const pdfText = email.pdfText;
      
      // Pattern 1: Look for "FATURA" followed by date
      const faturaPattern = /FATURA\s+(\d{2}\/\d{2}\/\d{4})/i;
      const faturaMatch = pdfText.match(faturaPattern);
      if (faturaMatch) {
        return `Fatura XP ${faturaMatch[1]}`;
      }
      
      // Pattern 2: Look for "Resumo de Fatura" or similar
      const resumoPattern = /Resumo de Fatura\s+(\d{2}\/\d{2}\/\d{4})/i;
      const resumoMatch = pdfText.match(resumoPattern);
      if (resumoMatch) {
        return `Fatura XP ${resumoMatch[1]}`;
      }
    }
    
    // Fallback to the original logic if no meaningful description found
    const date = new Date(email.internalDate);
    const billAt = `${date.getMonth() + 1}/${date
      .getFullYear()
      .toString()
      .slice(-2)}`;

    return `Fatura XP ${billAt}`;
  }

  removeBlackListedTerms(input: string): string {
    let cleanedString = input;

    // Iterate over each blacklisted term and remove matches
    for (const term of this.BLACK_LIST_TERMS) {
      cleanedString = cleanedString.replace(term, '');
    }

    return cleanedString.trim();
  }

  /**
   * @example Extracts sub-items from a credit card PDF text.
   *    '16/12/23BT SHOP ELDORADO - Parcela 8/12947,000,00\n' +
        '26/12/23RESERVA STONE - Parcela 8/10319,200,00\n' +
        '21/01/24PG *REVITALE REDS - Parcela 7/12108,080,00\n' +
        '01/04/24PG *GUILHERME FRE - Parcela 5/1249,920,00\n' +
        '04/04/24OFICINA SHOPPING - Parcela 5/7299,040,00\n' +
        '05/04/24MP*LOGITECH - Parcela 5/7128,090,00\n' +
        '21/04/24LATAM SITE - Parcela 4/41.009,230,00\n' +
        '21/04/24AMAZON MARKETPLACE - Parcela 4/10355,760,00\n' +
        '01/05/24CAPS ANALIA FRANCO COM - Parcela 4/10118,000,00\n' +
        '06/05/24ANA PAULA CALIMAN SOCIE - Parcela 4/61.083,330,00\n' +
        '28/05/24MP*MERCADOLIVRE - Parcela 3/10299,200,00\n' +
        '31/05/24APPLE.COM/BR - Parcela 3/12183,160,00\n' +
        '13/06/24EC *INSIDERSTORE - Parcela 2/4253,250,00\n' +
        '01/07/24MERCADOLIVRE*MNLDISTRI - Parcela 2/1084,980,00\n' +
        '09/07/24PP *GORILSHIELD - Parcela 2/2459,840,00\n' +
        '11/07/24IFD*BAR E RESTAURANTE LAC53,980,00\n' +
        '11/07/24APPLE.COM/BILL61,900,00\n' +
        '12/07/24IFD*BAR E RESTAURANTE LAC54,980,00\n' +
        '12/07/24APPLE.COM/BILL19,900,00\n' +
   */

  extractSubItemsFromCreditCardPDFText(
    text: string,
    creditCardBillDate: Date,
  ): SubItem[] {
    const subItems: SubItem[] = [];

    // Regex patterns for parcel formats
    const regexXYY =
      /(\d{2}\/\d{2}\/\d{2})\s*([^\d]+?-\s*Parcela\s*\d+\/\d{2})\s*(\d{1,3}(?:\.\d{3})*,\d{2})/;
    const regexXX =
      /(\d{2}\/\d{2}\/\d{2})\s*([^\d]+?-\s*Parcela\s*\d+\/\d)\s*(\d{1,3}(?:\.\d{3})*,\d{2})/;

    // Generic regex pattern for non-parcel items
    const dateRegex = new RegExp(`\\d{2}\\/\\d{2}\\/\\d{2}`); // Matches date (dd/mm/yy)
    // Updated value regex pattern to ignore the first value (USD) and capture only BRL
    const valueRegex = /(\d{1,3}(?:\.\d{3})*,\d{2})\d*(?:,\d{2})?/;

    // Split the input text into lines
    const lines = text.split('\n');
    for (let line of lines) {
      let isParcel = false;
      line = line.trim();
      if (!line) continue; // Skip empty lines

      line = this.removeBlackListedTerms(line);

      let match = null;

      if (line.includes('Parcela')) {
        isParcel = true;
        // Check if the line contains the "/1" pattern to determine parcel format
        if (line.includes('/1')) {
          // Apply the regex for the x/yy pattern
          match = regexXYY.exec(line);
        } else {
          // Apply the regex for the x/x pattern
          match = regexXX.exec(line);
        }
      } else {
        // Start by matching the value from the end of the string
        const valueMatch = valueRegex.exec(line);

        if (valueMatch) {
          const value = parseFloat(
            valueMatch[1].replace(/\./g, '').replace(',', '.'),
          );

          // Now match the date from the start of the string
          const dateMatch = dateRegex.exec(line);
          if (dateMatch) {
            const dateString = dateMatch[0].trim();
            const [day, month, year] = dateString.split('/');
            const fullYear = parseInt(`20${year}`, 10);

            const dateObject = new Date(
              Date.UTC(
                fullYear,
                parseInt(month, 10) - 1,
                parseInt(day, 10),
                12,
                0,
                0,
              ),
            );

            // Extract the description by removing the date and value from the line
            const description = line
              .replace(dateRegex, '')
              .replace(valueRegex, '')
              .trim();

            subItems.push({ date: dateObject, description, value });
          }
        }
      }

      if (match) {
        const dateString = match[1].trim();
        const [day, month, year] = dateString.split('/');
        const fullYear = parseInt(`20${year}`);

        // we do this because we dont want this transaction to appear in the past.
        const dateObject = isParcel
          ? creditCardBillDate
          : new Date(
              Date.UTC(
                fullYear,
                parseInt(month, 10) - 1,
                parseInt(day, 10),
                12,
                0,
                0,
              ),
            );

        const description = match[2].trim();
        const value = parseFloat(match[3].replace(/\./g, '').replace(',', '.'));

        subItems.push({ date: dateObject, description, value });
      }
    }

    return subItems.filter(
      (subItem) =>
        !subItem.description
          .toLowerCase()
          .includes('pagamentos validos normais'),
    );
  }
}

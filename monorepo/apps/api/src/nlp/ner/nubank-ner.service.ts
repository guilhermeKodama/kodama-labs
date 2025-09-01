/**
 * @name NubankNERService
 * @summary This service is responsible for extracting relevant information from Nubank emails.
 */

import { Injectable, Logger } from '@nestjs/common';
import { SubItem } from '../types/email.interface';
import { Email } from '@prisma/client';

@Injectable()
export class NubankNERService {
  private readonly logger = new Logger(NubankNERService.name);

  extractSubItemsFromCreditCardPDFText(text: string): SubItem[] {
    const transactions: SubItem[] = [];
    
    // More specific regex to match only actual transaction lines
    // Looking for patterns like:
    // "15 JUL\n•••• 3308Localiza MeooR$ 181,18"
    // "24 JUL\n•••• 3308sem PararR$ 329,58"
    // The pattern should start with a date, have some content, and end with a value
    // We'll be more restrictive to avoid picking up other monetary values
    // Updated to handle both newline and space separators between date and content
    const transactionPattern = /(\d{2}\s+[A-Z]{3})\s*(?:\n|[\s]+)(?:.*?)(?:R\$\s*([\d.,]+))/g;
    
    let match;
    let matchCount = 0;

    this.logger.debug('Starting sub-items extraction from PDF text', {
      textLength: text.length,
      textSample: text.substring(0, 500)
    });

    // First, let's identify the main bill total to filter out values that are too large
    const mainBillTotal = this.extractMainBillTotal(text);
    const maxReasonableTransaction = mainBillTotal ? mainBillTotal * 0.95 : 10000; // Max 95% of bill total (was 80%)

    this.logger.debug('Main bill total and max reasonable transaction', {
      mainBillTotal,
      maxReasonableTransaction
    });

    // Let's also log all monetary values found to understand what's in the PDF
    const allValues = this.extractAllMonetaryValues(text);
    this.logger.debug('All monetary values found in PDF', {
      allValues,
      count: allValues.length
    });

    while ((match = transactionPattern.exec(text)) !== null) {
      matchCount++;
      const [fullMatch, date, value] = match;

      this.logger.debug(`Match ${matchCount}:`, { fullMatch, date, value });

      // Convert BRL value format to a format that parseFloat can understand
      const numericValue = parseFloat(
        value
          .replace(/\./g, '') // Remove all periods (thousands separators)
          .replace(',', '.') // Replace the comma with a period (decimal separator)
          .trim(), // Trim any whitespace
      );

      // Skip if the value is too large to be a reasonable transaction
      if (numericValue > maxReasonableTransaction) {
        this.logger.debug(`Skipping value ${numericValue} - too large for a transaction`, {
          maxReasonableTransaction,
          mainBillTotal
        });
        continue;
      }

      // Convert the captured date to a Date object
      const [day, monthStr] = date.trim().split(/\s+/);
      const month = this.convertMonthStringToNumber(monthStr);
      const currentYear = new Date().getFullYear();
      const dateObject = new Date(
        Date.UTC(currentYear, month, parseInt(day, 10), 12, 0, 0),
      );

      // Try to extract description from the line
      // Look for text between the date and the amount
      const lineStart = text.lastIndexOf(date, match.index);
      const lineEnd = text.indexOf('\n', match.index);
      const line = text.substring(lineStart, lineEnd || text.length);
      
      // Extract description (remove date, card info, and amount)
      let description = line
        .replace(date, '')
        .replace(/R\$\s*[\d.,]+/, '')
        .replace(/[•\s]+/, ' ')
        .trim();

      // If no description found, use a default
      if (!description || description.length < 3) {
        description = `Transaction ${matchCount}`;
      }

      this.logger.debug(`Processing transaction ${matchCount}:`, {
        date: dateObject,
        description,
        value: numericValue,
        originalLine: line
      });

      if (!isNaN(numericValue) && numericValue > 0) {
        transactions.push({
          description,
          date: dateObject,
          value: numericValue,
        });
      }
    }

    // If no transactions were found with the current pattern, let's try a different approach
    if (transactions.length === 0) {
      
      // Look for lines that contain dates and amounts but might not follow the exact pattern
      const alternativePattern = /(\d{2}\s+[A-Z]{3})\s+(.*?)\s+R\$\s*([\d.,]+)/g;
      let altMatch;
      let altMatchCount = 0;
      
      // Get current year for date parsing
      const currentYear = new Date().getFullYear();
      
      while ((altMatch = alternativePattern.exec(text)) !== null) {
        altMatchCount++;
        const [fullAltMatch, altDate, altDescription, altValue] = altMatch;
        
        
        const altNumericValue = parseFloat(
          altValue
            .replace(/\./g, '')
            .replace(',', '.')
            .trim()
        );
        
        if (!isNaN(altNumericValue) && altNumericValue > 0 && altNumericValue <= maxReasonableTransaction) {
          const [altDay, altMonthStr] = altDate.trim().split(/\s+/);
          const altMonth = this.convertMonthStringToNumber(altMonthStr);
          const altDateObject = new Date(
            Date.UTC(currentYear, altMonth, parseInt(altDay, 10), 12, 0, 0),
          );
          
          const cleanDescription = altDescription.trim();
          
          transactions.push({
            description: cleanDescription || `Transaction ${altMatchCount}`,
            date: altDateObject,
            value: altNumericValue,
          });
        }
      }
    }

    // If still no transactions found, this might be a summary bill without detailed transactions
    if (transactions.length === 0) {
      this.logger.log('No individual transactions found in PDF - this appears to be a summary bill', {
        mainBillTotal,
        pdfTextLength: text.length
      });
    }

    return transactions;
  }

  /**
   * Extract the main bill total from Nubank PDF text, prioritizing values that appear to be the correct amount
   * This method is smarter than the generic extractValues when dealing with credit card bills that have multiple amounts
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

    // Look for the main bill total by checking the text for specific patterns
    let mainTotal = null;
    
    // Pattern 1: "no valor de R$ X.XXX,XX" (main bill amount) - HIGHEST PRIORITY
    const valorPattern = /no valor de\s*r\$\s*([\d.,]+)/i;
    const valorMatch = text.match(valorPattern);
    if (valorMatch) {
      const valorAmount = parseFloat(valorMatch[1].replace(/\./g, '').replace(',', '.'));
      if (!isNaN(valorAmount) && values.includes(valorAmount)) {
        mainTotal = valorAmount;
        return mainTotal; // Return immediately for highest priority pattern
      }
    }
    
    // Pattern 2: "fatura no valor de R$ X.XXX,XX" (main bill amount)
    if (!mainTotal) {
      const faturaPattern = /fatura no valor de\s*r\$\s*([\d.,]+)/i;
      const faturaMatch = text.match(faturaPattern);
      if (faturaMatch) {
        const faturaAmount = parseFloat(faturaMatch[1].replace(/\./g, '').replace(',', '.'));
        if (!isNaN(faturaAmount) && values.includes(faturaAmount)) {
          mainTotal = faturaAmount;
        }
      }
    }
    
    // Pattern 3: "Total a pagar R$ X.XXX,XX" (main bill amount)
    if (!mainTotal) {
      const totalPattern = /total a pagar\s*r\$\s*([\d.,]+)/i;
      const totalMatch = text.match(totalPattern);
      if (totalMatch) {
        const totalAmount = parseFloat(totalMatch[1].replace(/\./g, '').replace(',', '.'));
        if (!isNaN(totalAmount) && values.includes(totalAmount)) {
          mainTotal = totalAmount;
        }
      }
    }
    
    if (mainTotal) {
      // Use the pattern-matched total
      return mainTotal;
    } else {
      // Fallback: Look for values that might be the main total
      // Credit card bills typically have totals in the range of 100-50,000
      const likelyTotals = values.filter(value => value >= 100 && value <= 50000);
      
      if (likelyTotals.length > 0) {
        // If we have likely totals, use the largest one as it's usually the main bill
        const fallbackTotal = Math.max(...likelyTotals);
        return fallbackTotal;
      } else {
        // If no likely totals, use the largest value
        const fallbackTotal = Math.max(...values);
        return fallbackTotal;
      }
    }
  }

  /**
   * Extract all monetary values from text (helper method for extractMainBillTotal)
   */
  extractAllMonetaryValues(text: string): number[] {
    // Regular expression to match prices in the format: "R$ 123.123,23" or "123.123,23"
    const priceRegex = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{2}))/g;

    // Array to store matched prices
    const values: number[] = [];

    // Execute the regex on the text
    const matches = text.match(priceRegex);

    if (matches) {
      // Process each match and extract the numeric value
      for (const match of matches) {
        const numericValue = parseFloat(
          match.replace(/[^\d,]/g, '').replace(',', '.'),
        );

        if (!isNaN(numericValue)) {
          values.push(numericValue);
        }
      }
    }

    return values;
  }

  /**
   * Extract dates from Nubank PDF text
   */
  extractDates(text: string): Date[] {
    // First, look specifically for due dates with a more targeted regex
    const dueDateRegex = /data de vencimento:\s*(\d{1,2})\s+([a-z]+)\s*(\d{4})?/gi;
    const dueDates: Date[] = [];
    
    // Mapping of month names in Portuguese to their respective month numbers
    const months = {
      janeiro: 0, jan: 0,
      fevereiro: 1, fev: 1,
      março: 2, mar: 2,
      abril: 3, abr: 3,
      maio: 4, mai: 4,
      junho: 5, jun: 5,
      julho: 6, jul: 6,
      agosto: 7, ago: 7,
      setembro: 8, set: 8,
      outubro: 9, out: 9,
      novembro: 10, nov: 10,
      dezembro: 11, dez: 11,
    };

    // Current year as fallback if the year is not mentioned in the text
    const currentYear = new Date().getFullYear();

    // First, extract due dates specifically
    const dueDateMatches = [...text.matchAll(dueDateRegex)];
    for (const match of dueDateMatches) {
      const day = parseInt(match[1], 10);
      const monthName = match[2].toLowerCase();
      const month = months[monthName];
      const year = match[3] ? parseInt(match[3], 10) : currentYear;

      if (!isNaN(day) && !isNaN(month) && month >= 0 && month <= 11) {
        const date = new Date(Date.UTC(year, month, day));
        dueDates.push(date);
        this.logger.debug('Found due date using specific pattern', { 
          date: date.toISOString(), 
          match: match[0],
          day, month, year 
        });
      }
    }

    // If we found due dates, return them immediately
    if (dueDates.length > 0) {
      this.logger.debug('Due dates found, returning them', { 
        dueDates: dueDates.map(d => d.toISOString())
      });
      return dueDates;
    }

    // Fallback: extract all other dates if no due dates found
    const dates: Date[] = [];
    
    // Regular expression to match dates in various formats found in Nubank credit card PDFs
    // Format 1: "11 AGO 2025" (DD MMM YYYY)
    // Format 2: "15 JUL" (DD MMM)
    // Format 3: "DD/MM" (DD/MM)
    // Format 4: "DD de MMMM" (DD de Month)
    const dateRegex = /(\d{1,2})\s*(?:de\s+)?([a-z]+)\s*(\d{4})?|(\d{1,2})\/(\d{1,2})/gi;
    
    // Execute the regex on the text
    const matches = [...text.matchAll(dateRegex)];

    if (matches) {
      for (const match of matches) {
        let day: number, month: number, year: number;

        if (match[1] && match[2]) {
          // Format: "11 AGO 2025" or "15 JUL" or "11 de agosto"
          day = parseInt(match[1], 10);
          const monthName = match[2].toLowerCase();
          month = months[monthName];
          year = match[3] ? parseInt(match[3], 10) : currentYear;
        } else if (match[4] && match[5]) {
          // Format: "DD/MM"
          day = parseInt(match[4], 10);
          month = parseInt(match[5], 10) - 1; // Month is 0-indexed
          year = currentYear;
        } else {
          continue; // Skip invalid matches
        }

        if (!isNaN(day) && !isNaN(month) && month >= 0 && month <= 11) {
          // Create date in UTC to avoid timezone issues
          const date = new Date(Date.UTC(year, month, day));
          dates.push(date);
        }
      }
    }

    return dates;
  }

  /**
   * Get description from Nubank credit card bill
   */
  getDescriptionFromCreditCardBill(email: Email): string {
    // Try to extract a meaningful description from the PDF content first
    if (email.pdfText) {
      // Look for patterns that indicate the bill description
      const pdfText = email.pdfText;
      
      // Pattern 1: Look for "FATURA" followed by date
      const faturaPattern = /FATURA\s+(\d{1,2}\s+[A-Z]{3}\s+\d{4})/i;
      const faturaMatch = pdfText.match(faturaPattern);
      if (faturaMatch) {
        return `Fatura Nubank ${faturaMatch[1]}`;
      }
      
      // Pattern 2: Look for "Esta é a sua fatura de [month]"
      const mesPattern = /Esta é a sua fatura de\s+([a-z]+)/i;
      const mesMatch = pdfText.match(mesPattern);
      if (mesMatch) {
        const month = mesMatch[1];
        const date = new Date(email.internalDate);
        const year = date.getFullYear();
        return `Fatura Nubank ${month} ${year}`;
      }
      
      // Pattern 3: Look for "FATURA [date] EMISSÃO"
      const emissaoPattern = /FATURA\s+(\d{1,2}\s+[A-Z]{3}\s+\d{4})/i;
      const emissaoMatch = pdfText.match(emissaoPattern);
      if (emissaoMatch) {
        return `Fatura Nubank ${emissaoMatch[1]}`;
      }
    }
    
    // Fallback to the original logic if no meaningful description found
    const date = new Date(email.internalDate);
    const billAt = `${date.getMonth() + 1}/${date
      .getFullYear()
      .toString()
      .slice(-2)}`;

    return `Fatura Nubank ${billAt}`;
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

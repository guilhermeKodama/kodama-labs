/**
 * Named entity recognition (NER) is a task that is concerned with identifying and
 * classifying named entities in textual data. Named entities can be a person,
 * organization, location, date, time, or even quantity.
 */

import { Injectable, Logger } from '@nestjs/common';
import { SubItem } from '../types/email.interface';
import { BankDomains } from 'src/gmail/interfaces/bank.interface';
import { NubankNERService } from './nubank-ner.service';
import { XPNERService } from './xp-ner.service';
import { Email } from '@prisma/client';
import { Email as GmailEmail } from 'src/gmail/interfaces/gmail.interface';

@Injectable()
export class NERService {
  private readonly CREDIT_CARD_KEY_TERMS = ['fatura'];
  private readonly CREDIT_CARD_BLACK_LIST = [
    'débito',
    'renegociação',
    'negativado',
  ];
  private readonly logger = new Logger(NERService.name);

  constructor(
    private readonly nubankNerService: NubankNERService,
    private readonly xpNerService: XPNERService,
  ) {}

  hasBlackListedTerms(text: string): boolean {
    return this.CREDIT_CARD_BLACK_LIST.some((term) => text.includes(term));
  }

  filterCreditCardEmails(emails: GmailEmail[]): GmailEmail[] {
    const bankEmails = emails.filter((email) => {
      const snippetLower = email.snippet.toLowerCase();

      return this.CREDIT_CARD_KEY_TERMS.every(
        (term) =>
          snippetLower.includes(term) &&
          !this.hasBlackListedTerms(snippetLower),
      );
    });

    return bankEmails;
  }
  extractValues(text: string): number[] {
    // Regular expression to match prices in the format: "R$ 123.123,23" or "123.123,23"
    const priceRegex = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{2}))/g;

    // Array to store matched prices
    const values: number[] = [];

    // Execute the regex on the email body
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

    if (values.length === 0) this.logger.warn({ text });

    return values;
  }

  extractDates(text: string): Date[] {
    // Regular expression to match dates in the format "DD/MM" or "DD de MMMM"
    const dateRegex = /\b(\d{1,2})[\/\s]?de?\s?([a-z]+)?[\/\s]?(\d{2,4})?\b/gi;

    // Array to store matched dates
    const dates: Date[] = [];

    // Mapping of month names in Portuguese to their respective month numbers
    const months = {
      janeiro: 0,
      fevereiro: 1,
      março: 2,
      abril: 3,
      maio: 4,
      junho: 5,
      julho: 6,
      agosto: 7,
      setembro: 8,
      outubro: 9,
      novembro: 10,
      dezembro: 11,
    };

    // Execute the regex on the email body
    const matches = [...text.matchAll(dateRegex)];

    // Current year as fallback if the year is not mentioned in the text
    const currentYear = new Date().getFullYear();

    if (matches) {
      for (const match of matches) {
        const day = parseInt(match[1], 10);
        const monthName = match[2] ? match[2].toLowerCase() : null;
        const year = match[3] ? parseInt(match[3], 10) : currentYear;

        // Determine the month
        let month: number;
        if (monthName) {
          month = months[monthName];
        } else {
          // Handle format "DD/MM" where month is numeric
          month = parseInt(match[1].split('/')[1], 10) - 1;
        }

        if (!isNaN(day) && !isNaN(month)) {
          const date = new Date(year, month, day);
          dates.push(date);
        }
      }
    }

    if (dates.length === 0) this.logger.warn({ text });

    return dates;
  }

  extractSubItems(email: Email): SubItem[] {
    if (email.sender.includes(BankDomains.NUBANK)) {
      return this.nubankNerService.extractSubItemsFromCreditCardPDFText(
        email.pdfText,
      );
    }

    if (email.sender.includes(BankDomains.XP)) {
      return this.xpNerService.extractSubItemsFromCreditCardPDFText(
        email.pdfText,
        new Date(email.internalDate),
      );
    }

    return [];
  }

  getDescriptionFromCreditCardBill(email: Email) {
    const date = new Date(email.internalDate);
    const billAt = `${date.getMonth() + 1}/${date
      .getFullYear()
      .toString()
      .slice(-2)}`;

    if (email.sender.includes(BankDomains.NUBANK)) {
      return `Fatura Nubank ${billAt}`;
    }

    if (email.sender.includes(BankDomains.XP)) {
      return `Fatura XP ${billAt}`;
    }

    return `${email.sender}`;
  }
}

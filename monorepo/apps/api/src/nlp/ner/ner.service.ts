/**
 * Named entity recognition (NER) is a task that is concerned with identifying and
 * classifying named entities in textual data. Named entities can be a person,
 * organization, location, date, time, or even quantity.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Email } from 'src/gmail/interfaces/gmail.interface';

@Injectable()
export class NERService {
  private readonly CREDIT_CARD_KEY_TERMS = ['fatura'];
  private readonly logger = new Logger(NERService.name);

  filterCreditCardEmails(emails: Email[]): Email[] {
    const bankEmails = emails.filter((email) => {
      const snippetLower = email.snippet.toLowerCase();

      return this.CREDIT_CARD_KEY_TERMS.every((term) =>
        snippetLower.includes(term),
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
}

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
    'renegociação',
    'negativado',
    'transferência realizada', // More specific - only block completed transfers
    'pagamento concluído', // Block payment confirmations
    'pagamento realizado', // Block payment confirmations
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
    this.logger.debug(
      `Filtering ${emails.length} emails for credit card bills`,
    );

    const bankEmails = emails.filter((email) => {
      this.logger.debug(`Processing email: ${email.id}`, {
        snippet: email.snippet?.substring(0, 100),
        sender: email.senderEmail,
        hasPDF: email.hasPDF,
        pdfTextLength: email.pdfText?.length || 0,
        hasPdfBuffer: !!email.pdfBuffer,
      });

      const snippetLower = email.snippet.toLowerCase();

      // First check: must contain credit card key terms and no blacklisted terms
      const hasValidTerms = this.CREDIT_CARD_KEY_TERMS.some(
        (term) =>
          snippetLower.includes(term) &&
          !this.hasBlackListedTerms(snippetLower),
      );

      if (!hasValidTerms) {
        this.logger.debug(
          `Email ${email.id} failed first check - no valid terms`,
        );
        return false;
      }

      // Second check: must have actual PDF content to process
      // This prevents processing notification emails that just mention "fatura" but have no bill
      const hasPdfContent = email.hasPDF && (email.pdfText || email.pdfBuffer);

      if (!hasPdfContent) {
        this.logger.debug(
          `Email ${email.id} failed second check - no PDF content`,
        );
        return false;
      }

      this.logger.debug(
        `Email ${email.id} passed second check - has PDF content`,
      );

      // Third check: must be an actual credit card bill, not just a notification
      // Look for indicators that this is a real bill (amount, due date, etc.)
      const hasBillIndicators = this.hasBillIndicators(email);

      if (!hasBillIndicators) {
        this.logger.debug(
          `Email ${email.id} failed third check - no bill indicators`,
        );
        return false;
      }

      this.logger.debug(
        `Email ${email.id} passed all checks - accepting email`,
      );
      return true;
    });

    this.logger.debug(
      `Filtered ${emails.length} emails down to ${bankEmails.length} credit card emails with PDF content`,
    );

    return bankEmails;
  }

  /**
   * Check if an email has indicators that it's an actual credit card bill
   * This helps filter out notification emails that just mention "fatura"
   */
  private hasBillIndicators(email: GmailEmail): boolean {
    this.logger.debug('Checking bill indicators for email', {
      id: email.id,
      snippet: email.snippet?.substring(0, 100),
      hasPdfText: !!email.pdfText,
      pdfTextLength: email.pdfText?.length || 0,
      hasBody: !!email.body,
      bodyLength: email.body?.length || 0,
    });

    // Check if the PDF text contains bill indicators
    if (email.pdfText) {
      const pdfText = email.pdfText.toLowerCase();

      // Look for common bill indicators
      const billIndicators = [
        'valor de',
        'total a pagar',
        'data de vencimento',
        'fatura de',
        'r$',
        'reais',
        'valor da fatura',
        'total da fatura',
        'fatura', // Nubank: "Esta é a sua fatura de"
        'vencimento', // Nubank: "Data de vencimento"
        'valor', // Nubank: "no valor de"
      ];

      const foundIndicators = billIndicators.filter((indicator) =>
        pdfText.includes(indicator),
      );

      this.logger.debug('PDF text bill indicators check', {
        foundIndicators,
        pdfTextSample: pdfText.substring(0, 200),
      });

      if (foundIndicators.length > 0) {
        this.logger.debug('PDF text has bill indicators, accepting email');
        return true;
      }
    }

    // Check if the email body contains bill indicators
    if (email.body) {
      const bodyText = email.body.toLowerCase();

      const bodyBillIndicators = [
        'valor de',
        'total',
        'r$',
        'reais',
        'fatura de',
        'vencimento',
      ];

      const foundBodyIndicators = bodyBillIndicators.filter((indicator) =>
        bodyText.includes(indicator),
      );

      this.logger.debug('Email body bill indicators check', {
        foundBodyIndicators,
        bodyTextSample: bodyText.substring(0, 200),
      });

      if (foundBodyIndicators.length > 0) {
        this.logger.debug('Email body has bill indicators, accepting email');
        return true;
      }
    }

    // Check if the email snippet contains bill indicators (fallback for password-protected PDFs)
    if (email.snippet) {
      const snippetText = email.snippet.toLowerCase();

      const snippetBillIndicators = [
        'fatura',
        'valor',
        'r$',
        'reais',
        'total',
        'vencimento',
        'cartão',
        'crédito',
      ];

      const foundSnippetIndicators = snippetBillIndicators.filter((indicator) =>
        snippetText.includes(indicator),
      );

      this.logger.debug('Email snippet bill indicators check', {
        foundSnippetIndicators,
        snippetTextSample: snippetText.substring(0, 200),
      });

      if (foundSnippetIndicators.length > 0) {
        this.logger.debug('Email snippet has bill indicators, accepting email');
        return true;
      }
    }

    this.logger.debug('No bill indicators found, rejecting email');
    return false;
  }

  /**
   * Extract monetary values from text - delegates to appropriate service based on sender
   */
  extractValues(text: string, sender?: string): number[] {
    if (sender?.toLowerCase().includes('nubank')) {
      return this.nubankNerService.extractAllMonetaryValues(text);
    } else if (sender?.toLowerCase().includes('xp')) {
      return this.xpNerService.extractAllMonetaryValues(text);
    }

    // Generic fallback for unknown senders
    const priceRegex = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{2}))/g;
    const values: number[] = [];
    const matches = text.match(priceRegex);

    if (matches) {
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
   * Extract the main bill total - delegates to appropriate service based on sender
   */
  extractMainBillTotal(text: string, sender?: string): number | null {
    if (sender?.toLowerCase().includes('nubank')) {
      return this.nubankNerService.extractMainBillTotal(text);
    } else if (sender?.toLowerCase().includes('xp')) {
      return this.xpNerService.extractMainBillTotal(text);
    }

    // Generic fallback for unknown senders
    const values = this.extractValues(text, sender);
    return values.length > 0 ? values[0] : null;
  }

  /**
   * Extract dates from text - delegates to appropriate service based on sender
   */
  extractDates(text: string, sender?: string): Date[] {
    if (sender?.toLowerCase().includes('nubank')) {
      return this.nubankNerService.extractDates(text);
    } else if (sender?.toLowerCase().includes('xp')) {
      return this.xpNerService.extractDates(text);
    }

    // Generic fallback for unknown senders
    const dateRegex =
      /(\d{1,2})\s*(?:de\s+)?([a-z]+)\s*(\d{4})?|(\d{1,2})\/(\d{1,2})/gi;
    const dates: Date[] = [];
    const months = {
      janeiro: 0,
      jan: 0,
      fevereiro: 1,
      fev: 1,
      março: 2,
      mar: 2,
      abril: 3,
      abr: 3,
      maio: 4,
      mai: 4,
      junho: 5,
      jun: 5,
      julho: 6,
      jul: 6,
      agosto: 7,
      ago: 7,
      setembro: 8,
      set: 8,
      outubro: 9,
      out: 9,
      novembro: 10,
      nov: 10,
      dezembro: 11,
      dez: 11,
    };

    const matches = [...text.matchAll(dateRegex)];
    const currentYear = new Date().getFullYear();

    for (const match of matches) {
      let day: number, month: number, year: number;

      if (match[1] && match[2]) {
        day = parseInt(match[1], 10);
        const monthName = match[2].toLowerCase();
        month = months[monthName];
        year = match[3] ? parseInt(match[3], 10) : currentYear;
      } else if (match[4] && match[5]) {
        day = parseInt(match[4], 10);
        month = parseInt(match[5], 10) - 1;
        year = currentYear;
      } else {
        continue;
      }

      if (!isNaN(day) && !isNaN(month) && month >= 0 && month <= 11) {
        const date = new Date(Date.UTC(year, month, day));
        dates.push(date);
      }
    }

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

  getDescriptionFromCreditCardBill(email: Email): string {
    if (email.sender.includes(BankDomains.NUBANK)) {
      return this.nubankNerService.getDescriptionFromCreditCardBill(email);
    }

    if (email.sender.includes(BankDomains.XP)) {
      return this.xpNerService.getDescriptionFromCreditCardBill(email);
    }

    // Generic fallback for unknown senders
    const date = new Date(email.internalDate);
    const billAt = `${date.getMonth() + 1}/${date
      .getFullYear()
      .toString()
      .slice(-2)}`;

    return `${email.sender} ${billAt}`;
  }
}

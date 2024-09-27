import { Injectable, Logger } from '@nestjs/common';
import { gmail_v1, google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { Email } from './interfaces/gmail.interface';

import { BankDomains } from './interfaces/bank.interface';
import { PdfService } from 'src/nlp/ner/pdf.service';

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);
  readonly BANKS_DOMAINS = [
    BankDomains.NUBANK,
    BankDomains.INTER,
    BankDomains.XP,
    BankDomains.ITAU,
    BankDomains.BB,
    BankDomains.CAIXA,
    BankDomains.SANTANDER,
    BankDomains.BRADESCO,
    BankDomains.C6,
  ];

  constructor(private readonly pdfService: PdfService) {}

  private createOAuth2Client(
    accessToken: string,
    refreshToken: string,
  ): OAuth2Client {
    this.logger.debug({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${process.env.API_URL}/auth/google/redirect`,
    });
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.API_URL}/auth/google/redirect`,
    );

    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    return oauth2Client;
  }

  async getAttachmentContent(
    messageId: string,
    attachmentId: string,
    oauth2Client: any,
  ): Promise<Buffer> {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const res = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: messageId,
      id: attachmentId,
    });

    const data = res.data.data || '';
    return Buffer.from(data, 'base64');
  }

  async getEmails(
    accessToken: string,
    refreshToken: string,
    senderDomains: string[],
  ): Promise<Email[]> {
    const oauth2Client = this.createOAuth2Client(accessToken, refreshToken);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const now = new Date();
    const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 100));
    const query = `after:${Math.floor(
      thirtyDaysAgo.getTime() / 1000,
    )} (${senderDomains.map((domain) => `from:${domain}`).join(' OR ')})`;

    let emails: Email[] = [];
    let pageToken: string | undefined;

    try {
      do {
        const res = await gmail.users.messages.list({
          userId: 'me',
          q: query,
          pageToken: pageToken,
        });

        this.logger.debug({ emails: res.data.messages?.length });

        if (res.data.messages) {
          const fetchedEmails = await Promise.all(
            res.data.messages.map(async (message) => {
              const msg = await gmail.users.messages.get({
                userId: 'me',
                id: message.id,
              });

              const payload = msg.data.payload;
              let body = payload.body?.data || '';
              let senderEmail = '';
              let pdfText = '';
              let pdfBuffer = null;
              let hasPDF = false;

              if (payload.headers) {
                const fromHeader = payload.headers.find(
                  (header) => header.name === 'From',
                );
                if (fromHeader) {
                  senderEmail = fromHeader.value;
                  // Extract email from "Name <email@example.com>" format
                  const emailMatch = senderEmail.match(/<(.+)>/);
                  if (emailMatch) {
                    senderEmail = emailMatch[1];
                  }
                }
              }

              if (payload.parts && payload.parts.length) {
                for (const part of payload.parts) {
                  if (part.filename && part.filename.endsWith('.pdf')) {
                    // Fetch attachment
                    pdfBuffer = await this.getAttachmentContent(
                      message.id,
                      part.body.attachmentId,
                      oauth2Client,
                    );

                    hasPDF = true;
                    pdfText = await this.pdfService.extractTextFromPdf(
                      pdfBuffer,
                    );
                  } else if (part.body?.data) {
                    body += part.body.data;
                  }
                }
              }

              const decodedBody = Buffer.from(body, 'base64').toString('utf-8');

              return {
                id: msg.data.id,
                snippet: msg.data.snippet,
                internalDate: msg.data.internalDate,
                sizeEstimate: msg.data.sizeEstimate,
                body: decodedBody,
                senderEmail: senderEmail,
                pdfText: pdfText,
                pdfBuffer: pdfBuffer,
                hasPDF,
                raw: msg as gmail_v1.Schema$Message,
              };
            }),
          );

          emails = emails.concat(fetchedEmails);
        }

        pageToken = res.data.nextPageToken;
      } while (pageToken);

      if (emails.length === 0) {
        this.logger.debug('No emails found');
      }

      return emails;
    } catch (error) {
      this.logger.error('Error fetching emails:', error);
      this.logger.error(error?.response?.data);
      throw new Error('Failed to fetch emails');
    }
  }
}

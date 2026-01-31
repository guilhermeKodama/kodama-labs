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

    this.logger.debug('Gmail query details:', {
      query,
      senderDomains,
      dateRange: `${thirtyDaysAgo.toISOString()} to ${now.toISOString()}`,
    });

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
                  // Check both filename and MIME type for PDF detection
                  const isPDFByFilename = part.filename && part.filename.toLowerCase().endsWith('.pdf');
                  const isPDFByMimeType = part.mimeType === 'application/pdf';
                  const isPDF = isPDFByFilename || isPDFByMimeType;
                  
                  if (isPDF) {
                    // Fetch attachment
                    pdfBuffer = await this.getAttachmentContent(
                      message.id,
                      part.body.attachmentId,
                      oauth2Client,
                    );

                    // Validate that the buffer actually contains PDF content
                    if (pdfBuffer && pdfBuffer.length > 0) {
                      // Check if the buffer starts with PDF magic number (%PDF)
                      const isActualPDF = pdfBuffer.length >= 4 && 
                        pdfBuffer[0] === 0x25 && // %
                        pdfBuffer[1] === 0x50 && // P
                        pdfBuffer[2] === 0x44 && // D
                        pdfBuffer[3] === 0x46;   // F
                      
                      
                      if (isActualPDF) {
                        hasPDF = true;
                        pdfText = await this.pdfService.extractTextFromPdf(pdfBuffer);
                        
                        // Additional validation: ensure we got meaningful text, not HTML
                        if (pdfText && pdfText.includes('<!doctype html>')) {
                          pdfText = ''; // Reset since it's not valid PDF text
                          // Keep hasPDF = true since we have a valid PDF buffer
                        } else if (pdfText && pdfText.length > 0) {
                          // Text extraction succeeded
                        } else {
                          // Text extraction failed (e.g., password-protected), but keep hasPDF = true
                          // since we have a valid PDF buffer
                        }
                      } else {
                        hasPDF = false;
                        pdfBuffer = null;
                      }
                    } else {
                      pdfBuffer = null;
                    }
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

      return emails;
    } catch (error) {
      this.logger.error('Error fetching emails:', error);
      this.logger.error(error?.response?.data);
      throw new Error('Failed to fetch emails');
    }
  }
}

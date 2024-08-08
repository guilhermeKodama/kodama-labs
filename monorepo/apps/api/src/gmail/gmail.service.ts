import { Injectable, Logger } from '@nestjs/common';
import { gmail_v1, google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { Email } from './interfaces/gmail.interface';
import * as pdfParse from 'pdf-parse';

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);
  readonly BANKS_DOMAINS = ['nubank.com.br', 'inter.co', 'xpi.com.br'];

  private createOAuth2Client(
    accessToken: string,
    refreshToken: string,
  ): OAuth2Client {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
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

  async extractTextFromPdf(pdfBuffer: Buffer): Promise<string> {
    try {
      const data = await pdfParse(pdfBuffer);
      return data.text;
    } catch (e) {
      this.logger.error('Error extracting text from PDF:', e);
    }

    return '';
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
                    const pdfBuffer = await this.getAttachmentContent(
                      message.id,
                      part.body.attachmentId,
                      oauth2Client,
                    );

                    hasPDF = true;
                    pdfText = await this.extractTextFromPdf(pdfBuffer);
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
      console.error('Error fetching emails:', error);
      throw new Error('Failed to fetch emails');
    }
  }
}

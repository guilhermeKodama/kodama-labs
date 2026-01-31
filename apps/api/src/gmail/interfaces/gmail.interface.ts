import { gmail_v1 } from 'googleapis';

export type Email = {
  id: string;
  snippet: string;
  internalDate: string;
  sizeEstimate: number;
  body: string;
  senderEmail: string;
  pdfText: string;
  pdfBuffer: Buffer | null;
  hasPDF: boolean;
  raw: gmail_v1.Schema$Message;
};

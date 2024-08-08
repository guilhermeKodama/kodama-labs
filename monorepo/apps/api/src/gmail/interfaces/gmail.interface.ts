import { gmail_v1 } from 'googleapis';

export type Email = {
  id: string;
  snippet: string;
  internalDate: string;
  sizeEstimate: number;
  body: string;
  senderEmail: string;
  pdfText: string;
  hasPDF: boolean;
  raw: gmail_v1.Schema$Message;
};

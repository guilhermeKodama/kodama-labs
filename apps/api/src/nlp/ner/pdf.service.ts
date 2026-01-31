import { Injectable, Logger } from '@nestjs/common';
import pdfParse from 'pdf-parse';

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);
  async extractTextFromPdf(pdfBuffer: Buffer): Promise<string> {
    try {
      // Validate input
      if (!pdfBuffer || pdfBuffer.length === 0) {
        this.logger.warn('Empty or null PDF buffer provided');
        return '';
      }

      // Check if buffer starts with PDF magic number
      if (pdfBuffer.length < 4 || 
          pdfBuffer[0] !== 0x25 || // %
          pdfBuffer[1] !== 0x50 || // P
          pdfBuffer[2] !== 0x44 || // D
          pdfBuffer[3] !== 0x46) { // F
        this.logger.warn('Buffer does not contain valid PDF content (missing PDF magic number)');
        this.logger.warn(`First 20 bytes: ${pdfBuffer.slice(0, 20).toString('hex')}`);
        return '';
      }

      this.logger.debug(`Processing PDF buffer of size: ${pdfBuffer.length} bytes`);
      
      const data = await pdfParse(pdfBuffer);
      
      if (!data || !data.text) {
        this.logger.warn('PDF parsing returned no text content');
        return '';
      }

      this.logger.debug(`Successfully extracted ${data.text.length} characters from PDF`);
      
      // Validate that we didn't get HTML content
      if (data.text.includes('<!doctype html>') || data.text.includes('<html')) {
        this.logger.error('PDF parsing returned HTML content instead of PDF text');
        this.logger.error(`First 200 characters: ${data.text.substring(0, 200)}`);
        return '';
      }

      return data.text;
    } catch (e) {
      this.logger.error('Error extracting text from PDF:', e);
      
      // Provide more specific error information
      if (e.message && e.message.includes('password')) {
        this.logger.error('PDF appears to be password-protected');
      } else if (e.message && e.message.includes('corrupt')) {
        this.logger.error('PDF appears to be corrupted');
      } else if (e.message && e.message.includes('invalid')) {
        this.logger.error('PDF appears to be invalid or not a PDF file');
      }
      
      return '';
    }
  }
}

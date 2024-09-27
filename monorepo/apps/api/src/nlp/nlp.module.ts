import { Module } from '@nestjs/common';
import { NERService } from './ner/ner.service';
import { NubankNERService } from './ner/nubank-ner.service';
import { XPNERService } from './ner/xp-ner.service';
import { PdfService } from './ner/pdf.service';

@Module({
  providers: [NERService, NubankNERService, XPNERService, PdfService],
})
export class NlpModule {}

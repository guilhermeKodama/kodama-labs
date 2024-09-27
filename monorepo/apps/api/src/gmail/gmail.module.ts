import { Module } from '@nestjs/common';
import { GmailService } from './gmail.service';
import { GmailController } from './gmail.controller';
import { PdfService } from 'src/nlp/ner/pdf.service';
import { NlpModule } from 'src/nlp/nlp.module';

@Module({
  imports: [NlpModule],
  providers: [GmailService, PdfService],
  controllers: [GmailController],
})
export class GmailModule {}

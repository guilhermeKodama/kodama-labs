import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { GmailService } from './gmail.service';

@Controller('gmail')
export class GmailController {
  private readonly logger = new Logger(GmailController.name);
  constructor(private readonly gmailService: GmailService) {}

  @Get('emails')
  getEmails() {
    try {
      return [];
    } catch (error) {
      this.logger.error(error.message);
      throw new HttpException('Email not verified', HttpStatus.BAD_REQUEST);
    }
  }
}

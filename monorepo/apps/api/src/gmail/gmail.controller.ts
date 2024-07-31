import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Req,
  Res,
} from '@nestjs/common';
import { GmailService } from './gmail.service';
import { google } from 'googleapis';

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

import {
  Controller,
  Logger,
  Get,
  Req,
  UseGuards,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { GmailService } from 'src/gmail/gmail.service';
import { GoogleAuthGuard, JwtAuthGuard } from './guards';
import { Response } from 'express';
import { NERService } from 'src/nlp/ner/ner.service';
import { UsersService } from 'src/users/users.service';
import { JwtService } from '@nestjs/jwt';
import { TransactionStatus, User } from '@prisma/client';
import { ExpenseCategory } from 'src/users/types/transaction.enum';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly gmailService: GmailService,
    private readonly nerService: NERService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async processEmailTransactions(user: User) {
    const emails = await this.gmailService.getEmails(
      user.accessToken,
      user.refreshToken,
      this.gmailService.BANKS_DOMAINS,
    );

    const creditCardEmails = this.nerService.filterCreditCardEmails(emails);

    for (const email of creditCardEmails) {
      const emailRecord = await this.usersService.saveEmail({
        body: email.body,
        pdfText: email.pdfText,
        pdfNeedsPassword: email.hasPDF && !email.pdfText,
        snippet: email.snippet,
        internalDate: new Date(parseInt(email.internalDate)).toISOString(),
        messageId: email.id,
        sender: email.senderEmail,
        user: { connect: { id: user.id } },
        raw: JSON.stringify(email.raw),
      });

      /**
       * Extract total valu
       */
      const values = this.nerService.extractValues(
        `${email.snippet}  ${email.body} ${email.pdfText}`,
      );

      /**
       * Extract due date
       */

      const dueDates = this.nerService.extractDates(email.body);

      let dueAt = null;

      if (dueDates.length > 0) {
        dueAt = dueDates[0];
      } else {
        dueAt = new Date(
          emailRecord.internalDate.getTime() + 5 * 24 * 60 * 60 * 1000,
        );
      }

      this.logger.debug({ email: emailRecord.sender, dueDates, dueAt });

      /**
       * Extract sub items
       */

      const subItems = this.nerService.extractSubItems(email);

      console.log({ subItems });

      /**
       * Parent transaction
       */

      const parentTransaction =
        await this.usersService.saveTransactionFromEmail({
          status: TransactionStatus.PENDING,
          amount: values[0],
          dueAt: dueAt,
          createdAt: emailRecord.internalDate,
          description: this.nerService.getDescriptionFromCreditCardBill(email),
          category: ExpenseCategory.CREDIT_CARD,
          email: { connect: { id: emailRecord.id } },
          user: { connect: { id: user.id } },
        });

      if (subItems.length > 0 && parentTransaction.subItems.length === 0) {
        for (const subItem of subItems) {
          await this.usersService.createTransaction({
            parent: { connect: { id: parentTransaction.id } },
            status: TransactionStatus.PENDING,
            amount: subItem.value,
            dueAt: dueAt,
            createdAt: subItem.date,
            description: subItem.description,
            category: ExpenseCategory.CREDIT_CARD,
            email: { connect: { id: emailRecord.id } },
            user: { connect: { id: user.id } },
          });
        }
      }

      this.logger.debug({
        date: email.internalDate,
        sender: email.senderEmail,
        summary: email.snippet,
        pdfText: email.pdfText,
        values,
      });
    }
  }

  @Get('google/login')
  @UseGuards(GoogleAuthGuard)
  googleLogin(@Req() req) {
    return req.user;
  }

  @Get('google/redirect')
  @UseGuards(GoogleAuthGuard)
  async googleAuthRedirect(
    @Req()
    req: {
      user?: {
        googleId: string;
        displayName: string;
        email: string;
        photo: string;
        accessToken: string;
        refreshToken?: string;
      };
    },
    @Res() res: Response,
  ) {
    this.logger.debug({ user: req.user });

    let user = await this.usersService.user({ email: req.user.email });

    if (!user) {
      user = await this.usersService.createUser({
        email: req.user.email,
        googleId: req.user.googleId,
        name: req.user.displayName,
        photo: req.user.photo,
        accessToken: req.user.accessToken,
        refreshToken: req.user.refreshToken,
      });
    }

    this.processEmailTransactions(user)
      .then(() => {
        this.logger.debug('Transactions processed');
      })
      .catch((error) => {
        this.logger.error(error);
      });

    const token = this.jwtService.sign({ id: user.id });
    const redirectUrl = `${process.env.APP_URL}/auth/jwt/sign-in?token=${token}`;

    return res.redirect(redirectUrl);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Req() request: Request & { user: { id } }) {
    const userId = request.user?.id;

    const user = await this.usersService.user(
      { id: userId },
      { id: true, email: true, photo: true },
    );

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return { user };
  }
}

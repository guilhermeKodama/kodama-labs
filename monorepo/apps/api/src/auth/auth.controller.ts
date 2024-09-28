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
import { UsersService } from 'src/users/services/users.service';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { StorageService } from 'src/storage/services/storage.service';
import { TransactionsService } from 'src/users/services/transactios.service';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly gmailService: GmailService,
    private readonly nerService: NERService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly storageService: StorageService,
    private readonly transactionsService: TransactionsService,
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

      this.logger.debug({ file: `${emailRecord.id}.pdf` });

      if (email.pdfBuffer) {
        await this.storageService.uploadFile(
          `${emailRecord.id}.pdf`,
          email.pdfBuffer,
        );
      }

      /**
       * Extract total value
       */

      const total = this.transactionsService.extractTotalFromEmail(emailRecord);

      /**
       * Extract due date
       */

      const dueAt = this.transactionsService.extractDueAtFromEmail(emailRecord);

      this.logger.debug({ email: emailRecord.sender, dueAt });

      await this.transactionsService.saveTransactionsFromEmail(
        emailRecord,
        user,
        total,
        dueAt,
      );
    }

    await this.usersService.updateUser({
      where: { id: user.id },
      data: { hasPendingProcess: false },
    });
  }

  @Get('google/login')
  googleLogin(@Res() res) {
    res.redirect(
      `https://accounts.google.com/o/oauth2/v2/auth?client_id=${
        process.env.GOOGLE_CLIENT_ID
      }&redirect_uri=${`${process.env.API_URL}/auth/google/redirect`}&response_type=code&scope=email profile https://www.googleapis.com/auth/gmail.readonly&access_type=offline`, // &prompt=consent - to force the consent screen
    );
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
    } else {
      user = await this.usersService.updateUser({
        where: { id: user.id },
        data: {
          accessToken: req.user.accessToken,
          refreshToken: req.user.refreshToken || user.refreshToken,
        },
      });
    }

    await this.usersService.updateUser({
      where: { id: user.id },
      data: { hasPendingProcess: true },
    });

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

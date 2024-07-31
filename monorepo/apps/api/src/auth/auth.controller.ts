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

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly gmailService: GmailService,
    private readonly nerService: NERService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

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

    // const emails = await this.gmailService.getEmails(
    //   req.user.accessToken,
    //   req.user.refreshToken,
    // );

    // const bankEmails = this.nerService.filterBankEmails(emails);
    // const creditCardEmails = this.nerService.filterCreditCardEmails(bankEmails);

    // for (const email of creditCardEmails) {
    //   const values = this.nerService.extractValues(
    //     `${email.snippet}  ${email.body} ${email.pdfText}`,
    //   );

    //   this.logger.debug({
    //     date: email.internalDate,
    //     sender: email.senderEmail,
    //     summary: email.snippet,
    //     pdfText: email.pdfText,
    //     values,
    //   });
    // }

    const token = this.jwtService.sign({ id: user.id });
    const redirectUrl = `http://localhost:8081/auth/jwt/sign-in?token=${token}`;

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

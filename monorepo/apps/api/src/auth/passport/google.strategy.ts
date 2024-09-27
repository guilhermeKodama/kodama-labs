import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-google-oauth20';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);
  constructor() {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.API_URL}/auth/google/redirect`,
      scope: [
        'email',
        'profile',
        'https://www.googleapis.com/auth/gmail.readonly',
      ],
      accessType: 'offline',
      prompt: 'consent',
      session: false,
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
  ): Promise<any> {
    this.logger.debug({ accessToken, refreshToken, profile });
    const { id, displayName, emails, photos } = profile;
    const user = {
      googleId: id,
      displayName,
      email: emails[0].value,
      photo: photos[0].value,
      accessToken,
      refreshToken,
    };
    return user;
  }
}

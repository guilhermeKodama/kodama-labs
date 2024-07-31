import { PassportSerializer } from '@nestjs/passport';

export class SessionSerializer extends PassportSerializer {
  constructor() {
    super();
  }
  serializeUser(user, done) {
    console.log('serializeUser', user);
    done(null, user);
  }

  deserializeUser(payload, done) {
    console.log('deserializeUser', payload);
    /**
     * fetch user
     */

    done(null, payload);
  }
}

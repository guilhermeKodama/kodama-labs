import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class AuthService {
  private readonly jwtSecret = 'your-secret-key';

  async generateToken(payload: object): Promise<string> {
    return new Promise((resolve, reject) => {
      jwt.sign(payload, this.jwtSecret, (err, token) => {
        if (err) {
          reject(err);
        } else {
          resolve(token);
        }
      });
    });
  }
}

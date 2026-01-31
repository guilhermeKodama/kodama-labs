import { Injectable } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

@Injectable()
export class MigrationService {
  async runMigrations(): Promise<string> {
    try {
      const { stdout, stderr } = await execPromise('npx prisma migrate dev');
      if (stderr) {
        throw new Error(stderr);
      }
      return stdout;
    } catch (error) {
      throw new Error(`Migration failed: ${error.message}`);
    }
  }
}

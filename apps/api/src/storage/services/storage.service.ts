import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class StorageService {
  private supabase;

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseApiKey = this.configService.get<string>('SUPABASE_API_KEY');
    this.supabase = createClient(supabaseUrl, supabaseApiKey);
  }

  async uploadFile(fileName: string, fileBuffer: Buffer): Promise<void> {
    const bucketName = this.configService.get<string>('SUPABASE_BUCKET');
    const { error } = await this.supabase.storage
      .from(bucketName)
      .upload(fileName, fileBuffer, {
        cacheControl: '3600',
        upsert: true,
      });

    if (error) {
      throw new InternalServerErrorException(
        `Failed to upload file: ${error.message}`,
      );
    }
  }

  async getFile(fileName: string): Promise<Buffer> {
    const bucketName = this.configService.get<string>('SUPABASE_BUCKET');
    const { data, error } = await this.supabase.storage
      .from(bucketName)
      .download(fileName);

    if (error) {
      throw new BadRequestException(
        `Failed to retrieve file: ${error.message}`,
      );
    }

    const buffer = await data.arrayBuffer();
    return Buffer.from(buffer);
  }
}

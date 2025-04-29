import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ExpressAdapter } from '@nestjs/platform-express';
import * as express from 'express';

const server = express();

async function bootstrap() {
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(server)
  );

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  app.enableCors({
    origin: ['https://app.wallex.com.br', 'http://localhost:8081'],
    methods: 'GET,POST,PUT,DELETE',
    allowedHeaders: 'Content-Type,Authorization',
    credentials: true,
  });

  await app.init();

  // For local development
  if (process.env.NODE_ENV !== 'production') {
    const port = process.env.PORT || 4000;
    await app.listen(port);
    console.log(`Application is running on: ${port}`);
  }

  return server;
}

// For Vercel
export default async function handler(req: any, res: any) {
  const app = await bootstrap();
  return app(req, res);
}

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { Request, Response } from 'express';
import { INestApplication } from '@nestjs/common';

let cachedServer: express.Express | null = null;
let cachedApp: INestApplication | null = null;

async function bootstrapServer() {
  if (!cachedServer || !cachedApp) {
    const expressApp = express();
    const app = await NestFactory.create(
      AppModule,
      new ExpressAdapter(expressApp),
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
    
    cachedServer = expressApp;
    cachedApp = app;
  }
  return { server: cachedServer, app: cachedApp };
}

// For Vercel
export default async function handler(req: Request, res: Response) {
  try {
    const { server, app } = await bootstrapServer();
    
    // Handle shutdown gracefully
    res.on('close', () => {
      // Cleanup if needed
    });

    res.on('error', (error) => {
      console.error('Response error:', error);
    });

    return server(req, res);
  } catch (error) {
    console.error('Error in handler:', error);
    // Ensure we're not sending multiple responses
    if (!res.headersSent) {
      res.status(500).json({
        statusCode: 500,
        message: 'Internal server error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

// For local development
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`Application is running on: ${port}`);
}

// Only run bootstrap() if we're not in Vercel
if (process.env.NODE_ENV !== 'production') {
  bootstrap();
}

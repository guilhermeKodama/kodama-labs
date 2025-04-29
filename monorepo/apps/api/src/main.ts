import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { INestApplication } from '@nestjs/common';

let app: INestApplication;

async function getApp() {
  if (!app) {
    const server = express();
    app = await NestFactory.create(
      AppModule,
      new ExpressAdapter(server)
    );

    app.enableCors({
      origin: ['https://app.wallex.com.br', 'http://localhost:8081'],
      methods: 'GET,POST,PUT,DELETE',
      allowedHeaders: 'Content-Type,Authorization',
      credentials: true,
    });

    app.use((req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      next();
    });

    await app.init();
  }
  return app;
}

export default async function handler(req: any, res: any) {
  try {
    const app = await getApp();
    const httpAdapter = app.getHttpAdapter();
    await httpAdapter.getInstance()(req, res);
  } catch (error) {
    console.error('Serverless function error:', error);
    return res.status(500).json({
      statusCode: 500,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// For local development
if (process.env.NODE_ENV !== 'production') {
  async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    
    app.enableCors({
      origin: ['https://app.wallex.com.br', 'http://localhost:8081'],
      methods: 'GET,POST,PUT,DELETE',
      allowedHeaders: 'Content-Type,Authorization',
      credentials: true,
    });

    app.use((req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      next();
    });

    const port = process.env.PORT || 4000;
    await app.listen(port);
    console.log(`Application is running on: ${port}`);
  }
  
  bootstrap();
}

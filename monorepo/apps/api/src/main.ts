import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ExpressAdapter } from '@nestjs/platform-express';
import * as express from 'express';
import { Server } from 'http';

let cachedServer: Server;

const bootstrapServer = async () => {
  const expressApp = express();

  // Security headers and CORS
  expressApp.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));

  app.enableCors({
    origin: ['https://app.wallex.com.br', 'http://localhost:8081'],
    methods: 'GET,POST,PUT,DELETE',
    allowedHeaders: 'Content-Type,Authorization',
    credentials: true,
  });

  await app.init();
  return expressApp;
};

// Handler for Vercel serverless
export default async function handler(req, res) {
  if (!cachedServer) {
    const expressApp = await bootstrapServer();
    cachedServer = expressApp.listen();
  }
  return cachedServer.emit('request', req, res);
}

// Local development: run server if not in Vercel
if (require.main === module) {
  (async () => {
    const expressApp = await bootstrapServer();
    const port = process.env.PORT || 4000;
    expressApp.listen(port, () => {
      console.log(`NestJS app listening on port ${port}`);
    });
  })();
}

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as session from 'express-session';
import * as passport from 'passport';
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Set global security headers including X-Content-Type-Options
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  // Define CORS options
  const corsOptions: CorsOptions = {
    origin: ['https://app.wallex.com.br', 'http://localhost:8081'], // Replace with your trusted domains
    methods: 'GET,POST,PUT,DELETE', // Specify allowed HTTP methods
    allowedHeaders: 'Content-Type,Authorization',
    credentials: true, // Allow cookies/auth headers
  };

  // Enable CORS with the specified options
  app.enableCors(corsOptions);

  app.use(
    session({
      secret: process.env.JWT_SECRET,
      saveUninitialized: false,
      resave: false,
      cookie: { maxAge: 3600000 }, // 1 hour
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());

  await app.listen(4000);
}
bootstrap();

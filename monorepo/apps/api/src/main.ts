import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use((req, res, next) => {
    // Set global security headers including X-Content-Type-Options
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Add Anti-clickjacking Headers
    res.setHeader('X-Frame-Options', 'DENY');
    // Add Cache-Control headers to prevent caching of sensitive content
    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, private',
    );
    res.setHeader('Pragma', 'no-cache'); // For HTTP/1.0 caches
    res.setHeader('Expires', '0'); // For HTTP/1.0 caches
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

  await app.listen(4000);
}
bootstrap();

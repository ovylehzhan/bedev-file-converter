import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS: whitelist origins from env (comma-separated). Default to the
  // local UI origin. "*" is allowed only if explicitly set — we don't
  // reflect arbitrary origins by default (basic trust-boundary hygiene).
  const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());
  app.enableCors({
    origin: corsOrigins.includes('*') ? true : corsOrigins,
  });

  // Systematic input validation for all DTOs (strips unknown fields,
  // enforces types) — instead of ad-hoc checks scattered in services.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  // Single error envelope for every response: { error: { code, message,
  // details?, requestId } } — mirrors the Credits Service contract.
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`API Gateway running on port ${port}`);
}

bootstrap();

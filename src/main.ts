import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT || 3000;

  await app.listen(port);
  Logger.log(`AI Planner running on http://localhost:${port}`, 'Bootstrap');
  Logger.log('Telegram bot started — send /plan to generate your day', 'Bootstrap');
}

bootstrap();

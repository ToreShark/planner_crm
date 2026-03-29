// ============================================================
// Telegram Module
// ============================================================

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TelegramBotService } from './telegram-bot.service';
import { PlannerCronService } from './planner-cron.service';
import { PlannerModule } from '../planner';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    PlannerModule,
  ],
  providers: [TelegramBotService, PlannerCronService],
  exports: [TelegramBotService],
})
export class TelegramModule {}

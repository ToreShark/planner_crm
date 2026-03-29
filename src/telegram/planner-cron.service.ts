// ============================================================
// Planner Cron Service
// Автоматическая отправка утреннего плана и вечернего обзора
//
// Расписание (Алматы, UTC+5):
// - 07:00 — утренний план
// - 21:00 — вечерний обзор
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TelegramBotService } from './telegram-bot.service';

@Injectable()
export class PlannerCronService {
  private readonly logger = new Logger(PlannerCronService.name);

  constructor(private readonly telegramBot: TelegramBotService) {}

  /**
   * Утренний план — 07:00 Алматы (02:00 UTC)
   * Генерирует план дня через Claude API и отправляет в Telegram
   */
  @Cron('0 2 * * 1-6', {
    name: 'morning-plan',
    timeZone: 'UTC',
  })
  // Пн-Сб. Воскресенье — отдых, план не генерируется.
  async sendMorningPlan() {
    this.logger.log('Triggering morning plan...');
    try {
      await this.telegramBot.sendMorningPlan();
    } catch (error) {
      this.logger.error('Morning plan cron failed', error);
    }
  }

  /**
   * Вечерний обзор — 21:00 Алматы (16:00 UTC)
   */
  @Cron('0 16 * * 1-6', {
    name: 'evening-review',
    timeZone: 'UTC',
  })
  async sendEveningReview() {
    this.logger.log('Triggering evening review...');
    try {
      await this.telegramBot.sendEveningReview();
    } catch (error) {
      this.logger.error('Evening review cron failed', error);
    }
  }
}

// ============================================================
// Planner Cron Service
// Автоматическая отправка планов и обзоров
//
// Расписание (Алматы, UTC+5):
// - Пн-Сб 07:00 — утренний план
// - Пн-Сб 21:00 — вечерний обзор
// - Вс    10:00 — итоги недели + задача на воскресенье
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TelegramBotService } from './telegram-bot.service';
import { PlanStoreService } from '../planner/plan-store.service';

@Injectable()
export class PlannerCronService {
  private readonly logger = new Logger(PlannerCronService.name);

  constructor(
    private readonly telegramBot: TelegramBotService,
    private readonly planStore: PlanStoreService,
  ) {}

  /**
   * Ночной перенос задач — 00:05 Алматы (19:05 UTC предыдущего дня)
   * Незакрытые задачи за вчера → план на сегодня
   */
  @Cron('5 19 * * *', {
    name: 'midnight-carryover',
    timeZone: 'UTC',
  })
  async midnightCarryOver() {
    this.logger.log('Midnight carry-over: checking unclosed tasks...');
    try {
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      const count = await this.planStore.carryOverTasks(yesterdayStr, today);
      if (count > 0) {
        this.logger.log(`Carried over ${count} tasks from ${yesterdayStr} to ${today}`);
        await this.telegramBot.sendCarryOverNotification(count, yesterdayStr);
      } else {
        this.logger.log('No tasks to carry over');
      }
    } catch (error) {
      this.logger.error('Midnight carry-over failed', error);
    }
  }

  /**
   * Утренний план — 07:00 Алматы (02:00 UTC), Пн-Сб
   */
  @Cron('0 2 * * 1-6', {
    name: 'morning-plan',
    timeZone: 'UTC',
  })
  async sendMorningPlan() {
    this.logger.log('Triggering morning plan...');
    try {
      await this.telegramBot.sendMorningPlan();
    } catch (error) {
      this.logger.error('Morning plan cron failed', error);
    }
  }

  /**
   * Вечерний обзор — 21:00 Алматы (16:00 UTC), Пн-Сб
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

  /**
   * Воскресенье 10:00 Алматы (05:00 UTC) — итоги недели
   */
  @Cron('0 5 * * 0', {
    name: 'sunday-review',
    timeZone: 'UTC',
  })
  async sendSundayReview() {
    this.logger.log('Triggering Sunday week review...');
    try {
      await this.telegramBot.sendSundayMessage();
    } catch (error) {
      this.logger.error('Sunday review cron failed', error);
    }
  }
}

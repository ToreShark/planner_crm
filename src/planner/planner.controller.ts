// ============================================================
// Planner Controller
// REST API для генерации и управления планами
// ============================================================

import { Controller, Post, Body, Get, Param, Patch, Query, Logger } from '@nestjs/common';
import { ClaudePlannerService } from './claude-planner.service';
import { PlanStoreService } from './plan-store.service';
import { todayAlmaty, formatDateAlmaty } from './types';
import { DailyPlanOutput, PlanType } from './types';

// --- DTOs ---

class GenerateDayPlanDto {
  quickNotes?: string[];
  energyLevel?: number;
  place?: string;
}

class GenerateWeekPlanDto {
  mainFocus?: string;
  quickNotes?: string[];
}

class GenerateMonthPlanDto {
  monthName: string;
  mainGoal?: string;
}

class ReplanDto {
  reason: string;
  currentPlan: DailyPlanOutput;
}

class ReviewDayDto {
  plan: DailyPlanOutput;
}

// --- Controller ---

@Controller('planner')
export class PlannerController {
  private readonly logger = new Logger(PlannerController.name);

  constructor(
    private readonly plannerService: ClaudePlannerService,
    private readonly planStore: PlanStoreService,
  ) {}

  // =============================================================
  // GET — Просмотр планов
  // =============================================================

  /**
   * GET /planner/day/:date
   * Просмотр плана на конкретную дату
   *
   * Примеры:
   * curl http://localhost:3000/planner/day/2026-03-31
   * curl http://localhost:3000/planner/day/today
   * curl http://localhost:3000/planner/day/tomorrow
   */
  @Get('day/:date')
  async getDayPlan(@Param('date') date: string) {
    const resolvedDate = this.resolveDate(date);
    const plan = await this.planStore.getDayPlan(resolvedDate);
    if (!plan) {
      return { success: false, message: `Нет плана на ${resolvedDate}` };
    }
    return { success: true, date: resolvedDate, plan };
  }

  /**
   * GET /planner/week
   * Просмотр плана текущей недели (или по дате)
   *
   * curl http://localhost:3000/planner/week
   * curl http://localhost:3000/planner/week?date=2026-03-31
   */
  @Get('week')
  async getWeekPlan(@Query('date') date?: string) {
    const resolvedDate = date ? this.resolveDate(date) : undefined;
    const plan = await this.planStore.getWeekPlan(resolvedDate);
    if (!plan) {
      return { success: false, message: 'Нет плана недели' };
    }

    // Подтягиваем планы дней за эту неделю
    const dayPlans = plan.dateEnd
      ? await this.planStore.getDayPlans(plan.date, plan.dateEnd)
      : [];

    return { success: true, plan, dayPlans };
  }

  /**
   * GET /planner/month
   * Просмотр плана месяца
   *
   * curl http://localhost:3000/planner/month
   * curl http://localhost:3000/planner/month?date=2026-04-01
   */
  @Get('month')
  async getMonthPlan(@Query('date') date?: string) {
    const plan = await this.planStore.getMonthPlan(date);
    if (!plan) {
      return { success: false, message: 'Нет плана месяца' };
    }
    return { success: true, plan };
  }

  /**
   * GET /planner/stats
   * Статистика выполнения за последние N дней
   *
   * curl http://localhost:3000/planner/stats
   * curl http://localhost:3000/planner/stats?days=14
   */
  @Get('stats')
  async getStats(@Query('days') days?: string) {
    const n = days ? parseInt(days, 10) : 7;
    const stats = await this.planStore.getCompletionStats(n);
    return { success: true, days: n, ...stats };
  }

  // =============================================================
  // POST — Генерация планов
  // =============================================================

  /**
   * POST /planner/day
   * Генерирует план на день
   *
   * Body: { quickNotes?: string[], energyLevel?: number, place?: string }
   *
   * Пример:
   * curl -X POST http://localhost:3000/planner/day \
   *   -H "Content-Type: application/json" \
   *   -d '{"quickNotes": ["Подать кассацию по Джанабаеву", "Бассейн вечером"], "energyLevel": 7, "place": "офис"}'
   */
  @Post('day')
  async generateDayPlan(@Body() dto: GenerateDayPlanDto) {
    this.logger.log('Generating daily plan...');
    const plan = await this.plannerService.generateDailyPlan({
      quickNotes: dto.quickNotes,
      energyLevel: dto.energyLevel,
      place: dto.place,
    });
    await this.planStore.saveDayPlan(plan);
    return { success: true, plan };
  }

  /**
   * POST /planner/week
   * Генерирует план на неделю
   */
  @Post('week')
  async generateWeekPlan(@Body() dto: GenerateWeekPlanDto) {
    this.logger.log('Generating weekly plan...');
    const plan = await this.plannerService.generateWeeklyPlan({
      mainFocus: dto.mainFocus,
      quickNotes: dto.quickNotes,
    });
    return { success: true, plan };
  }

  /**
   * POST /planner/month
   * Генерирует план на месяц
   */
  @Post('month')
  async generateMonthPlan(@Body() dto: GenerateMonthPlanDto) {
    this.logger.log('Generating monthly plan...');
    const plan = await this.plannerService.generateMonthlyPlan({
      monthName: dto.monthName,
      mainGoal: dto.mainGoal,
    });
    return { success: true, plan };
  }

  /**
   * POST /planner/replan
   * Перепланирование дня (если что-то пошло не так)
   */
  @Post('replan')
  async replan(@Body() dto: ReplanDto) {
    this.logger.log(`Replanning: ${dto.reason}`);
    const plan = await this.plannerService.replan(dto.currentPlan, dto.reason);
    return { success: true, plan };
  }

  /**
   * POST /planner/review
   * Подведение итогов дня
   */
  @Post('review')
  async reviewDay(@Body() dto: ReviewDayDto) {
    this.logger.log('Generating day review...');
    const review = await this.plannerService.generateDayReview(dto.plan);
    return { success: true, review };
  }

  // =============================================================
  // PATCH — Обновление задач
  // =============================================================

  /**
   * PATCH /planner/task/:id/status
   * Обновить статус задачи (done, cancelled, deferred, pending)
   *
   * curl -X PATCH http://localhost:3000/planner/task/uuid/status \
   *   -H "Content-Type: application/json" -d '{"status": "cancelled"}'
   */
  @Patch('task/:id/status')
  async updateTaskStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    const task = await this.planStore.updateTaskStatus(id, body.status);
    if (!task) {
      return { success: false, message: `Задача ${id} не найдена` };
    }
    return { success: true, task };
  }

  // =============================================================
  // Helpers
  // =============================================================

  private resolveDate(input: string): string {
    if (input === 'today') {
      return todayAlmaty();
    }
    if (input === 'tomorrow') {
      const tmr = new Date();
      tmr.setDate(tmr.getDate() + 1);
      return formatDateAlmaty(tmr);
    }
    if (input === 'yesterday') {
      const yest = new Date();
      yest.setDate(yest.getDate() - 1);
      return formatDateAlmaty(yest);
    }
    return input; // YYYY-MM-DD
  }
}

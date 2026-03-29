// ============================================================
// Planner Controller
// REST API для генерации и управления планами
// ============================================================

import { Controller, Post, Body, Get, Param, Patch, Logger } from '@nestjs/common';
import { ClaudePlannerService } from './claude-planner.service';
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

  constructor(private readonly plannerService: ClaudePlannerService) {}

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
}

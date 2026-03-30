// ============================================================
// Plan Store Service
// Чтение и запись планов из/в PostgreSQL
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { PlanEntity, TaskEntity, PaymentEntity, TimeBlockEntity } from './entities';
import { PlanType, DailyPlanOutput } from './types';

@Injectable()
export class PlanStoreService {
  private readonly logger = new Logger(PlanStoreService.name);

  constructor(
    @InjectRepository(PlanEntity)
    private readonly planRepo: Repository<PlanEntity>,
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,
    @InjectRepository(PaymentEntity)
    private readonly paymentRepo: Repository<PaymentEntity>,
    @InjectRepository(TimeBlockEntity)
    private readonly timeBlockRepo: Repository<TimeBlockEntity>,
  ) {}

  /**
   * Получить план дня по дате
   */
  async getDayPlan(date: string): Promise<PlanEntity | null> {
    return this.planRepo.findOne({
      where: { type: PlanType.DAY, date },
      relations: ['tasks', 'timeBlocks', 'payments'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Получить план недели, в которую попадает дата
   */
  async getWeekPlan(date?: string): Promise<PlanEntity | null> {
    const targetDate = date || new Date().toISOString().split('T')[0];

    // Ищем недельный план, где date <= targetDate <= dateEnd
    const plans = await this.planRepo.find({
      where: { type: PlanType.WEEK },
      relations: ['tasks'],
      order: { date: 'DESC' },
      take: 5,
    });

    for (const plan of plans) {
      const start = plan.date;
      const end = plan.dateEnd || start;
      // Расширяем на +1 день чтобы воскресенье попадало в неделю Пн-Сб
      const endPlus1 = new Date(end);
      endPlus1.setDate(endPlus1.getDate() + 1);
      const endExtended = endPlus1.toISOString().split('T')[0];
      if (targetDate >= start && targetDate <= endExtended) {
        return plan;
      }
    }

    // Если не нашли по диапазону — возвращаем последний
    return plans[0] || null;
  }

  /**
   * Получить план месяца
   */
  async getMonthPlan(date?: string): Promise<PlanEntity | null> {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const monthStart = targetDate.slice(0, 7) + '-01';

    return this.planRepo.findOne({
      where: { type: PlanType.MONTH, date: monthStart },
      relations: ['tasks'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Получить все планы дней за период
   */
  async getDayPlans(startDate: string, endDate: string): Promise<PlanEntity[]> {
    return this.planRepo.find({
      where: {
        type: PlanType.DAY,
        date: Between(startDate, endDate),
      },
      relations: ['tasks', 'payments'],
      order: { date: 'ASC' },
    });
  }

  /**
   * Получить последние N планов
   */
  async getRecentPlans(limit: number = 7): Promise<PlanEntity[]> {
    return this.planRepo.find({
      where: { type: PlanType.DAY },
      relations: ['tasks', 'payments'],
      order: { date: 'DESC' },
      take: limit,
    });
  }

  /**
   * Статистика выполнения за последние N дней
   */
  async getCompletionStats(days: number = 7): Promise<{
    totalTasks: number;
    completedTasks: number;
    completionRate: number;
    totalPayments: number;
  }> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const plans = await this.planRepo.find({
      where: {
        type: PlanType.DAY,
        date: MoreThanOrEqual(cutoffStr),
      },
      relations: ['tasks', 'payments'],
    });

    const allTasks = plans.flatMap((p) => p.tasks || []);
    const completedTasks = allTasks.filter((t) => t.status === 'done');
    const allPayments = plans.flatMap((p) => p.payments || []);
    const totalPayments = allPayments
      .filter((p) => p.received)
      .reduce((sum, p) => sum + p.amount, 0);

    return {
      totalTasks: allTasks.length,
      completedTasks: completedTasks.length,
      completionRate: allTasks.length > 0 ? completedTasks.length / allTasks.length : 0,
      totalPayments,
    };
  }

  /**
   * Получить или создать план дня (для будущих задач)
   */
  async getOrCreateDayPlan(date: string): Promise<PlanEntity> {
    let plan = await this.getDayPlan(date);
    if (plan) return plan;

    // Создаём placeholder план
    const newPlan = this.planRepo.create({
      type: PlanType.DAY,
      date,
      focusTitle: 'Запланированные задачи',
    });
    return this.planRepo.save(newPlan);
  }

  /**
   * Добавить задачу к плану
   */
  async addTaskToPlan(planId: string, task: {
    title: string;
    description?: string;
    category: string;
    priority: string;
    estimatedMinutes?: number;
  }): Promise<TaskEntity | null> {
    // Дедупликация: проверяем есть ли похожая задача
    const existing = await this.taskRepo.findOne({
      where: { planId, title: task.title },
    });
    if (existing) return null; // Дубль

    const count = await this.taskRepo.count({ where: { planId } });

    const newTask = this.taskRepo.create({
      planId,
      title: task.title,
      description: task.description,
      category: task.category as any,
      priority: task.priority as any,
      status: 'pending' as any,
      estimatedMinutes: task.estimatedMinutes,
      sortOrder: count + 1,
    });
    const saved = await this.taskRepo.save(newTask);

    // Синхронизируем план недели
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (plan?.date) {
      this.syncWeekCheckpoints(plan.date).catch((err) =>
        this.logger.error('Week sync failed', err),
      );
    }

    return saved;
  }

  /**
   * Получить запланированные задачи на дату (только активные — без done/cancelled)
   */
  async getScheduledTasks(date: string): Promise<TaskEntity[]> {
    const plan = await this.getDayPlan(date);
    if (!plan) return [];
    return (plan.tasks || []).filter(
      (t) => t.status !== 'done' && t.status !== 'cancelled',
    );
  }

  /**
   * Получить незакрытые задачи за вчера (pending, in_progress, deferred)
   * Для переноса в сегодняшний план
   */
  async getYesterdayCarryOver(todayDate: string): Promise<TaskEntity[]> {
    const yesterday = new Date(todayDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const plan = await this.getDayPlan(yesterdayStr);
    if (!plan) return [];
    return (plan.tasks || []).filter(
      (t) => t.status === 'pending' || t.status === 'in_progress' || t.status === 'deferred',
    );
  }

  /**
   * Сохранить план недели в БД
   */
  async saveWeekPlan(plan: any): Promise<PlanEntity> {
    const now = new Date();
    // Понедельник текущей недели
    const dayOfWeek = now.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const startDate = monday.toISOString().split('T')[0];
    const endDate = sunday.toISOString().split('T')[0];

    // Проверяем нет ли уже плана на эту неделю
    const existing = await this.planRepo.findOne({
      where: { type: PlanType.WEEK, date: startDate },
    });

    const entity = existing || this.planRepo.create({
      type: PlanType.WEEK,
      date: startDate,
    });

    entity.dateEnd = endDate;
    entity.focusTitle = plan.mainFocus || plan.weekFocus || '';
    entity.strategicIntentions = plan.strategicIntentions || [];
    entity.checkpoints = plan.checkpoints || {};
    entity.risks = plan.risks || [];
    entity.rawClaudeResponse = plan;

    return this.planRepo.save(entity);
  }

  /**
   * Сохранить сгенерированный Claude план дня в БД
   */
  async saveDayPlan(plan: DailyPlanOutput): Promise<PlanEntity> {
    const date = plan.date;

    // Ищем существующий план (placeholder или предыдущий)
    let existing = await this.planRepo.findOne({
      where: { type: PlanType.DAY, date },
      relations: ['tasks', 'timeBlocks'],
    });

    if (existing) {
      // Удаляем старые timeBlocks и задачи через DELETE query (надёжнее чем remove)
      await this.timeBlockRepo.delete({ planId: existing.id });
      await this.taskRepo.delete({ planId: existing.id });
    } else {
      existing = this.planRepo.create({
        type: PlanType.DAY,
        date,
      });
    }

    existing.focusTitle = plan.focusOfDay;
    existing.intentions = plan.intentions || null;
    existing.risks = plan.risks || [];
    existing.rawClaudeResponse = plan as any;

    const saved = await this.planRepo.save(existing);

    // Сохраняем задачи
    if (plan.tasks?.length) {
      for (let i = 0; i < plan.tasks.length; i++) {
        const t = plan.tasks[i];
        const task = this.taskRepo.create({
          planId: saved.id,
          title: t.title,
          description: t.description,
          category: t.category as any,
          priority: t.priority as any,
          status: t.status as any || 'pending',
          estimatedMinutes: t.estimatedMinutes,
          suggestedTime: t.suggestedTime,
          sortOrder: i + 1,
        });
        await this.taskRepo.save(task);
      }
    }

    // Сохраняем timeBlocks
    if (plan.timeBlocks?.length) {
      for (const block of plan.timeBlocks) {
        const tb = this.timeBlockRepo.create({
          planId: saved.id,
          startTime: block.startTime,
          endTime: block.endTime,
          label: block.label,
          category: block.category as any,
          taskIds: block.taskIds || [],
        });
        await this.timeBlockRepo.save(tb);
      }
    }

    // Синхронизируем план недели
    this.syncWeekCheckpoints(date).catch((err) =>
      this.logger.error('Week sync failed after saveDayPlan', err),
    );

    return saved;
  }

  /**
   * Обновить итоги плана недели
   */
  async updatePlanResults(
    planId: string,
    updates: {
      addWins?: string[];
      removeWins?: string[];
      addMistakes?: string[];
      removeMistakes?: string[];
      addNextPriorities?: string[];
    },
  ): Promise<PlanEntity> {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new Error(`Plan ${planId} not found`);

    const results = plan.results || { wins: [], mistakes: [], nextPriorities: [] };

    if (updates.addWins?.length) {
      results.wins = [...(results.wins || []), ...updates.addWins];
    }
    if (updates.removeWins?.length) {
      results.wins = (results.wins || []).filter(
        (w) => !updates.removeWins.some((r) => w.toLowerCase().includes(r.toLowerCase())),
      );
    }
    if (updates.addMistakes?.length) {
      results.mistakes = [...(results.mistakes || []), ...updates.addMistakes];
    }
    if (updates.removeMistakes?.length) {
      results.mistakes = (results.mistakes || []).filter(
        (m) => !updates.removeMistakes.some((r) => m.toLowerCase().includes(r.toLowerCase())),
      );
    }
    if (updates.addNextPriorities?.length) {
      results.nextPriorities = [...(results.nextPriorities || []), ...updates.addNextPriorities];
    }

    plan.results = results;
    return this.planRepo.save(plan);
  }

  /**
   * Обновить статус задачи по ID
   */
  async updateTaskStatus(taskId: string, status: string): Promise<TaskEntity | null> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId },
      relations: ['plan'],
    });
    if (!task) return null;

    task.status = status as any;
    if (status === 'done') {
      task.completedAt = new Date();
    }
    const saved = await this.taskRepo.save(task);

    // Синхронизируем план недели
    if (task.plan?.date) {
      this.syncWeekCheckpoints(task.plan.date).catch((err) =>
        this.logger.error('Week sync failed', err),
      );
    }

    return saved;
  }

  /**
   * Синхронизация: обновить checkpoints плана недели из реальных дневных планов
   * Вызывается при любом изменении задач в дне
   */
  async syncWeekCheckpoints(date: string): Promise<void> {
    const weekPlan = await this.getWeekPlan(date);
    if (!weekPlan) return;

    const start = weekPlan.date;
    const end = weekPlan.dateEnd || start;

    // Все дневные планы этой недели
    const dayPlans = await this.planRepo.find({
      where: {
        type: PlanType.DAY,
        date: Between(start, end),
      },
      relations: ['tasks'],
      order: { date: 'ASC' },
    });

    const dayNames: Record<number, string> = {
      0: 'Вс', 1: 'Пн', 2: 'Вт', 3: 'Ср', 4: 'Чт', 5: 'Пт', 6: 'Сб',
    };

    const checkpoints = weekPlan.checkpoints || {};

    for (const dp of dayPlans) {
      const d = new Date(dp.date + 'T12:00:00');
      const dayShort = dayNames[d.getDay()];
      if (!dayShort) continue;

      const activeTasks = (dp.tasks || []).filter(
        (t) => t.status !== 'cancelled',
      );

      if (activeTasks.length === 0 && !checkpoints[dayShort]) continue;

      const existing = checkpoints[dayShort] || {};
      const focus = (typeof existing === 'string')
        ? existing
        : (existing as any).focus || dp.focusTitle || '';

      checkpoints[dayShort] = {
        focus,
        tasks: activeTasks.map((t) => {
          const statusIcon = t.status === 'done' ? '✅ ' : '';
          return `${statusIcon}${t.title}`;
        }),
      };
    }

    weekPlan.checkpoints = checkpoints;
    await this.planRepo.save(weekPlan);
    this.logger.log(`Week checkpoints synced for ${start}`);
  }

  /**
   * Все будущие задачи (после сегодня)
   */
  async getUpcomingTasks(): Promise<Array<{ date: string; focusTitle: string; tasks: TaskEntity[] }>> {
    const today = new Date().toISOString().split('T')[0];

    const plans = await this.planRepo.find({
      where: {
        type: PlanType.DAY,
        date: MoreThanOrEqual(today),
      },
      relations: ['tasks'],
      order: { date: 'ASC' },
      take: 30,
    });

    return plans
      .filter((p) => p.tasks && p.tasks.length > 0)
      .map((p) => ({
        date: p.date,
        focusTitle: p.focusTitle,
        tasks: p.tasks.filter(
          (t) => t.status !== 'done' && t.status !== 'cancelled',
        ),
      }))
      .filter((p) => p.tasks.length > 0);
  }
}

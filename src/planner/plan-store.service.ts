// ============================================================
// Plan Store Service
// Чтение и запись планов из/в PostgreSQL
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { PlanEntity, TaskEntity, PaymentEntity } from './entities';
import { PlanType } from './types';

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
  }): Promise<TaskEntity> {
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
    return this.taskRepo.save(newTask);
  }

  /**
   * Получить запланированные задачи на дату
   */
  async getScheduledTasks(date: string): Promise<TaskEntity[]> {
    const plan = await this.getDayPlan(date);
    if (!plan) return [];
    return plan.tasks || [];
  }
}

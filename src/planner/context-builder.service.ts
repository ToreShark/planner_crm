// ============================================================
// Context Builder Service
// Собирает данные из CRM, календаря, заметок → формирует контекст для Claude
// ============================================================

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import {
  PlannerContext,
  PlanType,
  CrmCase,
  TaskCategory,
  WeeklyPlanInput,
  MonthlyPlanInput,
} from './types';
import { PlanStoreService } from './plan-store.service';

@Injectable()
export class ContextBuilderService {
  private readonly logger = new Logger(ContextBuilderService.name);

  constructor(
    @Inject(forwardRef(() => PlanStoreService))
    private readonly planStore: PlanStoreService,
  ) {}

  /**
   * Главный метод — собирает полный контекст для генерации плана
   */
  async buildContext(
    planType: PlanType,
    options?: {
      quickNotes?: string[];
      energyLevel?: number;
      place?: string;
    },
  ): Promise<PlannerContext> {
    const now = new Date();
    const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

    const todayStr = now.toISOString().split('T')[0];

    const [activeCases, upcomingDeadlines, calendarEvents, weekPlan, monthPlan, stats, scheduledTasks, upcomingTasks, yesterdayCarryOver] =
      await Promise.all([
        this.getActiveCases(),
        this.getUpcomingDeadlines(planType),
        this.getCalendarEvents(planType),
        this.getCurrentWeekPlan(),
        this.getCurrentMonthPlan(),
        this.getCompletionStats(),
        planType === PlanType.DAY
          ? this.planStore.getScheduledTasks(todayStr)
          : Promise.resolve([]),
        planType === PlanType.WEEK
          ? this.planStore.getUpcomingTasks()
          : Promise.resolve([]),
        planType === PlanType.DAY
          ? this.planStore.getYesterdayCarryOver(todayStr)
          : Promise.resolve([]),
      ]);

    return {
      planType,
      currentDate: todayStr,
      dayOfWeek: days[now.getDay()],
      activeCases,
      upcomingDeadlines,
      calendarEvents,
      currentMonthPlan: monthPlan,
      currentWeekPlan: weekPlan,
      quickNotes: options?.quickNotes,
      energyLevel: options?.energyLevel,
      place: options?.place,
      scheduledTasks: scheduledTasks.map((t) => ({
        title: t.title,
        description: t.description,
        priority: t.priority,
        status: t.status,
      })),
      yesterdayCarryOver: yesterdayCarryOver.map((t) => ({
        title: t.title,
        description: t.description,
        priority: t.priority,
        status: t.status,
        category: t.category,
      })),
      upcomingTasks: upcomingTasks,
      recentCompletionRate: stats.completionRate,
      commonDeferrals: stats.commonDeferrals,
    };
  }

  // -------------------------------------------------------
  // Источники данных — подключить к реальным сервисам
  // -------------------------------------------------------

  /**
   * Получить активные дела из CRM (PostgreSQL)
   * TODO: Подключить к существующему CRM-модулю
   */
  private async getActiveCases(): Promise<CrmCase[]> {
    // Пример запроса к твоей CRM БД:
    // return this.crmRepository.find({
    //   where: { status: Not('closed') },
    //   order: { nextDeadline: 'ASC' },
    // });

    // Заглушка на основе твоих реальных дел:
    return [
      {
        id: '1',
        clientName: 'Темирбаев',
        caseType: 'criminal',
        status: 'cassation_filed',
        nextAction: 'Ожидание решения по кассации',
        notes: 'Кассация подана и завершена',
      },
      {
        id: '2',
        clientName: 'Жансая',
        caseType: 'civil',
        status: 'enforcement',
        nextAction: 'Забрать ИЛ',
        notes: 'ИЛ забран',
      },
      {
        id: '3',
        clientName: 'Анара',
        caseType: 'civil',
        status: 'active',
        nextAction: 'Раздел имущества — подготовить документы',
      },
      {
        id: '4',
        clientName: 'Ульяна',
        caseType: 'criminal',
        status: 'active',
        nextAction: 'Снятие ареста через следственный суд',
      },
      {
        id: '5',
        clientName: 'Бауыржан',
        caseType: 'civil',
        status: 'active',
        nextAction: 'Раздел имущества',
      },
      {
        id: '6',
        clientName: 'Арбузов',
        caseType: 'criminal',
        status: 'active',
        nextAction: 'Получить копию приговора',
      },
    ];
  }

  /**
   * Дела с ближайшими дедлайнами
   */
  private async getUpcomingDeadlines(planType: PlanType): Promise<CrmCase[]> {
    const daysAhead = planType === PlanType.DAY ? 1 : planType === PlanType.WEEK ? 7 : 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + daysAhead);

    // return this.crmRepository.find({
    //   where: { nextDeadline: LessThan(cutoff), status: Not('closed') },
    //   order: { nextDeadline: 'ASC' },
    // });

    return []; // Заполнится из реальной БД
  }

  /**
   * События Google Calendar
   * TODO: Подключить через googleapis npm пакет
   */
  private async getCalendarEvents(planType: PlanType) {
    // const calendar = google.calendar({ version: 'v3', auth: this.oauthClient });
    // const timeMin = new Date().toISOString();
    // const timeMax = ...
    // const events = await calendar.events.list({ calendarId: 'primary', timeMin, timeMax });

    return [
      { title: 'Консультации', start: '12:00', end: '17:00', location: 'Офис' },
    ];
  }

  /**
   * Текущий план недели из БД
   */
  private async getCurrentWeekPlan(): Promise<Partial<WeeklyPlanInput> | undefined> {
    const plan = await this.planStore.getWeekPlan();
    if (!plan) return undefined;
    return {
      mainFocus: plan.focusTitle,
      strategicIntentions: plan.strategicIntentions || [],
      checkpoints: plan.checkpoints as any || {},
    };
  }

  /**
   * Текущий план месяца
   */
  private async getCurrentMonthPlan(): Promise<Partial<MonthlyPlanInput> | undefined> {
    const plan = await this.planStore.getMonthPlan();
    if (!plan) return undefined;
    return {
      mainGoal: plan.focusTitle,
      directions: plan.intentions as any || {},
    };
  }

  /**
   * Статистика выполнения за последние N дней
   */
  private async getCompletionStats(): Promise<{
    completionRate: number;
    commonDeferrals: string[];
  }> {
    // const recentPlans = await this.planRepository.find({
    //   where: { type: PlanType.DAY, date: MoreThan(subDays(new Date(), 7)) },
    // });
    // const done = recentPlans.flatMap(p => p.tasks.filter(t => t.status === 'done'));
    // const total = recentPlans.flatMap(p => p.tasks);

    return {
      completionRate: 0.65,  // 65% — заглушка
      commonDeferrals: ['IT-задачи', 'контент / съемка'],
    };
  }

  // -------------------------------------------------------
  // Сериализация контекста в текст для промпта
  // -------------------------------------------------------

  serializeContext(ctx: PlannerContext): string {
    const sections: string[] = [];

    sections.push(`## Текущая дата: ${ctx.currentDate} (${ctx.dayOfWeek})`);

    if (ctx.energyLevel !== undefined) {
      sections.push(`## Уровень энергии: ${ctx.energyLevel}/10`);
    }
    if (ctx.place) {
      sections.push(`## Место: ${ctx.place}`);
    }

    // Активные дела
    if (ctx.activeCases.length > 0) {
      sections.push('## Активные дела из CRM:');
      for (const c of ctx.activeCases) {
        let line = `- ${c.clientName} (${c.caseType}) — ${c.status}`;
        if (c.nextAction) line += ` → ${c.nextAction}`;
        if (c.nextDeadline) line += ` [дедлайн: ${c.nextDeadline}]`;
        if (c.courtDate) line += ` [суд: ${c.courtDate}]`;
        sections.push(line);
      }
    }

    // Срочные дедлайны
    if (ctx.upcomingDeadlines.length > 0) {
      sections.push('## ⚠️ Ближайшие дедлайны:');
      for (const c of ctx.upcomingDeadlines) {
        sections.push(`- ${c.clientName}: ${c.nextAction} [${c.nextDeadline}]`);
      }
    }

    // Календарь
    if (ctx.calendarEvents && ctx.calendarEvents.length > 0) {
      sections.push('## Календарь на сегодня:');
      for (const e of ctx.calendarEvents) {
        sections.push(`- ${e.start}–${e.end}: ${e.title}${e.location ? ` (${e.location})` : ''}`);
      }
    }

    // План месяца (для каскадирования)
    if (ctx.currentMonthPlan) {
      sections.push(`## Фокус месяца: ${ctx.currentMonthPlan.mainGoal}`);
    }

    // План недели (для каскадирования)
    if (ctx.currentWeekPlan) {
      sections.push(`## Фокус недели: ${ctx.currentWeekPlan.mainFocus}`);
      if (ctx.currentWeekPlan.checkpoints[ctx.dayOfWeek.slice(0, 2)]) {
        sections.push(
          `## Контрольная точка на ${ctx.dayOfWeek}: ${ctx.currentWeekPlan.checkpoints[ctx.dayOfWeek.slice(0, 2)]}`,
        );
      }
    }

    // Quick notes
    if (ctx.quickNotes && ctx.quickNotes.length > 0) {
      sections.push('## Заметки / входящие:');
      for (const note of ctx.quickNotes) {
        sections.push(`- ${note}`);
      }
    }

    // Статистика
    if (ctx.recentCompletionRate !== undefined) {
      sections.push(
        `## Статистика: выполнение за последние 7 дней — ${Math.round(ctx.recentCompletionRate * 100)}%`,
      );
    }
    if (ctx.commonDeferrals && ctx.commonDeferrals.length > 0) {
      sections.push(`## Часто переносимые задачи: ${ctx.commonDeferrals.join(', ')}`);
    }

    // Вчерашние незакрытые задачи (перенос)
    if (ctx.yesterdayCarryOver && ctx.yesterdayCarryOver.length > 0) {
      sections.push('## 🔄 НЕЗАКРЫТЫЕ ЗАДАЧИ СО ВЧЕРА (перенести в сегодняшний план):');
      sections.push('Эти задачи не были выполнены вчера и НЕ отменены. Включи их в план.');
      for (const t of ctx.yesterdayCarryOver) {
        const line = `- [${t.priority.toUpperCase()}] [${t.status}] ${t.title}${t.description ? ` — ${t.description}` : ''}`;
        sections.push(line);
      }
    }

    // Предзапланированные задачи на сегодня (только активные — done/cancelled уже отфильтрованы)
    if (ctx.scheduledTasks && ctx.scheduledTasks.length > 0) {
      sections.push('## ⚡ ПРЕДЗАПЛАНИРОВАННЫЕ ЗАДАЧИ НА СЕГОДНЯ (ОБЯЗАТЕЛЬНО включить в план):');
      for (const t of ctx.scheduledTasks) {
        let line = `- [${t.priority.toUpperCase()}] ${t.title}`;
        if (t.description) line += ` — ${t.description}`;
        sections.push(line);
      }
    }

    // Все будущие задачи из БД (для плана недели)
    if (ctx.upcomingTasks && ctx.upcomingTasks.length > 0) {
      const dayNames: Record<number, string> = { 0: 'Вс', 1: 'Пн', 2: 'Вт', 3: 'Ср', 4: 'Чт', 5: 'Пт', 6: 'Сб' };
      sections.push('## ⚡ ЗАДАЧИ ИЗ БД — ПРИВЯЗАНЫ К ДАТАМ! НЕ ПЕРЕНОСИТЬ!');
      sections.push('Каждая задача ДОЛЖНА быть в плане на тот день недели, который соответствует её дате.');
      for (const dayGroup of ctx.upcomingTasks) {
        const d = new Date(dayGroup.date);
        const dayName = dayNames[d.getDay()];
        sections.push(`\n### ${dayGroup.date} (${dayName}) — ${dayGroup.focusTitle}`);
        for (const t of dayGroup.tasks) {
          let line = `- ⚡ [${dayName}] [${t.priority.toUpperCase()}] [${t.status}] ${t.title}`;
          if (t.description) line += ` — ${t.description}`;
          sections.push(line);
        }
      }
    }

    return sections.join('\n');
  }
}

// ============================================================
// Telegram Bot Service
// Интерфейс планировщика через Telegram
//
// Пошаговые диалоги для планирования дня/недели/месяца
// ============================================================

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Markup, Context } from 'telegraf';
import { InlineKeyboardButton } from 'telegraf/typings/core/types/typegram';
import { ClaudePlannerService } from '../planner/claude-planner.service';
import { PlanStoreService } from '../planner/plan-store.service';
import { DailyPlanOutput, TaskItem, TaskCategory, TaskStatus, TaskPriority } from '../planner/types';
import { PlanEntity } from '../planner/entities';

// Emoji маппинг
const CATEGORY_EMOJI: Record<string, string> = {
  work: '💼',
  tech: '🤖',
  marketing: '📈',
  health: '💪',
  personal: '🧠',
};

const PRIORITY_EMOJI: Record<string, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '⚪',
};

const STATUS_EMOJI: Record<string, string> = {
  pending: '⬜',
  in_progress: '🔵',
  done: '✅',
  deferred: '➡️',
  cancelled: '❌',
};

// -------------------------------------------------------
// Состояние пошагового диалога
// -------------------------------------------------------

type WizardType = 'day' | 'week' | 'month' | null;

interface WizardState {
  type: WizardType;
  step: number;
  data: Record<string, any>;
}

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot: Telegraf;
  private readonly allowedUserId: number;

  private currentPlan: DailyPlanOutput | null = null;
  private wizard: WizardState = { type: null, step: 0, data: {} };

  constructor(
    private readonly configService: ConfigService,
    private readonly plannerService: ClaudePlannerService,
    private readonly planStore: PlanStoreService,
  ) {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');

    this.bot = new Telegraf(token);
    this.allowedUserId = Number(
      this.configService.get<string>('TELEGRAM_OWNER_ID'),
    );
  }

  async onModuleInit() {
    this.bot.catch((err, ctx) => {
      this.logger.error(`Telegraf error for ${ctx?.updateType}`, err);
    });

    this.setupMiddleware();
    this.setupCommands();
    this.setupCallbacks();
    this.setupTextHandler();
    this.logger.log('Telegram bot handlers registered');
  }

  async startPolling() {
    try {
      await this.bot.telegram.deleteWebhook({ drop_pending_updates: true });
      this.logger.log('Webhook cleared');
    } catch (e) {
      this.logger.warn('deleteWebhook failed: ' + e.message);
    }

    const me = await this.bot.telegram.getMe();
    this.logger.log(`Bot identity: @${me.username} (id: ${me.id})`);

    // Ручной polling вместо Telegraf launch
    let offset = 0;
    const poll = async () => {
      try {
        const updates = await this.bot.telegram.callApi('getUpdates', {
          offset,
          timeout: 30,
          allowed_updates: ['message', 'callback_query'],
        });
        if (updates && updates.length > 0) {
          this.logger.log(`Received ${updates.length} update(s)`);
          for (const update of updates) {
            offset = update.update_id + 1;
            try {
              await this.bot.handleUpdate(update);
            } catch (err) {
              this.logger.error('handleUpdate error: ' + err.message);
            }
          }
        }
      } catch (err) {
        this.logger.error('Polling error: ' + err.message);
        await new Promise((r) => setTimeout(r, 3000));
      }
      setImmediate(poll);
    };
    poll();
    this.logger.log('Telegram bot manual polling started');
  }

  async onModuleDestroy() {
    this.bot.stop('App shutdown');
  }

  // -------------------------------------------------------
  // Middleware
  // -------------------------------------------------------

  private setupMiddleware() {
    this.bot.use(async (ctx, next) => {
      if (ctx.from?.id !== this.allowedUserId) {
        await ctx.reply('⛔ Бот работает только для владельца.');
        return;
      }
      return next();
    });
  }

  // -------------------------------------------------------
  // Команды
  // -------------------------------------------------------

  private setupCommands() {
    this.bot.start(async (ctx) => {
      this.resetWizard();
      await ctx.reply(
        '🗓 *AI Планировщик PrimeLegal*\n\n' +
          '*Планирование (пошагово):*\n' +
          '/plan — Создать план на сегодня\n' +
          '/week — Создать план на неделю\n' +
          '/month — Создать план на месяц\n\n' +
          '*Просмотр:*\n' +
          '/today — Посмотреть план на сегодня\n' +
          '/thisweek — Посмотреть план недели\n' +
          '/history — Планы за последние 7 дней\n' +
          '/stats — Статистика и оплаты\n\n' +
          '*Будущие задачи:*\n' +
          '/upcoming — Все предстоящие задачи\n' +
          '/tasks 2026-04-04 — Задачи на дату\n\n' +
          '*Итоги:*\n' +
          '/dayresults — Итоги дня\n' +
          '/weekresults — Итоги недели\n' +
          '/weekreview — 🤖 AI-обновление итогов недели\n' +
          '/monthresults — Итоги месяца\n\n' +
          '*Управление:*\n' +
          '/status — Текущий прогресс\n' +
          '/replan — Перепланировать день\n' +
          '/review — AI-обзор дня (Claude)\n' +
          '/cancel — Отменить текущий диалог\n\n' +
          '💬 Просто напиши задачу — добавлю в план.',
        { parse_mode: 'Markdown' },
      );
    });

    // /cancel — сброс диалога
    this.bot.command('cancel', async (ctx) => {
      this.resetWizard();
      await ctx.reply('❌ Диалог отменён.');
    });

    // ==========================================
    // /plan — ПОШАГОВЫЙ ПЛАН ДНЯ
    // ==========================================
    this.bot.command('plan', async (ctx) => {
      this.wizard = {
        type: 'day',
        step: 1,
        data: {},
      };
      await ctx.reply(
        '🗓 *Планируем день*\n\n' +
          '📍 *Шаг 1/5 — Где ты сегодня?*\n\n' +
          'Выбери или напиши:',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('🏢 Офис', 'day_place:офис'),
              Markup.button.callback('🏠 Дом', 'day_place:дом'),
              Markup.button.callback('🚗 В дороге', 'day_place:в дороге'),
            ],
          ]),
        },
      );
    });

    // ==========================================
    // /week — ПОШАГОВЫЙ ПЛАН НЕДЕЛИ
    // ==========================================
    this.bot.command('week', async (ctx) => {
      this.wizard = {
        type: 'week',
        step: 1,
        data: {},
      };
      await ctx.reply(
        '📅 *Планируем неделю*\n\n' +
          '🎯 *Шаг 1/4 — Главный фокус недели*\n\n' +
          'Какой один результат ты хочешь получить к концу недели?\n\n' +
          '_Примеры:_\n' +
          '• Закрыть кассацию Темирбаева\n' +
          '• Запустить набор на курс\n' +
          '• Сдать возражение по НСД',
        { parse_mode: 'Markdown' },
      );
    });

    // ==========================================
    // /month — ПОШАГОВЫЙ ПЛАН МЕСЯЦА
    // ==========================================
    this.bot.command('month', async (ctx) => {
      const currentMonth = new Date().toLocaleString('ru-RU', { month: 'long' });
      const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toLocaleString('ru-RU', { month: 'long' });

      this.wizard = {
        type: 'month',
        step: 1,
        data: {},
      };
      await ctx.reply(
        '📆 *Планируем месяц*\n\n' +
          '📅 *Шаг 1/5 — На какой месяц планируем?*',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                `${currentMonth.charAt(0).toUpperCase() + currentMonth.slice(1)}`,
                `month_name:${currentMonth}`,
              ),
              Markup.button.callback(
                `${nextMonth.charAt(0).toUpperCase() + nextMonth.slice(1)}`,
                `month_name:${nextMonth}`,
              ),
            ],
          ]),
        },
      );
    });

    // /status
    this.bot.command('status', async (ctx) => {
      if (!this.currentPlan) {
        await ctx.reply('Плана нет. Используй /plan');
        return;
      }
      await this.sendPlanStatus(ctx);
    });

    // /replan
    this.bot.command('replan', async (ctx) => {
      const reason = ctx.message.text.replace('/replan', '').trim();
      if (!reason) {
        this.wizard = { type: null, step: 0, data: { awaitingReplan: true } };
        await ctx.reply(
          '🔄 *Перепланирование*\n\n' +
            'Что изменилось? Напиши причину:\n\n' +
            '_Примеры:_\n' +
            '• Суд перенесли на завтра\n' +
            '• Срочный звонок от клиента\n' +
            '• Плохо себя чувствую',
          { parse_mode: 'Markdown' },
        );
        return;
      }
      await this.replanDay(ctx, reason);
    });

    // /review
    this.bot.command('review', async (ctx) => {
      if (!this.currentPlan) {
        await ctx.reply('Нет плана для обзора.');
        return;
      }
      await this.sendDayReview(ctx);
    });

    // ==========================================
    // ПРОСМОТР ПЛАНОВ ИЗ БД
    // ==========================================

    // /today — план на сегодня из БД (или из контрольной точки недели)
    this.bot.command('today', async (ctx) => {
      const today = new Date().toISOString().split('T')[0];
      const plan = await this.planStore.getDayPlan(today);

      if (plan) {
        await this.sendStoredDayPlan(ctx, plan);
        return;
      }

      // Нет отдельного плана дня — ищем контрольную точку в плане недели
      const weekPlan = await this.planStore.getWeekPlan(today);
      if (weekPlan && weekPlan.checkpoints) {
        const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const dayShort = days[new Date().getDay()];
        const checkpoint = weekPlan.checkpoints[dayShort];

        if (checkpoint) {
          const lines: string[] = [];
          lines.push(`🗓 *${today}* (${dayShort})\n`);
          lines.push(`🎯 *Фокус недели:* ${weekPlan.focusTitle}\n`);
          lines.push(`📋 *На сегодня (из плана недели):*`);
          lines.push(`${checkpoint}\n`);
          lines.push(`_Отдельного плана нет. Используй /plan чтобы создать детальный._`);
          await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
          return;
        }
      }

      await ctx.reply(
        `📅 На *${today}* плана нет.\n\nИспользуй /plan чтобы создать.`,
        { parse_mode: 'Markdown' },
      );
    });

    // /thisweek — план текущей недели из БД
    this.bot.command('thisweek', async (ctx) => {
      const plan = await this.planStore.getWeekPlan();

      if (!plan) {
        await ctx.reply(
          '📅 Плана недели нет.\n\nИспользуй /week чтобы создать.',
          { parse_mode: 'Markdown' },
        );
        return;
      }

      await this.sendStoredWeekPlan(ctx, plan);
    });

    // /history — последние 7 дней
    this.bot.command('history', async (ctx) => {
      const plans = await this.planStore.getRecentPlans(7);

      if (plans.length === 0) {
        await ctx.reply('📋 Нет сохранённых планов.');
        return;
      }

      const lines: string[] = ['📋 *Последние планы:*\n'];

      for (const plan of plans) {
        const tasks = plan.tasks || [];
        const done = tasks.filter((t) => t.status === 'done').length;
        const total = tasks.length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;

        const payments = plan.payments || [];
        const payTotal = payments.filter((p) => p.received).reduce((s, p) => s + p.amount, 0);

        lines.push(
          `*${plan.date}* — ${plan.focusTitle}` +
            `\n  ${this.progressBar(pct)} ${pct}% (${done}/${total})` +
            (payTotal > 0 ? ` 💰 ${(payTotal / 1000).toFixed(0)}K` : ''),
        );
        lines.push('');
      }

      await this.sendLongMessage(ctx, lines.join('\n'));
    });

    // /stats — статистика
    this.bot.command('stats', async (ctx) => {
      const stats = await this.planStore.getCompletionStats(7);

      const pct = Math.round(stats.completionRate * 100);

      await ctx.reply(
        `📊 *Статистика за 7 дней*\n\n` +
          `${this.progressBar(pct)} *${pct}%* выполнение\n\n` +
          `✅ Выполнено: ${stats.completedTasks} из ${stats.totalTasks}\n` +
          `💰 Оплаты: ${(stats.totalPayments / 1000).toFixed(0)}K тенге\n`,
        { parse_mode: 'Markdown' },
      );
    });

    // ==========================================
    // ИТОГИ
    // ==========================================

    // /dayresults — итоги дня (сегодня или указанная дата)
    this.bot.command('dayresults', async (ctx) => {
      const dateArg = ctx.message.text.replace('/dayresults', '').trim();
      const date = dateArg || new Date().toISOString().split('T')[0];
      const plan = await this.planStore.getDayPlan(date);

      if (!plan) {
        await ctx.reply(`📅 На *${date}* плана нет.`, { parse_mode: 'Markdown' });
        return;
      }

      await this.sendDayResults(ctx, plan);
    });

    // /weekresults — итоги недели
    this.bot.command('weekresults', async (ctx) => {
      const plan = await this.planStore.getWeekPlan();

      if (!plan) {
        await ctx.reply('📅 Плана недели нет.');
        return;
      }

      // Собираем все дни этой недели
      const startDate = plan.date;
      const endDate = plan.dateEnd || plan.date;
      const dayPlans = await this.planStore.getDayPlans(startDate, endDate);

      await this.sendWeekResults(ctx, plan, dayPlans);
    });

    // /weekreview <текст> — AI-агент обновляет итоги недели
    this.bot.command('weekreview', async (ctx) => {
      const userText = ctx.message.text.replace('/weekreview', '').trim();
      if (!userText) {
        await ctx.reply(
          '✏️ Напиши итоги после команды:\n\n' +
            '`/weekreview кассация Темирбаева закрыта, договор на 200к`\n\n' +
            'Или просто напиши свободным текстом — Claude сам разберётся что обновить в плане недели.',
          { parse_mode: 'Markdown' },
        );
        return;
      }

      const weekPlan = await this.planStore.getWeekPlan();
      if (!weekPlan) {
        await ctx.reply('📅 Плана недели нет.');
        return;
      }

      const startDate = weekPlan.date;
      const endDate = weekPlan.dateEnd || weekPlan.date;
      const dayPlans = await this.planStore.getDayPlans(startDate, endDate);

      await ctx.reply('🤖 Анализирую...');

      try {
        const updates = await this.plannerService.analyzeWeekUpdate(
          userText,
          weekPlan,
          dayPlans,
        );

        // Обновляем results в плане недели
        await this.planStore.updatePlanResults(weekPlan.id, {
          addWins: updates.addWins,
          removeWins: updates.removeWins,
          addMistakes: updates.addMistakes,
          removeMistakes: updates.removeMistakes,
          addNextPriorities: updates.addNextPriorities,
        });

        // Обновляем статусы задач
        for (const tu of updates.taskUpdates || []) {
          await this.planStore.updateTaskStatus(tu.taskId, tu.newStatus);
        }

        // Формируем ответ
        const lines: string[] = [];
        lines.push('✅ *Итоги недели обновлены!*\n');

        if (updates.addWins?.length) {
          lines.push('🔥 *Добавлены победы:*');
          updates.addWins.forEach((w) => lines.push(`  + ${w}`));
        }
        if (updates.removeMistakes?.length) {
          lines.push('\n🗑 *Убрано из ошибок:*');
          updates.removeMistakes.forEach((m) => lines.push(`  − ${m}`));
        }
        if (updates.taskUpdates?.length) {
          lines.push(`\n📋 *Задач обновлено:* ${updates.taskUpdates.length}`);
        }
        if (updates.comment) {
          lines.push(`\n💬 ${updates.comment}`);
        }
        lines.push('\n_Используй /weekresults чтобы увидеть обновлённые итоги._');

        await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
      } catch (error) {
        this.logger.error('Week review update failed', error);
        await ctx.reply('⚠️ Ошибка при обновлении. Попробуй позже.');
      }
    });

    // /monthresults — итоги месяца
    this.bot.command('monthresults', async (ctx) => {
      const now = new Date();
      const monthStart = now.toISOString().slice(0, 7) + '-01';
      const monthEnd = now.toISOString().split('T')[0];

      const dayPlans = await this.planStore.getDayPlans(monthStart, monthEnd);
      const weekPlan = await this.planStore.getWeekPlan();
      const monthPlan = await this.planStore.getMonthPlan();

      if (dayPlans.length === 0) {
        await ctx.reply('📅 Нет данных за этот месяц.');
        return;
      }

      await this.sendMonthResults(ctx, dayPlans, weekPlan, monthPlan);
    });

    // ==========================================
    // ПРОСМОТР БУДУЩИХ ЗАДАЧ
    // ==========================================

    // /tasks 2026-04-04 — задачи на конкретную дату
    this.bot.command('tasks', async (ctx) => {
      const dateArg = ctx.message.text.replace('/tasks', '').trim();
      if (!dateArg) {
        await ctx.reply(
          '📋 Укажи дату:\n`/tasks 2026-04-04`\n\nИли используй /upcoming для всех будущих задач.',
          { parse_mode: 'Markdown' },
        );
        return;
      }

      const tasks = await this.planStore.getScheduledTasks(dateArg);
      if (tasks.length === 0) {
        await ctx.reply(`📅 На *${dateArg}* задач нет.`, { parse_mode: 'Markdown' });
        return;
      }

      const lines: string[] = [];
      lines.push(`📋 *Задачи на ${dateArg}:*\n`);
      for (const t of tasks) {
        const status = STATUS_EMOJI[t.status] || '⬜';
        const priority = PRIORITY_EMOJI[t.priority] || '';
        const cat = CATEGORY_EMOJI[t.category] || '';
        lines.push(`${status} ${priority}${cat} *${t.title}*`);
        if (t.description) lines.push(`  _${t.description.replace(/\n/g, ', ')}_`);
      }

      await this.sendLongMessage(ctx, lines.join('\n'));
    });

    // /upcoming — все будущие задачи
    this.bot.command('upcoming', async (ctx) => {
      const upcoming = await this.planStore.getUpcomingTasks();

      if (upcoming.length === 0) {
        await ctx.reply('📋 Нет запланированных задач.');
        return;
      }

      const lines: string[] = [];
      lines.push('📋 *Предстоящие задачи:*\n');

      for (const day of upcoming) {
        lines.push(`📅 *${day.date}*`);
        for (const t of day.tasks) {
          const status = STATUS_EMOJI[t.status] || '⬜';
          const priority = PRIORITY_EMOJI[t.priority] || '';
          const cat = CATEGORY_EMOJI[t.category] || '';
          lines.push(`  ${status} ${priority}${cat} ${t.title}`);
          if (t.description) {
            const short = t.description.split('\n').slice(0, 2).join(', ');
            lines.push(`    _${short}_`);
          }
        }
        lines.push('');
      }

      await this.sendLongMessage(ctx, lines.join('\n'));
    });
  }

  // -------------------------------------------------------
  // Callbacks (кнопки)
  // -------------------------------------------------------

  private setupCallbacks() {
    // === WIZARD: День ===

    // Шаг 1 — место
    this.bot.action(/^day_place:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      this.wizard.data.place = ctx.match[1];
      this.wizard.step = 2;
      await ctx.reply(
        `📍 Место: *${this.wizard.data.place}*\n\n` +
          '⚡ *Шаг 2/5 — Уровень энергии*\n\n' +
          'Как ты себя чувствуешь? (0 = никакой, 10 = огонь)',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('😴 1-3', 'day_energy:3'),
              Markup.button.callback('😐 4-5', 'day_energy:5'),
              Markup.button.callback('💪 6-7', 'day_energy:7'),
              Markup.button.callback('🔥 8-10', 'day_energy:9'),
            ],
          ]),
        },
      );
    });

    // Шаг 2 — энергия
    this.bot.action(/^day_energy:(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      this.wizard.data.energyLevel = Number(ctx.match[1]);
      this.wizard.step = 3;

      const energyComment = this.wizard.data.energyLevel <= 4
        ? '🔋 Понял, сделаем лёгкий план.'
        : this.wizard.data.energyLevel >= 8
          ? '🔥 Отлично! Можно нагрузить.'
          : '👍 Нормально, стандартный план.';

      await ctx.reply(
        `⚡ Энергия: *${this.wizard.data.energyLevel}/10* ${energyComment}\n\n` +
          '📝 *Шаг 3/5 — Что обязательно сделать сегодня?*\n\n' +
          'Напиши 1-3 главные задачи (каждая с новой строки):\n\n' +
          '_Примеры:_\n' +
          '• Составить отзыв по делу УГД\n' +
          '• Позвонить Анаре по разделу имущества\n' +
          '• Бассейн вечером',
        { parse_mode: 'Markdown' },
      );
    });

    // === WIZARD: Месяц ===

    // Шаг 1 — название месяца
    this.bot.action(/^month_name:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      this.wizard.data.monthName = ctx.match[1];
      this.wizard.step = 2;
      await ctx.reply(
        `📅 Месяц: *${this.wizard.data.monthName}*\n\n` +
          '🎯 *Шаг 2/5 — Главная цель месяца*\n\n' +
          'Один ключевой результат, ради которого всё остальное.\n\n' +
          '_Примеры:_\n' +
          '• Запустить набор на курс по банкротству\n' +
          '• Закрыть 3 дела в стадии исполнения\n' +
          '• Выйти на стабильный поток клиентов через таргет',
        { parse_mode: 'Markdown' },
      );
    });

    // === Задачи — inline кнопки ===

    this.bot.action(/^done:(.+)$/, async (ctx) => {
      const taskId = ctx.match[1];
      this.updateTaskStatus(taskId, TaskStatus.DONE);
      await ctx.answerCbQuery('✅ Выполнено!');
      await this.refreshPlanMessage(ctx);
    });

    this.bot.action(/^defer:(.+)$/, async (ctx) => {
      const taskId = ctx.match[1];
      this.updateTaskStatus(taskId, TaskStatus.DEFERRED);
      await ctx.answerCbQuery('➡️ Перенесено');
      await this.refreshPlanMessage(ctx);
    });

    this.bot.action(/^progress:(.+)$/, async (ctx) => {
      const taskId = ctx.match[1];
      this.updateTaskStatus(taskId, TaskStatus.IN_PROGRESS);
      await ctx.answerCbQuery('🔵 В работе');
      await this.refreshPlanMessage(ctx);
    });

    this.bot.action(/^cancel:(.+)$/, async (ctx) => {
      const taskId = ctx.match[1];
      this.updateTaskStatus(taskId, TaskStatus.CANCELLED);
      await ctx.answerCbQuery('❌ Отменено');
      await this.refreshPlanMessage(ctx);
    });

    this.bot.action(/^detail:(.+)$/, async (ctx) => {
      const taskId = ctx.match[1];
      const task = this.currentPlan?.tasks.find((t) => t.id === taskId);
      if (!task) {
        await ctx.answerCbQuery('Задача не найдена');
        return;
      }
      await ctx.answerCbQuery();
      await ctx.reply(this.formatTaskDetail(task), {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(this.getTaskActions(task)),
      });
    });

    this.bot.action('replan_day', async (ctx) => {
      await ctx.answerCbQuery();
      this.wizard.data.awaitingReplan = true;
      await ctx.reply('📝 Напиши причину перепланирования:');
    });

    this.bot.action('show_progress', async (ctx) => {
      await ctx.answerCbQuery();
      await this.sendPlanStatus(ctx);
    });

    // День: Шаг 5 — тренировка
    this.bot.action(/^day_train:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery();
      const training = ctx.match[1];
      await this.generateDayFromWizard(ctx, training);
    });

    // Пропуск шага (кнопка "Пропустить")
    this.bot.action('skip_step', async (ctx) => {
      await ctx.answerCbQuery();
      await this.handleWizardText(ctx, '');
    });
  }

  // -------------------------------------------------------
  // Текстовый ввод — роутер по состоянию wizard
  // -------------------------------------------------------

  private setupTextHandler() {
    this.bot.on('text', async (ctx) => {
      const text = ctx.message.text;
      if (text.startsWith('/')) return;

      // Если ждём причину перепланирования
      if (this.wizard.data.awaitingReplan) {
        this.wizard.data.awaitingReplan = false;
        await this.replanDay(ctx, text);
        return;
      }

      // Если wizard активен — обрабатываем шаг
      if (this.wizard.type) {
        await this.handleWizardText(ctx, text);
        return;
      }

      // Если текст длинный и содержит дату/время — smart task через Claude
      if (this.isSmartTask(text)) {
        await this.handleSmartTask(ctx, text);
        return;
      }

      // Иначе — простое добавление как задачу на сегодня
      await this.addTaskFromText(ctx, text);
    });
  }

  // -------------------------------------------------------
  // WIZARD — обработка текстовых шагов
  // -------------------------------------------------------

  private async handleWizardText(ctx: Context, text: string) {
    const w = this.wizard;

    // ==========================================
    // ДЕНЬ
    // ==========================================
    if (w.type === 'day') {
      switch (w.step) {
        case 2: // Место (если ввёл текстом)
          w.data.place = text;
          w.step = 3;
          await ctx.reply(
            '⚡ *Шаг 2/5 — Уровень энергии* (0-10)\n\nНапиши число или нажми:',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [
                  Markup.button.callback('😴 1-3', 'day_energy:3'),
                  Markup.button.callback('😐 4-5', 'day_energy:5'),
                  Markup.button.callback('💪 6-7', 'day_energy:7'),
                  Markup.button.callback('🔥 8-10', 'day_energy:9'),
                ],
              ]),
            },
          );
          break;

        case 3: // Главные задачи
          w.data.mainTasks = text.split('\n').map((s) => s.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
          w.step = 4;
          await ctx.reply(
            `✅ Записал ${w.data.mainTasks.length} задач(и).\n\n` +
              '📋 *Шаг 4/5 — Что ещё на уме?*\n\n' +
              'Допзадачи, мелочи, звонки, напоминания.\n' +
              'Или нажми "Пропустить" если всё.',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('⏭ Пропустить', 'skip_step')],
              ]),
            },
          );
          break;

        case 4: // Допзадачи
          if (text) {
            w.data.extraNotes = text.split('\n').map((s) => s.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
          }
          w.step = 5;
          await ctx.reply(
            '💪 *Шаг 5/5 — Тренировка сегодня?*',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [
                  Markup.button.callback('🏊 Бассейн', 'day_train:бассейн'),
                  Markup.button.callback('🏋️ Силовая', 'day_train:силовая'),
                  Markup.button.callback('🚫 Нет', 'day_train:нет'),
                ],
              ]),
            },
          );
          break;
      }
      return;
    }

    // ==========================================
    // НЕДЕЛЯ
    // ==========================================
    if (w.type === 'week') {
      switch (w.step) {
        case 1: // Фокус недели
          w.data.mainFocus = text;
          w.step = 2;
          await ctx.reply(
            `🎯 Фокус: *${text}*\n\n` +
              '💼 *Шаг 2/4 — Какие дела/задачи по работе на этой неделе?*\n\n' +
              'Напиши всё что приходит в голову — суды, дедлайны, звонки, документы:\n\n' +
              '_Каждая задача с новой строки_',
            { parse_mode: 'Markdown' },
          );
          break;

        case 2: // Рабочие задачи
          w.data.workTasks = text.split('\n').map((s) => s.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
          w.step = 3;
          await ctx.reply(
            `✅ Записал ${w.data.workTasks.length} рабочих задач.\n\n` +
              '🤖📈💪 *Шаг 3/4 — Другие направления*\n\n' +
              'Что ещё хочешь сделать на этой неделе?\n' +
              'IT, маркетинг, контент, тренировки, личное.\n\n' +
              '_Или нажми "Пропустить"_',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('⏭ Пропустить', 'skip_step')],
              ]),
            },
          );
          break;

        case 3: // Другие задачи
          if (text) {
            w.data.otherTasks = text.split('\n').map((s) => s.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
          }
          w.step = 4;
          await ctx.reply(
            '⚠️ *Шаг 4/4 — Риски и ограничения*\n\n' +
              'Что может помешать на этой неделе?\n\n' +
              '_Примеры:_\n' +
              '• Могут перенести заседание\n' +
              '• Жду решение суда — может прийти в любой день\n\n' +
              '_Или нажми "Пропустить"_',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('⏭ Сгенерировать план', 'skip_step')],
              ]),
            },
          );
          break;

        case 4: // Риски → Генерация
          if (text) {
            w.data.risks = text.split('\n').map((s) => s.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
          }
          await this.generateWeekFromWizard(ctx);
          break;
      }
      return;
    }

    // ==========================================
    // МЕСЯЦ
    // ==========================================
    if (w.type === 'month') {
      switch (w.step) {
        case 1: // Название месяца (текстом)
          w.data.monthName = text;
          w.step = 2;
          await ctx.reply(
            `📅 Месяц: *${text}*\n\n` +
              '🎯 *Шаг 2/5 — Главная цель месяца*\n\n' +
              'Один ключевой результат:',
            { parse_mode: 'Markdown' },
          );
          break;

        case 2: // Главная цель
          w.data.mainGoal = text;
          w.step = 3;
          await ctx.reply(
            `🎯 Цель: *${text}*\n\n` +
              '💼 *Шаг 3/5 — Юридические дела и задачи*\n\n' +
              'Какие дела и задачи по работе на этот месяц?\n' +
              'Суды, кассации, новые клиенты, дедлайны.\n\n' +
              '_Каждая с новой строки:_',
            { parse_mode: 'Markdown' },
          );
          break;

        case 3: // Рабочие задачи
          w.data.workTasks = text.split('\n').map((s) => s.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
          w.step = 4;
          await ctx.reply(
            `✅ Записал ${w.data.workTasks.length} задач по работе.\n\n` +
              '🤖📈💪🧠 *Шаг 4/5 — Другие направления*\n\n' +
              'Что ещё планируешь в этом месяце?\n' +
              'IT-проекты, маркетинг, курсы, тренировки, личное.\n\n' +
              '_Или "Пропустить"_',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('⏭ Пропустить', 'skip_step')],
              ]),
            },
          );
          break;

        case 4: // Другие направления
          if (text) {
            w.data.otherTasks = text.split('\n').map((s) => s.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
          }
          w.step = 5;
          await ctx.reply(
            '⚠️ *Шаг 5/5 — Риски и что может помешать*\n\n' +
              '_Примеры:_\n' +
              '• Загрузка по срочным делам\n' +
              '• Выгорание от попытки делать всё\n\n' +
              '_Или "Сгенерировать план"_',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('⏭ Сгенерировать план', 'skip_step')],
              ]),
            },
          );
          break;

        case 5: // Риски → Генерация
          if (text) {
            w.data.risks = text.split('\n').map((s) => s.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
          }
          await this.generateMonthFromWizard(ctx);
          break;
      }
      return;
    }
  }

  // -------------------------------------------------------
  // Wizard: Тренировка (callback для дня)
  // -------------------------------------------------------

  private setupDayTrainCallback() {
    // Уже обрабатывается в setupCallbacks через общий action handler
  }

  // -------------------------------------------------------
  // Генерация из wizard-данных
  // -------------------------------------------------------

  private async generateDayFromWizard(ctx: Context, training?: string) {
    const w = this.wizard.data;

    const quickNotes: string[] = [
      ...(w.mainTasks || []),
      ...(w.extraNotes || []),
    ];

    if (training && training !== 'нет') {
      quickNotes.push(`Тренировка: ${training}`);
    }

    await ctx.reply('🔄 Генерирую план дня на основе твоих ответов...');
    this.resetWizard();

    try {
      this.currentPlan = await this.plannerService.generateDailyPlan({
        quickNotes,
        energyLevel: w.energyLevel,
        place: w.place,
      });
      await this.sendDailyPlan(ctx);
    } catch (error) {
      this.logger.error('Day plan generation failed', error);
      await ctx.reply('❌ Ошибка генерации. Попробуй /plan заново.');
    }
  }

  private async generateWeekFromWizard(ctx: Context) {
    const w = this.wizard.data;

    const allNotes: string[] = [
      ...(w.workTasks || []),
      ...(w.otherTasks || []),
      ...(w.risks || []).map((r: string) => `Риск: ${r}`),
    ];

    await ctx.reply('🔄 Генерирую план недели...');
    this.resetWizard();

    try {
      const plan = await this.plannerService.generateWeeklyPlan({
        mainFocus: w.mainFocus,
        quickNotes: allNotes,
      });
      await this.planStore.saveWeekPlan(plan);
      await this.sendWeeklyPlan(ctx, plan);
    } catch (error) {
      this.logger.error('Week plan generation failed', error);
      await ctx.reply('❌ Ошибка генерации. Попробуй /week заново.');
    }
  }

  private async generateMonthFromWizard(ctx: Context) {
    const w = this.wizard.data;

    const allNotes = [
      ...(w.workTasks || []),
      ...(w.otherTasks || []),
      ...(w.risks || []).map((r: string) => `Риск: ${r}`),
    ];

    // Добавляем заметки в context через quickNotes
    await ctx.reply(`🔄 Генерирую план на *${w.monthName}*...`, { parse_mode: 'Markdown' });
    this.resetWizard();

    try {
      const plan = await this.plannerService.generateMonthlyPlan({
        monthName: w.monthName,
        mainGoal: `${w.mainGoal}. Задачи: ${allNotes.join('; ')}`,
      });
      await this.sendMonthlyPlan(ctx, plan, w.monthName);
    } catch (error) {
      this.logger.error('Month plan generation failed', error);
      await ctx.reply('❌ Ошибка генерации. Попробуй /month заново.');
    }
  }

  private resetWizard() {
    this.wizard = { type: null, step: 0, data: {} };
  }

  // -------------------------------------------------------
  // Генерация и отправка плана
  // -------------------------------------------------------

  async generateAndSendPlan(ctx: Context, options?: {
    quickNotes?: string[];
    energyLevel?: number;
  }) {
    await ctx.reply('🔄 Генерирую план дня...');
    try {
      this.currentPlan = await this.plannerService.generateDailyPlan({
        quickNotes: options?.quickNotes,
        energyLevel: options?.energyLevel,
      });
      await this.sendDailyPlan(ctx);
    } catch (error) {
      this.logger.error('Plan generation failed', error);
      await ctx.reply('❌ Ошибка генерации плана.');
    }
  }

  async sendMorningPlan() {
    try {
      this.currentPlan = await this.plannerService.generateDailyPlan();
      const message = this.formatDailyPlan(this.currentPlan);
      const keyboard = this.getPlanKeyboard(this.currentPlan);
      await this.bot.telegram.sendMessage(this.allowedUserId, message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(keyboard),
      });
      this.logger.log('Morning plan sent');
    } catch (error) {
      this.logger.error('Morning plan failed', error);
      await this.bot.telegram.sendMessage(
        this.allowedUserId,
        '❌ Не удалось сгенерировать утренний план. Используй /plan.',
      );
    }
  }

  async sendEveningReview() {
    if (!this.currentPlan) return;
    try {
      const review = await this.plannerService.generateDayReview(this.currentPlan);
      const message =
        `🌙 *Итоги дня*\n\n` +
        `🔥 *Главная победа:* ${review.mainWin}\n\n` +
        `📊 Выполнено: ${review.completedCount}/${review.totalCount}\n` +
        (review.deferred.length > 0 ? `➡️ Перенесено: ${review.deferred.join(', ')}\n` : '') +
        `\n💬 ${review.comment}\n\n` +
        `📋 *На завтра:*\n` +
        review.suggestionsForTomorrow.map((s) => `• ${s}`).join('\n');
      await this.bot.telegram.sendMessage(this.allowedUserId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      this.logger.error('Evening review failed', error);
    }
  }

  /**
   * Воскресное сообщение — итоги недели + задача дня
   */
  async sendSundayMessage() {
    try {
      const weekPlan = await this.planStore.getWeekPlan();
      const today = new Date().toISOString().split('T')[0];

      const lines: string[] = [];
      lines.push('☀️ *Доброе утро! Сегодня воскресенье.*\n');

      // Контрольная точка на воскресенье
      if (weekPlan?.checkpoints?.['Вс']) {
        lines.push(`📋 *На сегодня:* ${weekPlan.checkpoints['Вс']}\n`);
      } else {
        lines.push('📋 *На сегодня:* Подведение итогов недели и отдых.\n');
      }

      // Итоги недели
      if (weekPlan) {
        const startDate = weekPlan.date;
        const endDate = weekPlan.dateEnd || today;
        const dayPlans = await this.planStore.getDayPlans(startDate, endDate);

        const allTasks = dayPlans.flatMap((p) => p.tasks || []);
        const done = allTasks.filter((t) => t.status === 'done');
        const deferred = allTasks.filter((t) => t.status === 'deferred');
        const pct = allTasks.length > 0 ? Math.round((done.length / allTasks.length) * 100) : 0;

        const allPayments = dayPlans.flatMap((p) => p.payments || []);
        const payTotal = allPayments.filter((p) => p.received).reduce((s, p) => s + p.amount, 0);

        lines.push(`📊 *Итоги недели:*`);
        lines.push(`${this.progressBar(pct)} *${pct}%* (${done.length}/${allTasks.length})`);
        if (payTotal > 0) lines.push(`💰 Оплаты: ${(payTotal / 1000).toFixed(0)}K тенге`);
        lines.push('');

        if (done.length > 0) {
          lines.push('✅ *Сделано:*');
          for (const t of done.slice(0, 8)) {
            lines.push(`• ${t.title}`);
          }
          if (done.length > 8) lines.push(`_...и ещё ${done.length - 8}_`);
          lines.push('');
        }

        if (deferred.length > 0) {
          lines.push('➡️ *Перенесено (взять на след. неделю):*');
          const unique = [...new Set(deferred.map((t) => t.title))];
          for (const title of unique.slice(0, 5)) {
            lines.push(`• ${title}`);
          }
          lines.push('');
        }

        lines.push('🎯 *Вопросы для размышления:*');
        lines.push('1) Что было главной победой?');
        lines.push('2) Что мешало больше всего?');
        lines.push('3) Три приоритета на следующую неделю?\n');
        lines.push('Используй /weekresults для полного обзора.');
        lines.push('Используй /week чтобы составить план на новую неделю.');
      }

      await this.bot.telegram.sendMessage(this.allowedUserId, lines.join('\n'), {
        parse_mode: 'Markdown',
      });
      this.logger.log('Sunday message sent');
    } catch (error) {
      this.logger.error('Sunday message failed', error);
    }
  }

  // -------------------------------------------------------
  // Форматирование
  // -------------------------------------------------------

  private async sendDailyPlan(ctx: Context) {
    if (!this.currentPlan) return;
    const message = this.formatDailyPlan(this.currentPlan);
    const keyboard = this.getPlanKeyboard(this.currentPlan);
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(keyboard),
    });
  }

  private formatDailyPlan(plan: DailyPlanOutput): string {
    const lines: string[] = [];
    lines.push(`🗓 *План на ${plan.date}*\n`);
    lines.push(`🎯 *Фокус:* ${plan.focusOfDay}\n`);

    if (plan.intentions) {
      lines.push('*Намерения:*');
      lines.push(`1️⃣ ${plan.intentions.main}`);
      if (plan.intentions.secondary) lines.push(`2️⃣ ${plan.intentions.secondary}`);
      if (plan.intentions.recovery) lines.push(`3️⃣ ${plan.intentions.recovery}`);
      lines.push('');
    }

    if (plan.timeBlocks && plan.timeBlocks.length > 0) {
      lines.push('*Расписание:*');
      for (const block of plan.timeBlocks) {
        const emoji = CATEGORY_EMOJI[block.category] || '📌';
        lines.push(`\`${block.startTime}–${block.endTime}\` ${emoji} ${block.label}`);
      }
      lines.push('');
    }

    lines.push('*Задачи:*');
    for (const task of plan.tasks) {
      const status = STATUS_EMOJI[task.status] || '⬜';
      const priority = PRIORITY_EMOJI[task.priority] || '';
      const time = task.suggestedTime ? ` \`${task.suggestedTime}\`` : '';
      lines.push(`${status} ${priority} ${task.title}${time}`);
    }

    if (plan.risks && plan.risks.length > 0) {
      lines.push('\n⚠️ *Риски:*');
      for (const risk of plan.risks) {
        lines.push(`• ${risk.risk}\n  → ${risk.mitigation}`);
      }
    }

    return lines.join('\n');
  }

  private getPlanKeyboard(plan: DailyPlanOutput): InlineKeyboardButton[][] {
    const rows: InlineKeyboardButton[][] = [];
    const activeTasks = plan.tasks.filter(
      (t) => t.status === TaskStatus.PENDING || t.status === TaskStatus.IN_PROGRESS,
    );

    for (const task of activeTasks.slice(0, 8)) {
      const shortTitle = task.title.length > 25 ? task.title.slice(0, 22) + '...' : task.title;
      rows.push([
        Markup.button.callback(`✅ ${shortTitle}`, `done:${task.id}`),
        Markup.button.callback('➡️', `defer:${task.id}`),
        Markup.button.callback('📋', `detail:${task.id}`),
      ]);
    }

    rows.push([
      Markup.button.callback('📊 Прогресс', 'show_progress'),
      Markup.button.callback('🔄 Перепланировать', 'replan_day'),
    ]);

    return rows;
  }

  private formatTaskDetail(task: TaskItem): string {
    const lines: string[] = [];
    const catEmoji = CATEGORY_EMOJI[task.category] || '📌';
    const prioEmoji = PRIORITY_EMOJI[task.priority] || '';
    const statusEmoji = STATUS_EMOJI[task.status] || '';

    lines.push(`${catEmoji} *${task.title}*\n`);
    if (task.description) lines.push(`${task.description}\n`);
    lines.push(`Статус: ${statusEmoji} ${task.status}`);
    lines.push(`Приоритет: ${prioEmoji} ${task.priority}`);
    lines.push(`Категория: ${task.category}`);
    if (task.estimatedMinutes) lines.push(`⏱ ${task.estimatedMinutes} мин`);
    if (task.suggestedTime) lines.push(`🕐 ${task.suggestedTime}`);
    if (task.linkedCaseId) lines.push(`📁 Дело: ${task.linkedCaseId}`);
    return lines.join('\n');
  }

  private getTaskActions(task: TaskItem): InlineKeyboardButton[][] {
    const rows: InlineKeyboardButton[][] = [];
    if (task.status !== TaskStatus.DONE) {
      rows.push([
        Markup.button.callback('✅ Выполнено', `done:${task.id}`),
        Markup.button.callback('🔵 В работе', `progress:${task.id}`),
      ]);
    }
    rows.push([
      Markup.button.callback('➡️ Перенести', `defer:${task.id}`),
      Markup.button.callback('❌ Отменить', `cancel:${task.id}`),
    ]);
    return rows;
  }

  // -------------------------------------------------------
  // Прогресс
  // -------------------------------------------------------

  private async sendPlanStatus(ctx: Context) {
    if (!this.currentPlan) return;
    const tasks = this.currentPlan.tasks;
    const done = tasks.filter((t) => t.status === TaskStatus.DONE).length;
    const inProgress = tasks.filter((t) => t.status === TaskStatus.IN_PROGRESS).length;
    const pending = tasks.filter((t) => t.status === TaskStatus.PENDING).length;
    const deferred = tasks.filter((t) => t.status === TaskStatus.DEFERRED).length;
    const total = tasks.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    const lines: string[] = [];
    lines.push(`📊 *Прогресс дня*\n`);
    lines.push(`${this.progressBar(pct)} ${pct}%\n`);
    lines.push(`✅ Выполнено: ${done}`);
    lines.push(`🔵 В работе: ${inProgress}`);
    lines.push(`⬜ Ожидает: ${pending}`);
    if (deferred > 0) lines.push(`➡️ Перенесено: ${deferred}`);
    lines.push(`\n📋 Всего: ${total}`);

    const remaining = tasks.filter(
      (t) => t.status === TaskStatus.PENDING || t.status === TaskStatus.IN_PROGRESS,
    );
    if (remaining.length > 0) {
      lines.push('\n*Осталось:*');
      for (const t of remaining) {
        lines.push(`${STATUS_EMOJI[t.status]} ${t.title}`);
      }
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  }

  private progressBar(pct: number): string {
    const filled = Math.round(pct / 10);
    return '▓'.repeat(filled) + '░'.repeat(10 - filled);
  }

  // -------------------------------------------------------
  // Перепланирование
  // -------------------------------------------------------

  private async replanDay(ctx: Context, reason: string) {
    if (!this.currentPlan) {
      await ctx.reply('Нет текущего плана. Сначала /plan');
      return;
    }
    await ctx.reply(`🔄 Перепланирую...\n_Причина: ${reason}_`, { parse_mode: 'Markdown' });
    try {
      this.currentPlan = await this.plannerService.replan(this.currentPlan, reason);
      await this.sendDailyPlan(ctx);
    } catch (error) {
      this.logger.error('Replan failed', error);
      await ctx.reply('❌ Ошибка перепланирования.');
    }
  }

  // -------------------------------------------------------
  // Добавление задачи текстом
  // -------------------------------------------------------

  private async addTaskFromText(ctx: Context, text: string) {
    if (!this.currentPlan) {
      // Сохраняем как задачу на сегодня в БД
      const today = new Date().toISOString().split('T')[0];
      const plan = await this.planStore.getOrCreateDayPlan(today);
      const category = this.detectCategory(text);
      const saved = await this.planStore.addTaskToPlan(plan.id, {
        title: text,
        category,
        priority: 'medium',
      });
      if (!saved) {
        await ctx.reply(`⚠️ Такая задача уже есть на сегодня.`);
        return;
      }
      await ctx.reply(
        `➕ Задача сохранена на *${today}*:\n${CATEGORY_EMOJI[category] || '📌'} ${text}\n\n_Используй /plan чтобы сгенерировать полный план дня._`,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const timeMatch = text.match(/(\d{1,2}[:.]\d{2})/);
    const suggestedTime = timeMatch ? timeMatch[1].replace('.', ':') : undefined;
    const category = this.detectCategory(text);

    const newTask: TaskItem = {
      id: `manual_${Date.now()}`,
      title: text.replace(/(\d{1,2}[:.]\d{2})/, '').trim(),
      category,
      priority: TaskPriority.MEDIUM,
      status: TaskStatus.PENDING,
      suggestedTime,
    };

    this.currentPlan.tasks.push(newTask);

    await ctx.reply(
      `➕ Добавлено: ${CATEGORY_EMOJI[category]} *${newTask.title}*` +
        (suggestedTime ? `\n🕐 ${suggestedTime}` : ''),
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅', `done:${newTask.id}`),
            Markup.button.callback('➡️', `defer:${newTask.id}`),
            Markup.button.callback('📋', `detail:${newTask.id}`),
          ],
        ]),
      },
    );
  }

  // -------------------------------------------------------
  // Smart Task — Claude парсит текст → задача на будущую дату
  // -------------------------------------------------------

  private isSmartTask(text: string): boolean {
    const lower = text.toLowerCase();
    const hasDateWords = /завтра|послезавтра|понедельник|вторник|сред[уа]|четверг|пятниц|суббот|воскресень|следующ|через\s+\d|на\s+недел|\d{1,2}[\/.]\d{1,2}|\d{1,2}\s*(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)/.test(lower);
    const isLongEnough = text.length > 20;
    return hasDateWords && isLongEnough;
  }

  private async handleSmartTask(ctx: Context, text: string) {
    await ctx.reply('🤖 Анализирую задачу...');

    try {
      const now = new Date();
      const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
      const currentDate = now.toISOString().split('T')[0];

      const parsed = await this.plannerService.parseSmartTask(text, currentDate, days[now.getDay()]);

      // Сохраняем в БД
      const plan = await this.planStore.getOrCreateDayPlan(parsed.scheduledDate);

      const description = [
        parsed.clientName ? `Клиент: ${parsed.clientName}` : '',
        parsed.phone ? `Тел: ${parsed.phone}` : '',
        parsed.caseContext ? `Контекст: ${parsed.caseContext}` : '',
      ].filter(Boolean).join('\n');

      const saved = await this.planStore.addTaskToPlan(plan.id, {
        title: parsed.title,
        description: description || undefined,
        category: parsed.category,
        priority: parsed.priority,
        estimatedMinutes: parsed.estimatedMinutes,
      });

      if (!saved) {
        await ctx.reply(`⚠️ Такая задача уже есть на *${parsed.scheduledDate}*: ${parsed.title}`, { parse_mode: 'Markdown' });
        return;
      }

      // Формируем подтверждение
      const lines: string[] = [];
      lines.push(`✅ *Задача запланирована на ${parsed.scheduledDate}*\n`);
      lines.push(`📋 *${parsed.title}*`);
      if (parsed.clientName) lines.push(`👤 Клиент: ${parsed.clientName}`);
      if (parsed.phone) lines.push(`📞 ${parsed.phone}`);
      if (parsed.caseContext) lines.push(`📁 ${parsed.caseContext}`);
      lines.push(`\n${PRIORITY_EMOJI[parsed.priority] || '🟡'} Приоритет: ${parsed.priority}`);
      lines.push(`${CATEGORY_EMOJI[parsed.category] || '📌'} Категория: ${parsed.category}`);
      if (parsed.estimatedMinutes) lines.push(`⏱ ~${parsed.estimatedMinutes} мин`);
      lines.push(`\n_В утреннем плане на ${parsed.scheduledDate} эта задача появится автоматически._`);

      await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
    } catch (error) {
      this.logger.error('Smart task parsing failed', error);
      // Fallback — добавляем как обычную задачу на сегодня
      await ctx.reply('⚠️ Не удалось распарсить. Добавляю как обычную задачу на сегодня.');
      await this.addTaskFromText(ctx, text);
    }
  }

  private detectCategory(text: string): TaskCategory {
    const lower = text.toLowerCase();
    if (/суд|дело|клиент|иск|жалоб|отзыв|кассац|банкротств|консультац/.test(lower)) return TaskCategory.WORK;
    if (/код|бот|crm|кабинет|сервер|баг/.test(lower)) return TaskCategory.TECH;
    if (/реклам|таргет|рилс|контент|youtube|съёмк|сторис|курс/.test(lower)) return TaskCategory.MARKETING;
    if (/трениров|бассейн|зал|бег|плаван/.test(lower)) return TaskCategory.HEALTH;
    return TaskCategory.PERSONAL;
  }

  // -------------------------------------------------------
  // Итоги дня
  // -------------------------------------------------------

  private async sendDayReview(ctx: Context) {
    if (!this.currentPlan) return;
    await ctx.reply('🔄 Подвожу итоги...');
    try {
      const review = await this.plannerService.generateDayReview(this.currentPlan);
      const message =
        `🌙 *Итоги дня*\n\n` +
        `🔥 *Главная победа:* ${review.mainWin}\n\n` +
        `📊 Выполнено: ${review.completedCount}/${review.totalCount}\n` +
        (review.deferred.length > 0 ? `➡️ Перенесено: ${review.deferred.join(', ')}\n` : '') +
        `\n💬 _${review.comment}_\n\n` +
        `📋 *Рекомендации на завтра:*\n` +
        review.suggestionsForTomorrow.map((s) => `• ${s}`).join('\n');
      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
      this.logger.error('Day review failed', error);
      await ctx.reply('❌ Ошибка при подведении итогов.');
    }
  }

  // -------------------------------------------------------
  // Обновление статусов
  // -------------------------------------------------------

  private updateTaskStatus(taskId: string, status: TaskStatus) {
    if (!this.currentPlan) return;
    const task = this.currentPlan.tasks.find((t) => t.id === taskId);
    if (task) task.status = status;
  }

  private async refreshPlanMessage(ctx: Context) {
    if (!this.currentPlan) return;
    const tasks = this.currentPlan.tasks;
    const done = tasks.filter((t) => t.status === TaskStatus.DONE).length;
    const total = tasks.length;
    const pct = Math.round((done / total) * 100);
    await ctx.reply(`${this.progressBar(pct)} ${pct}% (${done}/${total})`);
  }

  // -------------------------------------------------------
  // Отправка плана недели
  // -------------------------------------------------------

  private async sendWeeklyPlan(ctx: Context, plan: any) {
    const lines: string[] = [];
    lines.push(`📅 *План недели*\n`);
    lines.push(`🎯 *Фокус:* ${plan.mainFocus || plan.weekFocus || '—'}\n`);

    if (plan.strategicIntentions && Array.isArray(plan.strategicIntentions)) {
      lines.push('*Стратегические намерения:*');
      plan.strategicIntentions.forEach((s: string, i: number) => lines.push(`${i + 1}) ${s}`));
      lines.push('');
    }

    const checkpoints = plan.checkpoints || plan.dailyPlans || plan.days;
    if (checkpoints) {
      lines.push('*По дням:*');
      if (typeof checkpoints === 'object' && !Array.isArray(checkpoints)) {
        for (const [day, val] of Object.entries(checkpoints)) {
          if (typeof val === 'string') {
            lines.push(`*${day}* — ${val}`);
          } else {
            const v = val as any;
            const focus = v.focus || v.focusOfDay || '';
            lines.push(`*${day}* — ${focus}`);
            if (Array.isArray(v.tasks)) {
              for (const t of v.tasks.slice(0, 3)) {
                const title = typeof t === 'string' ? t : t.title || '';
                lines.push(`  • ${title}`);
              }
            }
          }
        }
      } else if (Array.isArray(checkpoints)) {
        for (const cp of checkpoints) {
          const label = cp.day || cp.date || cp.label || '';
          const focus = cp.focus || cp.focusOfDay || '';
          lines.push(`*${label}* — ${focus}`);
        }
      }
    }

    if (plan.risks && Array.isArray(plan.risks)) {
      lines.push('\n⚠️ *Риски:*');
      for (const r of plan.risks) {
        const text = typeof r === 'string' ? r : r.risk || '';
        const mit = typeof r === 'string' ? '' : r.mitigation || '';
        lines.push(`• ${text}${mit ? `\n  → ${mit}` : ''}`);
      }
    }

    await this.sendLongMessage(ctx, lines.join('\n'));
  }

  // -------------------------------------------------------
  // Отправка плана месяца
  // -------------------------------------------------------

  private async sendMonthlyPlan(ctx: Context, plan: any, fallbackName?: string) {
    const lines: string[] = [];
    const name = plan.monthName || fallbackName || 'Текущий месяц';
    const goal = plan.mainGoal || plan.mainFocus || plan.goal || '—';

    lines.push(`📆 *План месяца — ${name}*\n`);
    lines.push(`🎯 *Главная цель:* ${goal}\n`);

    // Направления
    const directions = plan.directions || plan.tasksByCategory || plan.categories;
    if (directions && typeof directions === 'object') {
      const catLabels: Record<string, string> = {
        work: '💼 Работа / Prime Legal',
        tech: '🤖 Проекты / Автоматизация',
        marketing: '📈 Маркетинг / Продукты',
        health: '💪 Здоровье / Режим',
        personal: '🧠 Личное / Развитие',
      };

      for (const [cat, tasks] of Object.entries(directions)) {
        const label = catLabels[cat] || cat;
        const taskList = Array.isArray(tasks) ? tasks : [];
        if (taskList.length > 0) {
          lines.push(`\n*${label}*`);
          for (const task of taskList) {
            const s = typeof task === 'string' ? task : (task as any).title || JSON.stringify(task);
            lines.push(`• ${s}`);
          }
        }
      }
      lines.push('');
    }

    // Контрольные точки
    const checkpoints = plan.weeklyCheckpoints || plan.checkpoints || plan.weeks;
    if (checkpoints) {
      lines.push('📋 *Контрольные точки по неделям:*');
      if (Array.isArray(checkpoints)) {
        for (const cp of checkpoints) {
          const weekLabel = cp.week || cp.name || cp.label || 'Неделя';
          const focus = cp.focus || cp.mainFocus || cp.goal || '';
          lines.push(`\n*${weekLabel}*${focus ? ` — ${focus}` : ''}`);
          const tasks = cp.tasks || cp.items;
          if (Array.isArray(tasks)) {
            for (const t of tasks) {
              const s = typeof t === 'string' ? t : (t as any).title || JSON.stringify(t);
              lines.push(`  • ${s}`);
            }
          }
        }
      } else if (typeof checkpoints === 'object') {
        for (const [week, value] of Object.entries(checkpoints)) {
          if (typeof value === 'string') {
            lines.push(`*${week}* — ${value}`);
          } else if (typeof value === 'object' && value !== null) {
            const v = value as any;
            const focus = v.focus || v.mainFocus || v.goal || '';
            lines.push(`\n*${week}*${focus ? ` — ${focus}` : ''}`);
            const tasks = v.tasks || v.items;
            if (Array.isArray(tasks)) {
              for (const t of tasks) {
                const s = typeof t === 'string' ? t : t.title || JSON.stringify(t);
                lines.push(`  • ${s}`);
              }
            }
          }
        }
      }
      lines.push('');
    }

    // Риски
    if (plan.risks && Array.isArray(plan.risks) && plan.risks.length > 0) {
      lines.push('⚠️ *Риски:*');
      for (const risk of plan.risks) {
        const text = typeof risk === 'string' ? risk : risk.risk || risk.description || '';
        const mit = typeof risk === 'string' ? '' : risk.mitigation || risk.plan || '';
        lines.push(`• ${text}${mit ? `\n  → ${mit}` : ''}`);
      }
      lines.push('');
    }

    // Метрики
    const metrics = plan.metrics || plan.kpis;
    if (metrics && typeof metrics === 'object') {
      lines.push('📊 *Метрики:*');
      if (metrics.focusHours) lines.push(`• Часы фокуса: ${metrics.focusHours}`);
      if (metrics.trainings) lines.push(`• Тренировки: ${metrics.trainings}`);
      if (metrics.clientCases) lines.push(`• Клиентские дела: ${metrics.clientCases}`);
      if (metrics.contentPosts) lines.push(`• Контент/посты: ${metrics.contentPosts}`);
      if (metrics.mood) lines.push(`• Настроение: ${metrics.mood}/10`);
    }

    await this.sendLongMessage(ctx, lines.join('\n'));
  }

  // -------------------------------------------------------
  // Утилиты
  // -------------------------------------------------------

  // -------------------------------------------------------
  // Итоги дня / недели / месяца
  // -------------------------------------------------------

  private async sendDayResults(ctx: Context, plan: PlanEntity) {
    const tasks = plan.tasks || [];
    const done = tasks.filter((t) => t.status === 'done');
    const deferred = tasks.filter((t) => t.status === 'deferred');
    const cancelled = tasks.filter((t) => t.status === 'cancelled');
    const pending = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');
    const pct = tasks.length > 0 ? Math.round((done.length / tasks.length) * 100) : 0;

    const payments = plan.payments || [];
    const payReceived = payments.filter((p) => p.received);
    const payTotal = payReceived.reduce((s, p) => s + p.amount, 0);

    const lines: string[] = [];
    lines.push(`🌙 *Итоги дня — ${plan.date}*\n`);
    lines.push(`🎯 *Фокус:* ${plan.focusTitle}\n`);
    lines.push(`${this.progressBar(pct)} *${pct}%* (${done.length}/${tasks.length})\n`);

    if (done.length > 0) {
      lines.push('✅ *Выполнено:*');
      done.forEach((t) => lines.push(`• ${t.title}`));
      lines.push('');
    }

    if (deferred.length > 0) {
      lines.push('➡️ *Перенесено:*');
      deferred.forEach((t) => {
        lines.push(`• ${t.title}${t.deferredReason ? ` _(${t.deferredReason})_` : ''}`);
      });
      lines.push('');
    }

    if (pending.length > 0) {
      lines.push('⬜ *Не завершено:*');
      pending.forEach((t) => lines.push(`• ${t.title}`));
      lines.push('');
    }

    if (payReceived.length > 0) {
      lines.push(`💰 *Оплаты: ${(payTotal / 1000).toFixed(0)}K тенге*`);
      payReceived.forEach((p) =>
        lines.push(`• ${p.clientName} — ${p.description} (${(p.amount / 1000).toFixed(0)}K)`),
      );
      lines.push('');
    }

    if (plan.results) {
      if (plan.results.wins && plan.results.wins.length > 0) {
        lines.push('🔥 *Победы:*');
        plan.results.wins.forEach((w) => lines.push(`• ${w}`));
      }
      if (plan.results.mistakes && plan.results.mistakes.length > 0) {
        lines.push('\n❌ *Ошибки/уроки:*');
        plan.results.mistakes.forEach((m) => lines.push(`• ${m}`));
      }
    }

    if (plan.comment) lines.push(`\n💬 _${plan.comment}_`);

    await this.sendLongMessage(ctx, lines.join('\n'));
  }

  private async sendWeekResults(ctx: Context, weekPlan: PlanEntity, dayPlans: PlanEntity[]) {
    const lines: string[] = [];

    lines.push(`📅 *Итоги недели* (${weekPlan.date} – ${weekPlan.dateEnd || '...'})\n`);
    lines.push(`🎯 *Фокус:* ${weekPlan.focusTitle}\n`);

    // Общая статистика
    const allTasks = dayPlans.flatMap((p) => p.tasks || []);
    const allDone = allTasks.filter((t) => t.status === 'done');
    const allDeferred = allTasks.filter((t) => t.status === 'deferred');
    const pct = allTasks.length > 0 ? Math.round((allDone.length / allTasks.length) * 100) : 0;

    const allPayments = dayPlans.flatMap((p) => p.payments || []);
    const payTotal = allPayments.filter((p) => p.received).reduce((s, p) => s + p.amount, 0);

    lines.push(`${this.progressBar(pct)} *${pct}%* (${allDone.length}/${allTasks.length})\n`);
    if (payTotal > 0) lines.push(`💰 *Оплаты за неделю:* ${(payTotal / 1000).toFixed(0)}K тенге\n`);

    // По дням
    lines.push('*По дням:*');
    for (const day of dayPlans) {
      const tasks = day.tasks || [];
      const done = tasks.filter((t) => t.status === 'done').length;
      const total = tasks.length;
      const dayPct = total > 0 ? Math.round((done / total) * 100) : 0;

      const payments = day.payments || [];
      const dayPay = payments.filter((p) => p.received).reduce((s, p) => s + p.amount, 0);

      lines.push(
        `*${day.date}* ${this.progressBar(dayPct)} ${dayPct}%` +
          (dayPay > 0 ? ` 💰${(dayPay / 1000).toFixed(0)}K` : ''),
      );
      lines.push(`  _${day.focusTitle}_`);
    }
    lines.push('');

    // Задачи недели
    const weekTasks = weekPlan.tasks || [];
    if (weekTasks.length > 0) {
      const wDone = weekTasks.filter((t) => t.status === 'done');
      const wDeferred = weekTasks.filter((t) => t.status === 'deferred');
      const wPending = weekTasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');

      if (wDone.length > 0) {
        lines.push('✅ *Выполнены задачи недели:*');
        wDone.forEach((t) => lines.push(`• ${CATEGORY_EMOJI[t.category] || ''} ${t.title}`));
        lines.push('');
      }
      if (wDeferred.length > 0) {
        lines.push('➡️ *Перенесено:*');
        wDeferred.forEach((t) => lines.push(`• ${CATEGORY_EMOJI[t.category] || ''} ${t.title}`));
        lines.push('');
      }
      if (wPending.length > 0) {
        lines.push('⬜ *Не завершено:*');
        wPending.forEach((t) => lines.push(`• ${CATEGORY_EMOJI[t.category] || ''} ${t.title}`));
        lines.push('');
      }
    }

    // Итоги недели из results
    if (weekPlan.results) {
      if (weekPlan.results.wins && weekPlan.results.wins.length > 0) {
        lines.push('🔥 *Победы:*');
        weekPlan.results.wins.forEach((w) => lines.push(`• ${w}`));
      }
      if (weekPlan.results.mistakes && weekPlan.results.mistakes.length > 0) {
        lines.push('\n❌ *Ошибки:*');
        weekPlan.results.mistakes.forEach((m) => lines.push(`• ${m}`));
      }
      if (weekPlan.results.nextPriorities && weekPlan.results.nextPriorities.length > 0) {
        lines.push('\n🎯 *Приоритеты на след. неделю:*');
        weekPlan.results.nextPriorities.forEach((p) => lines.push(`• ${p}`));
      }
    }

    await this.sendLongMessage(ctx, lines.join('\n'));
  }

  private async sendMonthResults(
    ctx: Context,
    dayPlans: PlanEntity[],
    weekPlan: PlanEntity | null,
    monthPlan: PlanEntity | null,
  ) {
    const lines: string[] = [];
    const monthName = monthPlan?.focusTitle || new Date().toLocaleString('ru-RU', { month: 'long' });

    lines.push(`📆 *Итоги месяца — ${monthName}*\n`);

    // Общая статистика
    const allTasks = dayPlans.flatMap((p) => p.tasks || []);
    const allDone = allTasks.filter((t) => t.status === 'done');
    const pct = allTasks.length > 0 ? Math.round((allDone.length / allTasks.length) * 100) : 0;

    const allPayments = dayPlans.flatMap((p) => p.payments || []);
    const payTotal = allPayments.filter((p) => p.received).reduce((s, p) => s + p.amount, 0);

    lines.push(`${this.progressBar(pct)} *${pct}%* выполнение`);
    lines.push(`📋 Всего задач: ${allTasks.length} | Выполнено: ${allDone.length}`);
    lines.push(`📅 Дней с планами: ${dayPlans.length}`);
    lines.push(`💰 *Оплаты: ${(payTotal / 1000).toFixed(0)}K тенге* (${allPayments.filter((p) => p.received).length} шт)\n`);

    // По категориям
    const categories = ['work', 'tech', 'marketing', 'health', 'personal'];
    const catLabels: Record<string, string> = {
      work: '💼 Работа',
      tech: '🤖 Тех',
      marketing: '📈 Маркетинг',
      health: '💪 Здоровье',
      personal: '🧠 Личное',
    };

    lines.push('*По категориям:*');
    for (const cat of categories) {
      const catTasks = allTasks.filter((t) => t.category === cat);
      const catDone = catTasks.filter((t) => t.status === 'done').length;
      const catTotal = catTasks.length;
      if (catTotal > 0) {
        const catPct = Math.round((catDone / catTotal) * 100);
        lines.push(`${catLabels[cat]}: ${catDone}/${catTotal} (${catPct}%)`);
      }
    }
    lines.push('');

    // Топ оплат
    if (allPayments.length > 0) {
      lines.push('💰 *Детализация оплат:*');
      const sorted = [...allPayments].filter((p) => p.received).sort((a, b) => b.amount - a.amount);
      for (const p of sorted.slice(0, 10)) {
        lines.push(`• ${p.clientName} — ${p.description} (${(p.amount / 1000).toFixed(0)}K)`);
      }
      lines.push('');
    }

    // Часто переносимые
    const deferred = allTasks.filter((t) => t.status === 'deferred');
    if (deferred.length > 0) {
      lines.push('➡️ *Чаще всего переносилось:*');
      const deferCounts: Record<string, number> = {};
      for (const t of deferred) {
        deferCounts[t.title] = (deferCounts[t.title] || 0) + 1;
      }
      const sorted = Object.entries(deferCounts).sort((a, b) => b[1] - a[1]);
      for (const [title, count] of sorted.slice(0, 5)) {
        lines.push(`• ${title}${count > 1 ? ` (×${count})` : ''}`);
      }
      lines.push('');
    }

    // По дням — прогресс
    lines.push('📊 *По дням:*');
    for (const day of dayPlans) {
      const tasks = day.tasks || [];
      const done = tasks.filter((t) => t.status === 'done').length;
      const total = tasks.length;
      const dayPct = total > 0 ? Math.round((done / total) * 100) : 0;
      lines.push(`${day.date} ${this.progressBar(dayPct)} ${dayPct}%`);
    }

    await this.sendLongMessage(ctx, lines.join('\n'));
  }

  private async sendLongMessage(ctx: Context, text: string) {
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= 4000) {
        await ctx.reply(remaining, { parse_mode: 'Markdown' });
        break;
      }
      const cut = remaining.lastIndexOf('\n', 4000);
      await ctx.reply(remaining.slice(0, cut), { parse_mode: 'Markdown' });
      remaining = remaining.slice(cut);
    }
  }

  // -------------------------------------------------------
  // Отображение планов из БД
  // -------------------------------------------------------

  private async sendStoredDayPlan(ctx: Context, plan: PlanEntity) {
    const lines: string[] = [];

    lines.push(`🗓 *План на ${plan.date}*\n`);
    lines.push(`🎯 *Фокус:* ${plan.focusTitle}\n`);

    if (plan.intentions) {
      lines.push('*Намерения:*');
      if (plan.intentions.main) lines.push(`1️⃣ ${plan.intentions.main}`);
      if (plan.intentions.secondary) lines.push(`2️⃣ ${plan.intentions.secondary}`);
      if (plan.intentions.recovery) lines.push(`3️⃣ ${plan.intentions.recovery}`);
      lines.push('');
    }

    // Задачи
    if (plan.tasks && plan.tasks.length > 0) {
      lines.push('*Задачи:*');
      for (const task of plan.tasks.sort((a, b) => a.sortOrder - b.sortOrder)) {
        const status = STATUS_EMOJI[task.status] || '⬜';
        const priority = PRIORITY_EMOJI[task.priority] || '';
        const cat = CATEGORY_EMOJI[task.category] || '';
        lines.push(`${status} ${priority}${cat} ${task.title}`);
        if (task.deferredReason) lines.push(`  _→ ${task.deferredReason}_`);
      }
      lines.push('');
    }

    // Оплаты
    if (plan.payments && plan.payments.length > 0) {
      lines.push('💰 *Оплаты:*');
      let total = 0;
      for (const p of plan.payments) {
        const check = p.received ? '✅' : '⬜';
        lines.push(`${check} ${p.clientName} — ${p.description} (${(p.amount / 1000).toFixed(0)}K ${p.currency})`);
        if (p.received) total += p.amount;
      }
      lines.push(`\n*Итого:* ${(total / 1000).toFixed(0)}K тенге`);
      lines.push('');
    }

    // Итоги
    if (plan.results) {
      if (plan.results.wins && plan.results.wins.length > 0) {
        lines.push('✅ *Победы:*');
        plan.results.wins.forEach((w) => lines.push(`• ${w}`));
      }
      if (plan.results.mistakes && plan.results.mistakes.length > 0) {
        lines.push('❌ *Не выполнено:*');
        plan.results.mistakes.forEach((m) => lines.push(`• ${m}`));
      }
    }

    if (plan.comment) {
      lines.push(`\n💬 _${plan.comment}_`);
    }

    await this.sendLongMessage(ctx, lines.join('\n'));
  }

  private async sendStoredWeekPlan(ctx: Context, plan: PlanEntity) {
    const lines: string[] = [];

    lines.push(`📅 *План недели* (${plan.date} – ${plan.dateEnd || '...'})\n`);
    lines.push(`🎯 *Фокус:* ${plan.focusTitle}\n`);

    // Стратегические намерения
    if (plan.strategicIntentions && plan.strategicIntentions.length > 0) {
      lines.push('*Стратегические намерения:*');
      plan.strategicIntentions.forEach((s, i) => lines.push(`${i + 1}) ${s}`));
      lines.push('');
    }

    // Задачи по категориям
    if (plan.tasks && plan.tasks.length > 0) {
      const categories = ['work', 'tech', 'marketing', 'health', 'personal'];
      const catLabels: Record<string, string> = {
        work: '💼 Работа',
        tech: '🤖 Тех',
        marketing: '📈 Маркетинг',
        health: '💪 Здоровье',
        personal: '🧠 Личное',
      };

      for (const cat of categories) {
        const catTasks = plan.tasks.filter((t) => t.category === cat);
        if (catTasks.length > 0) {
          lines.push(`\n*${catLabels[cat]}:*`);
          for (const t of catTasks) {
            const status = STATUS_EMOJI[t.status] || '⬜';
            lines.push(`${status} ${t.title}`);
          }
        }
      }
      lines.push('');
    }

    // Контрольные точки
    if (plan.checkpoints) {
      lines.push('📋 *По дням:*');
      for (const [day, text] of Object.entries(plan.checkpoints)) {
        lines.push(`*${day}* — ${text}`);
      }
      lines.push('');
    }

    // Риски
    if (plan.risks && plan.risks.length > 0) {
      lines.push('⚠️ *Риски:*');
      for (const r of plan.risks) {
        lines.push(`• ${r.risk}\n  → ${r.mitigation}`);
      }
    }

    // Итоги
    if (plan.results) {
      lines.push('');
      if (plan.results.wins && plan.results.wins.length > 0) {
        lines.push('✅ *Победы:*');
        plan.results.wins.forEach((w) => lines.push(`• ${w}`));
      }
      if (plan.results.mistakes && plan.results.mistakes.length > 0) {
        lines.push('❌ *Ошибки:*');
        plan.results.mistakes.forEach((m) => lines.push(`• ${m}`));
      }
    }

    await this.sendLongMessage(ctx, lines.join('\n'));
  }
}

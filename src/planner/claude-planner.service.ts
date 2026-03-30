// ============================================================
// Claude Planner Service
// Интеграция с Claude API для генерации планов
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  PlannerContext,
  PlanType,
  DailyPlanOutput,
  WeeklyPlanOutput,
  MonthlyPlanOutput,
  TaskCategory,
  TaskPriority,
} from './types';
import { ContextBuilderService } from './context-builder.service';

@Injectable()
export class ClaudePlannerService {
  private readonly logger = new Logger(ClaudePlannerService.name);
  private readonly anthropic: Anthropic;

  constructor(
    private readonly configService: ConfigService,
    private readonly contextBuilder: ContextBuilderService,
  ) {
    this.anthropic = new Anthropic({
      apiKey: this.configService.get<string>('ANTHROPIC_API_KEY'),
    });
  }

  // -------------------------------------------------------
  // System Prompt — ядро интеллекта планировщика
  // -------------------------------------------------------

  private getSystemPrompt(): string {
    return `Ты — персональный AI-планировщик для адвоката Торехана Мухтарова (PrimeLegal, Алматы).

## Твоя роль
Ты генерируешь реалистичные, выполнимые планы на день/неделю/месяц на основе:
- Активных дел из CRM (судебные сроки, дедлайны, действия по делам)
- Событий из Google Calendar
- Текущих планов месяца и недели (каскадирование)
- Заметок и быстрого ввода
- Уровня энергии и статистики выполнения

## Профиль пользователя
- Адвокат АГКА с 20+ лет опыта. Специализации: банкротство, уголовная защита, гражданские споры, крипто.
- Ведёт PrimeLegal: юридическая практика + онлайн-курсы по банкротству.
- Техническая работа: CRM на NestJS, WhatsApp-бот, таргетированная реклама.
- Тренировки: бассейн (фристайл), силовая. Тренируется регулярно.
- Снимает контент: Reels, YouTube Shorts с дочкой.

## Правила генерации планов

### Приоритизация задач:
1. **CRITICAL** — судебные дедлайны, даты заседаний, процессуальные сроки (пропуск = необратимый вред клиенту)
2. **HIGH** — задачи, двигающие главный фокус недели/месяца
3. **MEDIUM** — текущая работа по делам, консультации, рутина
4. **LOW** — "по желанию", если останутся силы (контент, IT-задачи без дедлайна)

### Реалистичность:
- Консультации обычно с 12:00 до 17:00 — это занятое время
- Утро (до 12:00) — время для глубокой работы ("сначала заплати себе")
- Вечер — тренировка ИЛИ техническая работа ИЛИ отдых (не всё сразу)
- Максимум 3 основных задачи в день + 1-2 мелких
- Субботы — контент, маркетинг, стратегические вещи
- Воскресенья — подведение итогов и отдых

### Статусы задач из БД:
- **done** — выполнена. НИКОГДА не включать в новый план.
- **cancelled** — отменена. НИКОГДА не включать и не переносить. Задача больше не актуальна.
- **deferred** — перенесена. Включить в план, если передана в контексте.
- **pending** / **in_progress** — незакрыта. Включить в план.

⚠️ КРИТИЧЕСКОЕ ПРАВИЛО: Всегда сверяйся со статусами задач в контексте!
- Если задача помечена cancelled — она УДАЛЕНА из планирования, забудь о ней.
- Если задача помечена done — она ВЫПОЛНЕНА, не дублируй.
- Переносить можно ТОЛЬКО pending/in_progress/deferred задачи.

### Каскадирование:
- План дня должен вытекать из плана недели
- План недели — из плана месяца
- Если есть контрольная точка на текущий день — она приоритетна

### Тон:
- Конкретный, без воды. "Составить отзыв по делу УГД" > "Поработать над документами"
- Мотивирующий, но не пустой. Отмечай победы, но не раздувай.
- Если энергия < 5 — план легче: меньше задач, больше восстановления.
- Если часто переносятся IT-задачи — ставь таймер и жёсткий стоп.

## Формат ответа
Отвечай СТРОГО в JSON формате без markdown-обёртки. Структура зависит от типа плана.

### Для плана дня (DailyPlanOutput):
{
  "date": "2026-03-29",
  "focusOfDay": "Один чёткий фокус",
  "intentions": {
    "main": "Главная задача",
    "secondary": "По желанию",
    "recovery": "Восстановление"
  },
  "tasks": [
    {
      "id": "t1",
      "title": "Конкретная задача",
      "description": "Детали при необходимости",
      "category": "work|tech|marketing|health|personal",
      "priority": "critical|high|medium|low",
      "status": "pending",
      "estimatedMinutes": 60,
      "suggestedTime": "09:00-10:00",
      "linkedCaseId": "id_дела_если_есть"
    }
  ],
  "timeBlocks": [
    {
      "startTime": "09:00",
      "endTime": "10:00",
      "label": "Глубокая работа",
      "category": "work",
      "taskIds": ["t1"]
    }
  ],
  "risks": [
    {
      "risk": "Описание риска",
      "mitigation": "План обхода"
    }
  ]
}`;
  }

  // -------------------------------------------------------
  // Генерация планов
  // -------------------------------------------------------

  async generateDailyPlan(options?: {
    quickNotes?: string[];
    energyLevel?: number;
    place?: string;
  }): Promise<DailyPlanOutput> {
    const context = await this.contextBuilder.buildContext(PlanType.DAY, options);
    const serialized = this.contextBuilder.serializeContext(context);

    const userPrompt = `Сгенерируй план дня на основе следующего контекста:

${serialized}

Верни JSON объект DailyPlanOutput. Учитывай все активные дела, дедлайны, календарь и фокус недели/месяца.
Расставь задачи по временным блокам реалистично. Не забудь про тренировку если это подходящий день.`;

    return this.callClaude<DailyPlanOutput>(userPrompt);
  }

  async generateWeeklyPlan(options?: {
    mainFocus?: string;
    quickNotes?: string[];
  }): Promise<WeeklyPlanOutput> {
    const context = await this.contextBuilder.buildContext(PlanType.WEEK, {
      quickNotes: options?.quickNotes,
    });
    const serialized = this.contextBuilder.serializeContext(context);

    const userPrompt = `Сгенерируй план недели на основе контекста:

${serialized}

${options?.mainFocus ? `Главный фокус недели: ${options.mainFocus}` : ''}

Верни СТРОГО JSON в таком формате:
{
  "mainFocus": "Главный фокус недели одной фразой",
  "strategicIntentions": ["намерение 1", "намерение 2", "намерение 3"],
  "checkpoints": {
    "Пн": {"focus": "Фокус понедельника", "tasks": ["задача 1", "задача 2"]},
    "Вт": {"focus": "Фокус вторника", "tasks": ["задача 1"]},
    "Ср": {"focus": "Фокус среды", "tasks": ["задача 1"]},
    "Чт": {"focus": "Фокус четверга", "tasks": ["задача 1"]},
    "Пт": {"focus": "Фокус пятницы", "tasks": ["задача 1"]},
    "Сб": {"focus": "Фокус субботы", "tasks": ["задача 1"]},
    "Вс": {"focus": "Подведение итогов и отдых", "tasks": []}
  },
  "risks": [
    {"risk": "описание риска", "mitigation": "план обхода"}
  ]
}

КРИТИЧЕСКИЕ ПРАВИЛА:
1. Ключи дней ТОЛЬКО на русском: Пн, Вт, Ср, Чт, Пт, Сб, Вс
2. Каждый день содержит focus (текст) и tasks (массив строк)
3. ЗАПЛАНИРОВАННЫЕ ЗАДАЧИ ИЗ БД — ставить СТРОГО на тот день, на который они запланированы! НЕ переносить на другие дни! Если задача в БД на понедельник — она ДОЛЖНА быть в "Пн"
4. Задачи пользователя из quickNotes добавлять в подходящие дни по контексту`;

    return this.callClaude<WeeklyPlanOutput>(userPrompt);
  }

  async generateMonthlyPlan(options?: {
    monthName: string;
    mainGoal?: string;
  }): Promise<MonthlyPlanOutput> {
    const context = await this.contextBuilder.buildContext(PlanType.MONTH);
    const serialized = this.contextBuilder.serializeContext(context);

    const userPrompt = `Сгенерируй план месяца (${options?.monthName || 'следующий месяц'}).

Контекст:
${serialized}

${options?.mainGoal ? `Главная цель: ${options.mainGoal}` : ''}

Верни JSON объект MonthlyPlanOutput с:
- Главной целью месяца
- Направлениями по категориям
- Контрольными точками по неделям
- Рисками
- Метриками для отслеживания`;

    return this.callClaude<MonthlyPlanOutput>(userPrompt);
  }

  // -------------------------------------------------------
  // Перепланирование (если день пошёл не так)
  // -------------------------------------------------------

  async replan(
    currentPlan: DailyPlanOutput,
    reason: string,
  ): Promise<DailyPlanOutput> {
    const completedIds = currentPlan.tasks
      .filter((t) => t.status === 'done')
      .map((t) => t.id);

    const userPrompt = `Текущий план дня нужно перепланировать.

Причина: ${reason}

Текущий план (JSON):
${JSON.stringify(currentPlan, null, 2)}

Выполненные задачи: ${completedIds.join(', ') || 'пока ничего'}

Перераспредели оставшиеся задачи на оставшееся время дня.
Если что-то не влезает — пометь как deferred с пояснением.
Верни обновленный DailyPlanOutput JSON.`;

    return this.callClaude<DailyPlanOutput>(userPrompt);
  }

  // -------------------------------------------------------
  // Подведение итогов
  // -------------------------------------------------------

  async generateDayReview(plan: DailyPlanOutput): Promise<{
    mainWin: string;
    completedCount: number;
    totalCount: number;
    deferred: string[];
    comment: string;
    suggestionsForTomorrow: string[];
  }> {
    const userPrompt = `Подведи итоги дня на основе плана:

${JSON.stringify(plan, null, 2)}

Верни JSON:
{
  "mainWin": "Главная победа дня",
  "completedCount": число_выполненных,
  "totalCount": всего_задач,
  "deferred": ["что перенесено"],
  "comment": "Короткий мотивирующий комментарий",
  "suggestionsForTomorrow": ["рекомендации на завтра"]
}`;

    return this.callClaude(userPrompt);
  }

  // -------------------------------------------------------
  // AI-агент обновления итогов недели/дня/месяца
  // -------------------------------------------------------

  async analyzeWeekUpdate(
    userText: string,
    weekPlan: any,
    dayPlans: any[],
  ): Promise<{
    addWins: string[];
    removeWins: string[];
    addMistakes: string[];
    removeMistakes: string[];
    addNextPriorities: string[];
    taskUpdates: Array<{ taskId: string; newStatus: string }>;
    comment?: string;
  }> {
    const tasksContext = dayPlans.flatMap((dp) =>
      (dp.tasks || []).map((t) => ({
        id: t.id,
        date: dp.date,
        title: t.title,
        status: t.status,
        category: t.category,
      })),
    );

    const currentResults = weekPlan.results || { wins: [], mistakes: [], nextPriorities: [] };

    const prompt = `Ты — AI-агент планировщика. Пользователь написал свободный текст об итогах недели.
Твоя задача — определить, что нужно обновить в плане недели.

## Текущий план недели
Фокус: ${weekPlan.focusTitle}
Период: ${weekPlan.date} – ${weekPlan.dateEnd}

## Текущие итоги (results)
Победы: ${JSON.stringify(currentResults.wins || [])}
Ошибки: ${JSON.stringify(currentResults.mistakes || [])}
Приоритеты на след. неделю: ${JSON.stringify(currentResults.nextPriorities || [])}

## Задачи за неделю (все дни)
${JSON.stringify(tasksContext, null, 2)}

## Сообщение пользователя
"${userText}"

## Инструкции
Проанализируй сообщение пользователя в контексте плана недели и задач.
Определи:
1. Какие победы ДОБАВИТЬ в wins (то, чего ещё нет)
2. Какие ошибки УБРАТЬ из mistakes (если пользователь сообщает что задача выполнена, например "закончил кассацию" → убрать "Не закончил кассацию" из ошибок)
3. Какие задачи пометить как done (по taskId, если пользователь подтверждает выполнение)
4. Короткий мотивирующий комментарий

НЕ ДУБЛИРУЙ уже существующие победы.
Если пользователь пишет "кассация Темирбаева" — найди связанную задачу и обнови.

Верни СТРОГО JSON:
{
  "addWins": ["новые победы"],
  "removeWins": [],
  "addMistakes": [],
  "removeMistakes": ["ошибки для удаления, если задача выполнена"],
  "addNextPriorities": [],
  "taskUpdates": [{"taskId": "uuid задачи", "newStatus": "done"}],
  "comment": "Мотивирующий комментарий"
}`;

    return this.callClaude(prompt);
  }

  // -------------------------------------------------------
  // Умный парсинг задачи из текста
  // -------------------------------------------------------

  async parseSmartTask(rawText: string, currentDate: string, dayOfWeek: string): Promise<{
    title: string;
    scheduledDate: string;
    clientName?: string;
    phone?: string;
    caseContext?: string;
    priority: string;
    category: string;
    estimatedMinutes?: number;
  }> {
    const prompt = `Ты — парсер задач. Сегодня ${currentDate} (${dayOfWeek}).

Пользователь написал:
"${rawText}"

Извлеки структурированную задачу. Разреши относительные даты:
- "завтра" = следующий день
- "в пятницу" / "в следующую пятницу" = ближайшая пятница от сегодня
- "через неделю" = +7 дней
- Если дата не указана — поставь сегодня.

Верни СТРОГО JSON:
{
  "title": "Краткое название задачи (действие)",
  "scheduledDate": "YYYY-MM-DD",
  "clientName": "Имя клиента или null",
  "phone": "Телефон или null",
  "caseContext": "Контекст дела (кратко) или null",
  "priority": "critical|high|medium|low",
  "category": "work|tech|marketing|health|personal",
  "estimatedMinutes": число_или_null
}`;

    return this.callClaude(prompt);
  }

  // -------------------------------------------------------
  // Базовый вызов Claude API
  // -------------------------------------------------------

  private async callClaude<T>(userPrompt: string): Promise<T> {
    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: this.getSystemPrompt(),
        messages: [{ role: 'user', content: userPrompt }],
      });

      const textBlock = response.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text response from Claude');
      }

      // Парсим JSON из ответа (убираем возможные markdown-обёртки)
      const raw = textBlock.text
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      return JSON.parse(raw) as T;
    } catch (error) {
      this.logger.error('Claude API call failed', error);
      throw error;
    }
  }
}

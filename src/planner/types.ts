// ============================================================
// AI Planner — Types & Interfaces
// Структуры данных планов (день/неделя/месяц)
// ============================================================

/**
 * Получить текущую дату в Алматы (UTC+5) в формате YYYY-MM-DD
 * ВАЖНО: new Date().toISOString() возвращает UTC, что на 5 часов отстаёт.
 * В полночь по Алматы toISOString() ещё показывает вчерашнюю дату.
 */
export function todayAlmaty(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Almaty' });
}

/**
 * Форматировать любую дату в YYYY-MM-DD по таймзоне Алматы
 */
export function formatDateAlmaty(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Almaty' });
}

export enum PlanType {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

export enum TaskCategory {
  WORK = 'work',        // 💼 Работа / Prime Legal
  TECH = 'tech',        // 🤖 Бот / Тех
  MARKETING = 'marketing', // 📈 Маркетинг
  HEALTH = 'health',    // 💪 Здоровье
  PERSONAL = 'personal', // 🧠 Личное
}

export enum TaskPriority {
  CRITICAL = 'critical',  // Горит — дедлайн сегодня/завтра
  HIGH = 'high',          // Важно — двигает главный фокус
  MEDIUM = 'medium',      // Стандартная задача
  LOW = 'low',            // По желанию / если останутся силы
}

export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
  DEFERRED = 'deferred',  // Перенесено
  CANCELLED = 'cancelled',
}

// --- CRM Case (из твоей существующей БД) ---

export interface CrmCase {
  id: string;
  clientName: string;
  caseType: string;         // 'bankruptcy' | 'criminal' | 'civil' | 'admin' | 'crypto'
  status: string;
  nextDeadline?: Date;
  nextAction?: string;      // "подать кассацию", "забрать ИЛ", "составить отзыв"
  courtDate?: Date;
  notes?: string;
}

// --- Шаблон плана дня ---

export interface DailyPlanInput {
  date: string;             // ISO date
  place?: string;           // дом / офис / бассейн
  energyLevel?: number;     // 0-10
  focusOfDay: string;       // Фокус дня (1)
  intentions: {
    main: string;           // Техническое (Главное)
    secondary?: string;     // Маркетинговое (По желанию)
    recovery?: string;      // Восстановительное
  };
  risks?: Array<{
    risk: string;
    mitigation: string;
  }>;
}

export interface DailyPlanOutput extends DailyPlanInput {
  id: string;
  tasks: TaskItem[];
  timeBlocks: TimeBlock[];
  payments?: PaymentEntry[];
  completedTasks?: string[];
  comment?: string;
}

// --- Задача ---

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  estimatedMinutes?: number;
  suggestedTime?: string;    // "09:00-10:00"
  linkedCaseId?: string;     // привязка к делу из CRM
  isRecurring?: boolean;
}

// --- Временной блок ---

export interface TimeBlock {
  startTime: string;         // "09:00"
  endTime: string;           // "10:30"
  label: string;
  category: TaskCategory;
  taskIds: string[];
}

// --- Оплаты (из шаблона плана дня) ---

export interface PaymentEntry {
  clientName: string;
  description: string;
  amount: number;
  currency: string;          // "KZT"
  received: boolean;
}

// --- Шаблон плана недели ---

export interface WeeklyPlanInput {
  weekStart: string;
  weekEnd: string;
  mainFocus: string;
  strategicIntentions: string[];
  tasksByCategory: Record<TaskCategory, string[]>;
  checkpoints: Record<string, string>;   // { "Пн": "...", "Вт": "..." }
  risks?: Array<{ risk: string; mitigation: string }>;
}

export interface WeeklyPlanOutput extends WeeklyPlanInput {
  id: string;
  dailyPlans: DailyPlanOutput[];
  weekResults?: {
    wins: string[];
    mistakes: string[];
    nextWeekPriorities: string[];
  };
}

// --- Шаблон плана месяца ---

export interface MonthlyPlanInput {
  monthName: string;
  mainGoal: string;
  directions: Record<TaskCategory, string[]>;
  weeklyCheckpoints: Record<string, string>;
  risks?: Array<{ risk: string; mitigation: string }>;
}

export interface MonthlyPlanOutput extends MonthlyPlanInput {
  id: string;
  weeklyPlans: WeeklyPlanOutput[];
  metrics?: {
    focusHours: number;
    trainings: number;
    clientCases: number;
    contentPosts: number;
    mood: number;
  };
  monthResults?: {
    wins: string[];
    lessons: string[];
    nextMonthFocus: string[];
  };
}

// --- Контекст для Claude API ---

export interface PlannerContext {
  planType: PlanType;
  currentDate: string;
  dayOfWeek: string;

  // Из CRM
  activeCases: CrmCase[];
  upcomingDeadlines: CrmCase[];

  // Из Google Calendar
  calendarEvents?: Array<{
    title: string;
    start: string;
    end: string;
    location?: string;
  }>;

  // Текущие планы (для каскадирования)
  currentMonthPlan?: Partial<MonthlyPlanInput>;
  currentWeekPlan?: Partial<WeeklyPlanInput>;

  // Пользовательский ввод
  quickNotes?: string[];
  energyLevel?: number;
  place?: string;

  // Предзапланированные задачи (из smart task, только активные)
  scheduledTasks?: Array<{
    title: string;
    description?: string;
    priority: string;
    status: string;
  }>;

  // Незакрытые задачи со вчера (для переноса)
  yesterdayCarryOver?: Array<{
    title: string;
    description?: string;
    priority: string;
    status: string;
    category: string;
  }>;

  // Будущие задачи из БД (для плана недели)
  upcomingTasks?: Array<{
    date: string;
    focusTitle: string;
    tasks: Array<{
      title: string;
      description?: string;
      priority: string;
      status: string;
    }>;
  }>;

  // История (для обучения)
  recentCompletionRate?: number;   // % выполнения за последние 7 дней
  commonDeferrals?: string[];      // что часто переносится
}

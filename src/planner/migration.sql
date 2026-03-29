-- ============================================================
-- AI Planner — Database Migration
-- Запускать в PostgreSQL после создания основной БД CRM
-- ============================================================

-- Enums
CREATE TYPE plan_type AS ENUM ('day', 'week', 'month');
CREATE TYPE task_category AS ENUM ('work', 'tech', 'marketing', 'health', 'personal');
CREATE TYPE task_priority AS ENUM ('critical', 'high', 'medium', 'low');
CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'done', 'deferred', 'cancelled');

-- Планы (день / неделя / месяц)
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type plan_type NOT NULL,
  date DATE NOT NULL,
  date_end DATE,
  focus_title TEXT NOT NULL,
  intentions JSONB,
  strategic_intentions JSONB,
  checkpoints JSONB,
  risks JSONB,
  raw_claude_response JSONB,
  energy_level SMALLINT CHECK (energy_level BETWEEN 0 AND 10),
  place VARCHAR(50),
  results JSONB,
  comment TEXT,
  metrics JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_plans_type ON plans(type);
CREATE INDEX idx_plans_date ON plans(date);
CREATE INDEX idx_plans_type_date ON plans(type, date);

-- Задачи
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  category task_category NOT NULL,
  priority task_priority NOT NULL,
  status task_status NOT NULL DEFAULT 'pending',
  estimated_minutes SMALLINT,
  suggested_time VARCHAR(20),
  linked_case_id VARCHAR(100),
  is_recurring BOOLEAN DEFAULT FALSE,
  sort_order SMALLINT DEFAULT 0,
  completed_at TIMESTAMPTZ,
  deferred_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tasks_plan_id ON tasks(plan_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_category ON tasks(category);

-- Временные блоки
CREATE TABLE time_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  start_time VARCHAR(10) NOT NULL,
  end_time VARCHAR(10) NOT NULL,
  label VARCHAR(200) NOT NULL,
  category task_category NOT NULL,
  task_ids JSONB DEFAULT '[]'
);

CREATE INDEX idx_time_blocks_plan_id ON time_blocks(plan_id);

-- Оплаты (привязаны к плану дня)
CREATE TABLE plan_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  client_name VARCHAR(200) NOT NULL,
  description VARCHAR(500) NOT NULL,
  amount INTEGER NOT NULL,
  currency VARCHAR(10) DEFAULT 'KZT',
  received BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_payments_plan_id ON plan_payments(plan_id);

-- Полезные вьюхи

-- Статистика выполнения за последние 7 дней
CREATE OR REPLACE VIEW v_recent_completion AS
SELECT
  p.date,
  COUNT(t.id) AS total_tasks,
  COUNT(t.id) FILTER (WHERE t.status = 'done') AS completed_tasks,
  ROUND(
    COUNT(t.id) FILTER (WHERE t.status = 'done')::NUMERIC /
    NULLIF(COUNT(t.id), 0) * 100, 1
  ) AS completion_pct
FROM plans p
JOIN tasks t ON t.plan_id = p.id
WHERE p.type = 'day' AND p.date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY p.date
ORDER BY p.date DESC;

-- Часто переносимые задачи
CREATE OR REPLACE VIEW v_common_deferrals AS
SELECT
  t.category,
  t.title,
  COUNT(*) AS defer_count
FROM tasks t
WHERE t.status = 'deferred'
  AND t.created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY t.category, t.title
ORDER BY defer_count DESC
LIMIT 10;

-- Оплаты за текущий месяц
CREATE OR REPLACE VIEW v_monthly_payments AS
SELECT
  DATE_TRUNC('month', p.date) AS month,
  SUM(pp.amount) AS total_amount,
  SUM(pp.amount) FILTER (WHERE pp.received) AS received_amount,
  COUNT(pp.id) AS total_payments,
  COUNT(pp.id) FILTER (WHERE pp.received) AS received_payments
FROM plans p
JOIN plan_payments pp ON pp.plan_id = p.id
WHERE p.date >= DATE_TRUNC('month', CURRENT_DATE)
GROUP BY DATE_TRUNC('month', p.date);

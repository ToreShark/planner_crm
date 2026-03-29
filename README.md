# AI Planner Module — PrimeLegal CRM

Интеллектуальный планировщик на Claude API для генерации планов дня/недели/месяца.

## Архитектура

```
Источники данных → Context Builder → Claude API → PostgreSQL → Next.js Dashboard
      ↑                                                              |
      └────────────────── обратная связь ────────────────────────────┘
```

## Модули

| Файл | Назначение |
|------|-----------|
| `types.ts` | Все интерфейсы и типы (планы, задачи, контекст) |
| `entities.ts` | TypeORM сущности для PostgreSQL |
| `context-builder.service.ts` | Сбор данных из CRM, Calendar, заметок |
| `claude-planner.service.ts` | System prompt + вызовы Claude API |
| `planner.controller.ts` | REST API эндпоинты |
| `planner.module.ts` | NestJS модуль |
| `migration.sql` | SQL миграция для таблиц |

## Установка

### 1. Зависимости

```bash
npm install @anthropic-ai/sdk @nestjs/config @nestjs/typeorm typeorm pg
```

### 2. Переменные окружения

```env
# .env
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgresql://user:pass@localhost:5432/primelegal
```

### 3. Миграция БД

```bash
psql -U postgres -d primelegal -f src/planner/migration.sql
```

## API

- `POST /planner/day` — генерация плана дня
- `POST /planner/week` — генерация плана недели
- `POST /planner/replan` — перепланирование
- `POST /planner/review` — итоги дня

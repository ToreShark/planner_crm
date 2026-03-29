-- ============================================================
-- Seed: Реальные планы (неделя 22-28 марта 2026 + дни)
-- ============================================================

-- План недели
INSERT INTO plans (type, date, date_end, focus_title, intentions, strategic_intentions, checkpoints, risks, energy_level, place)
VALUES (
  'week',
  '2026-03-22',
  '2026-03-28',
  'Составить план конспект для занятий по банкротству',
  NULL,
  '["составить план конспект по банкротству и определить дни занятий", "составить новый таргет рекламы PL"]'::jsonb,
  '{"Пн": "(До 12:00) начать план-конспект и настроить зум. (12:00-17:00) Консультации. (Вечер) Ульяне подготовить жалобу. Тренировка. Съемка рилсов с дочкой.", "Вт": "(До 12:00) концентрация на адм. деле по коллекторской, Анар раздел имущества. (12:00-17:00) Консультации.", "Ср": "(До 12:00) посмотреть кассацию Темирбаева. (12:00-17:00) Консультации. (Вечер) Тренировка.", "Чт": "(Утро) выезд: забрать ИЛ Жансаи и приговор Арбузова. (12:00-17:00) Консультации. (Вечер) Съемка рилсов с дочкой. Заключить договор на внесудебное банкротство.", "Пт": "(До 12:00) Фокус на IT: развернуть базовую структуру личного кабинета. (12:00-17:00) Консультации. (Вечер) Тренировка.", "Сб": "Масштабная съемка видео для YouTube. Проанализировать креативы КИМЭП и запустить новый таргет PL на апрель.", "Вс": "Подведение итогов недели и отдых."}'::jsonb,
  '[{"risk": "Текущие дела заберут все внимание и план-конспект по банкротству опять придется переносить", "mitigation": "Работать в режиме сначала заплати себе — первые 60 минут утром строго на конспект"}, {"risk": "При развертывании личного кабинета можно залипнуть в отладке кода на весь день", "mitigation": "Жесткий таймер 2-3 часа на программирование. Если баг не решается — зафиксировать и пойти на тренировку"}]'::jsonb,
  NULL,
  'офис'
);

-- Сохраняем ID недели
DO $$
DECLARE week_id UUID;
BEGIN
  SELECT id INTO week_id FROM plans WHERE type = 'week' AND date = '2026-03-22' LIMIT 1;

  -- Задачи недели
  INSERT INTO tasks (plan_id, title, category, priority, status, sort_order) VALUES
    (week_id, 'Составить УГД отзыв', 'work', 'high', 'pending', 1),
    (week_id, 'Уголовное дело Темирбаева — кассация', 'work', 'critical', 'done', 2),
    (week_id, 'Анара — раздел имущества', 'work', 'high', 'deferred', 3),
    (week_id, 'Ульяна — снятие ареста через следственный суд', 'work', 'high', 'pending', 4),
    (week_id, 'Забрать ИЛ Жансая', 'work', 'medium', 'done', 5),
    (week_id, 'Бауыржан — раздел имущества', 'work', 'medium', 'pending', 6),
    (week_id, 'Получить копию приговора Арбузова', 'work', 'medium', 'deferred', 7),
    (week_id, 'Составить личный кабинет для занятий', 'tech', 'high', 'pending', 8),
    (week_id, 'Сохранение видео зума с последующим просмотром', 'tech', 'medium', 'pending', 9),
    (week_id, 'Новый таргет на апрель (КИМЕП и реклама)', 'marketing', 'medium', 'pending', 10),
    (week_id, 'Съемка контента (рилсы и YouTube) с дочкой', 'marketing', 'medium', 'pending', 11),
    (week_id, 'Тренировки', 'health', 'medium', 'done', 12);
END $$;

-- ============================================================
-- План дня 24/03/2026
-- ============================================================
INSERT INTO plans (type, date, focus_title, intentions, energy_level, place, results, comment)
VALUES (
  'day',
  '2026-03-24',
  'Административное дело и начало иска Анар',
  '{"main": "Сделать максимум по административному делу (коллекторская) и начать иск по разделу имущества Анар", "secondary": "Провести блок Zoom-консультаций (с 12:00 до 17:00) с фиксацией итогов в CRM"}'::jsonb,
  NULL,
  'офис',
  '{"wins": ["Консультации успешно", "Составил по адм делу жалобу по АППК"], "mistakes": ["Анар не выполнено"]}'::jsonb,
  'выполнил консультации успешно, составил по адм делу жалобу по АППК'
);

DO $$
DECLARE day_id UUID;
BEGIN
  SELECT id INTO day_id FROM plans WHERE type = 'day' AND date = '2026-03-24' LIMIT 1;

  INSERT INTO tasks (plan_id, title, category, priority, status, sort_order) VALUES
    (day_id, 'Административное дело (коллекторская) — жалоба по АППК', 'work', 'high', 'done', 1),
    (day_id, 'Иск по разделу имущества Анар', 'work', 'high', 'deferred', 2),
    (day_id, 'Zoom-консультации 12:00-17:00', 'work', 'medium', 'done', 3);

  INSERT INTO plan_payments (plan_id, client_name, description, amount, currency, received) VALUES
    (day_id, 'Дарига', 'за курс', 20000, 'KZT', true),
    (day_id, 'Гульзифа', 'за курс', 50000, 'KZT', true),
    (day_id, 'Нургуль', 'за p2p дело', 100000, 'KZT', true);
END $$;

-- ============================================================
-- План дня 25/03/2026
-- ============================================================
INSERT INTO plans (type, date, focus_title, intentions, energy_level, place, results, comment)
VALUES (
  'day',
  '2026-03-25',
  'Силовая тренировка + консультации',
  '{"main": "Качественно отработать силовую на ноги с самого утра", "secondary": "Отработать все внезапные консультации на 100%", "recovery": "Отключиться от работы. Бассейн или отдых"}'::jsonb,
  NULL,
  'офис',
  '{"wins": ["Мощная утренняя тренировка (прокачка ног)", "Проведен полный блок Zoom-консультаций", "Зафиксирована новая оплата за курс"], "mistakes": ["Не сделал иск Анары", "Не рассмотрел кассацию Темирбаева"]}'::jsonb,
  'День супер-интенсивный: начал с жесткой прокачки ног, потом весь день звонки. Отличный баланс физической и умственной нагрузки!'
);

DO $$
DECLARE day_id UUID;
BEGIN
  SELECT id INTO day_id FROM plans WHERE type = 'day' AND date = '2026-03-25' LIMIT 1;

  INSERT INTO tasks (plan_id, title, category, priority, status, sort_order) VALUES
    (day_id, 'Силовая тренировка — ноги', 'health', 'high', 'done', 1),
    (day_id, 'Zoom-консультации (весь день)', 'work', 'medium', 'done', 2),
    (day_id, 'Иск Анары — раздел имущества', 'work', 'high', 'deferred', 3),
    (day_id, 'Кассация Темирбаева', 'work', 'critical', 'deferred', 4);

  INSERT INTO plan_payments (plan_id, client_name, description, amount, currency, received) VALUES
    (day_id, 'Фазила', 'за курс', 50000, 'KZT', true);
END $$;

-- ============================================================
-- План дня 26/03/2026
-- ============================================================
INSERT INTO plans (type, date, focus_title, intentions, energy_level, place, results, comment)
VALUES (
  'day',
  '2026-03-26',
  'Договор + кассация + логистика судов',
  '{"main": "Заключить договор и начать писать кассацию/раздел имущества до созвонов", "secondary": "Zoom-консультации с 12:00 до 17:00", "recovery": "Забрать судебные акты (Жансая, Арбузов) и съемка рилсов"}'::jsonb,
  NULL,
  'офис',
  '{"wins": ["Кассация Темирбаева (частично)"], "mistakes": ["Не выполнено алименты и разводы", "Не забраны документы с судов", "Надо передать кассацию"]}'::jsonb,
  NULL
);

DO $$
DECLARE day_id UUID;
BEGIN
  SELECT id INTO day_id FROM plans WHERE type = 'day' AND date = '2026-03-26' LIMIT 1;

  INSERT INTO tasks (plan_id, title, category, priority, status, sort_order) VALUES
    (day_id, 'Заключить договор на внесудебное банкротство', 'work', 'high', 'done', 1),
    (day_id, 'Кассация Темирбаева', 'work', 'critical', 'in_progress', 2),
    (day_id, 'Zoom-консультации 12:00-17:00', 'work', 'medium', 'done', 3),
    (day_id, 'Забрать ИЛ Жансаи', 'work', 'medium', 'deferred', 4),
    (day_id, 'Забрать приговор Арбузова', 'work', 'medium', 'deferred', 5),
    (day_id, 'Алименты и разводы', 'work', 'medium', 'deferred', 6);

  INSERT INTO plan_payments (plan_id, client_name, description, amount, currency, received) VALUES
    (day_id, 'Дарья', 'за консультацию', 10000, 'KZT', true),
    (day_id, 'Адия', 'за консультацию', 20000, 'KZT', true),
    (day_id, 'Клиент', 'за услугу внесудебного банкротства', 200000, 'KZT', true);
END $$;

-- ============================================================
-- План дня 27/03/2026
-- ============================================================
INSERT INTO plans (type, date, focus_title, intentions, energy_level, place, results, comment)
VALUES (
  'day',
  '2026-03-27',
  'Жестко добить и передать кассацию Темирбаева',
  '{"main": "Кассация Темирбаева — дописать, проверить и передать. Никаких других задач до этого момента.", "secondary": "Выехать в суды забрать ИЛ Жансаи и приговор Арбузова", "recovery": "Вечер: хвосты по искам или IT-задачи для смены картинки"}'::jsonb,
  NULL,
  'офис',
  '{"wins": ["Забрал ИЛ Жансаи", "Провел консультации"], "mistakes": ["Кассация Темирбаева не завершена", "Не поехал за приговором Арбузова"]}'::jsonb,
  NULL
);

DO $$
DECLARE day_id UUID;
BEGIN
  SELECT id INTO day_id FROM plans WHERE type = 'day' AND date = '2026-03-27' LIMIT 1;

  INSERT INTO tasks (plan_id, title, category, priority, status, sort_order) VALUES
    (day_id, 'Кассация Темирбаева — добить и передать', 'work', 'critical', 'deferred', 1),
    (day_id, 'Забрать ИЛ Жансаи', 'work', 'medium', 'done', 2),
    (day_id, 'Забрать приговор Арбузова', 'work', 'medium', 'deferred', 3),
    (day_id, 'Консультации', 'work', 'medium', 'done', 4);

  INSERT INTO plan_payments (plan_id, client_name, description, amount, currency, received) VALUES
    (day_id, 'Жанар', 'за курс', 50000, 'KZT', true),
    (day_id, 'Гульзина', 'за курс', 50000, 'KZT', true);
END $$;

-- ============================================================
-- План дня 28/03/2026
-- ============================================================
INSERT INTO plans (type, date, focus_title, intentions, energy_level, place, results, comment)
VALUES (
  'day',
  '2026-03-28',
  'Смена контекста: завершение кассации + IT-кабинет для курсов',
  '{"main": "Продумать и расписать алгоритм работы личного кабинета для курсов", "secondary": "Посмотреть креативы КИМЭП и набросать идеи для рекламы PL на апрель", "recovery": "Похвалить себя за закрытую кассацию и классные продажи курсов"}'::jsonb,
  NULL,
  'офис',
  '{"wins": ["ГЛАВНАЯ ПОБЕДА: Полностью закончена кассация Темирбаева!", "Забрал ИЛ Жансаи"]}'::jsonb,
  NULL
);

DO $$
DECLARE day_id UUID;
BEGIN
  SELECT id INTO day_id FROM plans WHERE type = 'day' AND date = '2026-03-28' LIMIT 1;

  INSERT INTO tasks (plan_id, title, category, priority, status, sort_order) VALUES
    (day_id, 'Кассация Темирбаева — ЗАВЕРШЕНА', 'work', 'critical', 'done', 1),
    (day_id, 'Архитектура личного кабинета для курсов', 'tech', 'high', 'pending', 2),
    (day_id, 'Таргет PL на апрель — креативы КИМЭП', 'marketing', 'medium', 'pending', 3);

  INSERT INTO plan_payments (plan_id, client_name, description, amount, currency, received) VALUES
    (day_id, 'Адия', 'за курс', 50000, 'KZT', true);
END $$;

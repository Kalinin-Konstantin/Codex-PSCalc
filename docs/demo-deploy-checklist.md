# Чеклист демо-деплоя

Документ фиксирует минимальные шаги, чтобы поднять демо-версию калькулятора с авторизацией, сохранением расчетов и админкой.

## 1. Переменные окружения

В локальном `.env.local` и в Vercel задать:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
SUPABASE_SERVICE_ROLE_KEY=sb_service_role_your_key
WB_API_TOKEN=your_wildberries_api_token
CRON_SECRET=replace_with_long_random_secret
```

`SUPABASE_SERVICE_ROLE_KEY` используется только серверным cron-route `/api/cron/wb-tariffs`, чтобы раз в день сохранять свежий снимок тарифов WB в Supabase. В клиентский код он не попадает.

## 2. Миграции Supabase

Применить SQL-файлы строго по порядку:

1. `supabase/migrations/202606220001_auth_profiles.sql`
2. `supabase/migrations/202606220002_sellers_calculations.sql`
3. `supabase/migrations/202606220003_commercial_settings_profiles.sql`
4. `supabase/migrations/202606220004_harden_calculation_seller_ownership.sql`
5. `supabase/migrations/202606240001_marketplace_tariff_snapshots.sql`

После применения проверить, что RLS включен для таблиц:

- `profiles`
- `sellers`
- `calculations`
- `commercial_settings_profiles`
- `marketplace_tariff_snapshots`

## 3. Первый администратор

1. Зарегистрировать первого пользователя через интерфейс.
2. В Supabase SQL editor выполнить:

```sql
update public.profiles
set role = 'admin',
    status = 'approved',
    approved_at = now()
where email = 'admin@example.com';
```

После этого `/admin` должен открыться для первого администратора.

## 4. Smoke-test после деплоя

Проверить сценарии:

1. Неавторизованный пользователь видит экран входа/регистрации.
2. Новый пользователь после регистрации видит ожидание подтверждения.
3. Администратор видит нового пользователя в `/admin` и подтверждает доступ.
4. Подтвержденный пользователь создает селлера.
5. Пользователь сохраняет расчет и открывает его повторно.
6. Администратор видит расчет пользователя в `/admin`.
7. Администратор открывает чужой расчет в режиме просмотра, без кнопки сохранения.
8. Администратор меняет `Дефолты для новых расчётов`.
9. Новый расчет открывается с обновленными дефолтами.
10. Старый сохраненный расчет открывается со своим snapshot, без изменения задним числом.
11. Подтвержденный пользователь-менеджер видит внутреннюю кнопку коммерческих настроек на главной странице и может открыть панель наценок.
12. Пользователь без роли `admin` не видит ссылку `Админка`, а прямой заход на `/admin` возвращает его на главную.
13. Клиентская Excel-выгрузка скачивается и не содержит маржу, себестоимость и проценты наценки PIM.Seller.
14. Cron-route `/api/cron/wb-tariffs` с заголовком `Authorization: Bearer $CRON_SECRET` возвращает `ok: true` и создает свежую строку в `marketplace_tariff_snapshots`.

## 5. Перед показом клиенту

Перед первым показом пройти менеджерский сценарий из `docs/demo-manager-script.md`.

Запустить локально:

```bash
npm run test
npm run build
npm audit --audit-level=moderate
```

Если менялись тарифные источники, дополнительно выполнить нормализацию и профильные проверки тарифов.

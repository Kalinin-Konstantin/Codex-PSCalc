# PIM.Seller Unit Economics Calculator

Веб-прототип калькулятора совокупных затрат для селлеров маркетплейсов.

## Что считает MVP

- Для каждого SKU показываются 6 вариантов: `WB FBO`, `WB FBS`, `WB DBS`, `Ozon FBO`, `Ozon FBS`, `Ozon DBS`.
- В интерфейсе есть переключатель `без НДС / с НДС`: marketplace-тарифы считаются исходно с НДС, тарифы PIM.Seller исходно без НДС.
- SKU вводятся вручную в веб-таблице.
- В верхней панели маршрут разделён на `откуда / куда`; списки городов берутся из PEK Google Sheet и сохраняются в `route-cities.json`.
- Комиссии WB/Ozon и тарифы PIM.Seller берутся из файлов проекта и нормализуются в JSON.

## Запуск

```bash
npm install
npm run normalize:tariffs
npm run dev
```

Если нужен режим с авторизацией, сохранением расчетов и админкой, создайте `.env.local` по `.env.example` и примените миграции Supabase из `supabase/migrations/`. Порядок демо-деплоя зафиксирован в `docs/demo-deploy-checklist.md`.

## Локальная разработка

Обычный запуск:

```bash
npm run dev
```

Используйте его, когда dev server ещё не запущен и `.next` не пересоздавался командой `npm run build`.

Чистый перезапуск:

```bash
npm run dev:clean
```

Используйте `dev:clean`, если:

- перед этим запускался `npm run build`;
- страница открылась без CSS или React не гидратируется;
- кнопки не нажимаются;
- Next.js ушёл на порт `3001`, а вы ожидали `3000`.

`dev:clean` завершает старые процессы `next dev`, освобождает порт `3000`, удаляет `.next` и запускает свежий dev server на `http://localhost:3000`.

Не запускайте `npm run build` при уже работающем `npm run dev`.

Команда `build` пересоздает содержимое `.next`, из-за чего старый dev server может начать отдавать HTML со ссылками на несуществующие JS/CSS chunks.

Если после build вы продолжаете разработку:

1. остановите dev server и запустите `npm run dev` заново;
2. или просто выполните `npm run dev:clean`.

Иначе возможны симптомы:

- страница без стилей;
- React не работает;
- кнопки не нажимаются;
- виден только "голый" HTML.

Всегда открывайте URL, который Next.js показывает в терминале в строке `Local:`. Обычно это `http://localhost:3000`. Если терминал показывает `http://localhost:3001`, значит порт `3000` занят; в этом случае остановите сервер и запустите `npm run dev:clean`.

## Настройка окружения

Создайте локальный файл окружения из шаблона:

```bash
cp .env.example .env.local
```

Заполните только нужные значения. В `.env.example` должны оставаться только пустые placeholder'ы, без реальных токенов, URL и ключей.

Обязательные переменные для основного приложения с авторизацией:

- `NEXT_PUBLIC_SUPABASE_URL` — URL проекта Supabase.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — публичный publishable key Supabase для браузера.

Обязательные переменные для MPStats-раздела:

- `MPSTATS_TOKEN` — server-only токен MPStats для `/api/mpstats/*`.

Обязательные переменные для production-обновления тарифов WB:

- `SUPABASE_SERVICE_ROLE_KEY` — server-only ключ Supabase service role для записи tariff snapshots.
- `CRON_SECRET` — секрет для защиты `/api/cron/wb-tariffs`.
- `WB_API_TOKEN` — server-only токен Wildberries API.

Переменные для писем о подтверждении доступа:

- `RESEND_API_KEY` — server-only API key Resend.
- `APPROVAL_EMAIL_FROM` — отправитель писем.
- `NEXT_PUBLIC_APP_URL` или `APP_BASE_URL` — базовый URL приложения для ссылок в письмах.

Опциональные переменные:

- `MPSTATS_BASE_URL` — override базового URL MPStats API; обычно не нужен.
- `WILDBERRIES_API_TOKEN` — legacy alias для `WB_API_TOKEN`; для новых окружений используйте `WB_API_TOKEN`.
- `WB_TARIFF_DATE` — дата импорта WB-тарифов для локального скрипта, формат `YYYY-MM-DD`.
- `WB_TARIFFS_CACHE_DIR` — директория с локальным cache JSON для импорта WB-тарифов.
- `HOST` и `PORT` — настройки локального static preview server.

Важно: не добавляйте секретный MPStats token в переменные с публичным префиксом. `NEXT_PUBLIC_MPSTATS_TOKEN` и `VITE_MPSTATS_TOKEN` не используются и не должны появляться в окружениях, иначе токен может попасть во frontend bundle.

В текущем окружении `npm` может отсутствовать в PATH. Расчётные тесты можно запустить напрямую через Node:

```bash
node --test tests/*.test.ts
```

Без установки Next-зависимостей можно открыть статический preview:

```bash
node scripts/build_preview_data.mjs
node scripts/serve_preview.mjs
```

## Обновление тарифов

Исходные файлы:

- WB API — комиссии Wildberries и тарифы логистики/хранения/приёмки, импортируются командой `npm run import:wb-tariffs`.
- `Таблица_категорий_для_расчёта_вознаграждения_06042026-2_1773932702.xlsx` — комиссии Ozon.
- `Складские операции.docx` — складские операции PIM.Seller.
- `Средняя миля .docx` — тариф средней мили PIM.Seller.

Команда нормализации:

```bash
python3 scripts/normalize_tariffs.py
```

Скрипт обновляет JSON в `src/data/generated/`. Код расчёта работает только с этими JSON-справочниками.

## MVP-допущения

- Сайты маркетплейсов не парсятся автоматически.
- Первая миля и последняя миля PIM.Seller заложены как локальные MVP-допущения в `logistics-assumptions.json`.
- Для Ozon схема DBS использует RFBS-комиссии из файла категорий как ближайший доступный тарифный аналог.
- Если категория/тип товара не найдены в справочнике, схема помечается как неполная, без скрытой fallback-ставки.
- Основная ставка НДС для MVP: `22%`.

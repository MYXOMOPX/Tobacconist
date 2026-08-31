---
version: alpha
name: Tobacconist Group-Buy
description: Telegram Mini App для групповых закупок табака среди друзей — тёмная, "ember"-стилистика (тлеющие угли на угольно-чёрном фоне): фиксированная тёмная тема, один решительный оранжевый акцент, моноширинные цифры для денег/веса/количества и чёткая система статус-бейджей (заливка vs аутлайн).
colors:
  primary: "#F05E23"
  primary-pressed: "#C94A15"
  background: "#121110"
  surface: "#1C1B19"
  surface-raised: "#232120"
  border: "#332F2B"
  text-primary: "#F5F2EE"
  text-secondary: "#9C948C"
  text-disabled: "#5C5650"
  status-ordering: "#3DBD6C"
  status-awaiting: "#E8B923"
  status-done: "#8B857D"
  status-rejected: "#E5484D"
typography:
  h1:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.01em
  h2:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.3
  body-md:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0.04em
  button:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.2
  numeric-lg:
    fontFamily: "JetBrains Mono"
    fontSize: 28px
    fontWeight: 700
    lineHeight: 1.1
    fontFeature: tnum
  numeric-md:
    fontFamily: "JetBrains Mono"
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.3
    fontFeature: tnum
rounded:
  sm: 8px
  md: 14px
  lg: 20px
  full: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
    typography: "{typography.button}"
    rounded: "{rounded.lg}"
    padding: "14px 20px"
  button-primary-pressed:
    backgroundColor: "{colors.primary-pressed}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.lg}"
    padding: "14px 20px"
    border: "1px solid {colors.border}"
  button-destructive:
    backgroundColor: transparent
    textColor: "{colors.status-rejected}"
    typography: "{typography.button}"
    rounded: "{rounded.lg}"
    padding: "14px 20px"
    border: "1px solid {colors.status-rejected}"
  card-item:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  code-block:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text-primary}"
    typography: "{typography.numeric-md}"
    rounded: "{rounded.sm}"
    padding: "{spacing.md}"
    border: "1px solid {colors.border}"
  stepper-button:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.full}"
    height: 32px
    width: 32px
  tab-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-secondary}"
    activeColor: "{colors.primary}"
    border: "1px solid {colors.border}"
  bottom-sheet:
    backgroundColor: "{colors.surface-raised}"
    rounded: "{rounded.lg} {rounded.lg} 0 0"
    padding: "{spacing.lg}"
  input-field:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
    border: "1px solid {colors.border}"
  badge-status-ordering:
    backgroundColor: "{colors.status-ordering}"
    textColor: "#0F1A12"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  badge-status-awaiting:
    backgroundColor: "{colors.status-awaiting}"
    textColor: "#1F1A05"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  badge-status-done:
    backgroundColor: transparent
    textColor: "{colors.status-done}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
    border: "1px solid {colors.status-done}"
  badge-status-rejected:
    backgroundColor: transparent
    textColor: "{colors.status-rejected}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
    border: "1px solid {colors.status-rejected}"
  chip-outline:
    backgroundColor: transparent
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
    border: "1px solid currentColor"
---

## Overview

Telegram Mini App для организатора групповых закупок табака среди
друзей: сбор заказов участников закрытого чата, агрегация для продавца
("барыги"), сверка поставки, отметки оплаты. Тон — тёплый, дружеский,
неформальный (это инструмент для своих, не b2b-SaaS), но собранный и
"техничный" в подаче цифр — деньги и количества должны читаться как
на приборной панели. Визуальная идентичность: **фиксированная тёмная
тема** (угольно-чёрный фон, как тлеющий очаг ночью) с одним решительным
тёплым оранжевым акцентом `#F05E23` ("ember"). Приложение не
подстраивается под системную светлую/тёмную тему Telegram — у него
одна, узнаваемая тёмная тема всегда, это осознанный выбор бренда, а не
недоделанная адаптивность.

## Colors

`background` — базовый угольно-чёрный фон экрана. `surface` — чуть
светлее фона, для карточек и панелей поверх него. `surface-raised` —
ещё на ступень светлее, для элементов над карточками (bottom-sheet,
степпер-кнопки) — так создаётся многослойность без теней. `border` —
тонкая, едва заметная линия-разделитель. `text-primary` — почти белый
тёплый текст, `text-secondary` — приглушённый серо-бежевый для
второстепенной информации (даты, подписи), `text-disabled` — для
недоступных полей/значений.

`primary` (`#F05E23`) — единственный акцент бренда: главные кнопки,
активная вкладка таб-бара, крупные положительные суммы, бейдж "ты
ведёшь раунд/заказ". `primary-pressed` — состояние нажатия той же
кнопки.

Статусы заказа — самостоятельная палитра, не спутать с `primary`:
`status-ordering` (зелёный, "Сбор заказов" — можно добавлять позиции),
`status-awaiting` (жёлтый, "На сверке" — участники только смотрят,
админ донабирает и сверяет), `status-done` (приглушённый серый,
"Завершён" — терминальный, история), `status-rejected` (красный,
"Отменён" — терминальный, заказ не состоялся). "Завершён" и "Отменён"
визуально резко различаются — это разный исход, не вариации одного.

## Typography

Два регистра шрифта на весь интерфейс. Обычный текст (заголовки,
названия, подписи) — Inter/системный sans-serif: `h1`/`h2` для
заголовков экранов и секций, `body-md`/`body-sm` для основного и
второстепенного текста, `label` для коротких подписей внутри бейджей.
Отдельно — **моноширинный регистр для чисел**: `numeric-lg`/`numeric-md`
(моно-шрифт с табличными цифрами, например JetBrains Mono) — им
набираются ВСЕ денежные суммы, вес в кг, цена за кг, количество в
степпере, номера раунда/заказа. Это ключевая деталь стиля: цифры
должны визуально отличаться от обычного текста и ровно
выравниваться в колонках (таблица позиций, список участников).

## Layout

Мобильный, однoколоночный layout: ширина вьюпорта ~360–430px (Telegram
WebView на телефоне), контент на всю ширину минус боковые отступы
`spacing.md`. Вертикальный ритм — карточки и секции разделены
`spacing.md`/`spacing.lg`, внутри карточки — `spacing.sm`/`spacing.md`.
Верхнюю системную шапку (заголовок чата, кнопка "назад") рисует сам
Telegram — не дублировать в макете, но оставлять отступ `spacing.lg`
сверху под неё. Внизу экрана — постоянный **таб-бар** (`tab-bar`) с
текстовыми вкладками (без иконок), активная вкладка подчёркнута
`primary`-линией снизу; у участника — 2 вкладки ("Заказы", "История"),
у админа — на 2 больше ("Барыги", плюс текущий раздел управления
заказом). Модальные потоки (например выбор барыги при создании нового
заказа) — не отдельный экран, а **bottom-sheet**, выезжающий снизу
поверх таб-бара.

## Elevation & Depth

Плоский интерфейс без теней и градиентов — иерархия строится ступенями
яркости фона (`background` → `surface` → `surface-raised`) и тонкой
границей `border`, а не тенями. На тёмном фоне тень всё равно не
читается — глубину даёт именно эта лестница серых/тёмных тонов.

## Shapes

Скруглённые, мягкие формы: карточки — `rounded.md`, кнопки —
`rounded.lg` (крупнее карточек — кнопка читается как отдельный,
явно тач-элемент), статус-бейджи и чипы — `rounded.full` (форма
таблетки). Степпер-кнопки (+/-) — круглые (`rounded.full`).
Bottom-sheet — скруглены только верхние углы (`rounded.lg` сверху, 0
снизу — он "прирастает" к нижнему краю экрана).

## Components

Кнопки: основная (`button-primary`, заливка `primary`) — одна на
экран, самое главное действие ("Закрыть раунд", "Начать раунд",
"Завершить сверку", "Добавить"). Вторичная (`button-secondary`) — на
`surface`-подложке с тонкой границей, для соседних неглавных действий
("Слепок", "Скопировать"). Деструктивная (`button-destructive`) — БЕЗ
заливки, только красная обводка и красный текст (`status-rejected`) —
не заливка, чтобы не спорить по весу с основной кнопкой-заливкой на
том же экране.

Статус-бейджи — два визуальных варианта, оба `rounded.full`:
**заливка** (`badge-status-ordering`, `badge-status-awaiting`) — для
активных/актуальных состояний, где статус — это всё ещё что-то
происходящее и важное прямо сейчас; **аутлайн** (`badge-status-done`,
`badge-status-rejected`, `chip-outline`) — для завершённых/архивных/
второстепенных состояний (готовый заказ в истории, "устаревшее
наличие", "цена не задана"). Это разделение — так глаз сразу отличает
"это ещё в работе" от "это уже прошлое или справочная информация", не
дожидаясь чтения текста бейджа.

Карточка позиции товара (`card-item`) — одна визуальная единица что в
списке ассортимента, что в агрегированной сводке админа: слева
бренд/вкус/вес обычным текстом, справа — количество и сумма
моноширинным (`numeric-md`). Блок "слепок для барыги" — отдельный
`code-block`: моноширинный текст на фоне `background` (темнее самой
карточки) с рамкой `border`, имитирует "техническую" распечатку.
Степпер количества — два круглых `stepper-button` по бокам от
`numeric-md`-числа, кнопка "−" неактивна на нуле.

## Do's and Don'ts

Делай: используй `primary` только для одной главной кнопки на экране
за раз. Все денежные суммы, вес и количества — всегда моноширинным
регистром (`numeric-lg`/`numeric-md`), никогда обычным `body`-шрифтом.
Для завершённых/архивных статусов используй аутлайн-бейдж, для
активных — заливку. Держи кликабельные/тач-зоны не меньше 44px.

Не делай: не используй `primary` (`#F05E23`) как заливку статус-бейджа
"Завершён"/"Отменён" — заливкой красится только то, что ещё
актуально/в работе. Не делай светлую тему и не подстраивайся под
системную тему Telegram — тема всегда одна, тёмная. Не добавляй
тени/градиенты. Не имитируй в макете системную шапку Telegram — только
контент экрана и, при необходимости, таб-бар/bottom-sheet.

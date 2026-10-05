import { useState, type ReactNode } from 'react';
import {
  Badge,
  Banner,
  Button,
  Card,
  CardHead,
  Chip,
  EmptyState,
  ErrorState,
  LedgerRow,
  ListSkeleton,
  Money,
  Progress,
  Row,
  Sheet,
  Snapshot,
  StatusBadge,
  StickyBar,
  Stepper,
  TabBar,
  Toggle,
  Weight,
  gramsLabel,
  packPriceEur,
  sumEur,
} from './index';

/**
 * Living reference for the UI kit — every component with real order data, so a
 * drifted colour or a wrong price shows up here before it reaches a screen.
 * Open it at /kit.html; it is not part of the Mini App bundle.
 */

const PRICE_DARKSIDE = 42;
const PRICE_MUSTHAVE = 38;

const MY_ITEMS = [
  { name: 'DarkSide Needls', grams: 250, quantity: 2, pricePerKg: PRICE_DARKSIDE },
  { name: 'DarkSide Desert Eagle', grams: 100, quantity: 1, pricePerKg: PRICE_DARKSIDE },
  { name: 'MustHave Kiwi Smoothie', grams: 250, quantity: 3, pricePerKg: PRICE_MUSTHAVE },
];

const LINE_TOTALS = MY_ITEMS.map((item) => packPriceEur(item.pricePerKg, item.grams) * item.quantity);
const TOTAL_EUR = sumEur(LINE_TOTALS);
const TOTAL_KG = MY_ITEMS.reduce((kg, item) => kg + (item.grams * item.quantity) / 1000, 0);

const SNAPSHOT_TEXT = [
  'DarkSide - Needls - 250g - x2',
  'DarkSide - Desert Eagle - 100g - x1',
  'MustHave - Kiwi Smoothie - 250g - x3',
].join('\n');

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="tb-stack">
      <span className="tb-section-label">{title}</span>
      {children}
    </section>
  );
}

export function UiKit() {
  const [quantity, setQuantity] = useState(2);
  const [grams, setGrams] = useState(250);
  const [paid, setPaid] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tab, setTab] = useState<'orders' | 'vendors' | 'history'>('orders');

  return (
    <div className="tb-page">
      <header className="tb-stack">
        <h1 className="tb-title">Дизайн-система</h1>
        <p className="tb-subtitle">
          Один акцент, фиксированная тёмная тема, моноширинные цифры. Всё, что рисуется на экранах,
          собирается только отсюда.
        </p>
      </header>

      <Section title="Статусы заказа">
        <div className="tb-chips">
          <StatusBadge status="ordering" />
          <StatusBadge status="awaiting_validation" />
          <StatusBadge status="done" />
          <StatusBadge status="rejected" />
          <Badge>Не оплачено</Badge>
        </div>
        <p className="tb-subtitle">
          Заливка, пока заказ живой; аутлайн, когда он закончен. Правило зашито в компонент.
        </p>
      </Section>

      <Section title="Кнопки">
        <div className="tb-stack">
          <Button variant="primary" block>
            Завершить заказ
          </Button>
          <Button variant="secondary" block>
            Вернуть в работу
          </Button>
          <Button variant="destructive" block>
            Отменить заказ
          </Button>
          <Button variant="primary" block disabled>
            Завершить заказ
          </Button>
        </div>
      </Section>

      <Section title="Цифры">
        <Card>
          <div className="tb-card__head">
            <span className="tb-subtitle">Итого</span>
            <Money value={TOTAL_EUR} large tone="accent" />
          </div>
          <div className="tb-card__head">
            <span className="tb-subtitle">Общий вес</span>
            <Weight kg={TOTAL_KG} />
          </div>
          <p className="tb-subtitle">
            {PRICE_DARKSIDE} €/кг → 250г = {packPriceEur(PRICE_DARKSIDE, 250).toFixed(2)} €, 100г ={' '}
            {packPriceEur(PRICE_DARKSIDE, 100).toFixed(2)} €. Цена пачки всегда считается, а не
            хранится.
          </p>
        </Card>
      </Section>

      <Section title="Чек-строка">
        <Card>
          <CardHead title="Мой заказ" trailing={<StatusBadge status="ordering" />} />
          {MY_ITEMS.map((item, index) => (
            <LedgerRow
              key={item.name}
              name={item.name}
              meta={gramsLabel(item.grams)}
              quantity={item.quantity}
              amount={LINE_TOTALS[index]}
            />
          ))}
          <LedgerRow name="Wild Fire" meta="250г" quantity={1} amount={10.5} unavailable />
          <hr className="tb-divider" />
          <div className="tb-card__head">
            <span>Итого</span>
            <Money value={TOTAL_EUR} tone="accent" />
          </div>
        </Card>
      </Section>

      <Section title="Ввод">
        <Card>
          <CardHead
            title="Needls"
            trailing={
              <Stepper value={quantity} onChange={setQuantity} label={`Needls ${gramsLabel(grams)}`} />
            }
          />
          <div className="tb-chips">
            <Chip selected={grams === 100} onClick={() => setGrams(100)}>
              {gramsLabel(100)}
            </Chip>
            <Chip selected={grams === 250} onClick={() => setGrams(250)}>
              {gramsLabel(250)}
            </Chip>
            <Chip unavailable>{gramsLabel(500)}</Chip>
          </div>
          <LedgerRow
            name="Строка заказа"
            meta={gramsLabel(grams)}
            quantity={quantity}
            amount={packPriceEur(PRICE_DARKSIDE, grams) * quantity}
          />
        </Card>
      </Section>

      <Section title="Сообщения">
        <Banner tone="warning">Добавление позиций закрыто, идёт сверка с продавцом</Banner>
        <Banner tone="danger">Не удалось распознать фото. Попробуй перезалить.</Banner>
        <Banner>Позиция помечена «больше не в наличии» — реши, оставляем её или убираем.</Banner>
      </Section>

      <Section title="Сверка и оплата">
        <Card>
          <Progress
            label="Принято"
            value={5}
            max={6}
            trailing={<span className="tb-num tb-num--muted">5 / 6</span>}
          />
          <LedgerRow name="Needls" meta="250г" note="нужно 2 · привезли 1" />
          <LedgerRow name="Cane Mint" meta="100г" note="нужно 3 · привезли 3" />
          <Toggle label="Кирилл" pressed={paid} onChange={setPaid} trailing={<Money value={42} />} />
        </Card>
      </Section>

      <Section title="Слепок для барыги">
        <Card>
          <Snapshot text={SNAPSHOT_TEXT} onCopy={() => {}} />
        </Card>
      </Section>

      <Section title="Списки и модалки">
        <Row
          label="Darian Shisha"
          note="4 бренда"
          trailing={<StatusBadge status="ordering" />}
          onClick={() => setSheetOpen(true)}
        />
        <Row label="Boss Shisha" note="уже есть активный заказ" disabled trailing={<StatusBadge status="awaiting_validation" />} />
        <Button variant="secondary" block onClick={() => setSheetOpen(true)}>
          Открыть шторку
        </Button>
      </Section>

      <Section title="Состояния">
        <ListSkeleton count={2} />
        <Card>
          <EmptyState
            title="Активных заказов нет"
            text="Как только админ откроет закупку у барыги, она появится здесь."
          />
        </Card>
        <Card>
          <ErrorState text="Проверь связь и попробуй ещё раз." onRetry={() => {}} />
        </Card>
      </Section>

      <Section title="Итоговая панель">
        <StickyBar
          inline
          summary={
            <>
              <span className="tb-subtitle">Твой заказ: 3 позиции</span>
              <span>
                <Money value={TOTAL_EUR} tone="accent" /> · <Weight kg={TOTAL_KG} tone="muted" />
              </span>
            </>
          }
          action={<Button variant="primary">Я готов(а)</Button>}
        />
      </Section>

      <TabBar
        items={[
          { id: 'orders', label: 'Заказы' },
          { id: 'vendors', label: 'Барыги' },
          { id: 'history', label: 'История' },
        ]}
        active={tab}
        onSelect={setTab}
      />

      <Sheet open={sheetOpen} title="У кого закупаемся?" onClose={() => setSheetOpen(false)}>
        <Row label="World Hookah Market" note="3 бренда" onClick={() => setSheetOpen(false)} />
        <Row
          label="Darian Shisha"
          note="уже есть активный заказ"
          disabled
          trailing={<StatusBadge status="ordering" />}
        />
        <Button variant="primary" block onClick={() => setSheetOpen(false)}>
          Начать заказ
        </Button>
      </Sheet>
    </div>
  );
}

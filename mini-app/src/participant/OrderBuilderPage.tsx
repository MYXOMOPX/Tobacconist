import { useEffect, useState } from 'react';
import { api } from '../apiClient';
import { useAction } from '../useAction';

type AssortmentRow = {
  brandId: number;
  brandName: string;
  flavorId: number;
  flavorName: string;
  weightId: number;
  grams: number;
  available: boolean;
};
type AggregateLine = {
  brandId: number;
  brandName: string;
  flavorId: number;
  flavorName: string;
  weightId: number;
  grams: number;
  quantity: number;
  totalEur: number;
  available: boolean;
};
type MyOrder = {
  round: { id: number; vendorId: number; status: string } | null;
  items: AggregateLine[];
  totalKg: number;
  totalEur: number;
  hasUnavailableItems: boolean;
};

function lineKey(brandId: number, flavorId: number, weightId: number) {
  return `${brandId}:${flavorId}:${weightId}`;
}

export function OrderBuilderPage() {
  const [assortment, setAssortment] = useState<AssortmentRow[]>([]);
  const [mine, setMine] = useState<MyOrder | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const { error, run } = useAction();

  async function reload() {
    setAssortment(await api.get<AssortmentRow[]>('/orders/assortment'));
    const myOrder = await api.get<MyOrder>('/orders/mine');
    setMine(myOrder);
    const q: Record<string, string> = {};
    for (const item of myOrder.items) {
      q[lineKey(item.brandId, item.flavorId, item.weightId)] = String(item.quantity);
    }
    setQuantities(q);
  }

  useEffect(() => {
    run(reload);
  }, [run]);

  function saveQuantity(row: AssortmentRow) {
    return run(async () => {
      const key = lineKey(row.brandId, row.flavorId, row.weightId);
      const quantity = Number(quantities[key] ?? 0);
      await api.put('/orders/items', {
        brandId: row.brandId,
        flavorId: row.flavorId,
        weightId: row.weightId,
        quantity,
      });
      setMine(await api.get<MyOrder>('/orders/mine'));
    });
  }

  if (!mine?.round) {
    return (
      <section>
        {error && <p role="alert">{error}</p>}
        <p>Сейчас нет активной закупки.</p>
      </section>
    );
  }

  const byBrand = new Map<string, AssortmentRow[]>();
  for (const row of assortment) {
    const list = byBrand.get(row.brandName) ?? [];
    list.push(row);
    byBrand.set(row.brandName, list);
  }

  return (
    <section>
      <h2>Мой заказ</h2>
      {error && <p role="alert">{error}</p>}
      {[...byBrand.entries()].map(([brandName, rows]) => (
        <div key={brandName}>
          <h3>{brandName}</h3>
          <ul>
            {rows.map((row) => {
              const key = lineKey(row.brandId, row.flavorId, row.weightId);
              return (
                <li key={key}>
                  <label>
                    {row.flavorName} - {row.grams}г
                    <input
                      type="number"
                      min={0}
                      value={quantities[key] ?? ''}
                      onChange={(e) => setQuantities({ ...quantities, [key]: e.target.value })}
                      onBlur={() => saveQuantity(row)}
                    />
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {mine.items.length > 0 && (
        <div>
          <h3>Ваш заказ</h3>
          <ul>
            {mine.items.map((item) => (
              <li key={lineKey(item.brandId, item.flavorId, item.weightId)}>
                {item.brandName} - {item.flavorName} - {item.grams}г: x{item.quantity}
                {!item.available && <strong> больше не в наличии</strong>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3>Итого</h3>
      <p>
        {mine.totalKg.toFixed(2)} кг, {mine.totalEur.toFixed(2)} €
      </p>
      {mine.hasUnavailableItems && <p role="alert">Часть позиций больше не в наличии</p>}
    </section>
  );
}

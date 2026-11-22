import { useCallback, useEffect, useState } from 'react';
import { api } from '../apiClient';
import { useAction } from '../useAction';
import type { AssortmentRow, Brand, Vendor, Weight } from '../types';
import { AvailabilityReview } from './AvailabilityReview';
import {
  Badge,
  Banner,
  Button,
  Card,
  CardHead,
  ConfirmDialog,
  EmptyState,
  ListSkeleton,
  Select,
  TextField,
  Toggle,
  gramsLabel,
} from '../ui';

type PriceRow = { vendorId: number; brandId: number; brandName: string; pricePerKgEur: number };

/** Everything about one vendor: prices, what they stock, and getting rid of them. */
export function VendorPage({ vendorId, onBack }: { vendorId: number; onBack: () => void }) {
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [weights, setWeights] = useState<Weight[]>([]);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [stock, setStock] = useState<AssortmentRow[]>([]);
  const [priceInputs, setPriceInputs] = useState<Record<number, string>>({});
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [newBrandId, setNewBrandId] = useState<number | null>(null);
  const [newWeightId, setNewWeightId] = useState<number | null>(null);
  const [newFlavorName, setNewFlavorName] = useState('');

  const { error, run } = useAction();

  const reload = useCallback(async () => {
    const vendors = await api.get<Vendor[]>('/admin/vendors?includeArchived=true');
    const found = vendors.find((row) => row.id === vendorId) ?? null;
    setVendor(found);
    setName(found?.name ?? '');
    setBrands(await api.get<Brand[]>('/admin/brands'));
    setWeights(await api.get<Weight[]>('/admin/weights'));
    setPrices(await api.get<PriceRow[]>(`/admin/vendors/${vendorId}/prices`));
    setStock(await api.get<AssortmentRow[]>(`/admin/vendors/${vendorId}/availability`));
  }, [vendorId]);

  useEffect(() => {
    setLoading(true);
    run(reload).finally(() => setLoading(false));
  }, [reload, run]);

  function rename() {
    if (!name.trim() || name.trim() === vendor?.name) return;
    return run(async () => {
      await api.patch(`/admin/vendors/${vendorId}`, { name: name.trim() });
      await reload();
    });
  }

  function savePrice(brandId: number) {
    const value = Number(priceInputs[brandId]);
    if (!value || value <= 0) return;
    return run(async () => {
      await api.put(`/admin/vendors/${vendorId}/prices/${brandId}`, { pricePerKgEur: value });
      setPriceInputs({ ...priceInputs, [brandId]: '' });
      setPrices(await api.get<PriceRow[]>(`/admin/vendors/${vendorId}/prices`));
    });
  }

  function toggleStock(row: AssortmentRow, available: boolean) {
    return run(async () => {
      await api.put(`/admin/vendors/${vendorId}/availability`, {
        brandId: row.brandId,
        weightId: row.weightId,
        flavorId: row.flavorId,
        available,
      });
      setStock(await api.get<AssortmentRow[]>(`/admin/vendors/${vendorId}/availability`));
    });
  }

  function addFlavorByHand() {
    if (!newBrandId || !newWeightId || !newFlavorName.trim()) return;
    return run(async () => {
      await api.put(`/admin/vendors/${vendorId}/availability`, {
        brandId: newBrandId,
        weightId: newWeightId,
        flavorName: newFlavorName.trim(),
        available: true,
      });
      setNewFlavorName('');
      setStock(await api.get<AssortmentRow[]>(`/admin/vendors/${vendorId}/availability`));
    });
  }

  function remove() {
    return run(async () => {
      await api.delete(`/admin/vendors/${vendorId}`);
      setConfirmingDelete(false);
      onBack();
    });
  }

  if (loading) {
    return (
      <div className="tb-page">
        <ListSkeleton />
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="tb-page">
        {error && <Banner tone="danger">{error}</Banner>}
        <EmptyState title="Барыга не найден" />
        <Button onClick={onBack}>К списку барыг</Button>
      </div>
    );
  }

  // Stock reads by brand and weight, the same pairing the screenshots come in.
  const groups = new Map<string, { brandName: string; grams: number; rows: AssortmentRow[] }>();
  for (const row of stock) {
    const key = `${row.brandId}:${row.weightId}`;
    const group = groups.get(key) ?? { brandName: row.brandName, grams: row.grams, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }

  return (
    <div className="tb-page">
      <header className="tb-card__head">
        <div className="tb-row__label">
          <h1 className="tb-title">{vendor.name}</h1>
          <button type="button" className="tb-btn tb-btn--ghost" onClick={onBack}>
            ← Все барыги
          </button>
        </div>
        {vendor.archived && <Badge>в архиве</Badge>}
      </header>

      {error && <Banner tone="danger">{error}</Banner>}

      <Card>
        <CardHead title="Название" />
        <div className="tb-fieldrow">
          <TextField label="Как зовут барыгу" value={name} onChange={setName} />
          <Button onClick={rename}>Сохранить</Button>
        </div>
      </Card>

      <Card>
        <CardHead title="Цены" />
        <p className="tb-subtitle">
          Цена за килограмм. Цена пачки считается пропорционально её граммовке.
        </p>
        {brands.map((brand) => {
          const existing = prices.find((price) => price.brandId === brand.id);
          return (
            <div className="tb-stack" key={brand.id}>
              <div className="tb-ledger">
                <span className="tb-ledger__label">
                  <span className="tb-ledger__name">{brand.name}</span>
                </span>
                <span className="tb-ledger__rail" aria-hidden="true" />
                <span className="tb-ledger__value">
                  {existing ? (
                    <>
                      <span className="tb-num">{existing.pricePerKgEur}</span>
                      <span className="tb-unit">€/кг</span>
                    </>
                  ) : (
                    <span className="tb-ledger__note">не задано</span>
                  )}
                </span>
              </div>
              <div className="tb-fieldrow">
                <TextField
                  label={`${brand.name}, €/кг`}
                  value={priceInputs[brand.id] ?? ''}
                  onChange={(next) => setPriceInputs({ ...priceInputs, [brand.id]: next })}
                  numeric
                />
                <Button onClick={() => savePrice(brand.id)}>Сохранить</Button>
              </div>
            </div>
          );
        })}
      </Card>

      <Card>
        <CardHead
          title="Наличие"
          trailing={
            <span className="tb-num tb-num--muted">
              {stock.filter((row) => row.available).length} / {stock.length}
            </span>
          }
        />
        {stock.length === 0 ? (
          <EmptyState
            title="Наличие пустое"
            text="Загрузи скрины прайса ниже или добавь позицию руками."
          />
        ) : (
          [...groups.entries()].map(([key, group]) => (
            <div className="tb-stack" key={key}>
              <span className="tb-section-label">
                {group.brandName} · {gramsLabel(group.grams)}
              </span>
              {group.rows.map((row) => (
                <Toggle
                  key={row.flavorId}
                  label={row.flavorName}
                  pressed={row.available}
                  onChange={(next) => toggleStock(row, next)}
                />
              ))}
            </div>
          ))
        )}

        <hr className="tb-divider" />
        <CardHead title="Добавить позицию руками" />
        <p className="tb-subtitle">
          Если ИИ не разобрал скрин или барыга назвал вкус словами — заведи его здесь.
        </p>
        <div className="tb-fieldrow">
          <Select
            label="Бренд"
            value={newBrandId}
            onChange={setNewBrandId}
            placeholder="Выбери бренд"
            options={brands.map((brand) => ({ value: brand.id, label: brand.name }))}
          />
          <Select
            label="Граммовка"
            value={newWeightId}
            onChange={setNewWeightId}
            placeholder="Выбери граммовку"
            options={weights.map((weight) => ({ value: weight.id, label: gramsLabel(weight.grams) }))}
          />
        </div>
        <div className="tb-fieldrow">
          <TextField
            label="Название вкуса"
            value={newFlavorName}
            onChange={setNewFlavorName}
            placeholder="Например: Cosmo Pole"
          />
          <Button onClick={addFlavorByHand}>Добавить</Button>
        </div>
      </Card>

      <AvailabilityReview
        vendorId={vendor.id}
        vendorName={vendor.name}
        brands={brands}
        weights={weights}
        onSaved={reload}
      />

      <Button variant="destructive" block onClick={() => setConfirmingDelete(true)}>
        Удалить барыгу
      </Button>

      <ConfirmDialog
        open={confirmingDelete}
        title={`Удалить ${vendor.name}?`}
        confirmLabel="Удалить"
        onConfirm={remove}
        onCancel={() => setConfirmingDelete(false)}
        body={
          <>
            <p className="tb-subtitle">
              Цены и наличие этого барыги удалятся. Если у него уже были заказы, он уйдёт в архив —
              история заказов должна остаться читаемой.
            </p>
          </>
        }
      />
    </div>
  );
}

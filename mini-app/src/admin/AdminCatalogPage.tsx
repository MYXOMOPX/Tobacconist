import { useEffect, useState } from 'react';
import { api } from '../apiClient';
import { useAction } from '../useAction';
import { AvailabilityReview } from './AvailabilityReview';
import type { Brand, Vendor, Weight } from '../types';
import {
  Banner,
  Button,
  Card,
  CardHead,
  EmptyState,
  ListSkeleton,
  Row,
  TextField,
} from '../ui';

type PriceRow = { vendorId: number; brandId: number; brandName: string; pricePerKgEur: number };

export function AdminCatalogPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [weights, setWeights] = useState<Weight[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState<number | null>(null);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [newVendorName, setNewVendorName] = useState('');
  const [newBrandName, setNewBrandName] = useState('');
  const [priceInputs, setPriceInputs] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);

  const { error, run } = useAction();

  async function reloadCatalog() {
    setVendors(await api.get<Vendor[]>('/admin/vendors'));
    setBrands(await api.get<Brand[]>('/admin/brands'));
    setWeights(await api.get<Weight[]>('/admin/weights'));
  }

  useEffect(() => {
    run(reloadCatalog).finally(() => setLoading(false));
  }, [run]);

  useEffect(() => {
    if (selectedVendorId == null) {
      setPrices([]);
      return;
    }
    run(async () => {
      setPrices(await api.get<PriceRow[]>(`/admin/vendors/${selectedVendorId}/prices`));
    });
  }, [selectedVendorId, run]);

  function createVendor() {
    if (!newVendorName.trim()) return;
    return run(async () => {
      await api.post('/admin/vendors', { name: newVendorName.trim() });
      setNewVendorName('');
      await reloadCatalog();
    });
  }

  function createBrand() {
    if (!newBrandName.trim()) return;
    return run(async () => {
      await api.post('/admin/brands', { name: newBrandName.trim() });
      setNewBrandName('');
      await reloadCatalog();
    });
  }

  function savePrice(brandId: number) {
    if (selectedVendorId == null) return;
    const value = Number(priceInputs[brandId]);
    if (!value || value <= 0) return;
    return run(async () => {
      await api.put(`/admin/vendors/${selectedVendorId}/prices/${brandId}`, { pricePerKgEur: value });
      setPrices(await api.get<PriceRow[]>(`/admin/vendors/${selectedVendorId}/prices`));
    });
  }

  const selectedVendor = vendors.find((vendor) => vendor.id === selectedVendorId) ?? null;

  return (
    <div className="tb-page">
      <h1 className="tb-title">Барыги и цены</h1>
      {error && <Banner tone="danger">{error}</Banner>}

      {loading ? (
        <ListSkeleton />
      ) : (
        <Card>
          <CardHead title="Барыги" />
          {vendors.length === 0 ? (
            <EmptyState title="Барыг ещё нет" text="Заведи первого — ниже." />
          ) : (
            <div className="tb-stack">
              {vendors.map((vendor) => (
                <Row
                  key={vendor.id}
                  label={vendor.name}
                  note={vendor.id === selectedVendorId ? 'выбран' : undefined}
                  onClick={() => setSelectedVendorId(vendor.id)}
                />
              ))}
            </div>
          )}
          <div className="tb-fieldrow">
            <TextField
              label="Новый барыга"
              value={newVendorName}
              onChange={setNewVendorName}
              placeholder="Например: Darian Shisha"
            />
            <Button onClick={createVendor}>Добавить</Button>
          </div>
        </Card>
      )}

      <Card>
        <CardHead title="Бренды" />
        <div className="tb-stack">
          {brands.map((brand) => (
            <div className="tb-ledger" key={brand.id}>
              <span className="tb-ledger__label">
                <span className="tb-ledger__name">{brand.name}</span>
              </span>
              <span className="tb-ledger__rail" aria-hidden="true" />
            </div>
          ))}
        </div>
        <div className="tb-fieldrow">
          <TextField
            label="Новый бренд"
            value={newBrandName}
            onChange={setNewBrandName}
            placeholder="Например: DarkSide"
          />
          <Button onClick={createBrand}>Добавить</Button>
        </div>
      </Card>

      {selectedVendor && (
        <>
          <Card>
            <CardHead title={`Цены: ${selectedVendor.name}`} />
            <p className="tb-subtitle">
              Цена за килограмм. Цена пачки считается из неё: 100г — десятая часть, 250г — четверть.
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

          <AvailabilityReview
            vendorId={selectedVendor.id}
            vendorName={selectedVendor.name}
            brands={brands}
            weights={weights}
            onSaved={reloadCatalog}
          />
        </>
      )}
    </div>
  );
}

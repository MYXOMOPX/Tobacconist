import { useEffect, useState } from 'react';
import { api } from '../apiClient';
import { useAction } from '../useAction';
import type { Brand, Vendor } from '../types';
import { Banner, Button, Card, CardHead, EmptyState, ListSkeleton, Row, TextField } from '../ui';

/**
 * The list of vendors and the brand catalogue. Everything about one vendor —
 * prices, stock, deletion — lives on its own page, one tap in.
 */
export function AdminCatalogPage({ onOpenVendor }: { onOpenVendor: (vendorId: number) => void }) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [newVendorName, setNewVendorName] = useState('');
  const [newBrandName, setNewBrandName] = useState('');
  const [loading, setLoading] = useState(true);
  const { error, run } = useAction();

  async function reloadCatalog() {
    setVendors(await api.get<Vendor[]>('/admin/vendors'));
    setBrands(await api.get<Brand[]>('/admin/brands'));
  }

  useEffect(() => {
    run(reloadCatalog).finally(() => setLoading(false));
  }, [run]);

  function createVendor() {
    if (!newVendorName.trim()) return;
    return run(async () => {
      const created = await api.post<Vendor>('/admin/vendors', { name: newVendorName.trim() });
      setNewVendorName('');
      await reloadCatalog();
      // Straight into the new vendor: it is empty and needs prices and stock.
      onOpenVendor(created.id);
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
                  note="цены, наличие, удаление"
                  trailing={<span aria-hidden="true">›</span>}
                  onClick={() => onOpenVendor(vendor.id)}
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
        <p className="tb-subtitle">Общий справочник: бренды одни и те же у всех барыг.</p>
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
    </div>
  );
}

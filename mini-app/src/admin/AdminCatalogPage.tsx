import { useEffect, useState } from 'react';
import { api, uploadAvailabilityImage } from '../apiClient';
import { useAction } from '../useAction';
import {
  Banner,
  Button,
  Card,
  CardHead,
  EmptyState,
  ListSkeleton,
  Row,
  Select,
  TextField,
  Toggle,
  gramsLabel,
} from '../ui';

type Vendor = { id: number; name: string; archived: boolean };
type Brand = { id: number; name: string };
type Weight = { id: number; grams: number };
type PriceRow = { vendorId: number; brandId: number; brandName: string; pricePerKgEur: number };
type AvailabilityEntry = { name: string; available: boolean };

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

  const [uploadBrandId, setUploadBrandId] = useState<number | null>(null);
  const [uploadWeightId, setUploadWeightId] = useState<number | null>(null);
  const [proposedEntries, setProposedEntries] = useState<AvailabilityEntry[] | null>(null);
  const [uploading, setUploading] = useState(false);
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

  function handleFileSelected(file: File | undefined) {
    if (!file || selectedVendorId == null || uploadBrandId == null || uploadWeightId == null) return;
    // Gemini parsing is the most failure-prone call in the app: a failure must
    // surface, not just silently clear the spinner.
    return run(async () => {
      setUploading(true);
      try {
        const { entries } = await uploadAvailabilityImage(selectedVendorId, uploadBrandId, uploadWeightId, file);
        setProposedEntries(entries);
      } finally {
        setUploading(false);
      }
    });
  }

  function toggleEntry(index: number) {
    if (!proposedEntries) return;
    const next = [...proposedEntries];
    next[index] = { ...next[index], available: !next[index].available };
    setProposedEntries(next);
  }

  function confirmAvailability() {
    if (selectedVendorId == null || uploadBrandId == null || uploadWeightId == null || !proposedEntries) return;
    return run(async () => {
      await api.post('/admin/availability/confirm', {
        vendorId: selectedVendorId,
        brandId: uploadBrandId,
        weightId: uploadWeightId,
        entries: proposedEntries,
      });
      setProposedEntries(null);
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

          <Card>
            <CardHead title="Наличие по фото" />
            <p className="tb-subtitle">
              Загрузка заменяет наличие целиком для выбранной пары «бренд + граммовка».
            </p>
            <div className="tb-fieldrow">
              <Select
                label="Бренд"
                value={uploadBrandId}
                onChange={setUploadBrandId}
                placeholder="Бренд..."
                options={brands.map((brand) => ({ value: brand.id, label: brand.name }))}
              />
              <Select
                label="Граммовка"
                value={uploadWeightId}
                onChange={setUploadWeightId}
                placeholder="Граммовка..."
                options={weights.map((weight) => ({
                  value: weight.id,
                  label: gramsLabel(weight.grams),
                }))}
              />
            </div>
            <span className="tb-field">
              <label className="tb-field__label" htmlFor="availability-file">
                Файл наличия
              </label>
              <input
                id="availability-file"
                className="tb-input"
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={(event) => handleFileSelected(event.target.files?.[0])}
              />
            </span>
            {uploading && <Banner>Распознаём вкусы на фото…</Banner>}

            {proposedEntries && (
              <>
                <CardHead title="Проверь распознанное" />
                <div className="tb-stack">
                  {proposedEntries.map((entry, index) => (
                    <Toggle
                      key={entry.name}
                      label={entry.name}
                      pressed={entry.available}
                      onChange={() => toggleEntry(index)}
                    />
                  ))}
                </div>
                <Button variant="primary" block onClick={confirmAvailability}>
                  Сохранить наличие
                </Button>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

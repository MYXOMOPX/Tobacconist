import { useEffect, useState } from 'react';
import { api, uploadAvailabilityImage } from '../apiClient';

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

  const [uploadBrandId, setUploadBrandId] = useState<number | null>(null);
  const [uploadWeightId, setUploadWeightId] = useState<number | null>(null);
  const [proposedEntries, setProposedEntries] = useState<AvailabilityEntry[] | null>(null);
  const [uploading, setUploading] = useState(false);

  async function reloadCatalog() {
    setVendors(await api.get<Vendor[]>('/admin/vendors'));
    setBrands(await api.get<Brand[]>('/admin/brands'));
    setWeights(await api.get<Weight[]>('/admin/weights'));
  }

  useEffect(() => {
    reloadCatalog();
  }, []);

  useEffect(() => {
    if (selectedVendorId == null) {
      setPrices([]);
      return;
    }
    api.get<PriceRow[]>(`/admin/vendors/${selectedVendorId}/prices`).then(setPrices);
  }, [selectedVendorId]);

  async function createVendor() {
    if (!newVendorName.trim()) return;
    await api.post('/admin/vendors', { name: newVendorName.trim() });
    setNewVendorName('');
    await reloadCatalog();
  }

  async function createBrand() {
    if (!newBrandName.trim()) return;
    await api.post('/admin/brands', { name: newBrandName.trim() });
    setNewBrandName('');
    await reloadCatalog();
  }

  async function savePrice(brandId: number) {
    if (selectedVendorId == null) return;
    const value = Number(priceInputs[brandId]);
    if (!value || value <= 0) return;
    await api.put(`/admin/vendors/${selectedVendorId}/prices/${brandId}`, { pricePerKgEur: value });
    setPrices(await api.get<PriceRow[]>(`/admin/vendors/${selectedVendorId}/prices`));
  }

  async function handleFileSelected(file: File | undefined) {
    if (!file || selectedVendorId == null || uploadBrandId == null || uploadWeightId == null) return;
    setUploading(true);
    try {
      const { entries } = await uploadAvailabilityImage(selectedVendorId, uploadBrandId, uploadWeightId, file);
      setProposedEntries(entries);
    } finally {
      setUploading(false);
    }
  }

  function toggleEntry(index: number) {
    if (!proposedEntries) return;
    const next = [...proposedEntries];
    next[index] = { ...next[index], available: !next[index].available };
    setProposedEntries(next);
  }

  async function confirmAvailability() {
    if (selectedVendorId == null || uploadBrandId == null || uploadWeightId == null || !proposedEntries) return;
    await api.post('/admin/availability/confirm', {
      vendorId: selectedVendorId,
      brandId: uploadBrandId,
      weightId: uploadWeightId,
      entries: proposedEntries,
    });
    setProposedEntries(null);
  }

  return (
    <section>
      <h2>Барыги</h2>
      <ul>
        {vendors.map((v) => (
          <li key={v.id}>
            <button onClick={() => setSelectedVendorId(v.id)}>{v.name}</button>
          </li>
        ))}
      </ul>
      <input value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} placeholder="Новый барыга" />
      <button onClick={createVendor}>Добавить барыгу</button>

      <h2>Бренды</h2>
      <ul>
        {brands.map((b) => (
          <li key={b.id}>{b.name}</li>
        ))}
      </ul>
      <input value={newBrandName} onChange={(e) => setNewBrandName(e.target.value)} placeholder="Новый бренд" />
      <button onClick={createBrand}>Добавить бренд</button>

      {selectedVendorId != null && (
        <>
          <h2>Цены (€/кг)</h2>
          <ul>
            {brands.map((b) => {
              const existing = prices.find((p) => p.brandId === b.id);
              return (
                <li key={b.id}>
                  {b.name}: {existing ? `${existing.pricePerKgEur} €/кг` : 'не задано'}
                  <input
                    value={priceInputs[b.id] ?? ''}
                    onChange={(e) => setPriceInputs({ ...priceInputs, [b.id]: e.target.value })}
                  />
                  <button onClick={() => savePrice(b.id)}>Сохранить</button>
                </li>
              );
            })}
          </ul>

          <h2>Загрузить наличие</h2>
          <select
            value={uploadBrandId ?? ''}
            onChange={(e) => setUploadBrandId(Number(e.target.value) || null)}
          >
            <option value="">Бренд...</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select
            value={uploadWeightId ?? ''}
            onChange={(e) => setUploadWeightId(Number(e.target.value) || null)}
          >
            <option value="">Граммовка...</option>
            {weights.map((w) => (
              <option key={w.id} value={w.id}>
                {w.grams}г
              </option>
            ))}
          </select>
          <label>
            Файл наличия
            <input
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={(e) => handleFileSelected(e.target.files?.[0])}
            />
          </label>

          {proposedEntries && (
            <div>
              <h3>Проверь распознанное</h3>
              <ul>
                {proposedEntries.map((entry, i) => (
                  <li key={entry.name}>
                    <label>
                      <input type="checkbox" checked={entry.available} onChange={() => toggleEntry(i)} />
                      {entry.name}
                    </label>
                  </li>
                ))}
              </ul>
              <button onClick={confirmAvailability}>Сохранить наличие</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

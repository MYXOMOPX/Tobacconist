import { useEffect, useState } from 'react';
import { api } from '../apiClient';
import { useAction } from '../useAction';
import type { Brand, DuplicateGroup, DuplicateReview, Flavor, FlavorImportResult, Vendor } from '../types';
import { Banner, Button, Card, CardHead, EmptyState, ListSkeleton, Row, TextField, Toggle } from '../ui';

/**
 * One brand's reference flavour list. Pasted one per line; screenshots are
 * later snapped to these spellings, so a typo on a photo lands on the real name.
 */
function BrandFlavors({ brand }: { brand: Brand }) {
  const [flavors, setFlavors] = useState<Flavor[]>([]);
  const [text, setText] = useState('');
  const [report, setReport] = useState<string | null>(null);
  /** The merge preview; `chosen` holds the keep ids of the groups still ticked. */
  const [review, setReview] = useState<DuplicateGroup[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const { error, run } = useAction();

  const reload = async () => setFlavors(await api.get<Flavor[]>(`/admin/brands/${brand.id}/flavors`));

  useEffect(() => {
    run(reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand.id]);

  function save() {
    if (!text.trim()) return;
    return run(async () => {
      const result = await api.post<FlavorImportResult>(`/admin/brands/${brand.id}/flavors/import`, { text });
      setText('');
      setReport(
        `Добавлено: ${result.added.length}` +
          (result.skipped.length ? `, уже были: ${result.skipped.length}` : '')
      );
      await reload();
    });
  }

  function findDuplicates() {
    return run(async () => {
      const result = await api.post<DuplicateReview>(`/admin/brands/${brand.id}/flavors/duplicates`);
      setReview(result.groups);
      setChosen(new Set(result.groups.map((group) => group.keep.id)));
    });
  }

  function toggleGroup(keepId: number) {
    const next = new Set(chosen);
    if (!next.delete(keepId)) next.add(keepId);
    setChosen(next);
  }

  function applyMerges() {
    const merges = (review ?? [])
      .filter((group) => chosen.has(group.keep.id))
      .map((group) => ({ keepId: group.keep.id, dropIds: group.duplicates.map((d) => d.id) }));
    if (merges.length === 0) return;
    return run(async () => {
      await api.post(`/admin/brands/${brand.id}/flavors/merge`, { merges });
      setReview(null);
      setReport(`Слито вкусов: ${merges.reduce((n, m) => n + m.dropIds.length, 0)}`);
      await reload();
    });
  }

  return (
    <div className="tb-stack">
      {error && <Banner tone="danger">{error}</Banner>}
      <p className="tb-subtitle">
        {flavors.length === 0
          ? 'Список вкусов пуст.'
          : `Вкусов в списке: ${flavors.length}. ${flavors.map((flavor) => flavor.name).join(', ')}`}
      </p>
      <TextField
        label={`Список вкусов ${brand.name}`}
        value={text}
        onChange={setText}
        placeholder="По одному вкусу на строку"
        rows={6}
      />
      {report && <Banner tone="info">{report}</Banner>}
      <Button onClick={save}>Загрузить список</Button>

      <Button onClick={findDuplicates}>Найти дубли и опечатки</Button>
      {review && review.length === 0 && <Banner tone="info">Дублей и опечаток не нашлось.</Banner>}
      {review && review.length > 0 && (
        <>
          <p className="tb-subtitle">Что будет слито — сними галочку с лишнего:</p>
          {review.map((group) => (
            <Toggle
              key={group.keep.id}
              label={`${group.duplicates.map((d) => d.name).join(', ')} → ${group.keep.name}`}
              pressed={chosen.has(group.keep.id)}
              onChange={() => toggleGroup(group.keep.id)}
            />
          ))}
          <Button variant="primary" onClick={applyMerges}>
            Слить выбранное
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * The list of vendors and the brand catalogue. Everything about one vendor —
 * prices, stock, deletion — lives on its own page, one tap in.
 */
export function AdminCatalogPage({ onOpenVendor }: { onOpenVendor: (vendorId: number) => void }) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [newVendorName, setNewVendorName] = useState('');
  const [newBrandName, setNewBrandName] = useState('');
  const [openBrandId, setOpenBrandId] = useState<number | null>(null);
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
            <div key={brand.id}>
              <Row
                label={brand.name}
                note="список вкусов"
                trailing={<span aria-hidden="true">{openBrandId === brand.id ? '⌃' : '›'}</span>}
                onClick={() => setOpenBrandId(openBrandId === brand.id ? null : brand.id)}
              />
              {openBrandId === brand.id && <BrandFlavors brand={brand} />}
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

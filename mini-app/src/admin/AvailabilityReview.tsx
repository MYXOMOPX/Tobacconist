import { useRef, useState } from 'react';
import { api, uploadAvailabilityImage, type ParsedScreenshot } from '../apiClient';
import { useAction } from '../useAction';
import type { Brand, Weight } from '../types';
import {
  Badge,
  Banner,
  Button,
  Card,
  CardHead,
  EmptyState,
  Select,
  TextField,
  Toggle,
  gramsLabel,
} from '../ui';

/** One screenshot after parsing, with whatever the admin has corrected on top. */
type Group = {
  key: string;
  fileName: string;
  detectedBrandName: string | null;
  detectedGrams: number | null;
  brandId: number | null;
  weightId: number | null;
  /** Set when the detected brand is not in the catalogue and is being created. */
  newBrandName: string;
  entries: { name: string; available: boolean; originalName?: string }[];
};

let counter = 0;

/** Marks a flavour whose spelling was corrected; a tap shows what the photo said. */
function TypoHint({ original }: { original: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="tb-typo">
      <button
        type="button"
        className="tb-typo__btn"
        aria-label="Исправлена опечатка"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ✎
      </button>
      {open && (
        <span className="tb-typo__tip" role="tooltip">
          Распознано: {original}
        </span>
      )}
    </span>
  );
}

/**
 * Spec §4: the admin throws in a pile of screenshots, the model reads the brand,
 * the weight and the flavours off each one, and this screen is where a human
 * checks that before anything is written.
 */
export function AvailabilityReview({
  vendorId,
  vendorName,
  brands,
  weights,
  onSaved,
}: {
  vendorId: number;
  vendorName: string;
  brands: Brand[];
  weights: Weight[];
  onSaved: () => void;
}) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [wipeOthers, setWipeOthers] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { error, run } = useAction();

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = Array.from(files);
    return run(async () => {
      setBusy(true);
      const failed: string[] = [];
      try {
        for (const file of picked) {
          let parsed: ParsedScreenshot;
          try {
            parsed = await uploadAvailabilityImage(vendorId, file);
          } catch {
            // One unreadable screenshot must not throw away the rest of the batch.
            failed.push(file.name);
            continue;
          }
          setGroups((current) => merge(current, parsed, file.name));
        }
      } finally {
        setBusy(false);
        setFailures(failed);
        if (fileInput.current) fileInput.current.value = '';
      }
    });
  }

  /** A long list often spans several screenshots, so the same brand+weight unions. */
  function merge(current: Group[], parsed: ParsedScreenshot, fileName: string): Group[] {
    const twin =
      parsed.brandId && parsed.weightId
        ? current.find(
            (group) => group.brandId === parsed.brandId && group.weightId === parsed.weightId
          )
        : undefined;

    if (twin) {
      const byName = new Map(twin.entries.map((entry) => [entry.name.toLowerCase(), entry]));
      for (const entry of parsed.entries) byName.set(entry.name.toLowerCase(), entry);
      return current.map((group) =>
        group.key === twin.key
          ? { ...group, entries: [...byName.values()], fileName: `${group.fileName}, ${fileName}` }
          : group
      );
    }

    return [
      ...current,
      {
        key: `g${counter++}`,
        fileName,
        detectedBrandName: parsed.detectedBrandName,
        detectedGrams: parsed.detectedGrams,
        brandId: parsed.brandId,
        weightId: parsed.weightId,
        newBrandName: parsed.brandId ? '' : (parsed.detectedBrandName ?? ''),
        entries: parsed.entries,
      },
    ];
  }

  function patch(key: string, change: Partial<Group>) {
    setGroups((current) =>
      current.map((group) => (group.key === key ? { ...group, ...change } : group))
    );
  }

  function toggleEntry(key: string, index: number) {
    setGroups((current) =>
      current.map((group) =>
        group.key === key
          ? {
              ...group,
              entries: group.entries.map((entry, i) =>
                i === index ? { ...entry, available: !entry.available } : entry
              ),
            }
          : group
      )
    );
  }

  const resolved = groups.every(
    (group) => (group.brandId || group.newBrandName.trim()) && group.weightId
  );

  function save() {
    return run(async () => {
      const payload = [];
      for (const group of groups) {
        // A brand the catalogue has never seen is created only now, on save —
        // not while the admin is still deciding what the screenshot showed.
        const brandId =
          group.brandId ??
          (await api.post<Brand>('/admin/brands', { name: group.newBrandName.trim() })).id;
        payload.push({ brandId, weightId: group.weightId!, entries: group.entries });
      }
      await api.post('/admin/availability/confirm', { vendorId, groups: payload, wipeOthers });
      setGroups([]);
      setWipeOthers(false);
      onSaved();
    });
  }

  return (
    <Card>
      <CardHead title="Наличие по фото" />
      <p className="tb-subtitle">
        Закинь скрины прайса {vendorName} — бренд, граммовку и вкусы распознает ИИ, а ты проверишь.
      </p>

      {error && <Banner tone="danger">{error}</Banner>}
      {failures.length > 0 && (
        <Banner tone="warning">Не удалось распознать: {failures.join(', ')}. Попробуй перезалить.</Banner>
      )}

      <span className="tb-field">
        <label className="tb-field__label" htmlFor="availability-files">
          Скрины наличия
        </label>
        <input
          id="availability-files"
          ref={fileInput}
          className="tb-input"
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          onChange={(event) => addFiles(event.target.files)}
        />
      </span>
      {busy && <Banner>Распознаём вкусы на фото…</Banner>}

      {groups.length === 0 ? (
        <EmptyState title="Скринов пока нет" text="Можно закинуть сразу несколько — они разберутся по брендам." />
      ) : (
        groups.map((group) => (
          <Card key={group.key}>
            <CardHead
              title={group.detectedBrandName ?? 'Бренд не распознан'}
              trailing={
                <Badge tone={group.brandId && group.weightId ? 'ordering' : 'awaiting'}>
                  {group.entries.length} вкусов
                </Badge>
              }
            />
            <p className="tb-subtitle">{group.fileName}</p>

            <div className="tb-fieldrow">
              <Select
                label="Бренд"
                value={group.brandId}
                onChange={(next) => patch(group.key, { brandId: next })}
                placeholder={group.detectedBrandName ? `Создать «${group.detectedBrandName}»` : 'Выбери бренд'}
                options={brands.map((brand) => ({ value: brand.id, label: brand.name }))}
              />
              <Select
                label="Граммовка"
                value={group.weightId}
                onChange={(next) => patch(group.key, { weightId: next })}
                placeholder="Не распознана"
                options={weights.map((weight) => ({
                  value: weight.id,
                  label: gramsLabel(weight.grams),
                }))}
              />
            </div>

            {!group.brandId && (
              <TextField
                label="Название нового бренда"
                value={group.newBrandName}
                onChange={(next) => patch(group.key, { newBrandName: next })}
                placeholder="Например: DarkSide"
              />
            )}

            {group.entries.map((entry, index) => (
              <div className="tb-entry" key={`${entry.name}-${index}`}>
                <Toggle
                  label={entry.name}
                  pressed={entry.available}
                  onChange={() => toggleEntry(group.key, index)}
                />
                {entry.originalName && <TypoHint original={entry.originalName} />}
              </div>
            ))}

            <Button onClick={() => setGroups(groups.filter((g) => g.key !== group.key))}>
              Убрать этот скрин
            </Button>
          </Card>
        ))
      )}

      {groups.length > 0 && (
        <>
          <Toggle
            label="Убрать всё другое наличие"
            pressed={wipeOthers}
            onChange={setWipeOthers}
          />
          {wipeOthers && (
            <Banner tone="warning">
              Всё, чего нет в этих скринах, будет удалено у {vendorName} — по всем брендам и
              граммовкам. Зачёркнутые на скринах останутся с выключенной галочкой. Уже заказанные позиции не пропадут, их пометят «больше не в наличии».
            </Banner>
          )}
          <Button variant="primary" block disabled={!resolved || busy} onClick={save}>
            Сохранить наличие
          </Button>
          {!resolved && (
            <p className="tb-subtitle">У каждого скрина должен быть бренд и граммовка.</p>
          )}
        </>
      )}
    </Card>
  );
}

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  deliveryChecklistItems,
  flavors,
  orderItems,
  vendorFlavorAvailability,
} from '../db/schema.js';
import {
  damerauLevenshtein,
  maxDoubtfulDistance,
  maxTypoDistance,
  normalizeFlavorName,
} from './flavorMatch.js';

export type FlavorRef = { id: number; name: string };

/** One real flavour and the spellings that should be folded into it. */
export type DuplicateGroup = {
  keep: FlavorRef;
  duplicates: FlavorRef[];
  /** True when the match is a respelling only by the distance rule, not an exact normalised twin. */
  fuzzy: boolean;
};

/**
 * Clusters a brand's flavours that look like one another: the same name once
 * normalised, or a typo apart (`wide` widens that to what only a judge may
 * confirm). Transitive, so A~B and B~C land in one cluster.
 * Returns only clusters of two or more, each as the list of its members.
 */
export async function findDuplicateClusters(
  db: Db,
  brandId: number,
  opts: { wide?: boolean } = {}
): Promise<FlavorRef[][]> {
  const limit = opts.wide ? maxDoubtfulDistance : maxTypoDistance;
  const all = await db.select().from(flavors).where(eq(flavors.brandId, brandId)).all();
  const keys = all.map((flavor) => normalizeFlavorName(flavor.name));

  const parent = all.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));

  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (!keys[i] || !keys[j]) continue;
      const same =
        keys[i] === keys[j] ||
        damerauLevenshtein(keys[i], keys[j]) <= limit(Math.min(keys[i].length, keys[j].length));
      if (same) parent[find(i)] = find(j);
    }
  }

  const clusters = new Map<number, FlavorRef[]>();
  all.forEach((flavor, i) => {
    const root = find(i);
    clusters.set(root, [...(clusters.get(root) ?? []), { id: flavor.id, name: flavor.name }]);
  });
  return [...clusters.values()].filter((members) => members.length > 1);
}

/** How many rows lean on each flavour: the best-used spelling is the one to keep. */
async function usageByFlavor(db: Db, ids: number[]): Promise<Map<number, number>> {
  const usage = new Map<number, number>(ids.map((id) => [id, 0]));
  const bump = (rows: { flavorId: number }[]) => {
    for (const row of rows) usage.set(row.flavorId, (usage.get(row.flavorId) ?? 0) + 1);
  };
  bump(
    await db
      .select({ flavorId: vendorFlavorAvailability.flavorId })
      .from(vendorFlavorAvailability)
      .where(inArray(vendorFlavorAvailability.flavorId, ids))
      .all()
  );
  bump(
    await db
      .select({ flavorId: orderItems.flavorId })
      .from(orderItems)
      .where(inArray(orderItems.flavorId, ids))
      .all()
  );
  return usage;
}

/** Picks, in each cluster, the most used spelling (the oldest on a tie) as the one to keep. */
export async function proposeMerges(db: Db, clusters: FlavorRef[][]): Promise<DuplicateGroup[]> {
  const groups: DuplicateGroup[] = [];
  for (const members of clusters) {
    const usage = await usageByFlavor(db, members.map((m) => m.id));
    const ranked = [...members].sort(
      (a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || a.id - b.id
    );
    const [keep, ...duplicates] = ranked;
    groups.push({
      keep,
      duplicates,
      fuzzy: duplicates.some(
        (dup) => normalizeFlavorName(dup.name) !== normalizeFlavorName(keep.name)
      ),
    });
  }
  return groups;
}

/**
 * Folds `dropId` into `keepId`: every row that pointed at the dropped flavour
 * now points at the kept one, and where both already had a row the two are
 * combined rather than left to collide on the unique keys.
 */
async function mergeOne(db: Db, keepId: number, dropId: number) {
  const dropAvail = await db
    .select()
    .from(vendorFlavorAvailability)
    .where(eq(vendorFlavorAvailability.flavorId, dropId))
    .all();
  for (const row of dropAvail) {
    const twin = await db
      .select()
      .from(vendorFlavorAvailability)
      .where(
        and(
          eq(vendorFlavorAvailability.vendorId, row.vendorId),
          eq(vendorFlavorAvailability.flavorId, keepId),
          eq(vendorFlavorAvailability.weightId, row.weightId)
        )
      )
      .get();
    if (twin) {
      if (row.available && !twin.available) {
        await db
          .update(vendorFlavorAvailability)
          .set({ available: true, updatedAt: row.updatedAt })
          .where(eq(vendorFlavorAvailability.id, twin.id))
          .run();
      }
      await db.delete(vendorFlavorAvailability).where(eq(vendorFlavorAvailability.id, row.id)).run();
    } else {
      await db
        .update(vendorFlavorAvailability)
        .set({ flavorId: keepId })
        .where(eq(vendorFlavorAvailability.id, row.id))
        .run();
    }
  }

  const dropItems = await db.select().from(orderItems).where(eq(orderItems.flavorId, dropId)).all();
  for (const row of dropItems) {
    const twin = await db
      .select()
      .from(orderItems)
      .where(
        and(
          eq(orderItems.orderId, row.orderId),
          eq(orderItems.userId, row.userId),
          eq(orderItems.brandId, row.brandId),
          eq(orderItems.flavorId, keepId),
          eq(orderItems.weightId, row.weightId)
        )
      )
      .get();
    if (twin) {
      await db
        .update(orderItems)
        .set({
          quantity: twin.quantity + row.quantity,
          deliveredQty:
            twin.deliveredQty === null && row.deliveredQty === null
              ? null
              : (twin.deliveredQty ?? 0) + (row.deliveredQty ?? 0),
        })
        .where(eq(orderItems.id, twin.id))
        .run();
      await db.delete(orderItems).where(eq(orderItems.id, row.id)).run();
    } else {
      await db.update(orderItems).set({ flavorId: keepId }).where(eq(orderItems.id, row.id)).run();
    }
  }

  const dropChecklist = await db
    .select()
    .from(deliveryChecklistItems)
    .where(eq(deliveryChecklistItems.flavorId, dropId))
    .all();
  for (const row of dropChecklist) {
    const twin = await db
      .select()
      .from(deliveryChecklistItems)
      .where(
        and(
          eq(deliveryChecklistItems.orderId, row.orderId),
          eq(deliveryChecklistItems.brandId, row.brandId),
          eq(deliveryChecklistItems.flavorId, keepId),
          eq(deliveryChecklistItems.weightId, row.weightId)
        )
      )
      .get();
    if (twin) {
      await db
        .update(deliveryChecklistItems)
        .set({
          expectedQty: twin.expectedQty + row.expectedQty,
          receivedQty: twin.receivedQty + row.receivedQty,
        })
        .where(eq(deliveryChecklistItems.id, twin.id))
        .run();
      await db.delete(deliveryChecklistItems).where(eq(deliveryChecklistItems.id, row.id)).run();
    } else {
      await db
        .update(deliveryChecklistItems)
        .set({ flavorId: keepId })
        .where(eq(deliveryChecklistItems.id, row.id))
        .run();
    }
  }

  await db.delete(flavors).where(eq(flavors.id, dropId)).run();
}

/** Applies confirmed merges. Everything must belong to `brandId`: the caller's ids are not trusted. */
export async function mergeFlavors(
  db: Db,
  brandId: number,
  merges: { keepId: number; dropIds: number[] }[]
) {
  const ids = [...new Set(merges.flatMap((m) => [m.keepId, ...m.dropIds]))];
  const rows = ids.length
    ? await db.select().from(flavors).where(inArray(flavors.id, ids)).all()
    : [];
  if (rows.length !== ids.length || rows.some((row) => row.brandId !== brandId)) {
    throw new Error('every flavour to merge must exist and belong to this brand');
  }
  if (merges.some((m) => m.dropIds.includes(m.keepId))) {
    throw new Error('a flavour cannot be merged into itself');
  }
  const dropped = new Set(merges.flatMap((m) => m.dropIds));
  if (merges.some((m) => dropped.has(m.keepId))) {
    throw new Error('a flavour cannot be both merged away and kept');
  }

  let merged = 0;
  for (const { keepId, dropIds } of merges) {
    for (const dropId of dropIds) {
      await mergeOne(db, keepId, dropId);
      merged++;
    }
  }
  return { merged };
}

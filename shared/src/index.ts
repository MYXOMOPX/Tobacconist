export type Weight = { id: number; grams: number };

export type Brand = { id: number; name: string };

export type Flavor = { id: number; brandId: number; name: string };

export type Vendor = { id: number; name: string; archived: boolean };

export type VendorBrandPriceDto = {
  vendorId: number;
  brandId: number;
  brandName: string;
  pricePerKgEur: number;
};

export type AvailabilityLineDto = {
  flavorId: number;
  flavorName: string;
  weightId: number;
  grams: number;
  available: boolean;
};

export type AggregateLineDto = {
  brandId: number;
  brandName: string;
  flavorId: number;
  flavorName: string;
  weightId: number;
  grams: number;
  quantity: number;
  /** What actually arrived for this line once the delivery was checked (§7.1); null before that. */
  deliveredQty: number | null;
  totalEur: number;
  /** False when the (flavor, weight) pair is no longer stocked by the order's vendor. */
  available: boolean;
};

export type UserSummaryDto = {
  userId: number;
  displayName: string;
  items: AggregateLineDto[];
  totalKg: number;
  totalEur: number;
  paid: boolean;
  /** The participant's own "I'm done picking" mark (§5). */
  ready: boolean;
  hasUnavailableItems: boolean;
};

/** Spec §5. Active while ordering or awaiting_validation; done and rejected are terminal. */
export type OrderStatus = 'ordering' | 'awaiting_validation' | 'done' | 'rejected';

export type OrderDto = {
  id: number;
  vendorId: number;
  vendorName: string;
  status: OrderStatus;
  createdAt: string;
  statusChangedAt: string;
};

export type ChecklistItemDto = {
  id: number;
  brandId: number;
  brandName: string;
  flavorId: number;
  flavorName: string;
  weightId: number;
  grams: number;
  expectedQty: number;
  receivedQty: number;
};

export type PaymentDto = {
  userId: number;
  displayName: string;
  paid: boolean;
};

/** One position where the delivery did not match the order, and who ordered it (§7.1). */
export type DiscrepancyDto = {
  brandId: number;
  brandName: string;
  flavorId: number;
  flavorName: string;
  weightId: number;
  grams: number;
  expectedQty: number;
  receivedQty: number;
  participants: {
    orderItemId: number;
    userId: number;
    displayName: string;
    quantity: number;
    proposedDeliveredQty: number;
  }[];
};

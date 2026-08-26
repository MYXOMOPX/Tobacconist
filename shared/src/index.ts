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
  totalEur: number;
};

export type UserSummaryDto = {
  userId: number;
  displayName: string;
  items: AggregateLineDto[];
  totalKg: number;
  totalEur: number;
  paid: boolean;
  hasUnavailableItems: boolean;
};

export type RoundDto = {
  id: number;
  vendorId: number;
  vendorName: string;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt: string | null;
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

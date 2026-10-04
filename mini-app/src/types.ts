export type Me = { id: number; telegramId: string; displayName: string; role: 'admin' | 'member' };

export type OrderStatus = 'ordering' | 'awaiting_validation' | 'done' | 'rejected';

export type OrderDto = {
  id: number;
  vendorId: number;
  vendorName: string;
  status: OrderStatus;
  createdAt: string;
  statusChangedAt: string;
};

export type AssortmentRow = {
  brandId: number;
  brandName: string;
  flavorId: number;
  flavorName: string;
  weightId: number;
  grams: number;
  available: boolean;
};

export type AggregateLine = {
  brandId: number;
  brandName: string;
  flavorId: number;
  flavorName: string;
  weightId: number;
  grams: number;
  quantity: number;
  deliveredQty: number | null;
  totalEur: number;
  available: boolean;
};

export type MyOrderDto = {
  order: OrderDto;
  items: AggregateLine[];
  totalKg: number;
  totalEur: number;
  ready: boolean;
  paid: boolean;
  hasUnavailableItems: boolean;
};

export type ParticipantSummary = {
  userId: number;
  displayName: string;
  items: AggregateLine[];
  totalKg: number;
  totalEur: number;
  paid: boolean;
  ready: boolean;
};

export type ChecklistItem = {
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

export type Discrepancy = {
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

export type Vendor = { id: number; name: string; archived: boolean };

export type Brand = { id: number; name: string };

export type Weight = { id: number; grams: number };

export type SnapshotDto = {
  text: string;
  table: { brand: string; flavor: string; weight: string; quantity: number; totalEur: number }[];
};

export type Flavor = { id: number; brandId: number; name: string };

export type FlavorImportResult = { added: string[]; skipped: string[] };

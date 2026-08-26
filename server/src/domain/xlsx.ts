import ExcelJS from 'exceljs';

export type TableRow = { brand: string; flavor: string; weight: string; quantity: number; totalEur: number };

export async function buildSnapshotWorkbook(rows: TableRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Order');
  sheet.columns = [
    { header: 'Brand', key: 'brand', width: 20 },
    { header: 'Flavor', key: 'flavor', width: 24 },
    { header: 'Weight', key: 'weight', width: 10 },
    { header: 'Quantity', key: 'quantity', width: 10 },
    { header: 'Total EUR', key: 'totalEur', width: 12 },
  ];
  sheet.addRows(rows);
  const totalEur = Math.round(rows.reduce((s, r) => s + r.totalEur, 0) * 100) / 100;
  sheet.addRow({ brand: '', flavor: '', weight: '', quantity: null, totalEur });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

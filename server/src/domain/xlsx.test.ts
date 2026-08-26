import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildSnapshotWorkbook } from './xlsx';

describe('buildSnapshotWorkbook', () => {
  it('writes a header row, data rows, and a total row', async () => {
    const buffer = await buildSnapshotWorkbook([
      { brand: 'DarkSide', flavor: 'CyberKiwi', weight: '250g', quantity: 3, totalEur: 15 },
    ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.getWorksheet('Order')!;
    expect(sheet.getRow(1).getCell(1).value).toBe('Brand');
    expect(sheet.getRow(2).getCell(1).value).toBe('DarkSide');
    expect(sheet.getRow(2).getCell(4).value).toBe(3);
    expect(sheet.getRow(3).getCell(5).value).toBe(15);
  });
});

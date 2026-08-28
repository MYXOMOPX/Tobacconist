import type { AggregateLine } from './summary.js';

function sortedLines(lines: AggregateLine[]): AggregateLine[] {
  return [...lines].sort((a, b) => {
    if (a.brandName !== b.brandName) return a.brandName.localeCompare(b.brandName);
    if (a.flavorName !== b.flavorName) return a.flavorName.localeCompare(b.flavorName);
    return a.grams - b.grams;
  });
}

export function buildTextSnapshot(lines: AggregateLine[]): string {
  const sorted = sortedLines(lines);
  const blocks: string[] = [];
  let currentBrand: string | null = null;
  let currentLines: string[] = [];

  for (const line of sorted) {
    if (line.brandName !== currentBrand) {
      if (currentBrand !== null) {
        blocks.push([currentBrand, ...currentLines].join('\n'));
      }
      currentBrand = line.brandName;
      currentLines = [];
    }
    currentLines.push(`${line.brandName} - ${line.flavorName} - ${line.grams}g - x${line.quantity}`);
  }
  if (currentBrand !== null) {
    blocks.push([currentBrand, ...currentLines].join('\n'));
  }

  return blocks.join('\n\n');
}

export function buildTableSnapshot(lines: AggregateLine[]) {
  return sortedLines(lines).map((line) => ({
    brand: line.brandName,
    flavor: line.flavorName,
    weight: `${line.grams}g`,
    quantity: line.quantity,
    totalEur: line.totalEur,
  }));
}

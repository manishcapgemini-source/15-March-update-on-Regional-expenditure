import { BudgetRecord, FinancialTransaction, VarianceRecord } from "../types";

type VarianceKeyParts = {
  year: number;
  region: string;
  station: string;
  category: string;
  itCategory: string;
  yearMonth: string;
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeKeyPart(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function normalizeStation(value: unknown): string {
  return normalizeText(value || "UNKNOWN").toUpperCase();
}

function buildVarianceKey(parts: VarianceKeyParts): string {
  return [
    parts.year,
    normalizeKeyPart(parts.region),
    normalizeKeyPart(parts.station),
    normalizeKeyPart(parts.category),
    normalizeKeyPart(parts.itCategory),
    normalizeKeyPart(parts.yearMonth)
  ].join("|");
}

function getMonthsPassed(actualData: FinancialTransaction[], selectedYear?: number): number {
  const months = new Set(
    actualData
      .filter((t) => (selectedYear ? t.year === selectedYear : true))
      .map((t) => t.yearMonth)
      .filter(Boolean)
  );

  return months.size || 1;
}

export type VarianceEngineResult = {
  varianceRecords: VarianceRecord[];
  summary: {
    totalBudget: number;
    totalActual: number;
    totalVariance: number;
    variancePct: number;
    budgetUsedPercent: number;
    runRate: number;
    forecastYearEnd: number;
    overspendRisk: number;
  };
};

export function buildVarianceRecords(
  actualData: FinancialTransaction[],
  budgetData: BudgetRecord[],
  selectedYear?: number
): VarianceEngineResult {
  const actualsMap = new Map<string, number>();
  const budgetsMap = new Map<string, number>();
  const keyMeta = new Map<string, VarianceKeyParts>();

  const filteredActuals = selectedYear
    ? actualData.filter((t) => t.year === selectedYear)
    : actualData;

  const filteredBudgets = selectedYear
    ? budgetData.filter((b) => b.year === selectedYear)
    : budgetData;

  for (const tx of filteredActuals) {
    const keyParts: VarianceKeyParts = {
      year: tx.year,
      region: normalizeText(tx.region),
      station: normalizeStation(tx.businessArea || tx.station || tx.country || "UNKNOWN"),
      category: normalizeText(tx.category || "Uncategorized"),
      itCategory: normalizeText(tx.itCategory || tx.category || "Uncategorized"),
      yearMonth: normalizeText(tx.yearMonth || `${tx.year}/01`)
    };

    const key = buildVarianceKey(keyParts);
    actualsMap.set(key, (actualsMap.get(key) || 0) + (tx.usd || 0));
    keyMeta.set(key, keyParts);
  }

  for (const budget of filteredBudgets) {
    const keyParts: VarianceKeyParts = {
      year: budget.year,
      region: normalizeText(budget.region),
      station: normalizeStation(budget.station),
      category: normalizeText(budget.category || "Uncategorized"),
      itCategory: normalizeText(budget.itCategory || budget.category || "Uncategorized"),
      yearMonth: normalizeText(budget.yearMonth || `${budget.year}/01`)
    };

    const key = buildVarianceKey(keyParts);
    budgetsMap.set(key, (budgetsMap.get(key) || 0) + (budget.budget || 0));
    keyMeta.set(key, keyParts);
  }

  const allKeys = new Set([...actualsMap.keys(), ...budgetsMap.keys()]);
  const monthsPassed = getMonthsPassed(filteredActuals, selectedYear);

  const varianceRecords: VarianceRecord[] = Array.from(allKeys).map((key) => {
    const meta = keyMeta.get(key)!;
    const actualUsd = actualsMap.get(key) || 0;
    const budgetUsd = budgetsMap.get(key) || 0;

    const variance = actualUsd - budgetUsd;
    const variancePct = budgetUsd !== 0 ? (variance / budgetUsd) * 100 : null;
    const budgetUsedPercent = budgetUsd !== 0 ? (actualUsd / budgetUsd) * 100 : null;

    // Row-level forecast is only indicative; using annualized logic from one row can be misleading.
    // Keep these values for UI compatibility but avoid overstating row-level forecast power.
    const runRate = actualUsd;
    const forecastYearEnd = actualUsd;
    const overspendRisk = actualUsd - budgetUsd;

    return {
      id: key,
      year: meta.year,
      region: meta.region,
      station: meta.station,
      category: meta.category,
      itCategory: meta.itCategory,
      yearMonth: meta.yearMonth,
      actualUsd,
      budgetUsd,
      variance,
      variancePct,
      budgetUsedPercent,
      runRate,
      forecastYearEnd,
      overspendRisk
    };
  });

  const totalBudget = varianceRecords.reduce((sum, r) => sum + r.budgetUsd, 0);
  const totalActual = varianceRecords.reduce((sum, r) => sum + r.actualUsd, 0);
  const totalVariance = totalActual - totalBudget;
  const variancePct = totalBudget !== 0 ? (totalVariance / totalBudget) * 100 : 0;
  const budgetUsedPercent = totalBudget !== 0 ? (totalActual / totalBudget) * 100 : 0;
  const runRate = totalActual / monthsPassed;
  const forecastYearEnd = runRate * 12;
  const overspendRisk = forecastYearEnd - totalBudget;

  return {
    varianceRecords,
    summary: {
      totalBudget,
      totalActual,
      totalVariance,
      variancePct,
      budgetUsedPercent,
      runRate,
      forecastYearEnd,
      overspendRisk
    }
  };
}

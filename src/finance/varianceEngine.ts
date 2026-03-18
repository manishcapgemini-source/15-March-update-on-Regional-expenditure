import { BudgetRecord, FinancialTransaction, VarianceRecord, ExpenditureType } from "../types";

type VarianceKeyParts = {
  year: number;
  region: string;
  station: string;
  category: string;
  itCategory: string;
  yearMonth: string;
  type: ExpenditureType;
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

function normalizeType(value: unknown): ExpenditureType {
  const str = String(value || "").toUpperCase().trim();
  if (str.includes("CAPEX")) return "CAPEX";
  if (str.includes("OPEX")) return "OPEX";
  return "OPEX";
}

function buildVarianceKey(parts: VarianceKeyParts): string {
  return [
    parts.year,
    normalizeKeyPart(parts.region),
    normalizeKeyPart(parts.station),
    normalizeKeyPart(parts.category),
    normalizeKeyPart(parts.itCategory),
    normalizeKeyPart(parts.yearMonth),
    normalizeKeyPart(parts.type)
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

function normalizeMatchValue(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

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
    const matchedCategory = tx.budgetCategory ? normalizeMatchValue(tx.budgetCategory) : normalizeText(tx.category || "Uncategorized");
    const matchedItem = tx.budgetItem ? normalizeMatchValue(tx.budgetItem) : normalizeText(tx.itCategory || tx.category || "Uncategorized");

    const keyParts: VarianceKeyParts = {
      year: tx.year,
      region: normalizeText(tx.region),
      station: normalizeStation(tx.businessArea || tx.station || tx.country || "UNKNOWN"),
      category: matchedCategory,
      itCategory: matchedItem,
      yearMonth: normalizeText(tx.yearMonth || `${tx.year}/01`),
      type: normalizeType(tx.expenditureType || tx.category)
    };

    const key = buildVarianceKey(keyParts);
    actualsMap.set(key, (actualsMap.get(key) || 0) + (tx.usd || 0));
    keyMeta.set(key, keyParts);
  }

  for (const budget of filteredBudgets) {
    const matchedCategory = normalizeMatchValue(budget.category || "Uncategorized");
    const matchedItem = normalizeMatchValue(budget.item || budget.category || "Uncategorized");

    const keyParts: VarianceKeyParts = {
      year: budget.year,
      region: normalizeText(budget.region),
      station: normalizeStation(budget.station),
      category: matchedCategory,
      itCategory: matchedItem,
      yearMonth: normalizeText(budget.yearMonth || `${budget.year}/01`),
      type: normalizeType(budget.type)
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

    const runRate = actualUsd / monthsPassed;
    const forecastYearEnd = runRate * 12;
    const overspendRisk = forecastYearEnd - budgetUsd;

    return {
      id: key,
      year: meta.year,
      region: meta.region,
      station: meta.station,
      category: meta.category,
      itCategory: meta.itCategory,
      yearMonth: meta.yearMonth,
      type: meta.type,
      actualUsd,
      budgetUsd,
      variance,
      variancePct,
      budgetUsedPercent,
      runRate,
      forecastYearEnd,
      overspendRisk,
      expenditureType: meta.type
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

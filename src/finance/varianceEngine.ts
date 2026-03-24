import { BudgetRecord, FinancialTransaction, VarianceRecord, ExpenditureType } from "../types";

type VarianceKeyParts = {
  year: number;
  region: string;
  station: string;
  country?: string;
  category: string;        // real category
  itCategory: string;      // real IT category
  budgetCategory: string;  // matched budget category
  budgetItem: string;      // matched budget item
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
    normalizeKeyPart(parts.budgetCategory),
    normalizeKeyPart(parts.budgetItem),
    normalizeKeyPart(parts.yearMonth),
    normalizeKeyPart(parts.type)
  ].join("|");
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
  selectedYears: string[] = [],
  periodView: 'monthly' | 'quarterly' | 'halfYearly' | 'fullYear' = 'fullYear',
  selectedQuarters: ('Q1' | 'Q2' | 'Q3' | 'Q4')[] = [],
  selectedHalves: ('H1' | 'H2')[] = [],
  selectedMonths: string[] = []
): VarianceEngineResult {
  const actualsMap = new Map<string, number>();
  const budgetsMap = new Map<string, number>();
  const keyMeta = new Map<string, VarianceKeyParts>();

  const getPeriodMonths = () => {
    if (periodView === 'monthly') {
      return selectedMonths.length > 0 ? selectedMonths : ['01'];
    }
    if (periodView === 'quarterly') {
      const quarterMonths = {
        Q1: ['01', '02', '03'],
        Q2: ['04', '05', '06'],
        Q3: ['07', '08', '09'],
        Q4: ['10', '11', '12'],
      };
      if (selectedQuarters.length === 0) return ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
      return selectedQuarters.flatMap(q => quarterMonths[q]);
    }
    if (periodView === 'halfYearly') {
      const halfMonths = {
        H1: ['01', '02', '03', '04', '05', '06'],
        H2: ['07', '08', '09', '10', '11', '12'],
      };
      if (selectedHalves.length === 0) return ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
      return selectedHalves.flatMap(h => halfMonths[h]);
    }
    return null;
  };

  const periodMonths = getPeriodMonths();

  const filterByPeriod = (records: any[]) => {
    if (!periodMonths) return records;
    return records.filter((r) => {
      const ym = String(r.yearMonth || "");
      const month = ym.includes("/") ? ym.split("/")[1] : ym.split("-")[1];
      return periodMonths.includes(month);
    });
  };

  let filteredActuals = selectedYears.length > 0
    ? actualData.filter((t) => selectedYears.includes(String(t.year)))
    : actualData;

  let filteredBudgets = selectedYears.length > 0
    ? budgetData.filter((b) => selectedYears.includes(String(b.year)))
    : budgetData;

  filteredActuals = filterByPeriod(filteredActuals);
  filteredBudgets = filterByPeriod(filteredBudgets);

  for (const tx of filteredActuals) {
    const matchedCategory = tx.budgetCategory
      ? normalizeMatchValue(tx.budgetCategory)
      : normalizeMatchValue(tx.category || "Uncategorized");

    const matchedItem = tx.budgetItem
      ? normalizeMatchValue(tx.budgetItem)
      : normalizeMatchValue(tx.itCategory || tx.category || "Uncategorized");

    const keyParts: VarianceKeyParts = {
      year: tx.year,
      region: normalizeText(tx.region),
      station: normalizeStation(tx.businessArea || tx.station || tx.country || "UNKNOWN"),
      country: normalizeText(tx.country),
      category: normalizeText(tx.category || "Uncategorized"),
      itCategory: normalizeText(tx.itCategory || tx.category || "Uncategorized"),
      budgetCategory: matchedCategory,
      budgetItem: matchedItem,
      yearMonth: normalizeText(tx.yearMonth || `${tx.year}/01`),
      type: normalizeType(tx.expenditureType || tx.category)
    };

    const key = buildVarianceKey(keyParts);
    actualsMap.set(key, (actualsMap.get(key) || 0) + (tx.usd || 0));
    keyMeta.set(key, keyParts);
  }

  for (const budget of filteredBudgets) {
    const matchedCategory = normalizeMatchValue(
      budget.budgetCategory || budget.category || "Uncategorized"
    );

    const matchedItem = normalizeMatchValue(
      budget.budgetItem || budget.item || budget.itCategory || budget.category || "Uncategorized"
    );

    const keyParts: VarianceKeyParts = {
      year: budget.year,
      region: normalizeText(budget.region),
      station: normalizeStation(budget.station),
      country: normalizeText(budget.country || ""),
      category: normalizeText(budget.category || "Uncategorized"),
      itCategory: normalizeText(budget.itCategory || budget.category || "Uncategorized"),
      budgetCategory: matchedCategory,
      budgetItem: matchedItem,
      yearMonth: normalizeText(budget.yearMonth || `${budget.year}/01`),
      type: normalizeType(budget.type)
    };

    const key = buildVarianceKey(keyParts);
    budgetsMap.set(key, (budgetsMap.get(key) || 0) + (budget.budget || 0));
    keyMeta.set(key, keyParts);
  }

  const allKeys = new Set([...actualsMap.keys(), ...budgetsMap.keys()]);
  
  const getMonthsInScopeCount = () => {
    if (periodView === 'monthly') return 1;
    if (periodView === 'quarterly') return 3;
    if (periodView === 'halfYearly') return 6;
    if (periodView === 'fullYear') return 12;
    return 1;
  };
  const monthsInScopeCount = getMonthsInScopeCount();

  const varianceRecords: VarianceRecord[] = Array.from(allKeys).map((key) => {
    const meta = keyMeta.get(key)!;
    const actualUsd = actualsMap.get(key) || 0;
    const budgetUsd = budgetsMap.get(key) || 0;

    const variance = actualUsd - budgetUsd;
    const variancePct = budgetUsd !== 0 ? (variance / budgetUsd) * 100 : null;
    const budgetUsedPercent = budgetUsd !== 0 ? (actualUsd / budgetUsd) * 100 : null;

    const runRate = actualUsd / monthsInScopeCount;
    const forecastYearEnd = runRate * 12;
    const overspendRisk = forecastYearEnd - budgetUsd;

    return {
      id: key,
      year: meta.year,
      region: meta.region,
      station: meta.station,
      country: meta.country || "",
      category: meta.category,
      itCategory: meta.itCategory,
      budgetCategory: meta.budgetCategory,
      budgetItem: meta.budgetItem,
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
  const runRate = totalActual / monthsInScopeCount;
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

import { BudgetRecord, FinancialTransaction, VarianceRecord } from "../types";
import { formatCurrency } from "../utils/formatters";

export type InsightLevel = "info" | "warning" | "success";

export interface InsightItem {
  id: string;
  level: InsightLevel;
  title: string;
  message: string;
}

function safeNumber(value: unknown): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function safeText(value: unknown): string {
  return String(value ?? "").trim();
}

function percent(part: number, total: number): number {
  if (!total) return 0;
  return (part / total) * 100;
}

export function generateInsights(
  actualData: FinancialTransaction[],
  budgetData: BudgetRecord[],
  varianceData: VarianceRecord[]
): InsightItem[] {

  const insights: InsightItem[] = [];

  const totalActual = actualData.reduce((sum, r) => sum + safeNumber(r.usd), 0);
  const totalBudget = budgetData.reduce((sum, r) => sum + safeNumber(r.budget), 0);
  const totalVariance = totalActual - totalBudget;

  // Budget vs Actual Insight
  if (totalBudget > 0) {

    const variancePct = percent(totalVariance, totalBudget);

    if (totalVariance > 0) {

      insights.push({
        id: "budget-risk",
        level: "warning",
        title: "Budget pressure detected",
        message: `Actual spend ${formatCurrency(totalActual)} vs budget ${formatCurrency(totalBudget)}. Variance ${formatCurrency(totalVariance)} (${variancePct.toFixed(1)}%).`
      });

    } else {

      insights.push({
        id: "budget-safe",
        level: "success",
        title: "Spend within budget",
        message: `Actual spend ${formatCurrency(totalActual)} vs budget ${formatCurrency(totalBudget)}. Remaining budget ${formatCurrency(Math.abs(totalVariance))}.`
      });

    }
  }

  // Supplier concentration insight
  const supplierMap: Record<string, number> = {};

  actualData.forEach(row => {

    const supplier = safeText(row.supplier) || "Unknown";

    supplierMap[supplier] =
      (supplierMap[supplier] || 0) + safeNumber(row.usd);

  });

  const topSupplier = Object.entries(supplierMap)
    .sort((a, b) => b[1] - a[1])[0];

  if (topSupplier) {

    const [supplier, spend] = topSupplier;

    const share = percent(spend, totalActual);

    if (share > 35) {

      insights.push({
        id: "supplier-risk",
        level: "warning",
        title: "High supplier concentration",
        message: `${supplier} represents ${share.toFixed(1)}% of total spend (${formatCurrency(spend)}).`
      });

    }

  }

  // Overspend category
  const categoryVariance: Record<string, number> = {};

  varianceData.forEach(v => {

    const key = safeText(v.itCategory || v.category);

    categoryVariance[key] =
      (categoryVariance[key] || 0) + safeNumber(v.variance);

  });

  const topOver = Object.entries(categoryVariance)
    .sort((a, b) => b[1] - a[1])[0];

  if (topOver && topOver[1] > 0) {

    insights.push({
      id: "top-overspend",
      level: "warning",
      title: "Largest overspend category",
      message: `${topOver[0]} exceeded budget by ${formatCurrency(topOver[1])}.`
    });

  }

  // Region spend insight
  const regionSpend: Record<string, number> = {};

  actualData.forEach(row => {

    const region = safeText(row.region) || "Unknown";

    regionSpend[region] =
      (regionSpend[region] || 0) + safeNumber(row.usd);

  });

  const topRegion = Object.entries(regionSpend)
    .sort((a, b) => b[1] - a[1])[0];

  if (topRegion) {

    insights.push({
      id: "top-region",
      level: "info",
      title: "Highest spend region",
      message: `${topRegion[0]} spend is ${formatCurrency(topRegion[1])}.`
    });

  }

  return insights.slice(0,5);
}

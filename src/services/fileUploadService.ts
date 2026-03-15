import Papa from "papaparse";
import { FinancialTransaction, BudgetRecord, VarianceRecord, BudgetProcessingResult } from "../types";
import { parseBudgetWorkbook } from "./budgetParser";
import { parseActualFile } from "./actualParser";

export async function parseActualsFile(file: File): Promise<FinancialTransaction[]> {
  return parseActualFile(file);
}

export async function parseVarianceFile(file: File): Promise<VarianceRecord[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data as any[];
        const records: VarianceRecord[] = data.map((row, index) => {
          const actualUsd = parseFloat(String(row.Actual || row.actual || "0").replace(/,/g, ""));
          const budgetUsd = parseFloat(String(row.Budget || row.budget || "0").replace(/,/g, ""));
          const variance = actualUsd - budgetUsd;
          return {
            id: row.id || `var-${index}-${Date.now()}`,
            year: parseInt(row.Year || row.year || "2025", 10),
            region: row.Region || "",
            station: row.Station || row.Country || "",
            category: row.Category || "Opex",
            itCategory: row["IT Category"] || "Other",
            yearMonth: row["Year/Month"] || "",
            actualUsd,
            budgetUsd,
            variance,
            variancePct: budgetUsd !== 0 ? (variance / budgetUsd) * 100 : null,
            budgetUsedPercent: budgetUsd !== 0 ? (actualUsd / budgetUsd) * 100 : null,
            runRate: actualUsd,
            forecastYearEnd: actualUsd * 12,
            overspendRisk: (actualUsd * 12) - budgetUsd
          };
        });
        resolve(records);
      },
      error: (err) => reject(err)
    });
  });
}

export async function parseBudgetFile(file: File): Promise<BudgetProcessingResult> {
  return parseBudgetWorkbook(file);
}

import { GoogleGenAI } from "@google/genai";

export interface ActualData {
  "Fiscal Year": string;
  "Region": string;
  "Country": string;
  "Station": string;
  "Category": string;
  "IT Category": string;
  "Expenditure Type": "CAPEX" | "OPEX";
  "YearMonth": string; // YYYY-MM
  "Budget Item"?: string;
  "Budget Category"?: string;
  "Supplier": string;
  "Actual Amount": number;
}

export interface BudgetData {
  "Fiscal Year": string;
  "Region": string;
  "Country": string;
  "Station": string;
  "Category": string;
  "IT Category": string;
  "Budget Type": "CAPEX" | "OPEX";
  "YearMonth"?: string; // Optional, if missing we divide Annual by 12
  "Budget Item"?: string;
  "Budget Category"?: string;
  "Budget Amount": number;
}

export interface VarianceAnalysis {
  key: string;
  actual: number;
  budget: number;
  variance: number;
  variancePercent: number;
  ytdActual: number;
  ytdBudget: number;
  ytdVariance: number;
  forecastYE: number;
  overspendRisk: number;
  isUnbudgeted: boolean;
  isLeakage: boolean;
  hasSpike: boolean;
  details: {
    region: string;
    country: string;
    station: string;
    itCategory: string;
    supplier: string;
    expenditureType: string;
  };
}

export interface AnalysisResult {
  totalBudget: number;
  totalActual: number;
  totalVariance: number;
  variancePercent: number;
  forecastYE: number;
  overspendRisk: number;
  topOverspendDrivers: VarianceAnalysis[];
  topUnderspendAreas: VarianceAnalysis[];
  riskFlags: {
    unbudgetedSpend: VarianceAnalysis[];
    leakage: VarianceAnalysis[];
    spikes: VarianceAnalysis[];
    highSupplierConcentration: { supplier: string; amount: number; percent: number }[];
  };
  monthlyPerformance: { month: string; actual: number; budget: number }[];
  aiCommentary?: string;
}

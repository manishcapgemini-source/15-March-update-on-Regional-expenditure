export type ExpenditureType = "CAPEX" | "OPEX";

export type StationCode =
  | "PRG" | "ABY" | "BRX" | "TRF" | "LEX" | "LNN" | "LON" | "SKY" | "WLV"
  | "DBC" | "XMS" | "UDC"
  | "BAH" | "ADC" | "DXB" | "AIL" | "AIS" | "AUH" | "RUH" | "JED" | "DHA"
  | "DOH" | "KWI" | "MCT" | "ALM" | "TUU" | "DWC"
  | "CMB" | "DAC" | "PNQ"
  | "ALR" | "AEL" | "CAI" | "CAS" | "CMN" | "KRT" | "TIP" | "TUN" | "BEY"
  | "IST" | "TBS" | "AMM" | "RMM" | "BGD" | "EBL"
  | "DAR" | "EBB" | "NBO" | "ACC" | "LOS" | "JNB";

export interface BudgetRecord {
  id: string;
  year: number;
  region: string;
  station: StationCode | string;
  category: string;
  item: string;
  type: ExpenditureType;
  budget: number;
  itCategory?: string;
  yearMonth?: string;
  sourceFile?: string;
  uploadedAt?: string;
  validationIssues?: string[];

  // optional normalized helper fields
  country?: string;
  month?: string;
  vendor?: string;
  expenditureType?: string;
  actual?: number;
  variance?: number;
}

export interface ValidationIssue {
  sheet: string;
  row: number;
  column?: string;
  issue: string;
  severity: "warning" | "error";
}

export interface BudgetProcessingResult {
  masterDataset: BudgetRecord[];
  validationIssues: ValidationIssue[];
  summary: {
    totalSheets: number;
    totalBudget: number;
    budgetByRegion: Record<string, number>;
    budgetByStation: Record<string, number>;
    budgetByType: Record<string, number>;
    topCategories: { category: string; amount: number }[];
  };
}

export interface FinancialTransaction {
  id: string;
  year: number;
  companyCode: string;
  businessArea: string;
  it: string;
  country: string;
  region: string;
  vp: string;
  documentType: string;
  documentNumber: string;
  postingDate: string;
  documentDate: string;
  fiscalYear: string;
  text: string;
  reference: string;
  assignment: string;
  amountLocal: number;
  amountDoc: number;
  localCurrency: string;
  usd: number;
  userName: string;
  glAccount: string;
  glName: string;
  costCenter: string;
  yearMonth: string;
  supplier: string;
  category: string;
  itCategory: string;
  sourceFile: string;

  // optional normalized helper fields
  vendor?: string;
  station?: string;
  month?: string;
  expenditureType?: string;
  actual?: number;
  budget?: number;
  variance?: number;
}

export interface UploadedFileData {
  name: string;
  uploadDate: string;
  transactions: FinancialTransaction[];
}

export interface UploadedBudgetData {
  name: string;
  uploadDate: string;
  budgetRecords: BudgetRecord[];
}

export interface UploadedFile {
  name: string;
  uploadDate: string;
  transactionCount: number;
  totalUsd: number;
}

export interface UploadedBudgetFile {
  name: string;
  uploadDate: string;
  recordCount: number;
  totalBudgetUsd: number;
}

export interface VarianceRecord {
  id: string;
  year: number;
  region: string;
  station: string;
  category: string;
  itCategory: string;
  yearMonth: string;
  actualUsd: number;
  budgetUsd: number;
  variance: number;
  variancePct: number | null;
  budgetUsedPercent: number | null;
  runRate: number;
  forecastYearEnd: number;
  overspendRisk: number;

  // optional helper fields for charting / AI normalization
  country?: string;
  vendor?: string;
  month?: string;
  expenditureType?: string;
}

export interface DashboardStats {
  totalSpend: number;
  transactionCount: number;
  supplierCount: number;
  avgTransaction: number;
}

export interface PivotRow {
  region: string;
  country: string;
  supplier: string;
  category: string;
  itCategory: string;
  grandTotal: number;
  months: Record<string, number>;
}

export interface PivotRowWithMoM extends PivotRow {
  mom: Record<string, number | null>;
}

export type SummaryData = {
  totalActual: number;
  totalBudget: number;
  totalVariance: number;
  variancePct: number;
  topRegions: Array<{ name: string; actual: number; budget: number; variance: number }>;
  topStations: Array<{ name: string; actual: number; budget: number; variance: number }>;
  topCategories: Array<{ name: string; actual: number; budget: number; variance: number }>;
  monthlyActual: Array<{ month: string; value: number }>;
  monthlyBudget: Array<{ month: string; value: number }>;
};

export type ParsedQuestion = {
  intent:
    | "unknown"
    | "top_vendor"
    | "vendor_spend"
    | "top_category"
    | "category_spend"
    | "country_spend"
    | "region_spend"
    | "budget_vs_actual"
    | "monthly_trend"
    | "top_overspend"
    | "cost_lookup"
    | "distribution"
    | "breakdown"
    | "burn_rate"
    | "comparison"
    | "anomaly";
  metric: "actual" | "budget" | "variance" | "variance_percent";
  filters: {
    region?: string | null;
    country?: string | null;
    station?: string | null;
    category?: string | null;
    itCategory?: string | null;
    vendor?: string | null;
    month?: string | null;
    expenditureType?: string | null;
  };
  ranking?: "asc" | "desc";
  groupBy?: "overall" | "region" | "station" | "vendor" | "category" | "itCategory" | "country" | "month";
  limit?: number;
};

export type ComputedResult = {
  answerType: "ranking" | "timeseries" | "summary" | "comparison" | "chart_request";
  matchedRows: number;
  groupedBy?: string;
  topResults?: { name: string; value: number; actual?: number; budget?: number; variance?: number; variancePct?: number }[];
  monthlyTrend?: { month: string; value: number; actual?: number; budget?: number; variance?: number }[];
  totals?: {
    actual?: number;
    budget?: number;
    variance?: number;
  };
  bestMatch?: any;
  resultContext?: string;
  chartReady?: boolean;
  title?: string;
};

export type FinanceIntent = {
  businessIntent:
    | "lookup"
    | "breakdown"
    | "distribution"
    | "comparison"
    | "trend"
    | "overspend"
    | "burn_rate"
    | "anomaly"
    | "chart"
    | "clarification";

  metric: "actual" | "budget" | "variance" | "variance_percent";
  primaryDimension:
    | "overall"
    | "region"
    | "country"
    | "station"
    | "vendor"
    | "category"
    | "itCategory"
    | "month";

  filters: {
    region?: string | null;
    country?: string | null;
    station?: string | null;
    vendor?: string | null;
    category?: string | null;
    itCategory?: string | null;
    month?: string | null;
    expenditureType?: string | null;
  };

  ranking?: "asc" | "desc";
  limit?: number;
  outputMode: "text" | "chart" | "table";
  followUp: boolean;
};

export interface ExcelActualRow {
  id: string;
  region: string;
  country: string;
  station: string;
  vendor: string;
  category: string;
  itCategory: string;
  expenditureType: string;
  yearMonth: string;
  usd: number;
}

export interface ExcelBudgetRow {
  id: string;
  region: string;
  country: string;
  station: string;
  category: string;
  itCategory: string;
  expenditureType: string;
  yearMonth: string;
  budget: number;
}

export interface ExcelSyncPayload {
  fileName: string;
  submittedAt: string;
  version: string;
  actual: ExcelActualRow[];
  budget: ExcelBudgetRow[];
}

export interface ExcelSyncResponse {
  status: "success" | "error";
  actualRows?: number;
  budgetRows?: number;
  message: string;
}

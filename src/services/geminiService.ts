import { GoogleGenAI } from "@google/genai";
import { FinancialTransaction, BudgetRecord, VarianceRecord, ParsedQuestion, ComputedResult, SummaryData, FinanceIntent } from "../types";
import { buildFinanceIntent } from "./financeIntentEngine";

type ClarificationRule = {
  key: "categoryMeaning" | "defaultMetric" | "nonItLogic";
  value: string;
  source: "user_confirmation" | "system_default";
};

type SessionContext = {
  lastQuestion?: string;
  lastIntent?: ParsedQuestion["intent"];
  lastMetric?: ParsedQuestion["metric"];
  lastGroupBy?: ParsedQuestion["groupBy"];
  lastFilters?: ParsedQuestion["filters"];
  lastResult?: ComputedResult | null;
};

type DatasetCapabilities = {
  hasRegion: boolean;
  hasCountry: boolean;
  hasStation: boolean;
  hasVendor: boolean;
  hasCategory: boolean;
  hasItCategory: boolean;
  hasExpenditureType: boolean;
  hasMonth: boolean;
  isITOnlyDataset: boolean;
  supportsNonIT: boolean;
};

/* =========================================================
   In-memory clarification memory + session memory
   ========================================================= */

const CLARIFICATION_STORAGE_KEY = "finance_ai_clarifications";

function loadClarificationsFromStorage(): ClarificationRule[] {
  try {
    const stored = localStorage.getItem(CLARIFICATION_STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

function saveClarificationsToStorage(rules: ClarificationRule[]) {
  try {
    localStorage.setItem(CLARIFICATION_STORAGE_KEY, JSON.stringify(rules));
  } catch (err) {
    console.warn("Failed to save clarification rules:", err);
  }
}

let clarificationRules: ClarificationRule[] = loadClarificationsFromStorage();
let sessionContext: SessionContext = {};

export function getClarificationRules() {
  return clarificationRules;
}

export function clearClarificationRules() {
  clarificationRules = [];
  localStorage.removeItem(CLARIFICATION_STORAGE_KEY);
}

export function clearSessionContext() {
  sessionContext = {};
}

function upsertClarificationRule(rule: ClarificationRule) {
  const index = clarificationRules.findIndex(r => r.key === rule.key);

  if (index >= 0) {
    clarificationRules[index] = rule;
  } else {
    clarificationRules.push(rule);
  }

  saveClarificationsToStorage(clarificationRules);
}

function getClarificationRule(key: ClarificationRule["key"]): ClarificationRule | undefined {
  return clarificationRules.find(r => r.key === key);
}

function updateSessionContext(patch: Partial<SessionContext>) {
  sessionContext = { ...sessionContext, ...patch };
}

function getSessionContext(): SessionContext {
  return sessionContext;
}

/* =========================================================
   Normalization helpers
   ========================================================= */

function normalizeNumber(value: any): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(String(value ?? "").replace(/,/g, "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function normalizeText(value: any): string {
  return String(value ?? "").trim();
}

function normalizeForMatch(value: any): string {
  return normalizeText(value).toLowerCase();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasTokenMatch(text: string, candidate: string): boolean {
  const normalizedCandidate = normalizeForMatch(candidate);
  if (!normalizedCandidate) return false;

  const regex = new RegExp(`(^|[^a-z0-9])${escapeRegex(normalizedCandidate)}([^a-z0-9]|$)`, "i");
  return regex.test(text);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function safeDivide(a: number, b: number): number {
  if (!b) return 0;
  return a / b;
}

function isLikelyFollowUp(question: string): boolean {
  const q = normalizeForMatch(question);
  return [
    "same",
    "same for",
    "now for",
    "what about",
    "show graph",
    "make graph",
    "chart",
    "plot",
    "visualize",
    "top 5",
    "top 10",
    "only top",
    "same by",
    "now by",
    "for europe",
    "for gcc",
    "for ssa",
    "for menat",
    "for north america"
  ].some(term => q.includes(term));
}

function isGraphRequest(question: string): boolean {
  const q = normalizeForMatch(question);
  return ["graph", "chart", "plot", "visual", "visualize"].some(term => q.includes(term));
}

function mergeFilters(
  base: ParsedQuestion["filters"] = {},
  override: ParsedQuestion["filters"] = {}
): ParsedQuestion["filters"] {
  return {
    region: override.region ?? base.region ?? null,
    country: override.country ?? base.country ?? null,
    station: override.station ?? base.station ?? null,
    category: override.category ?? base.category ?? null,
    itCategory: override.itCategory ?? base.itCategory ?? null,
    vendor: override.vendor ?? base.vendor ?? null,
    month: override.month ?? base.month ?? null,
    expenditureType: override.expenditureType ?? base.expenditureType ?? null,
  };
}

/* =========================================================
   Data extraction
   ========================================================= */

function getActualAmount(row: any): number {
  const candidates = [
    row.actual,
    row.usd,
    row.USD,
    row.amount,
    row["Amount in Doc. Curr."],
    row["Amount in Local Currency"]
  ];
  for (const candidate of candidates) {
    const num = normalizeNumber(candidate);
    if (num !== 0) return num;
  }
  return 0;
}

function getBudgetAmount(row: any): number {
  const candidates = [
    row.budget,
    row.amount,
    row.usd,
    row.USD,
    row["Grand Total"],
    row.grandTotal,
  ];
  for (const candidate of candidates) {
    const num = normalizeNumber(candidate);
    if (num !== 0) return num;
  }
  return 0;
}

function getVarianceAmount(row: any): number {
  const candidates = [
    row.variance,
    row.amount,
    row.usd,
    row.USD,
  ];
  for (const candidate of candidates) {
    const num = normalizeNumber(candidate);
    if (num !== 0) return num;
  }
  return 0;
}

function normalizeRegion(region: unknown): string {
  const raw = String(region ?? "").trim();
  const key = raw.toLowerCase();

  const REGION_MAP: Record<string, string> = {
    us: "US",
    usa: "US",
    "united states": "US",

    "north america": "North America",
    na: "North America",

    europe: "Europe",
    eu: "Europe",

    gcc: "GCC",
    gulf: "GCC",
    "gulf cooperation council": "GCC",

    ssa: "SSA",
    "sub saharan africa": "SSA",
    "sub-saharan africa": "SSA",

    menat: "MENAT",
    mena: "MENAT",
    meenat: "Meenat & South of Asia",
    "meenat & south of asia": "Meenat & South of Asia",
    "middle east north africa": "MENAT",
    "middle east & north africa": "MENAT",

    india: "India"
  };

  if (!key) return "Unknown";
  return REGION_MAP[key] || raw;
}

function getRegion(row: any): string {
  return normalizeRegion(row.region ?? row.Region);
}

function getCountry(row: any): string {
  return normalizeText(row.country ?? row.Country);
}

function getStation(row: any): string {
  return normalizeText(row.station ?? row.Station ?? row.country ?? row.Country);
}

function getCategory(row: any): string {
  return normalizeText(
    row.category ??
      row.Category ??
      row.item ??
      row.Item ??
      row.itCategory ??
      row.ITCategory ??
      row.expenditureCategory ??
      row["EXENTITURE Category"] ??
      row["IT infrastructure expenditures, categorized "] ??
      row["IT infrastructure expenditures, categorized"]
  );
}

function getMonth(row: any): string {
  return normalizeText(
    row.yearMonth ??
      row["Year/Month"] ??
      row.year_month ??
      row.month ??
      row.Month
  );
}

function getVendor(row: any): string {
  return normalizeText(
    row.supplier ??
      row.Supplier ??
      row.vendor ??
      row.Vendor ??
      row["Supplier Name and Code"]
  );
}

function getExpenditureType(row: any): string {
  const val = normalizeText(
    row.expenditureType ??
      row["Expenditure Type"] ??
      row.type ??
      row.Type ??
      row.capexOpex ??
      row["Capex/Opex"]
  );
  const lower = val.toLowerCase();
  if (lower.includes("capex")) return "Capex";
  if (lower.includes("opex")) return "Opex";
  return val;
}

/* =========================================================
   Aggregation helpers
   ========================================================= */

function aggregateBy<T>(
  rows: T[],
  keyGetter: (row: T) => string,
  valueGetter: (row: T) => number
): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = keyGetter(row) || "Unknown";
    acc[key] = (acc[key] || 0) + valueGetter(row);
    return acc;
  }, {});
}

function mergeActualBudget(
  actualMap: Record<string, number>,
  budgetMap: Record<string, number>
): Array<{ name: string; actual: number; budget: number; variance: number }> {
  const keys = new Set([...Object.keys(actualMap), ...Object.keys(budgetMap)]);
  return Array.from(keys).map((key) => {
    const actual = actualMap[key] || 0;
    const budget = budgetMap[key] || 0;
    return {
      name: key,
      actual,
      budget,
      variance: actual - budget,
    };
  });
}

function topN(
  items: Array<{ name: string; actual: number; budget: number; variance: number }>,
  n = 5
) {
  return [...items]
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
    .slice(0, n);
}

function sortMonthlyMap(map: Record<string, number>): Array<{ month: string; value: number }> {
  return Object.entries(map)
    .map(([month, value]) => ({ month, value }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/* =========================================================
   Cleaning + dataset capability detection
   ========================================================= */

export function cleanData(data: any[], type: "actual" | "budget") {
  if (!data || !Array.isArray(data)) return [];
  return data.map(row => {
    return {
      ...row,
      region: getRegion(row),
      country: getCountry(row),
      station: getStation(row),
      category: getCategory(row),
      itCategory: normalizeText(row.itCategory || row.it_category || row.ITCategory || getCategory(row)),
      vendor: getVendor(row),
      expenditureType: getExpenditureType(row),
      month: getMonth(row),
      item: normalizeText(row.item || row.Item),
      year: normalizeNumber(row.year || row.Year || 2025),
      yearMonth: normalizeText(row.yearMonth || row["Year/Month"] || getMonth(row)),
      usd: type === "actual" ? getActualAmount(row) : 0,
      actual: type === "actual" ? getActualAmount(row) : 0,
      budget: type === "budget" ? getBudgetAmount(row) : 0,
      variance: 0
    };
  });
}

export function detectDatasetCapabilities(actualData: any[], budgetData: any[]): DatasetCapabilities {
  const combined = [...actualData, ...budgetData];

  const hasNonEmpty = (field: string) =>
    combined.some(row => String(row?.[field] ?? "").trim() !== "");

  const hasRegion = hasNonEmpty("region");
  const hasCountry = hasNonEmpty("country");
  const hasStation = hasNonEmpty("station");
  const hasVendor = hasNonEmpty("vendor");
  const hasCategory = hasNonEmpty("category");
  const hasItCategory = hasNonEmpty("itCategory");
  const hasExpenditureType = hasNonEmpty("expenditureType");
  const hasMonth = hasNonEmpty("month");

  const supportsNonIT =
    combined.some(row => {
      const c = String(row?.category ?? "").toLowerCase();
      const ic = String(row?.itCategory ?? "").toLowerCase();
      const e = String(row?.expenditureType ?? "").toLowerCase();
      return c.includes("non it") || ic.includes("non it") || e.includes("non it");
    });

  return {
    hasRegion,
    hasCountry,
    hasStation,
    hasVendor,
    hasCategory,
    hasItCategory,
    hasExpenditureType,
    hasMonth,
    isITOnlyDataset: !supportsNonIT,
    supportsNonIT
  };
}

function validateQuestionAgainstDataset(
  question: string,
  capabilities: DatasetCapabilities,
  rules: ClarificationRule[]
): { supported: boolean; message?: string } {
  const q = normalizeForMatch(question);

  if (q.includes("non it") || q.includes("non-it")) {
    if (!capabilities.supportsNonIT) {
      return {
        supported: false,
        message:
          "This uploaded file appears to contain IT expenditure only, so Non-IT cost cannot be calculated from the current dataset."
      };
    }
  }

  if ((q.includes("category") || q.includes("categories")) && !capabilities.hasCategory && !capabilities.hasItCategory) {
    return {
      supported: false,
      message: "This dataset does not contain category fields needed for category analysis."
    };
  }

  if ((q.includes("vendor") || q.includes("supplier")) && !capabilities.hasVendor) {
    return {
      supported: false,
      message: "This dataset does not contain vendor information needed for vendor analysis."
    };
  }

  return { supported: true };
}

/* =========================================================
   Summary
   ========================================================= */

export function buildSummary(
  actualData: FinancialTransaction[],
  budgetData: BudgetRecord[],
  varianceData: VarianceRecord[]
): SummaryData {
  const cleanedActual = cleanData(actualData, "actual");
  const cleanedBudget = cleanData(budgetData, "budget");

  const totalActual = cleanedActual.reduce((sum, row) => sum + Number(row.actual || 0), 0);
  const totalBudget = cleanedBudget.reduce((sum, row) => sum + Number(row.budget || 0), 0);

  let totalVariance = totalActual - totalBudget;
  if (varianceData.length > 0) {
    const explicitVariance = varianceData.reduce((sum, row) => sum + getVarianceAmount(row), 0);
    if (explicitVariance !== 0) totalVariance = explicitVariance;
  }

  const variancePct = safeDivide(totalVariance, totalBudget) * 100;

  const regionActual = aggregateBy(cleanedActual, r => r.region, r => Number(r.actual || 0));
  const regionBudget = aggregateBy(cleanedBudget, r => r.region, r => Number(r.budget || 0));

  const stationActual = aggregateBy(cleanedActual, r => r.station, r => Number(r.actual || 0));
  const stationBudget = aggregateBy(cleanedBudget, r => r.station, r => Number(r.budget || 0));

  const categoryActual = aggregateBy(cleanedActual, r => r.category, r => Number(r.actual || 0));
  const categoryBudget = aggregateBy(cleanedBudget, r => r.category, r => Number(r.budget || 0));

  const monthlyActualMap = aggregateBy(cleanedActual, r => r.month, r => Number(r.actual || 0));
  const monthlyBudgetMap = aggregateBy(cleanedBudget, r => r.month, r => Number(r.budget || 0));

  return {
    totalActual,
    totalBudget,
    totalVariance,
    variancePct,
    topRegions: topN(mergeActualBudget(regionActual, regionBudget)),
    topStations: topN(mergeActualBudget(stationActual, stationBudget)),
    topCategories: topN(mergeActualBudget(categoryActual, categoryBudget)),
    monthlyActual: sortMonthlyMap(monthlyActualMap),
    monthlyBudget: sortMonthlyMap(monthlyBudgetMap),
  };
}

/* =========================================================
   Clarification rule detection
   ========================================================= */

type FinanceSemanticSignals = {
  asksTop: boolean;
  asksLowest: boolean;
  asksBreakdown: boolean;
  asksDistribution: boolean;
  asksComparison: boolean;
  asksTrend: boolean;
  asksOverspend: boolean;
  asksBurnRate: boolean;
  asksAnomaly: boolean;
  asksGraph: boolean;
  mentionsVendor: boolean;
  mentionsRegion: boolean;
  mentionsCountry: boolean;
  mentionsStation: boolean;
  mentionsCategory: boolean;
  mentionsMonth: boolean;
  mentionsBudget: boolean;
  mentionsActual: boolean;
  mentionsVariance: boolean;
};

function detectFinanceSignals(question: string): FinanceSemanticSignals {
  const q = normalizeForMatch(question);

  const hasAny = (terms: string[]) => terms.some(term => q.includes(term));

  return {
    asksTop: hasAny(["top", "highest", "largest", "most", "biggest", "max", "leading"]),
    asksLowest: hasAny(["lowest", "least", "smallest", "min"]),
    asksBreakdown: hasAny([
      "breakdown",
      "split",
      "under which",
      "under what",
      "which category",
      "by category",
      "by vendor",
      "by region",
      "by country",
      "for each"
    ]),
    asksDistribution: hasAny([
      "distribution",
      "mix",
      "allocation",
      "spread",
      "how is it distributed",
      "distributed"
    ]),
    asksComparison: hasAny([
      "vs",
      "versus",
      "compare",
      "comparison",
      "against"
    ]),
    asksTrend: hasAny([
      "trend",
      "monthly",
      "month wise",
      "month-wise",
      "over time",
      "run rate",
      "movement"
    ]),
    asksOverspend: hasAny([
      "overspend",
      "over budget",
      "expensive",
      "costly",
      "high spend",
      "too much spend"
    ]),
    asksBurnRate: hasAny([
      "burn rate",
      "burnrate",
      "run rate",
      "runrate",
      "year end projection",
      "projection"
    ]),
    asksAnomaly: hasAny([
      "anomaly",
      "outlier",
      "unusual",
      "spike",
      "abnormal"
    ]),
    asksGraph: hasAny(["graph", "chart", "plot", "visual", "visualize"]),
    mentionsVendor: hasAny(["vendor", "supplier", "provider"]),
    mentionsRegion: hasAny(["region", "regional"]),
    mentionsCountry: hasAny(["country", "countries"]),
    mentionsStation: hasAny(["station", "branch", "site", "location"]),
    mentionsCategory: hasAny(["category", "categories", "cost head", "spend head"]),
    mentionsMonth: hasAny(["month", "monthly", "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]),
    mentionsBudget: hasAny(["budget", "plan", "planned"]),
    mentionsActual: hasAny(["actual", "spent", "spend", "cost"]),
    mentionsVariance: hasAny(["variance", "difference", "gap", "delta"])
  };
}

function captureClarificationRule(question: string): ClarificationRule | null {
  const q = normalizeForMatch(question);

  if (
    q.includes("from now on category means it category") ||
    q.includes("category means it category") ||
    q.includes("use it category") ||
    q.includes("use it infrastructure category") ||
    q.includes("it infrastructure category")
  ) {
    return {
      key: "categoryMeaning",
      value: "itCategory",
      source: "user_confirmation"
    };
  }

  if (
    q.includes("category means capex") ||
    q.includes("category means opex") ||
    q.includes("use capex opex") ||
    q.includes("use expenditure category")
  ) {
    return {
      key: "categoryMeaning",
      value: "category",
      source: "user_confirmation"
    };
  }

  if (
    q.includes("default metric actual") ||
    q.includes("use actual by default") ||
    q.includes("actual should be default")
  ) {
    return {
      key: "defaultMetric",
      value: "actual",
      source: "user_confirmation"
    };
  }

  if (
    q.includes("default metric budget") ||
    q.includes("use budget by default") ||
    q.includes("budget should be default")
  ) {
    return {
      key: "defaultMetric",
      value: "budget",
      source: "user_confirmation"
    };
  }

  return null;
}

/* =========================================================
   Question parsing
   ========================================================= */

type InterpretedQuestion = {
  mode: "fresh" | "follow_up" | "clarification" | "chart";
  normalizedQuestion: string;
  clarificationRule?: ClarificationRule | null;
};

function interpretQuestion(question: string): InterpretedQuestion {
  const normalizedQuestion = normalizeForMatch(question);

  const clarificationRule = captureClarificationRule(question);
  if (clarificationRule) {
    return {
      mode: "clarification",
      normalizedQuestion,
      clarificationRule
    };
  }

  if (isGraphRequest(question)) {
    return {
      mode: "chart",
      normalizedQuestion,
      clarificationRule: null
    };
  }

  if (isLikelyFollowUp(question)) {
    return {
      mode: "follow_up",
      normalizedQuestion,
      clarificationRule: null
    };
  }

  return {
    mode: "fresh",
    normalizedQuestion,
    clarificationRule: null
  };
}

function extractLimit(question: string): number | undefined {
  const q = normalizeForMatch(question);

  const topMatch = q.match(/\btop\s+(\d+)\b/);
  if (topMatch) return Number(topMatch[1]);

  const onlyMatch = q.match(/\bonly\s+(\d+)\b/);
  if (onlyMatch) return Number(onlyMatch[1]);

  const showMatch = q.match(/\bshow\s+(\d+)\b/);
  if (showMatch) return Number(showMatch[1]);

  return undefined;
}

function parseQuestion(
  question: string,
  actualData: any[],
  budgetData: any[]
): ParsedQuestion {
  const q = normalizeForMatch(question);
  const signals = detectFinanceSignals(question);

  const hasAny = (terms: string[]) => terms.some(term => q.includes(term));

  let intent: ParsedQuestion["intent"] = "unknown";

  const asksTop = signals.asksTop;
  const asksLowest = signals.asksLowest;

  if (signals.asksComparison || (signals.mentionsBudget && signals.mentionsActual)) {
    intent = "budget_vs_actual";
  } else if (signals.asksBurnRate) {
    intent = "burn_rate";
  } else if (signals.asksTrend || hasAny(["monthly trend", "trend by month", "month wise", "month-wise", "over time"])) {
    intent = "monthly_trend";
  } else if (signals.asksOverspend) {
    intent = "top_overspend";
  } else if (signals.mentionsVendor) {
    intent = asksTop || asksLowest ? "top_vendor" : "vendor_spend";
  } else if (signals.mentionsCategory) {
    intent = asksTop || asksLowest ? "top_category" : "category_spend";
  } else if (signals.mentionsCountry) {
    intent = "country_spend";
  } else if (signals.mentionsRegion) {
    intent = "region_spend";
  } else if (signals.asksDistribution) {
    intent = "distribution";
  } else if (signals.asksBreakdown) {
    intent = "breakdown";
  } else if (signals.asksAnomaly) {
    intent = "anomaly";
  } else if (signals.mentionsActual || signals.mentionsBudget || signals.mentionsVariance) {
    intent = "cost_lookup";
  }

  const savedMetricRule = getClarificationRule("defaultMetric");

  let metric: "actual" | "budget" | "variance" | "variance_percent" =
    (savedMetricRule?.value as any) || "actual";

  if (signals.mentionsVariance && hasAny(["%", "percent", "percentage"])) {
    metric = "variance_percent";
  } else if (signals.mentionsVariance) {
    metric = "variance";
  } else if (signals.mentionsBudget && !signals.mentionsActual) {
    metric = "budget";
  } else if (signals.mentionsActual || q.includes("spent") || q.includes("cost")) {
    metric = "actual";
  }

  const extractUnique = (field: string) =>
    Array.from(
      new Set(
        [...actualData.map(r => r[field]), ...budgetData.map(r => r[field])]
          .filter(Boolean)
          .map(v => String(v).trim())
      )
    );

  const regionNames = extractUnique("region");
  const countryNames = extractUnique("country");
  const stationNames = extractUnique("station");
  const categoryNames = extractUnique("category");
  const itCategoryNames = extractUnique("itCategory");
  const vendorNames = extractUnique("vendor");
  const monthNames = extractUnique("month");
  const expenditureTypeNames = extractUnique("expenditureType");

  const filters: ParsedQuestion["filters"] = {};

  const findMatch = (names: string[]) => {
    const sorted = [...names].sort((a, b) => b.length - a.length);

    for (const name of sorted) {
      const normalizedName = normalizeForMatch(name);
      if (!normalizedName) continue;

      if (normalizedName.length <= 4) {
        if (hasTokenMatch(q, normalizedName)) return name;
        continue;
      }

      if (hasTokenMatch(q, normalizedName)) return name;
    }

    return null;
  };

  filters.region = findMatch(regionNames);
  filters.country = findMatch(countryNames);
  filters.station = findMatch(stationNames);
  filters.category = findMatch(categoryNames);
  filters.itCategory = findMatch(itCategoryNames);
  filters.vendor = findMatch(vendorNames);
  filters.month = findMatch(monthNames);
  filters.expenditureType = findMatch(expenditureTypeNames);

  if (!filters.expenditureType) {
    if (hasAny(["opex", "op ex", "operating expense", "operational expense"])) {
      filters.expenditureType = "Opex";
    } else if (hasAny(["capex", "cap ex", "capital expense"])) {
      filters.expenditureType = "Capex";
    }
  }

  const ranking = asksLowest ? "asc" : "desc";
  let groupBy: ParsedQuestion["groupBy"] = "overall";

  if (signals.mentionsRegion || hasAny(["regional spend distribution", "by region", "region wise", "region-wise", "grouped by region", "for each region"])) {
    groupBy = "region";
  } else if (signals.mentionsStation || hasAny(["by station", "station wise", "station-wise", "grouped by station", "for each station"])) {
    groupBy = "station";
  } else if (signals.mentionsCountry || hasAny(["by country", "country wise", "country-wise", "grouped by country", "for each country"])) {
    groupBy = "country";
  } else if (signals.mentionsVendor || hasAny(["by vendor", "vendor wise", "vendor-wise", "by supplier", "supplier wise", "supplier-wise"])) {
    groupBy = "vendor";
  } else if (hasAny(["by it category", "by itcategory", "it category wise", "itcategory wise"])) {
    groupBy = "itCategory";
  } else if (signals.mentionsCategory || hasAny(["by category", "category wise", "category-wise", "grouped by category", "for each category", "under which category"])) {
    groupBy = "category";
  } else if (signals.mentionsMonth || hasAny(["by month", "month wise", "month-wise", "monthly trend", "trend by month"])) {
    groupBy = "month";
  }

  const categoryMeaningRule = getClarificationRule("categoryMeaning");
  if ((intent === "category_spend" || intent === "top_category" || groupBy === "category") && categoryMeaningRule?.value === "itCategory") {
    groupBy = "itCategory";
    if (filters.category && !filters.itCategory) {
      filters.itCategory = filters.category;
      filters.category = null;
    }
  }

  const mentionsStation =
    hasAny(["station", "branch", "site", "location"]) ||
    /\b(for|in)\s+[a-z]{3}\b/i.test(question);

  if (!mentionsStation) {
    filters.station = null;
  }

  // Smart Fallback for Distribution/Breakdown
  if (intent === "distribution" || intent === "breakdown") {
    if (filters.region || filters.country || filters.station) {
      groupBy =
        getClarificationRule("categoryMeaning")?.value === "itCategory"
          ? "itCategory"
          : "category";
      intent = "category_spend";
    } else if (signals.mentionsVendor) {
      groupBy = "vendor";
      intent = "vendor_spend";
    } else if (signals.mentionsCategory) {
      groupBy =
        getClarificationRule("categoryMeaning")?.value === "itCategory"
          ? "itCategory"
          : "category";
      intent = "category_spend";
    } else {
      groupBy = "region";
      intent = "region_spend";
    }
  }

  // Explicit category breakdown questions
  if (
    (q.includes("under which category") ||
      q.includes("category split") ||
      q.includes("category breakdown")) &&
    (filters.region || filters.country || filters.station)
  ) {
    intent = "category_spend";
    groupBy =
      getClarificationRule("categoryMeaning")?.value === "itCategory"
        ? "itCategory"
        : "category";
  }

  const limit = extractLimit(question);

  return {
    intent,
    metric,
    filters,
    ranking,
    groupBy,
    limit
  };
}

function questionMentionsMetric(question: string): boolean {
  const q = normalizeForMatch(question);
  return [
    "actual",
    "budget",
    "variance",
    "variance %",
    "variance percent",
    "cost",
    "spend",
    "spent"
  ].some(term => q.includes(term));
}

function extractTopLimit(question: string): number | null {
  const q = normalizeForMatch(question);
  const match = q.match(/\btop\s+(\d+)\b/);
  if (match) return Number(match[1]);
  if (q.includes("top 5")) return 5;
  if (q.includes("top 10")) return 10;
  return null;
}

function applyFollowUpContext(question: string, parsed: ParsedQuestion): ParsedQuestion {
  const session = getSessionContext();
  const q = normalizeForMatch(question);

  if (!isLikelyFollowUp(question)) {
    return parsed;
  }

  const hasExplicitRegion = !!parsed.filters.region;
  const hasExplicitCountry = !!parsed.filters.country;
  const hasExplicitStation = !!parsed.filters.station;
  const hasExplicitVendor = !!parsed.filters.vendor;
  const hasExplicitCategory = !!parsed.filters.category || !!parsed.filters.itCategory;
  const hasExplicitMonth = !!parsed.filters.month;

  const hasAnyExplicitFilter =
    hasExplicitRegion ||
    hasExplicitCountry ||
    hasExplicitStation ||
    hasExplicitVendor ||
    hasExplicitCategory ||
    hasExplicitMonth;

  let merged: ParsedQuestion = {
    ...parsed,
    filters: { ...parsed.filters }
  };

  if (!hasAnyExplicitFilter && session.lastFilters) {
    merged.filters = mergeFilters(session.lastFilters, parsed.filters);
  }

  if (isGraphRequest(question) && session.lastResult) {
    merged.intent = session.lastIntent || parsed.intent;
    merged.metric = session.lastMetric || parsed.metric;
    merged.groupBy = session.lastGroupBy || parsed.groupBy;
    merged.filters = mergeFilters(session.lastFilters, parsed.filters);
  }

  if (q.includes("same for") || q.includes("now for") || q.includes("what about")) {
    merged.intent = session.lastIntent || parsed.intent;
    merged.metric =
      questionMentionsMetric(question)
        ? parsed.metric
        : session.lastMetric || parsed.metric || "actual";
    merged.groupBy = session.lastGroupBy || parsed.groupBy;
    merged.filters = mergeFilters(session.lastFilters, parsed.filters);
  }

  if (q.includes("now by category")) {
    merged.groupBy =
      getClarificationRule("categoryMeaning")?.value === "itCategory"
        ? "itCategory"
        : "category";
    merged.intent = "category_spend";
  }

  if (q.includes("now by vendor")) {
    merged.groupBy = "vendor";
    merged.intent = "vendor_spend";
  }

  if (q.includes("now by region")) {
    merged.groupBy = "region";
    merged.intent = "region_spend";
  }

  if (
    q.includes("under which category") ||
    q.includes("category split") ||
    q.includes("category breakdown")
  ) {
    merged.intent = "category_spend";
    merged.groupBy =
      getClarificationRule("categoryMeaning")?.value === "itCategory"
        ? "itCategory"
        : "category";
    merged.metric =
      questionMentionsMetric(question)
        ? parsed.metric
        : session.lastMetric || merged.metric || "actual";
  }

  if (
    q.includes("under which vendor") ||
    q.includes("vendor split") ||
    q.includes("vendor breakdown")
  ) {
    merged.intent = "vendor_spend";
    merged.groupBy = "vendor";
    merged.metric =
      questionMentionsMetric(question)
        ? parsed.metric
        : session.lastMetric || merged.metric || "actual";
  }

  if (q.includes("same")) {
    merged.intent =
      merged.intent === "unknown"
        ? session.lastIntent || merged.intent
        : merged.intent;

    merged.metric =
      questionMentionsMetric(question)
        ? merged.metric
        : session.lastMetric || merged.metric;

    merged.groupBy =
      merged.groupBy === "overall"
        ? session.lastGroupBy || merged.groupBy
        : merged.groupBy;
  }

  return merged;
}

/* =========================================================
   Filtering + grouping
   ========================================================= */

function isMatch(value: string, target: string) {
  if (!value || !target) return false;
  const v = normalizeForMatch(value);
  const t = normalizeForMatch(target);
  return v === t || v.includes(t) || t.includes(v);
}

function filterRows(parsed: ParsedQuestion, actualData: any[], budgetData: any[]) {
  let filteredActual = actualData;
  let filteredBudget = budgetData;

  if (parsed.filters.region) {
    const target = parsed.filters.region;
    filteredActual = filteredActual.filter(r => isMatch(r.region, target));
    filteredBudget = filteredBudget.filter(r => isMatch(r.region, target));
  }
  if (parsed.filters.station) {
    const target = parsed.filters.station;
    filteredActual = filteredActual.filter(r => isMatch(r.station, target));
    filteredBudget = filteredBudget.filter(r => isMatch(r.station, target));
  }
  if (parsed.filters.country) {
    const target = parsed.filters.country;
    filteredActual = filteredActual.filter(r => isMatch(r.country, target));
    filteredBudget = filteredBudget.filter(r => isMatch(r.country, target));
  }
  if (parsed.filters.category) {
    const target = parsed.filters.category;
    filteredActual = filteredActual.filter(r => isMatch(r.category, target));
    filteredBudget = filteredBudget.filter(r => isMatch(r.category, target));
  }
  if (parsed.filters.itCategory) {
    const target = parsed.filters.itCategory;
    filteredActual = filteredActual.filter(r => isMatch(r.itCategory, target));
    filteredBudget = filteredBudget.filter(r => isMatch(r.itCategory, target));
  }
  if (parsed.filters.vendor) {
    const target = parsed.filters.vendor;
    filteredActual = filteredActual.filter(r => isMatch(r.vendor, target));
  }
  if (parsed.filters.month) {
    const target = parsed.filters.month;
    filteredActual = filteredActual.filter(r => isMatch(r.month, target));
    filteredBudget = filteredBudget.filter(r => isMatch(r.month, target));
  }
  if (parsed.filters.expenditureType) {
    const target = parsed.filters.expenditureType;
    filteredActual = filteredActual.filter(r => isMatch(r.expenditureType, target));
    filteredBudget = filteredBudget.filter(r => isMatch(r.expenditureType, target));
  }

  return { filteredActual, filteredBudget };
}

function groupByField(actualData: any[], budgetData: any[], field: string, metric: string) {
  const map: Record<string, { actual: number; budget: number }> = {};

  const normalizeGroupKey = (value: any) => {
    const text = String(value ?? "").trim();
    return text || "Unknown";
  };

  for (const row of actualData) {
    const key = normalizeGroupKey(row[field]);
    if (!map[key]) map[key] = { actual: 0, budget: 0 };
    map[key].actual += Number(row.actual || row.usd || 0);
  }

  const budgetSafeFields = new Set([
    "region",
    "country",
    "station",
    "category",
    "itCategory",
    "yearMonth",
    "month"
  ]);

  if (budgetSafeFields.has(field)) {
    for (const row of budgetData) {
      const key = normalizeGroupKey(row[field]);
      if (!map[key]) map[key] = { actual: 0, budget: 0 };
      map[key].budget += Number(row.budget || 0);
    }
  }

  return Object.entries(map)
    .map(([name, vals]) => {
      const variance = vals.actual - vals.budget;
      const variancePct = vals.budget !== 0 ? (variance / vals.budget) * 100 : 0;

      let value = 0;
      if (metric === "actual") value = vals.actual;
      else if (metric === "budget") value = vals.budget;
      else if (metric === "variance") value = variance;
      else if (metric === "variance_percent") value = variancePct;
      else value = vals.actual;

      return {
        name,
        value,
        actual: vals.actual,
        budget: vals.budget,
        variance,
        variancePct
      };
    })
    .sort((a, b) => b.value - a.value);
}

/* =========================================================
   Compute answer
   ========================================================= */

function getMonthSortValue(month: string): number {
  const m = normalizeForMatch(month);

  const monthMap: Record<string, number> = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12
  };

  if (monthMap[m]) return monthMap[m];

  const match = m.match(/(\d{4})[\/\-](\d{1,2})/);
  if (match) {
    return Number(match[1]) * 100 + Number(match[2]);
  }

  return 9999;
}

function computeAnswer(
  parsed: ParsedQuestion,
  filteredActual: any[],
  filteredBudget: any[],
  originalQuestion: string,
  financeIntent?: FinanceIntent
): ComputedResult {
  let resultContext = "";
  let groupedBy = "";
  let topResults: any[] = [];
  let monthlyTrend: any[] = [];
  let answerType: "ranking" | "timeseries" | "summary" | "comparison" | "chart_request" = "summary";

  const totalActual = filteredActual.reduce((sum, r) => sum + Number(r.actual || r.usd || 0), 0);
  const totalBudget = filteredBudget.reduce((sum, r) => sum + Number(r.budget || 0), 0);
  const totalVariance = totalActual - totalBudget;
  const variancePct = totalBudget ? (totalVariance / totalBudget) * 100 : 0;
  const totals = { actual: totalActual, budget: totalBudget, variance: totalVariance };

  const matchedRows =
    parsed.metric === "budget"
      ? filteredBudget.length
      : parsed.intent === "vendor_spend" || parsed.intent === "top_vendor"
        ? filteredActual.length
        : Math.max(filteredActual.length, filteredBudget.length);

  if (financeIntent?.outputMode === "chart") {
    const session = getSessionContext();
    if (session.lastResult) {
      return {
        ...session.lastResult,
        answerType: "chart_request",
        chartReady: true,
        resultContext: "Chart request detected. Use previous analysis result for visualization."
      };
    }
  }

  if (parsed.intent === "top_vendor" || parsed.intent === "vendor_spend") {
    answerType = "ranking";
    groupedBy = "vendor";
    topResults = groupByField(filteredActual, filteredBudget, "vendor", parsed.metric);

    if (parsed.ranking === "asc") {
      topResults = topResults.sort((a, b) => a.value - b.value);
    }

    resultContext = `Vendors by ${parsed.metric}:\n${topResults
      .slice(0, parsed.limit || 10)
      .map(v => `- ${v.name}: ${formatMoney(v.value)}`)
      .join("\n")}`;

  } else if (parsed.intent === "top_category" || parsed.intent === "category_spend") {
    answerType = "ranking";
    groupedBy = parsed.groupBy === "itCategory" ? "itCategory" : "category";
    topResults = groupByField(filteredActual, filteredBudget, groupedBy, parsed.metric);

    if (parsed.ranking === "asc") {
      topResults = topResults.sort((a, b) => a.value - b.value);
    }

    resultContext = `Categories by ${parsed.metric}:\n${topResults
      .slice(0, parsed.limit || 10)
      .map(v => `- ${v.name}: ${formatMoney(v.value)}`)
      .join("\n")}`;

  } else if (parsed.intent === "top_overspend") {
    answerType = "ranking";
    groupedBy = parsed.groupBy === "itCategory" ? "itCategory" : "category";
    const catResults = groupByField(filteredActual, filteredBudget, groupedBy, "variance");
    topResults = catResults.filter(r => r.variance > 0).sort((a, b) => b.variance - a.variance);

    resultContext = `Top overspending categories:\n${topResults
      .slice(0, parsed.limit || 10)
      .map(v => `- ${v.name}: ${formatMoney(v.variance)} over budget`)
      .join("\n")}`;

  } else if (parsed.intent === "country_spend") {
    answerType = "ranking";
    groupedBy = "country";
    topResults = groupByField(filteredActual, filteredBudget, "country", parsed.metric);

    resultContext = `Country-wise spend by ${parsed.metric}:\n${topResults
      .slice(0, parsed.limit || 10)
      .map(v => `- ${v.name}: ${formatMoney(v.value)}`)
      .join("\n")}`;

  } else if (parsed.intent === "region_spend") {
    answerType = "ranking";
    groupedBy = "region";
    topResults = groupByField(filteredActual, filteredBudget, "region", parsed.metric);

    resultContext = `Region-wise spend by ${parsed.metric}:\n${topResults
      .slice(0, parsed.limit || 10)
      .map(v => `- ${v.name}: ${formatMoney(v.value)}`)
      .join("\n")}`;

  } else if (parsed.intent === "budget_vs_actual") {
    if (parsed.groupBy && parsed.groupBy !== "overall") {
      answerType = "ranking";
      groupedBy = parsed.groupBy;
      topResults = groupByField(filteredActual, filteredBudget, parsed.groupBy, parsed.metric);

      resultContext = `${parsed.groupBy.charAt(0).toUpperCase() + parsed.groupBy.slice(1)} breakdown (${parsed.metric}):\n${topResults
        .slice(0, parsed.limit || 10)
        .map(v => `- ${v.name}: ${formatMoney(v.actual || 0)} actual / ${formatMoney(v.budget || 0)} budget (Var: ${formatMoney(v.variance || 0)}, ${v.variancePct?.toFixed(1)}%)`)
        .join("\n")}`;
    } else {
      answerType = "comparison";
      groupedBy = "overall";
      topResults = [{
        name: "Total",
        value: totalVariance,
        actual: totalActual,
        budget: totalBudget,
        variance: totalVariance,
        variancePct
      }];

      resultContext = `Overall budget vs actual:
- Total Actual Spend: ${formatMoney(totalActual)}
- Total Budget: ${formatMoney(totalBudget)}
- Total Variance: ${formatMoney(totalVariance)} (${variancePct.toFixed(2)}%)`;
    }

  } else if (parsed.intent === "monthly_trend") {
    answerType = "timeseries";
    groupedBy = "month";

    const monthlyResults = groupByField(filteredActual, filteredBudget, "month", parsed.metric)
      .sort((a, b) => getMonthSortValue(a.name) - getMonthSortValue(b.name));

    monthlyTrend = monthlyResults.map(r => ({
      month: r.name,
      value: r.value,
      actual: r.actual,
      budget: r.budget,
      variance: r.variance
    }));

    resultContext = `Monthly trend for ${parsed.metric}:\n${monthlyTrend
      .map(v => `- ${v.month}: ${formatMoney(v.value)}`)
      .join("\n")}`;

  } else if (parsed.intent === "burn_rate") {
    answerType = "timeseries";
    groupedBy = "month";

    const monthlyResults = groupByField(filteredActual, filteredBudget, "month", "actual")
      .sort((a, b) => getMonthSortValue(a.name) - getMonthSortValue(b.name));

    monthlyTrend = monthlyResults.map(r => ({
      month: r.name,
      value: r.value,
      actual: r.actual,
      budget: r.budget,
      variance: r.variance
    }));

    const monthsWithActualSpend = monthlyTrend.filter(m => Number(m.actual || 0) > 0);
    const totalMonths = monthsWithActualSpend.length || 1;
    const avgMonthlySpend = totalActual / totalMonths;
    const projectedYearEnd = avgMonthlySpend * 12;

    topResults = [
      {
        name: "Current burn rate",
        value: avgMonthlySpend,
        actual: totalActual,
        budget: totalBudget,
        variance: projectedYearEnd - totalBudget,
        variancePct: totalBudget ? ((projectedYearEnd - totalBudget) / totalBudget) * 100 : 0
      }
    ];

    resultContext = `Burn rate analysis:
- Actual spend to date: ${formatMoney(totalActual)}
- Average monthly burn rate: ${formatMoney(avgMonthlySpend)}
- Projected year-end spend: ${formatMoney(projectedYearEnd)}
- Budget reference: ${formatMoney(totalBudget)}`;

  } else if (parsed.intent === "anomaly") {
    answerType = "ranking";
    groupedBy = parsed.groupBy === "overall" ? "category" : parsed.groupBy || "category";

    const anomalyBase = groupByField(filteredActual, filteredBudget, groupedBy, "actual");
    const avg = anomalyBase.reduce((sum, item) => sum + (item.actual || 0), 0) / (anomalyBase.length || 1);

    topResults = anomalyBase
      .map(item => ({ ...item, anomalyScore: avg ? (item.actual || 0) / avg : 0 }))
      .filter(item => (item.actual || 0) > avg * 1.5)
      .sort((a, b) => (b.actual || 0) - (a.actual || 0));

    resultContext = `Potential anomalies:\n${topResults
      .slice(0, parsed.limit || 10)
      .map(v => `- ${v.name}: ${formatMoney(v.actual || 0)}`)
      .join("\n")}`;

  } else if (parsed.intent === "cost_lookup" || parsed.intent === "comparison") {
    answerType =
      financeIntent?.primaryDimension && financeIntent.primaryDimension !== "overall"
        ? "ranking"
        : "summary";

    if (financeIntent?.primaryDimension && financeIntent.primaryDimension !== "overall") {
      groupedBy = financeIntent.primaryDimension;
      topResults = groupByField(
        filteredActual,
        filteredBudget,
        financeIntent.primaryDimension,
        parsed.metric
      );

      if (parsed.ranking === "asc") {
        topResults = topResults.sort((a, b) => a.value - b.value);
      }

      resultContext = `${financeIntent.primaryDimension} by ${parsed.metric}:\n${topResults
        .slice(0, parsed.limit || 10)
        .map(v => `- ${v.name}: ${formatMoney(v.value)}`)
        .join("\n")}`;
    } else {
      groupedBy = "general";
      topResults = [{
        name: "Total",
        value:
          parsed.metric === "actual"
            ? totalActual
            : parsed.metric === "budget"
              ? totalBudget
              : totalVariance,
        actual: totalActual,
        budget: totalBudget,
        variance: totalVariance,
        variancePct
      }];

      resultContext = `Summary:
- Total Actual Spend: ${formatMoney(totalActual)}
- Total Budget: ${formatMoney(totalBudget)}
- Total Variance: ${formatMoney(totalVariance)} (${variancePct.toFixed(2)}%)`;
    }

  } else {
    answerType = "summary";
    groupedBy = "general";
    topResults = [{
      name: "Total",
      value:
        parsed.metric === "actual"
          ? totalActual
          : parsed.metric === "budget"
            ? totalBudget
            : totalVariance,
      actual: totalActual,
      budget: totalBudget,
      variance: totalVariance,
      variancePct
    }];

    resultContext = `Summary:
- Total Actual Spend: ${formatMoney(totalActual)}
- Total Budget: ${formatMoney(totalBudget)}
- Total Variance: ${formatMoney(totalVariance)} (${variancePct.toFixed(2)}%)`;
  }

  return {
    answerType,
    matchedRows,
    groupedBy,
    topResults: topResults.slice(0, parsed.limit || 10),
    monthlyTrend,
    totals,
    bestMatch: topResults[0] || null,
    resultContext,
    chartReady: answerType === "ranking" || answerType === "timeseries"
  };
}

/* =========================================================
   Output generation
   ========================================================= */

function localFallbackNarrative(result: ComputedResult, parsed: ParsedQuestion) {
  const filters = Object.entries(parsed.filters || {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  const filterText = filters ? ` in ${filters}` : "";

  if (result.answerType === "chart_request") {
    return `Chart-ready context found from the previous analysis${filterText}. Use the last grouped result to visualize the answer.`;
  }

  if (result.answerType === "ranking" && result.topResults?.length) {
    const top = result.topResults[0];
    return `Based on local analysis, the top ${result.groupedBy}${filterText} is ${top.name} with value ${formatMoney(top.value)} across ${result.matchedRows} matched rows.`;
  }

  if (result.answerType === "comparison" && result.totals) {
    return `Based on local analysis, actual is ${formatMoney(result.totals.actual || 0)}, budget is ${formatMoney(result.totals.budget || 0)}, and variance is ${formatMoney(result.totals.variance || 0)} across ${result.matchedRows} matched rows.`;
  }

  if (result.answerType === "summary" && result.totals) {
    return `Based on local analysis, actual is ${formatMoney(result.totals.actual || 0)}, budget is ${formatMoney(result.totals.budget || 0)}, and variance is ${formatMoney(result.totals.variance || 0)} across ${result.matchedRows} matched rows. Applied filters: ${filters || "none"}.`;
  }

  return `Local analysis completed. Applied filters: ${filters || "none"}. Matched rows: ${result.matchedRows}.`;
}

async function explainWithGemini(
  question: string,
  parsed: ParsedQuestion,
  computed: ComputedResult,
  apiKey: string
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });

  const explainPrompt = `
You are a senior FP&A analyst.

Answer ONLY from the structured result provided below.
Do not invent data.
Do not say data is unavailable if grouped results are present.
If the result contains grouped rows, you MUST present the answer by that grouping.
If grouped rows are present for region, station, country, category, IT category, or vendor, do NOT collapse the answer into one total-only summary.
If the user is clearly asking a follow-up, preserve the context already reflected in the structured result.

User question:
${question}

Parsed intent:
${JSON.stringify(parsed, null, 2)}

Computed result:
${JSON.stringify(computed, null, 2)}

Important rules:
- If computed.topResults exists and has items, use them directly.
- If parsed.groupBy is "region", present the answer region-wise.
- If parsed.groupBy is not "overall", do not say "overall only" or "breakdown not available".
- Mention actual, budget, and variance whenever they are available in computed.topResults.
- If variancePct exists, include it where useful.
- If the question mentions "vendor", "supplier", "duplication", "fragmentation", or "governance", prioritize identifying the supplier, country, service, spend, and region in your answer.
- Keep numbers exactly as provided in computed result.
- Do not recalculate from memory.
- If chartReady=true and the question asks for graph/chart, mention that the result is chart-ready.
- Use markdown.

Respond with exactly these sections and headings:

1. Direct answer
2. Key numbers
3. Short business insight

Formatting rules:
- In "Direct answer", answer the user's exact question first.
- In "Key numbers", list the grouped rows if available.
- If grouped rows exist, show the top relevant rows clearly, for example:
  - Europe: Actual $X | Budget $Y | Variance $Z
- In "Short business insight", explain the biggest business takeaway from the grouped result.
`;

  const explainResponse = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: explainPrompt,
  });

  return explainResponse.text || "";
}

/* =========================================================
   Public analyze function
   ========================================================= */

export async function analyzeExpenditure(
  question: string,
  actualData: FinancialTransaction[],
  budgetData: BudgetRecord[]
): Promise<{ narrative: string; result: ComputedResult | null }> {
  try {
    if (!question?.trim()) {
      return { narrative: "Please enter a question.", result: null };
    }

    if (!actualData?.length && !budgetData?.length) {
      return { narrative: "No data is loaded. Please upload Actual or Budget data first.", result: null };
    }

    const interpreted = interpretQuestion(question);

    if (interpreted.mode === "clarification" && interpreted.clarificationRule) {
      upsertClarificationRule(interpreted.clarificationRule);
      return {
        narrative: `Noted. Going forward, I will use **${interpreted.clarificationRule.value}** for **${interpreted.clarificationRule.key}**.`,
        result: null
      };
    }

    const cleanedActual = cleanData(actualData, "actual");
    const cleanedBudget = cleanData(budgetData, "budget");

    const capabilities = detectDatasetCapabilities(cleanedActual, cleanedBudget);
    const validation = validateQuestionAgainstDataset(question, capabilities, getClarificationRules());
    if (!validation.supported) {
      return { narrative: validation.message!, result: null };
    }

    let parsed = parseQuestion(question, cleanedActual, cleanedBudget);

    if (interpreted.mode === "follow_up" || interpreted.mode === "chart") {
      parsed = applyFollowUpContext(question, parsed);
    }

    const financeIntent = buildFinanceIntent(
      question,
      parsed,
      interpreted.mode === "follow_up" || interpreted.mode === "chart",
      getClarificationRules()
    );

    console.log("Finance intent:", financeIntent);

    // If user only asks for chart, reuse previous analysis
    if (interpreted.mode === "chart") {
      const session = getSessionContext();
      if (session.lastResult) {
        return {
          narrative: "Here is the chart for the previous analysis.",
          result: {
            ...session.lastResult,
            answerType: "chart_request",
            chartReady: true
          }
        };
      }
    }

    const { filteredActual, filteredBudget } = filterRows(parsed, cleanedActual, cleanedBudget);
    const result = computeAnswer(parsed, filteredActual, filteredBudget, question, financeIntent);

    // Ensure chart readiness for ranking or timeseries answers
    if (result) {
      result.chartReady =
        result.answerType === "ranking" ||
        result.answerType === "timeseries";
    }

    // Auto-generate chart title
    if (result && result.groupedBy) {
      const titleMap: Record<string, string> = {
        region: "Regional Spend Distribution",
        country: "Country Spend Distribution",
        station: "Station Spend Distribution",
        category: "Category Spend Distribution",
        itCategory: "IT Category Spend Distribution",
        vendor: "Vendor Spend Distribution",
        month: "Monthly Spend Trend"
      };

      result.title = titleMap[result.groupedBy] || "Spend Analysis";
    }

    updateSessionContext({
      lastQuestion: question,
      lastIntent: parsed.intent,
      lastMetric: parsed.metric,
      lastGroupBy: parsed.groupBy,
      lastFilters: parsed.filters,
      lastResult: result
    });

    if (!result || result.matchedRows === 0) {
      const filterStr = Object.entries(parsed.filters || {})
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ") || "None";

      return {
        narrative: [
          "**No matching data found for this question.**",
          "",
          "**Analysis details**",
          `- Intent: ${parsed.intent}`,
          `- Metric: ${parsed.metric}`,
          `- Filters: ${filterStr}`
        ].join("\n"),
        result: null
      };
    }

    const auditText = [
      "",
      "**Analysis details**",
      `- Question mode: ${interpreted.mode}`,
      `- Business intent: ${financeIntent.businessIntent}`,
      `- Primary dimension: ${financeIntent.primaryDimension}`,
      `- Output mode: ${financeIntent.outputMode}`,
      `- Follow-up: ${financeIntent.followUp ? "Yes" : "No"}`,
      `- Intent: ${parsed.intent}`,
      `- Metric: ${parsed.metric}`,
      `- Grouped by: ${result.groupedBy || "N/A"}`,
      `- Matched rows: ${result.matchedRows}`,
      `- Filters: ${
        Object.entries(parsed.filters || {})
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ") || "None"
      }`,
      `- Clarification rules: ${
        getClarificationRules().length
          ? getClarificationRules().map(r => `${r.key}=${r.value}`).join(", ")
          : "None"
      }`
    ].join("\n");

    const auditOutput = "\n\n" + auditText;

    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      return {
        narrative: localFallbackNarrative(result, parsed) + auditOutput + "\n\n*(Gemini API key is missing. Showing local fallback.)*",
        result
      };
    }

    try {
      const explanation = await explainWithGemini(question, parsed, result, apiKey);
      return {
        narrative: (explanation || localFallbackNarrative(result, parsed)) + auditOutput,
        result
      };
    } catch (error) {
      console.error("Gemini analysis error:", error);
      return {
        narrative: localFallbackNarrative(result, parsed) + auditOutput,
        result
      };
    }
  } catch (error) {
    console.error("analyzeExpenditure failed:", error);
    return {
      narrative: "Something went wrong while analyzing the expenditure data. Please check the uploaded data format and try again.",
      result: null
    };
  }
}

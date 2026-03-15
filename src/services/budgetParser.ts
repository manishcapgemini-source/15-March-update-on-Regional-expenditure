import * as XLSX from "xlsx";
import { BudgetRecord, ValidationIssue, BudgetProcessingResult, ExpenditureType } from "../types";
import { STATION_CODES, isStationCode } from "../constants";

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  if (typeof value === "string") {
    const trimmed = value.trim();
    const isBracketNegative = /^\(.*\)$/.test(trimmed);

    const cleaned = trimmed
      .replace(/[,$]/g, "")
      .replace(/usd/gi, "")
      .replace(/[^\d.\-()]/g, "");

    let parsed = Number(cleaned.replace(/[()]/g, ""));
    if (!Number.isFinite(parsed)) return 0;

    if (isBracketNegative) parsed = -parsed;
    return parsed;
  }

  return 0;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeHeader(value: unknown): string {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function extractYear(fileName: string): number {
  const match = fileName.match(/20\d{2}/);
  return match ? Number(match[0]) : new Date().getFullYear();
}

function normalizeYearMonth(value: string, fallbackYear: number): string {
  const raw = normalizeText(value);

  if (!raw) return `${fallbackYear}/01`;

  if (/^20\d{2}[/-]\d{2}$/.test(raw)) {
    return raw.replace("-", "/");
  }

  if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{4}$/i.test(raw)) {
    const date = new Date(raw);
    if (!isNaN(date.getTime())) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      return `${y}/${m}`;
    }
  }

  if (/^20\d{2}$/.test(raw)) {
    return `${raw}/01`;
  }

  return `${fallbackYear}/01`;
}

function normalizeRegion(region: unknown): string {
  const raw = String(region ?? "").trim();
  const key = raw.toLowerCase();

  const REGION_MAP: Record<string, string> = {
    us: "US",
    usa: "US",
    "united states": "US",
    "north america": "US",
    na: "US",

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
    meenat: "MENAT",
    "meenat & south of asia": "MENAT",
    "middle east north africa": "MENAT",
    "middle east & north africa": "MENAT",

    india: "India"
  };

  if (!key) return "Unknown";

  return REGION_MAP[key] || raw;
}

function normalizeType(value: string, fallback: ExpenditureType = "OPEX"): ExpenditureType {
  const upper = normalizeText(value).toUpperCase();

  if (upper.includes("CAPEX")) return "CAPEX";
  if (upper.includes("OPEX")) return "OPEX";

  return fallback;
}

function isRecognizedType(value: string): boolean {
  const upper = normalizeText(value).toUpperCase();
  return upper.includes("CAPEX") || upper.includes("OPEX");
}

function isSummaryLabel(value: string): boolean {
  const upper = normalizeText(value).toUpperCase();
  return upper === "TOTAL" || upper === "GRAND TOTAL" || upper === "SUBTOTAL";
}

type BudgetColumn = {
  colIndex: number;
  station: string;
};

export async function parseBudgetWorkbook(file: File): Promise<BudgetProcessingResult> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array" });
  const budgetYear = extractYear(file.name);

  const masterDataset: BudgetRecord[] = [];
  const validationIssues: ValidationIssue[] = [];

  const budgetByRegion: Record<string, number> = {};
  const budgetByStation: Record<string, number> = {};
  const budgetByType: Record<string, number> = {};
  const categoryTotals: Record<string, number> = {};

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const region = normalizeRegion(sheetName);

    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
      blankrows: false
    }) as unknown[][];

    if (rows.length < 2) {
      validationIssues.push({
        sheet: region,
        row: 0,
        issue: "Sheet appears to be empty.",
        severity: "error"
      });
      return;
    }

    let headerRowIndex = -1;

    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const row = rows[i] || [];
      const normalizedRow = row.map(normalizeHeader);

      const hasCategoryLike = normalizedRow.some(v => v.includes("category"));
      const hasItemLike = normalizedRow.some(
        v => v === "item" || v === "items" || v.includes("description") || v === "name" || v === "details"
      );
      const hasTypeLike = normalizedRow.some(
        v => v.includes("expenditurecategory") || v.includes("capex") || v.includes("opex") || v === "type"
      );
      const hasStationLike = row.some(v => isStationCode(normalizeText(v).toUpperCase()));
      const hasBudgetLike = normalizedRow.some(
        v => v.includes("budget") || v.includes("amount") || v.includes("total") || v.includes("usd")
      );

      if (
        (hasCategoryLike && hasItemLike) ||
        (hasItemLike && hasStationLike) ||
        (hasTypeLike && hasStationLike) ||
        (hasCategoryLike && hasBudgetLike) ||
        (hasItemLike && hasBudgetLike) ||
        hasBudgetLike
      ) {
        headerRowIndex = i;
        break;
      }
    }

    if (headerRowIndex === -1) {
      headerRowIndex = 0;
      validationIssues.push({
        sheet: region,
        row: 1,
        issue: "Header row could not be confidently detected. Using first row as header.",
        severity: "warning"
      });
    }

    const headers = (rows[headerRowIndex] || []).map(h => normalizeText(h));
    const budgetColumns: BudgetColumn[] = [];

    let categoryCol = -1;
    let itemCol = -1;
    let typeCol = -1;
    let yearMonthCol = -1;
    let stationCol = -1;
    let budgetCol = -1;
    let regionCol = -1;

    headers.forEach((header, index) => {
      const h = normalizeHeader(header);
      const upperHeader = normalizeText(header).toUpperCase();

      if (h === "category" || h === "itcategory") {
        categoryCol = index;
      } else if (
        h === "item" ||
        h === "items" ||
        h === "description" ||
        h === "name" ||
        h === "details"
      ) {
        itemCol = index;
      } else if (
        h === "expenditurecategory" ||
        h === "expendituretype" ||
        h === "type" ||
        h === "capexopex"
      ) {
        typeCol = index;
      } else if (h === "yearmonth" || h === "period" || h === "month") {
        yearMonthCol = index;
      } else if (STATION_CODES.includes(upperHeader)) {
        budgetColumns.push({ colIndex: index, station: upperHeader });
      } else if (h.includes("station") || h.includes("location") || h.includes("country")) {
        stationCol = index;
      } else if (h.includes("budget") || h.includes("amount") || h.includes("total") || h.includes("usd")) {
        budgetCol = index;
      } else if (h.includes("region")) {
        regionCol = index;
      }
    });

    if (itemCol === -1 && budgetCol === -1 && budgetColumns.length === 0) {
      validationIssues.push({
        sheet: region,
        row: headerRowIndex + 1,
        issue: "Could not detect any budget or item columns.",
        severity: "error"
      });
      return;
    }

    if (budgetColumns.length === 0 && budgetCol === -1) {
      validationIssues.push({
        sheet: region,
        row: headerRowIndex + 1,
        issue: "No station budget columns or general budget column detected.",
        severity: "warning"
      });
    }

    let currentCategory = "";

    for (let i = headerRowIndex + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      if (row.length === 0) continue;

      const categoryValue = categoryCol !== -1 ? normalizeText(row[categoryCol]) : "";
      const item = itemCol !== -1 ? normalizeText(row[itemCol]) : "Unknown";
      const typeValue = typeCol !== -1 ? normalizeText(row[typeCol]) : "";
      const rawYearMonth = yearMonthCol !== -1 ? normalizeText(row[yearMonthCol]) : "";

      if (categoryValue) currentCategory = categoryValue;

      const finalCategory = currentCategory || "Uncategorized";
      const finalType = normalizeType(typeValue, "OPEX");
      const yearMonth = normalizeYearMonth(rawYearMonth, budgetYear);

      if (!item && itemCol !== -1) continue;
      if (isSummaryLabel(item)) continue;
      if (isSummaryLabel(finalCategory)) continue;

      if (typeValue && !isRecognizedType(typeValue)) {
        validationIssues.push({
          sheet: region,
          row: i + 1,
          column: typeCol !== -1 ? String.fromCharCode(65 + typeCol) : undefined,
          issue: `Unrecognized expenditure type "${typeValue}". Defaulted to ${finalType}.`,
          severity: "warning"
        });
      }

      const hasPivotColumns = budgetColumns.length > 0;
      const hasFlatBudgetColumn = budgetCol !== -1;

      // Prefer pivot-table format when station columns are present.
      if (hasPivotColumns) {
        for (const { colIndex, station } of budgetColumns) {
          const budget = toNumber(row[colIndex]);
          if (budget === 0) continue;

          const record: BudgetRecord = {
            id: `${budgetYear}|${region}|${station}|${finalCategory}|${item}|${yearMonth}|${i}|${colIndex}`,
            year: budgetYear,
            region,
            station,
            category: finalCategory,
            item,
            type: finalType,
            budget,
            itCategory: finalCategory,
            yearMonth,
            sourceFile: file.name,
            uploadedAt: new Date().toLocaleDateString()
          };

          masterDataset.push(record);

          budgetByRegion[region] = (budgetByRegion[region] || 0) + budget;
          budgetByStation[station] = (budgetByStation[station] || 0) + budget;
          budgetByType[record.type] = (budgetByType[record.type] || 0) + budget;
          categoryTotals[record.itCategory || record.category] =
            (categoryTotals[record.itCategory || record.category] || 0) + budget;
        }

        continue;
      }

      // Flat table format
      if (hasFlatBudgetColumn) {
        const budget = toNumber(row[budgetCol]);
        if (budget === 0) continue;

        const stationRaw = stationCol !== -1 ? normalizeText(row[stationCol]).toUpperCase() : "UNKNOWN";
        const station = stationRaw || "UNKNOWN";
        const rowRegion = regionCol !== -1 ? normalizeRegion(row[regionCol]) : region;

        const record: BudgetRecord = {
          id: `${budgetYear}|${rowRegion}|${station}|${finalCategory}|${item}|${yearMonth}|${i}`,
          year: budgetYear,
          region: rowRegion,
          station,
          category: finalCategory,
          item,
          type: finalType,
          budget,
          itCategory: finalCategory,
          yearMonth,
          sourceFile: file.name,
          uploadedAt: new Date().toLocaleDateString()
        };

        masterDataset.push(record);

        budgetByRegion[rowRegion] = (budgetByRegion[rowRegion] || 0) + budget;
        budgetByStation[station] = (budgetByStation[station] || 0) + budget;
        budgetByType[record.type] = (budgetByType[record.type] || 0) + budget;
        categoryTotals[record.itCategory || record.category] =
          (categoryTotals[record.itCategory || record.category] || 0) + budget;
      }
    }
  });

  const dedupedMasterDataset = Array.from(
    new Map(masterDataset.map(record => [record.id, record])).values()
  );

  const totalBudget = dedupedMasterDataset.reduce((sum, r) => sum + r.budget, 0);

  const topCategories = Object.entries(categoryTotals)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  return {
    masterDataset: dedupedMasterDataset,
    validationIssues,
    summary: {
      totalSheets: workbook.SheetNames.length,
      totalBudget,
      budgetByRegion,
      budgetByStation,
      budgetByType,
      topCategories
    }
  };
}

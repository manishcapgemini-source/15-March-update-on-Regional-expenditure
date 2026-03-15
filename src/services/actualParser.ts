import Papa from "papaparse";
import * as XLSX from "xlsx";
import { FinancialTransaction } from "../types";

const normalizeHeader = (value: string) =>
  String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/\u200B/g, "")
    .replace(/\uFEFF/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const normalizeForCompare = (value: string) =>
  normalizeHeader(value).replace(/[^a-z0-9]/g, "");

const COLUMN_ALIASES: Record<string, string[]> = {
  companyCode: ["Company Code", "CompanyCode"],
  businessArea: ["Business Area", "BusAreaCode"],
  station: ["Station", "Country", "Business Area", "BusAreaCode"],
  it: ["IT"],
  country: ["Country"],
  region: ["Region", "Old Region", "New Region"],
  vp: ["VP", "IT Regional Head"],
  documentType: ["Document Type"],
  documentNumber: ["Document Number"],
  postingDate: ["Posting Date"],
  documentDate: ["Document Date"],
  fiscalYear: ["Fiscal Year"],
  text: ["Text"],
  reference: ["Reference"],
  assignment: ["Assignment"],
  amountLocal: ["Amount in Local Currency"],
  amountDoc: ["Amount in Doc. Curr."],
  localCurrency: ["Local Currency", "CompanyCcy"],
  usd: ["USD"],
  userName: ["User Name"],
  glAccount: ["G/L Account", "SAPCode"],
  glName: ["G/L Name", "Code Name", "NAME"],
  costCenter: ["Cost Center", "CostCenterCode"],
  yearMonth: ["Year/Month", "Year Month", "Period", "Month"],
  supplier: ["Supplier Name and Code", "Vendor Name", "Vendor", "Supplier"],
  category: ["Expenditure Category", "Category"],
  itCategory: [
    "IT Category",
    "IT infrastructure expenditures, categorized",
    "IT infrastructure expenditures categorized",
    "IT infrastructure expenditure categorized"
  ]
};

function getValue(row: Record<string, unknown>, aliases: string | string[]): unknown {
  if (!row || typeof row !== "object") return "";

  const keys = Object.keys(row);
  const aliasList = Array.isArray(aliases) ? aliases : [aliases];

  for (const alias of aliasList) {
    const target = normalizeHeader(alias);
    const foundKey = keys.find((k) => normalizeHeader(k) === target);
    if (foundKey) return row[foundKey];
  }

  for (const alias of aliasList) {
    const target = normalizeForCompare(alias);
    if (!target) continue;

    const foundKey = keys.find((k) => normalizeForCompare(k) === target);
    if (foundKey) return row[foundKey];
  }

  for (const alias of aliasList) {
    const target = normalizeForCompare(alias);
    if (target.length < 3) continue;

    const foundKey = keys.find((k) => {
      const keyNorm = normalizeForCompare(k);
      return keyNorm.includes(target) || target.includes(keyNorm);
    });

    if (foundKey) return row[foundKey];
  }

  return "";
}

function safeString(value: unknown): string {
  return String(value ?? "").trim();
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  if (typeof value === "string") {
    const trimmed = value.trim();

    const isBracketNegative = /^\(.*\)$/.test(trimmed);
    const cleaned = trimmed
      .replace(/[,$]/g, "")
      .replace(/usd/gi, "")
      .replace(/[^\d.\-()]/g, "");

    let normalized = cleaned.replace(/[()]/g, "");
    let parsed = Number(normalized);

    if (!Number.isFinite(parsed)) return 0;
    if (isBracketNegative) parsed = -parsed;

    return parsed;
  }

  return 0;
}

function extractYearFromFileName(fileName: string): number {
  const match = fileName.match(/20\d{2}/);
  return match ? Number(match[0]) : new Date().getFullYear();
}

function normalizeYearMonth(value: string, fallbackYear: number): string {
  const raw = safeString(value);

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

function getItCategoryValue(row: Record<string, unknown>): string {
  const aliasValue = safeString(getValue(row, COLUMN_ALIASES.itCategory));
  if (aliasValue) return aliasValue;

  const keys = Object.keys(row || {});
  const matchedKey = keys.find(
    (k) =>
      normalizeHeader(k).includes("it infrastructure expenditures") &&
      normalizeHeader(k).includes("categorized")
  );

  return matchedKey ? safeString(row[matchedKey]) : "";
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

function makeTransactionId(parts: Array<string | number>): string {
  return parts.map((p) => String(p ?? "").trim()).join("|");
}

function isWideMonthColumn(header: string): boolean {
  const cleanKey = String(header).trim().toLowerCase();

  if (cleanKey === "grand total" || cleanKey === "total") return false;

  return (
    /^\d{4}[/-]\d{2}$/.test(cleanKey) ||
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{4}$/i.test(cleanKey)
  );
}

function buildWideFormatTransactions(
  rawData: Record<string, unknown>[],
  fileName: string
): FinancialTransaction[] {
  const firstRow = rawData[0] || {};
  const headers = Object.keys(firstRow);
  const monthColumns = headers.filter(isWideMonthColumn);
  const fallbackYear = extractYearFromFileName(fileName);

  const output: FinancialTransaction[] = [];

  rawData.forEach((row, index) => {
    monthColumns.forEach((monthCol) => {
      const rawVal = row[monthCol];
      const value = toNumber(rawVal);

      if (value === 0) return;

      let yearMonth = normalizeYearMonth(monthCol, fallbackYear);
      const [yearStr, monthStr] = yearMonth.split("/");
      const postingDate = `${yearStr}-${monthStr}-01`;
      const fiscalYear = yearStr;
      const year = Number(yearStr) || fallbackYear;

      const supplier = safeString(getValue(row, COLUMN_ALIASES.supplier));
      const documentNumber = safeString(getValue(row, COLUMN_ALIASES.documentNumber));
      const companyCode = safeString(getValue(row, COLUMN_ALIASES.companyCode));

      const businessAreaValue =
        safeString(getValue(row, COLUMN_ALIASES.businessArea)) ||
        safeString(getValue(row, COLUMN_ALIASES.station));

      const countryValue =
        safeString(getValue(row, COLUMN_ALIASES.country)) ||
        safeString(getValue(row, COLUMN_ALIASES.station));

      const regionValue = normalizeRegion(getValue(row, COLUMN_ALIASES.region));

      const id = makeTransactionId([
        fileName,
        index,
        companyCode,
        documentNumber,
        supplier,
        yearMonth,
        value
      ]);

      output.push({
        id,
        year,
        companyCode,
        businessArea: businessAreaValue.toUpperCase(),
        it: safeString(getValue(row, COLUMN_ALIASES.it)),
        country: countryValue,
        region: regionValue,
        vp: safeString(getValue(row, COLUMN_ALIASES.vp)),
        documentType: safeString(getValue(row, COLUMN_ALIASES.documentType)),
        documentNumber,
        postingDate,
        documentDate: "",
        fiscalYear,
        text: safeString(getValue(row, COLUMN_ALIASES.text)),
        reference: safeString(getValue(row, COLUMN_ALIASES.reference)),
        assignment: safeString(getValue(row, COLUMN_ALIASES.assignment)),
        amountLocal: value,
        amountDoc: value,
        localCurrency: safeString(getValue(row, COLUMN_ALIASES.localCurrency)) || "USD",
        usd: value,
        userName: safeString(getValue(row, COLUMN_ALIASES.userName)),
        glAccount: safeString(getValue(row, COLUMN_ALIASES.glAccount)),
        glName: safeString(getValue(row, COLUMN_ALIASES.glName)),
        costCenter: safeString(getValue(row, COLUMN_ALIASES.costCenter)),
        yearMonth,
        supplier,
        category: safeString(getValue(row, COLUMN_ALIASES.category)),
        itCategory: getItCategoryValue(row),
        sourceFile: fileName
      });
    });
  });

  return output;
}

function buildTransactionFormatTransactions(
  rawData: Record<string, unknown>[],
  fileName: string
): FinancialTransaction[] {
  const fallbackYear = extractYearFromFileName(fileName);

  return rawData
    .map((row, index) => {
      const postingDate = safeString(getValue(row, COLUMN_ALIASES.postingDate));
      const fiscalYear =
        safeString(getValue(row, COLUMN_ALIASES.fiscalYear)) ||
        (postingDate ? postingDate.split("-")[0] : String(fallbackYear));

      let yearMonth = safeString(getValue(row, COLUMN_ALIASES.yearMonth));

      if (!yearMonth && postingDate) {
        const parsedDate = new Date(postingDate);
        if (!isNaN(parsedDate.getTime())) {
          const y = parsedDate.getFullYear();
          const m = String(parsedDate.getMonth() + 1).padStart(2, "0");
          yearMonth = `${y}/${m}`;
        } else {
          const parts = postingDate.split(/[-/]/);
          if (parts.length >= 2 && /^\d{4}$/.test(parts[0])) {
            yearMonth = `${parts[0]}/${String(parts[1]).padStart(2, "0")}`;
          }
        }
      }

      yearMonth = normalizeYearMonth(yearMonth, Number(fiscalYear) || fallbackYear);
      const year = Number(fiscalYear) || fallbackYear;

      const companyCode = safeString(getValue(row, COLUMN_ALIASES.companyCode));
      const documentNumber = safeString(getValue(row, COLUMN_ALIASES.documentNumber));
      const supplier = safeString(getValue(row, COLUMN_ALIASES.supplier));
      const usd = toNumber(getValue(row, COLUMN_ALIASES.usd));

      const businessAreaValue =
        safeString(getValue(row, COLUMN_ALIASES.businessArea)) ||
        safeString(getValue(row, COLUMN_ALIASES.station));

      const countryValue =
        safeString(getValue(row, COLUMN_ALIASES.country)) ||
        safeString(getValue(row, COLUMN_ALIASES.station));

      const regionValue = normalizeRegion(getValue(row, COLUMN_ALIASES.region));

      const id = makeTransactionId([
        fileName,
        index,
        companyCode,
        documentNumber,
        postingDate,
        supplier,
        usd
      ]);

      const tx: FinancialTransaction = {
        id,
        year,
        companyCode,
        businessArea: businessAreaValue.toUpperCase(),
        it: safeString(getValue(row, COLUMN_ALIASES.it)),
        country: countryValue,
        region: regionValue,
        vp: safeString(getValue(row, COLUMN_ALIASES.vp)),
        documentType: safeString(getValue(row, COLUMN_ALIASES.documentType)),
        documentNumber,
        postingDate,
        documentDate: safeString(getValue(row, COLUMN_ALIASES.documentDate)),
        fiscalYear: String(year),
        text: safeString(getValue(row, COLUMN_ALIASES.text)),
        reference: safeString(getValue(row, COLUMN_ALIASES.reference)),
        assignment: safeString(getValue(row, COLUMN_ALIASES.assignment)),
        amountLocal: toNumber(getValue(row, COLUMN_ALIASES.amountLocal)),
        amountDoc: toNumber(getValue(row, COLUMN_ALIASES.amountDoc)),
        localCurrency: safeString(getValue(row, COLUMN_ALIASES.localCurrency)),
        usd,
        userName: safeString(getValue(row, COLUMN_ALIASES.userName)),
        glAccount: safeString(getValue(row, COLUMN_ALIASES.glAccount)),
        glName: safeString(getValue(row, COLUMN_ALIASES.glName)),
        costCenter: safeString(getValue(row, COLUMN_ALIASES.costCenter)),
        yearMonth,
        supplier,
        category: safeString(getValue(row, COLUMN_ALIASES.category)),
        itCategory: getItCategoryValue(row),
        sourceFile: fileName
      };

      return tx;
    })
    .filter(
      (row) =>
        row.usd !== 0 ||
        !!row.supplier ||
        !!row.documentNumber ||
        !!row.glAccount ||
        !!row.itCategory ||
        !!row.category ||
        !!row.postingDate
    );
}

function dedupeTransactions(transactions: FinancialTransaction[]): FinancialTransaction[] {
  return Array.from(new Map(transactions.map((item) => [item.id, item])).values()).filter(Boolean);
}

function hasUsdColumn(rawData: Record<string, unknown>[]): boolean {
  if (!rawData.length) return false;

  const headers = Object.keys(rawData[0] || {});
  return headers.some((header) => normalizeForCompare(header) === "usd");
}

function parseRawData(rawData: Record<string, unknown>[], fileName: string): FinancialTransaction[] {
  if (!rawData.length) return [];

  const firstRow = rawData[0] || {};
  const headers = Object.keys(firstRow);
  const monthColumns = headers.filter(isWideMonthColumn);

  const usdExists = hasUsdColumn(rawData);
  if (!usdExists && monthColumns.length === 0) {
    console.warn(`USD column missing in ${fileName}. Spend values may be zero.`);
  }

  const transactions =
    monthColumns.length > 0
      ? buildWideFormatTransactions(rawData, fileName)
      : buildTransactionFormatTransactions(rawData, fileName);

  return dedupeTransactions(transactions);
}

export async function parseActualFile(file: File): Promise<FinancialTransaction[]> {
  const fileName = file.name;
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith(".csv")) {
    return new Promise((resolve, reject) => {
      Papa.parse<Record<string, unknown>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          try {
            resolve(parseRawData(results.data, fileName));
          } catch (error) {
            reject(error);
          }
        },
        error: (err) => reject(err)
      });
    });
  }

  if (
    lowerName.endsWith(".xlsx") ||
    lowerName.endsWith(".xls") ||
    lowerName.endsWith(".xlsm")
  ) {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });

    const allRows: Record<string, unknown>[] = [];

    workbook.SheetNames.forEach((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        defval: ""
      });

      if (jsonData.length > 0) {
        allRows.push(...jsonData);
      }
    });

    return parseRawData(allRows, fileName);
  }

  throw new Error(
    `Unsupported file format: ${fileName}. Please use .csv, .xlsx, .xls, or .xlsm`
  );
}

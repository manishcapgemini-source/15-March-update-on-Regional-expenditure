import { ExcelActualRow, ExcelBudgetRow } from "../../src/types";

function validateActualRow(row: ExcelActualRow, index: number): string[] {
  const errors: string[] = [];

  if (!row.region) errors.push(`Actual row ${index + 1}: region is required`);
  if (!row.country) errors.push(`Actual row ${index + 1}: country is required`);
  if (!row.station) errors.push(`Actual row ${index + 1}: station is required`);
  if (!row.vendor) errors.push(`Actual row ${index + 1}: vendor is required`);
  if (!row.yearMonth) errors.push(`Actual row ${index + 1}: yearMonth is required`);
  if (typeof row.usd !== "number" || Number.isNaN(row.usd)) {
    errors.push(`Actual row ${index + 1}: usd must be numeric`);
  }

  return errors;
}

function validateBudgetRow(row: ExcelBudgetRow, index: number): string[] {
  const errors: string[] = [];

  if (!row.region) errors.push(`Budget row ${index + 1}: region is required`);
  if (!row.country) errors.push(`Budget row ${index + 1}: country is required`);
  if (!row.station) errors.push(`Budget row ${index + 1}: station is required`);
  if (!row.yearMonth) errors.push(`Budget row ${index + 1}: yearMonth is required`);
  if (typeof row.budget !== "number" || Number.isNaN(row.budget)) {
    errors.push(`Budget row ${index + 1}: budget must be numeric`);
  }

  return errors;
}

export function validatePayload(body: any): string[] {
  const errors: string[] = [];

  if (!body || typeof body !== "object") {
    return ["Payload must be a valid JSON object"];
  }

  if (!Array.isArray(body.actual)) {
    errors.push("actual must be an array");
  }

  if (!Array.isArray(body.budget)) {
    errors.push("budget must be an array");
  }

  if (Array.isArray(body.actual)) {
    body.actual.forEach((row: any, index: number) => {
      errors.push(...validateActualRow(row, index));
    });
  }

  if (Array.isArray(body.budget)) {
    body.budget.forEach((row: any, index: number) => {
      errors.push(...validateBudgetRow(row, index));
    });
  }

  return errors;
}

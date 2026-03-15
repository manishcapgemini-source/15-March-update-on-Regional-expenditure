import { useState, useCallback } from "react";
import { FinancialTransaction, BudgetRecord, VarianceRecord, BudgetProcessingResult } from "../types";
import { parseActualsFile, parseBudgetFile, parseVarianceFile } from "../services/fileUploadService";

export function useFinanceUploader() {
  const [actuals, setActuals] = useState<FinancialTransaction[]>([]);
  const [budgets, setBudgets] = useState<BudgetRecord[]>([]);
  const [variances, setVariances] = useState<VarianceRecord[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadActuals = useCallback(async (file: File) => {
    setIsUploading(true);
    setError(null);
    try {
      const data = await parseActualsFile(file);
      setActuals(prev => [...prev, ...data]);
    } catch (err: any) {
      setError(`Failed to upload actuals: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  }, []);

  const uploadBudget = useCallback(async (file: File) => {
    setIsUploading(true);
    setError(null);
    try {
      const result = await parseBudgetFile(file);
      setBudgets(prev => [...prev, ...result.masterDataset]);
    } catch (err: any) {
      setError(`Failed to upload budget: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  }, []);

  const uploadVariance = useCallback(async (file: File) => {
    setIsUploading(true);
    setError(null);
    try {
      const data = await parseVarianceFile(file);
      setVariances(prev => [...prev, ...data]);
    } catch (err: any) {
      setError(`Failed to upload variance: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  }, []);

  const clearData = useCallback(() => {
    setActuals([]);
    setBudgets([]);
    setVariances([]);
    setError(null);
  }, []);

  return {
    actuals,
    budgets,
    variances,
    isUploading,
    error,
    uploadActuals,
    uploadBudget,
    uploadVariance,
    clearData
  };
}

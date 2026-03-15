import React, { useRef } from "react";
import { Upload, FileText, PieChart, AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface Props {
  onUploadActuals: (file: File) => void;
  onUploadBudget: (file: File) => void;
  onUploadVariance: (file: File) => void;
  isUploading: boolean;
  actualCount: number;
  budgetCount: number;
  varianceCount: number;
  error: string | null;
  onClear: () => void;
}

export const FinanceDashboardUploader: React.FC<Props> = ({
  onUploadActuals,
  onUploadBudget,
  onUploadVariance,
  isUploading,
  actualCount,
  budgetCount,
  varianceCount,
  error,
  onClear
}) => {
  const actualInputRef = useRef<HTMLInputElement>(null);
  const budgetInputRef = useRef<HTMLInputElement>(null);
  const varianceInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'actual' | 'budget' | 'variance') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (type === 'actual') onUploadActuals(file);
    else if (type === 'budget') onUploadBudget(file);
    else if (type === 'variance') onUploadVariance(file);

    // Reset input
    e.target.value = '';
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Data Sources</h2>
          <p className="text-sm text-slate-500 text-balance">Upload your financial reports to begin analysis.</p>
        </div>
        {(actualCount > 0 || budgetCount > 0 || varianceCount > 0) && (
          <button
            onClick={onClear}
            className="text-xs font-medium text-red-600 hover:text-red-700 flex items-center gap-1 px-2 py-1 rounded-md hover:bg-red-50 transition-colors"
          >
            <X className="w-3 h-3" />
            Clear All
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Actuals Upload */}
        <div className="relative group">
          <input
            type="file"
            ref={actualInputRef}
            onChange={(e) => handleFileChange(e, 'actual')}
            className="hidden"
            accept=".csv"
          />
          <button
            onClick={() => actualInputRef.current?.click()}
            disabled={isUploading}
            className={`w-full flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed transition-all ${
              actualCount > 0 
                ? 'border-emerald-200 bg-emerald-50/30' 
                : 'border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/30'
            }`}
          >
            <div className={`p-3 rounded-full mb-3 ${actualCount > 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-600 group-hover:bg-indigo-100 group-hover:text-indigo-600'}`}>
              {actualCount > 0 ? <CheckCircle2 className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
            </div>
            <span className="text-sm font-medium text-slate-900">Actual Spend</span>
            <span className="text-xs text-slate-500 mt-1">
              {actualCount > 0 ? `${actualCount.toLocaleString()} rows loaded` : 'Upload CSV'}
            </span>
          </button>
        </div>

        {/* Budget Upload */}
        <div className="relative group">
          <input
            type="file"
            ref={budgetInputRef}
            onChange={(e) => handleFileChange(e, 'budget')}
            className="hidden"
            accept=".xlsx,.xls,.csv"
          />
          <button
            onClick={() => budgetInputRef.current?.click()}
            disabled={isUploading}
            className={`w-full flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed transition-all ${
              budgetCount > 0 
                ? 'border-indigo-200 bg-indigo-50/30' 
                : 'border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/30'
            }`}
          >
            <div className={`p-3 rounded-full mb-3 ${budgetCount > 0 ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-600 group-hover:bg-indigo-100 group-hover:text-indigo-600'}`}>
              {budgetCount > 0 ? <CheckCircle2 className="w-6 h-6" /> : <PieChart className="w-6 h-6" />}
            </div>
            <span className="text-sm font-medium text-slate-900">Budget Plan</span>
            <span className="text-xs text-slate-500 mt-1">
              {budgetCount > 0 ? `${budgetCount.toLocaleString()} rows loaded` : 'Upload Excel/CSV'}
            </span>
          </button>
        </div>

        {/* Variance Upload */}
        <div className="relative group">
          <input
            type="file"
            ref={varianceInputRef}
            onChange={(e) => handleFileChange(e, 'variance')}
            className="hidden"
            accept=".csv"
          />
          <button
            onClick={() => varianceInputRef.current?.click()}
            disabled={isUploading}
            className={`w-full flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed transition-all ${
              varianceCount > 0 
                ? 'border-amber-200 bg-amber-50/30' 
                : 'border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/30'
            }`}
          >
            <div className={`p-3 rounded-full mb-3 ${varianceCount > 0 ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-600 group-hover:bg-indigo-100 group-hover:text-indigo-600'}`}>
              {varianceCount > 0 ? <CheckCircle2 className="w-6 h-6" /> : <Upload className="w-6 h-6" />}
            </div>
            <span className="text-sm font-medium text-slate-900">Variance Report</span>
            <span className="text-xs text-slate-500 mt-1">
              {varianceCount > 0 ? `${varianceCount.toLocaleString()} rows loaded` : 'Upload CSV (Optional)'}
            </span>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isUploading && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="mt-4 flex items-center justify-center gap-2 text-sm text-indigo-600 font-medium"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            Processing files...
          </motion.div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="mt-4 p-3 rounded-lg bg-red-50 border border-red-100 flex items-start gap-3 text-sm text-red-700"
          >
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <p>{error}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

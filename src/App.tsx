  import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
  import Papa from 'papaparse';
  import * as XLSX from 'xlsx';
  import ExcelJS from 'exceljs';
  import { saveAs } from 'file-saver';
  import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
    ComposedChart, Area, Line
  } from 'recharts';
  import { 
    Upload, Filter, Download, 
    BarChart3, Table as TableIcon, Search, X, ChevronDown,
    FileSpreadsheet, TrendingUp, DollarSign, Globe, Building2,
    MessageSquare, BrainCircuit, AlertTriangle, ArrowRight, ArrowUpRight, ArrowDownRight,
    Database, Activity, Layers, Trash2, Wallet, Plus,
    Target, CheckCircle2, AlertCircle, Zap, Sparkles, ShieldAlert, Map as MapIcon
  } from 'lucide-react';
  import { clsx, type ClassValue } from 'clsx';
  import { twMerge } from 'tailwind-merge';
  import { motion, AnimatePresence } from 'motion/react';
  import Markdown from 'react-markdown';
  import { 
    FinancialTransaction, 
    UploadedFile, 
    PivotRow, 
    PivotRowWithMoM, 
    UploadedFileData,
    BudgetRecord,
    UploadedBudgetFile,
    BudgetProcessingResult,
    ComputedResult
  } from './types';
  import { formatCurrency } from './utils/formatters';
  import { analyzeExpenditure } from './services/geminiService';
  import { parseBudgetWorkbook } from './services/budgetParser';
  import { parseActualFile } from './services/actualParser';
  import { buildVarianceRecords } from './finance/varianceEngine';
  import { generateInsights } from './finance/insightEngine';
  import DynamicChart from './DynamicChart';
  import AICFOInsightPanel from './components/AICFOInsightPanel';
  import BudgetForecastPanel from './components/BudgetForecastPanel';
  import VendorNegotiationRadar from './components/VendorNegotiationRadar';
  import { ErrorBoundary } from './components/ErrorBoundary';

  // Utility for tailwind classes
  function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
  }

  const normalizeHeader = (value: string) =>
    String(value || '')
      .replace(/\u00A0/g, ' ')
      .replace(/\u200B/g, '')
      .replace(/\uFEFF/g, '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const normalizeForCompare = (value: string) =>
    normalizeHeader(value).replace(/[^a-z0-9]/g, '');

  const STORAGE_KEYS = {
    uiState: 'it_ui_state_v1',
    expenditureMeta: 'it_expenditure_data_meta_v1',
    budgetMeta: 'it_budget_data_meta_v1'
  };

  const safeSetLocalStorage = (key: string, value: unknown) => {
    try {
      const json = JSON.stringify(value);
      const sizeInBytes = new Blob([json]).size;
      const maxSize = 4.5 * 1024 * 1024;

      if (sizeInBytes > maxSize) {
        console.warn(`Skipped saving ${key}: payload too large for localStorage.`);
        return false;
      }

      localStorage.setItem(key, json);
      return true;
    } catch (error) {
      console.warn(`Failed to save ${key} to localStorage`, error);
      return false;
    }
  };

  const safeGetLocalStorage = <T,>(key: string, fallback: T): T => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch (error) {
      console.warn(`Failed to read ${key} from localStorage`, error);
      return fallback;
    }
  };

  const getValue = (row: any, aliases: string | string[]) => {
    if (!row || typeof row !== 'object') return '';

    const keys = Object.keys(row);
    const aliasList = Array.isArray(aliases) ? aliases : [aliases];

    for (const alias of aliasList) {
      const target = normalizeHeader(alias);
      const foundKey = keys.find(k => normalizeHeader(k) === target);
      if (foundKey) return row[foundKey];
    }

    for (const alias of aliasList) {
      const target = normalizeForCompare(alias);
      if (!target) continue;

      const foundKey = keys.find(k => normalizeForCompare(k) === target);
      if (foundKey) return row[foundKey];
    }

    for (const alias of aliasList) {
      const target = normalizeForCompare(alias);
      if (target.length < 3) continue;

      const foundKey = keys.find(k => {
        const keyNorm = normalizeForCompare(k);
        return keyNorm.includes(target) || target.includes(keyNorm);
      });

      if (foundKey) return row[foundKey];
    }

    return '';
  };

  const COLUMN_ALIASES: Record<string, string[]> = {
    companyCode: ['Company Code', 'CompanyCode'],
    businessArea: ['Business Area', 'BusAreaCode'],
    it: ['IT'],
    station: ['Station', 'Business Area', 'BusAreaCode', 'Country'],
    region: ['Region', 'Old Region', 'New Region'],
    vp: ['VP', 'IT Regional Head'],
    documentType: ['Document Type'],
    documentNumber: ['Document Number'],
    postingDate: ['Posting Date'],
    documentDate: ['Document Date'],
    fiscalYear: ['Fiscal Year'],
    text: ['Text'],
    reference: ['Reference'],
    assignment: ['Assignment'],
    amountLocal: ['Amount in Local Currency'],
    amountDoc: ['Amount in Doc. Curr.'],
    localCurrency: ['Local Currency', 'CompanyCcy'],
    usd: ['USD'],
    userName: ['User Name'],
    glAccount: ['G/L Account', 'SAPCode'],
    glName: ['G/L Name', 'Code Name', 'NAME'],
    costCenter: ['Cost Center', 'CostCenterCode'],
    yearMonth: ['Year/Month', 'Year Month', 'Period', 'Month'],
    supplier: ['Supplier Name and Code', 'Vendor Name', 'Vendor', 'Supplier'],
    category: ['Expenditure Category', 'EXENTITURE Category', 'Category'],
    itCategory: [
      'IT Category',
      'IT infrastructure expenditures, categorized',
      'IT infrastructure expenditures categorized',
      'IT infrastructure expenditure categorized'
    ],
    budgetCategory: ['Budget Category', 'BudgetCategory'],
    budgetItem: ['Budget Item', 'BudgetItem', 'Items', 'Item'],
    budgetUsd: ['Budget USD', 'USD Budget', 'Budget', 'Budget Amount', 'BudgetUsd']
  };

  const getItCategoryValue = (row: any) => {
    const aliasValue = String(getValue(row, COLUMN_ALIASES.itCategory)).trim();
    if (aliasValue) return aliasValue;

    const keys = Object.keys(row || {});
    const matchedKey = keys.find(k =>
      normalizeHeader(k).includes('it infrastructure expenditures') &&
      normalizeHeader(k).includes('categorized')
    );

    return matchedKey ? String(row[matchedKey]).trim() : '';
  };

  const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

  const STAT_STYLES: Record<string, string> = {
    rose: "bg-rose-50 text-rose-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600"
  };

  function MultiSelectCheckbox({ 
    label, 
    options = [], 
    selected = [], 
    onChange,
    className 
  }: { 
    label: string; 
    options?: string[]; 
    selected?: string[]; 
    onChange: (values: string[]) => void;
    className?: string;
  }) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
          setIsOpen(false);
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const safeOptions = Array.isArray(options) ? options : [];
    const safeSelected = Array.isArray(selected) ? selected : [];

    const toggleOption = (option: string) => {
      const newSelected = safeSelected.includes(option)
        ? safeSelected.filter(item => item !== option)
        : [...safeSelected, option];
      onChange(newSelected);
    };

    const filteredOptions = safeOptions.filter(opt =>
      String(opt || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
      <div className={cn("relative", className)} ref={containerRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm flex items-center justify-between hover:bg-slate-100 transition-colors"
        >
          <span className="truncate max-w-[150px]">
            {safeSelected.length === 0 ? `All ${label}s` : `${safeSelected.length} Selected`}
          </span>
          <ChevronDown size={14} className={cn("transition-transform", isOpen && "rotate-180")} />
        </button>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute z-50 mt-2 w-64 bg-white border border-slate-200 rounded-2xl shadow-xl p-4 space-y-3 max-h-80 overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{label}</span>
                <button 
                  onClick={() => onChange([])}
                  className="text-[10px] font-bold text-rose-600 hover:underline"
                >
                  Clear
                </button>
              </div>

              {safeOptions.length > 5 && (
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" size={12} />
                  <input
                    type="text"
                    placeholder="Search options..."
                    className="w-full pl-7 pr-3 py-1.5 bg-slate-50 border border-slate-100 rounded-lg text-xs outline-none focus:ring-2 focus:ring-rose-500/20"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              )}

              <div className="space-y-1">
                {filteredOptions.length === 0 ? (
                  <div className="text-[10px] text-slate-400 italic p-2 text-center">No matches found</div>
                ) : (
                  filteredOptions.map(option => (
                    <label key={option} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors group">
                      <input
                        type="checkbox"
                        checked={safeSelected.includes(option)}
                        onChange={() => toggleOption(option)}
                        className="w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                      />
                      <span className="text-sm text-slate-600 group-hover:text-slate-900 truncate">{option}</span>
                    </label>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }



  export default function AppWrapper() {
    return (
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    );
  }

  type VendorGovernanceRow = {
    supplier: string;
    service: string;
    country: string;
    region: string;
    yearMonth: string;
    spend: number;
    category?: string;
    itCategory?: string;
  };

  function classifyService(row: FinancialTransaction): string {
    const raw = [
      row.itCategory,
      row.category,
      row.glName,
      row.text,
      row.supplier
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

    // Exact / strong business matches first
    if (raw.includes('internet provider')) return 'Internet Provider';
    if (raw.includes('connectivity - interbranch')) return 'Interbranch Connectivity';
    if (raw.includes('interbranch connectivity')) return 'Interbranch Connectivity';
    if (raw.includes('computer and server hw supplier')) return 'Hardware Supplier';
    if (raw.includes('computer & server hw supplier')) return 'Hardware Supplier';

    // Connectivity / telecom
    if (raw.includes('mpls')) return 'Interbranch Connectivity';
    if (raw.includes('sd-wan')) return 'Interbranch Connectivity';
    if (raw.includes('wan')) return 'Interbranch Connectivity';
    if (raw.includes('vpn')) return 'Connectivity';
    if (raw.includes('internet')) return 'Internet Provider';
    if (raw.includes('connectivity')) return 'Connectivity';
    if (raw.includes('telecom')) return 'Connectivity';
    if (raw.includes('bandwidth')) return 'Connectivity';
    if (raw.includes('network service')) return 'Network Services';
    if (raw.includes('network')) return 'Network Services';

    // Hardware
    if (raw.includes('server')) return 'Server Hardware';
    if (raw.includes('computer')) return 'Computer Hardware';
    if (raw.includes('desktop')) return 'Computer Hardware';
    if (raw.includes('laptop')) return 'Computer Hardware';
    if (raw.includes('printer')) return 'Printer / Scanner';
    if (raw.includes('scanner')) return 'Printer / Scanner';
    if (raw.includes('storage')) return 'Storage Hardware';
    if (raw.includes('firewall')) return 'Network Security';
    if (raw.includes('security')) return 'Network Security';

    // Cloud / hosting
    if (raw.includes('cloud')) return 'Cloud Infrastructure';
    if (raw.includes('hosting')) return 'Cloud Infrastructure';
    if (raw.includes('data center')) return 'Data Center / Hosting';

    // Fallbacks
    return row.itCategory?.trim() || row.category?.trim() || 'Other Infrastructure Service';
  }

  function App() {
    const [isUiStateHydrated, setIsUiStateHydrated] = useState(false);
    const [uploadedFileContents, setUploadedFileContents] = useState<UploadedFileData[]>([]);
    const [budgetData, setBudgetData] = useState<BudgetRecord[]>([]);
    const [excelSyncInfo, setExcelSyncInfo] = useState<{ fileName: string; submittedAt: string } | null>(null);

    // Poll for Excel sync data
    useEffect(() => {
      const pollSync = async () => {
        try {
          const res = await fetch('/api/latest-data');
          if (res.ok) {
            const data = await res.json();
            if (data.status === "success" && data.lastSyncAt !== excelSyncInfo?.submittedAt) {
              setExcelSyncInfo({ fileName: data.fileName, submittedAt: data.lastSyncAt });
              
              // Map Excel rows to internal types
              if (data.actual && Array.isArray(data.actual)) {
                const newActuals: FinancialTransaction[] = data.actual.map((row: any) => ({
                  ...row,
                  companyCode: 'EXCEL',
                  businessArea: 'EXCEL',
                  it: 'EXCEL',
                  vp: 'EXCEL',
                  documentType: 'EXCEL',
                  documentNumber: 'EXCEL',
                  postingDate: data.lastSyncAt,
                  documentDate: data.lastSyncAt,
                  fiscalYear: row.yearMonth.split('-')[0],
                  text: 'Synced from Excel',
                  reference: 'EXCEL',
                  assignment: 'EXCEL',
                  amountLocal: row.usd,
                  amountDoc: row.usd,
                  localCurrency: 'USD',
                  userName: 'EXCEL_VBA',
                  glAccount: 'EXCEL',
                  glName: 'EXCEL',
                  costCenter: 'EXCEL',
                  supplier: row.vendor,
                  sourceFile: data.fileName
                }));

                setUploadedFileContents(prev => {
                  const filtered = prev.filter(f => f.name !== data.fileName);
                  return [...filtered, {
                    name: data.fileName,
                    uploadDate: data.lastSyncAt,
                    transactions: newActuals
                  }];
                });
              }

              if (data.budget && Array.isArray(data.budget)) {
                const newBudgets: BudgetRecord[] = data.budget.map((row: any) => ({
                  ...row,
                  year: parseInt(row.yearMonth.split('-')[0]),
                  item: 'Synced from Excel',
                  type: row.expenditureType as any,
                  sourceFile: data.fileName,
                  uploadedAt: data.lastSyncAt
                }));

                setBudgetData(prev => {
                  const filtered = prev.filter(b => b.sourceFile !== data.fileName);
                  return [...filtered, ...newBudgets];
                });
              }
            }
          }
        } catch (err) {
          console.error("Failed to poll sync data", err);
        }
      };

      const interval = setInterval(pollSync, 10000);
      pollSync(); // Initial check
      return () => clearInterval(interval);
    }, [excelSyncInfo]);

    const actualData = useMemo(() => {
      if (!Array.isArray(uploadedFileContents)) return [];
      const allTransactions = uploadedFileContents.flatMap(file => file?.transactions || []);
      const unique = Array.from(new Map(allTransactions.map(item => [item?.id, item])).values()).filter(Boolean);
      return unique;
    }, [uploadedFileContents]);

    const uploadedFiles = useMemo<UploadedFile[]>(() => {
      if (!Array.isArray(uploadedFileContents)) return [];
      return uploadedFileContents.map(file => ({
        name: file.name,
        uploadDate: file.uploadDate,
        transactionCount: file?.transactions?.length || 0,
        totalUsd: (file?.transactions || []).reduce((sum, t) => sum + (t?.usd || 0), 0)
      }));
    }, [uploadedFileContents]);

    const uploadedBudgetFiles = useMemo<UploadedBudgetFile[]>(() => {
      try {
        const filesMap = new Map<string, { recordCount: number, totalBudgetUsd: number, uploadDate: string }>();
        budgetData.filter(Boolean).forEach(b => {
          const fileName = b.sourceFile || 'Unknown';
          const existing = filesMap.get(fileName);
          
          const recordCount = (existing?.recordCount || 0) + 1;
          const totalBudgetUsd = (existing?.totalBudgetUsd || 0) + (b.budget || 0);
          
          // Prefer a non-N/A upload date if available
          let uploadDate = existing?.uploadDate || 'N/A';
          if ((uploadDate === 'N/A' || !uploadDate) && b.uploadedAt) {
            uploadDate = b.uploadedAt;
          }

          filesMap.set(fileName, {
            recordCount,
            totalBudgetUsd,
            uploadDate
          });
        });
        
        return Array.from(filesMap.entries()).map(([name, stats]) => ({
          name,
          uploadDate: stats.uploadDate,
          recordCount: stats.recordCount,
          totalBudgetUsd: stats.totalBudgetUsd
        }));
      } catch (e) {
        console.error("uploadedBudgetFiles error:", e);
        return [];
      }
    }, [budgetData]);

    const [isDragging, setIsDragging] = useState(false);
    const [activeTab, setActiveTab] = useState<'dashboard' | 'transactions' | 'analyst' | 'data' | 'budget' | 'variance' | 'vendorGovernance'>('dashboard');
    const [selectedYear, setSelectedYear] = useState<string>('All Years');
    const [filters, setFilters] = useState({
      fiscalYear: [] as string[],
      yearMonth: [] as string[],
      region: [] as string[],
      country: [] as string[],
      station: [] as string[],
      supplier: [] as string[],
      category: [] as string[],
      itCategory: [] as string[],
      budgetCategory: [] as string[],
      budgetItem: [] as string[],
      budgetType: [] as string[],
      costCenter: [] as string[],
      glAccount: [] as string[],
      search: ''
    });
    const [momThreshold, setMomThreshold] = useState(35);

    useEffect(() => {
      const savedUiState = safeGetLocalStorage(STORAGE_KEYS.uiState, null as null | {
        selectedYear: string;
        activeTab: 'dashboard' | 'transactions' | 'analyst' | 'data' | 'budget' | 'variance' | 'vendorGovernance';
        momThreshold: number;
        filters: typeof filters;
      });

      if (savedUiState) {
        setSelectedYear(savedUiState.selectedYear || 'All Years');
        setActiveTab(savedUiState.activeTab || 'dashboard');
        setMomThreshold(
          typeof savedUiState.momThreshold === 'number' ? savedUiState.momThreshold : 35
        );
        setFilters(
          savedUiState.filters || {
            fiscalYear: [],
            yearMonth: [],
            region: [],
            country: [],
            station: [],
            supplier: [],
            category: [],
            itCategory: [],
            budgetCategory: [],
            budgetItem: [],
            budgetType: [],
            costCenter: [],
            glAccount: [],
            search: ''
          }
        );
      }

      setIsUiStateHydrated(true);
    }, []);

    useEffect(() => {
      if (!isUiStateHydrated) return;

      safeSetLocalStorage(STORAGE_KEYS.uiState, {
        selectedYear,
        activeTab,
        momThreshold,
        filters
      });
    }, [selectedYear, activeTab, momThreshold, filters, isUiStateHydrated]);

    // AI Analyst State
    const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'ai'; content: string; analysisResult?: ComputedResult | null }[]>([]);
    const [lastAnalysisResult, setLastAnalysisResult] = useState<ComputedResult | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [userInput, setUserInput] = useState('');
    const chatEndRef = useRef<HTMLDivElement>(null);

    const [pendingData, setPendingData] = useState<FinancialTransaction[]>([]);
    const [showUploadChoice, setShowUploadChoice] = useState(false);
    const [fileToDelete, setFileToDelete] = useState<string | null>(null);
    const [budgetFileToDelete, setBudgetFileToDelete] = useState<string | null>(null);
    const [showClearAllModal, setShowClearAllModal] = useState(false);
    const [showBudgetSuccess, setShowBudgetSuccess] = useState<BudgetProcessingResult | null>(null);
    const [showUsdWarning, setShowUsdWarning] = useState(false);

    useEffect(() => {
      safeSetLocalStorage(STORAGE_KEYS.expenditureMeta, {
        uploaded: uploadedFileContents.length > 0,
        fileCount: uploadedFileContents.length,
        timestamp: new Date().toISOString()
      });
    }, [uploadedFileContents]);

    useEffect(() => {
      safeSetLocalStorage(STORAGE_KEYS.budgetMeta, {
        uploaded: budgetData.length > 0,
        rowCount: budgetData.length,
        timestamp: new Date().toISOString()
      });
    }, [budgetData]);

    useEffect(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages]);

    const [pendingFileName, setPendingFileName] = useState('');

    const [manualBudget, setManualBudget] = useState({
      region: '',
      station: '',
      category: '',
      itCategory: '',
      budgetCategory: '',
      budgetItem: '',
      yearMonth: '',
      budget: '',
      item: '',
      type: 'OPEX'
    });

    const saveBudgetRows = useCallback((newRecords: BudgetRecord[]) => {
      setBudgetData(prev => {
        try {
          const budgetMap = new Map(prev.filter(Boolean).map(b => [b.id, b]));
          newRecords.filter(Boolean).forEach(b => {
            // Ensure ID is unique by including sourceFile if not already present
            const baseId = b.id || `${b.region}|${b.station}|${b.category}|${b.itCategory}|${b.yearMonth}`;
            const finalId = baseId.includes(b.sourceFile || '') ? baseId : `${baseId}|${b.sourceFile}`;
            budgetMap.set(finalId, { ...b, id: finalId });
          });
          return Array.from(budgetMap.values());
        } catch (e) {
          console.error("saveBudgetRows error:", e);
          return prev;
        }
      });
    }, []);

    const confirmDeleteBudgetFile = () => {
      if (!budgetFileToDelete) return;
      setBudgetData(prev => prev.filter(b => b.sourceFile !== budgetFileToDelete));
      setBudgetFileToDelete(null);
      setLastAnalysisResult(null);
    };

    const handleAddManualBudget = () => {
      const { region, station, yearMonth, budget, category, itCategory, budgetCategory, budgetItem, item, type } = manualBudget;
      
      if (!region || !station || !yearMonth || !budget) {
        alert("Please fill in all required fields (Region, Station, Year/Month, Budget)");
        return;
      }

      const id = `${region}|${station}|${category}|${itCategory}|${budgetCategory}|${budgetItem}|${yearMonth}`;

      saveBudgetRows([
        {
          id: id || `manual-${Date.now()}`,
          year: parseInt(yearMonth.split('/')[0] || "2025", 10),
          region,
          station,
          yearMonth,
          budget: Number(budget),
          category: category || 'Opex',
          itCategory: itCategory || 'General',
          budgetCategory: budgetCategory || '',
          budgetItem: budgetItem || '',
          item: budgetItem || item || 'Manual Entry',
          type: (type || 'OPEX') as "CAPEX" | "OPEX",
          sourceFile: 'Manual Entry',
          uploadedAt: new Date().toLocaleDateString()
        }
      ]);

      setManualBudget({
        region: '',
        station: '',
        category: '',
        itCategory: '',
        budgetCategory: '',
        budgetItem: '',
        yearMonth: '',
        budget: '',
        item: '',
        type: 'OPEX'
      });
    };

    const budgetStats = useMemo(() => {
      try {
        const validData = budgetData.filter(Boolean);
        const totalBudget = validData.reduce((sum, b) => sum + (b.budget || 0), 0);
        const budgetRows = validData.length;
        const regions = new Set(validData.map(b => b.region)).size;
        const stations = new Set(validData.map(b => b.station)).size;
        return { totalBudget, budgetRows, regions, stations };
      } catch (e) {
        console.error("budgetStats error:", e);
        return { totalBudget: 0, budgetRows: 0, regions: 0, stations: 0 };
      }
    }, [budgetData]);

    const monthsPassed = useMemo(() => {
      const yearFilter = selectedYear === 'All Years' ? undefined : parseInt(selectedYear, 10);
      const months = new Set(
        actualData
          .filter(t => (yearFilter ? t.year === yearFilter : true))
          .map(t => t.yearMonth)
          .filter(Boolean)
      );
      return months.size || 1;
    }, [actualData, selectedYear]);

    const varianceResult = useMemo(() => {
      try {
        return buildVarianceRecords(actualData, budgetData, selectedYear === 'All Years' ? undefined : parseInt(selectedYear, 10));
      } catch (e) {
        console.error("varianceResult error:", e);
        return {
          varianceRecords: [],
          summary: {
            totalBudget: 0,
            totalActual: 0,
            totalVariance: 0,
            variancePct: 0,
            budgetUsedPercent: 0,
            runRate: 0,
            forecastYearEnd: 0,
            overspendRisk: 0
          }
        };
      }
    }, [actualData, budgetData, selectedYear]);

    const varianceData = varianceResult.varianceRecords;

    const filteredBudgetData = useMemo(() => {
      try {
        return budgetData.filter(Boolean).filter(row => {
          const rowYear = String(row.year);
          if (selectedYear !== 'All Years' && rowYear !== selectedYear) return false;

          return (
            (filters.region.length === 0 || filters.region.includes(row.region)) &&
            (filters.country.length === 0 || filters.country.includes(row.station as string)) &&
            (filters.station.length === 0 || filters.station.includes(row.station as string)) &&
            (filters.category.length === 0 || filters.category.includes(row.category)) &&
            (filters.itCategory.length === 0 || filters.itCategory.includes(row.itCategory)) &&
            (filters.budgetCategory.length === 0 || filters.budgetCategory.includes(row.budgetCategory || '')) &&
            (filters.budgetItem.length === 0 || filters.budgetItem.includes(row.budgetItem || '')) &&
            (filters.budgetType.length === 0 || filters.budgetType.includes(String(row.type || ''))) &&
            (filters.yearMonth.length === 0 || filters.yearMonth.includes(row.yearMonth))
          );
        });
      } catch (e) {
        console.error("filteredBudgetData error:", e);
        return [];
      }
    }, [budgetData, filters, selectedYear]);

    const filteredVarianceData = useMemo(() => {
      return varianceData.filter(v => {
        if (filters.region.length > 0 && !filters.region.includes(v.region)) return false;
        if (filters.country.length > 0 && !filters.country.includes(v.station as string)) return false;
        if (filters.station.length > 0 && !filters.station.includes(v.station as string)) return false;
        if (filters.category.length > 0 && !filters.category.includes(v.category)) return false;
        if (filters.itCategory.length > 0 && !filters.itCategory.includes(v.itCategory)) return false;
        if (filters.budgetCategory.length > 0 && !filters.budgetCategory.includes(v.budgetCategory || '')) return false;
        if (filters.budgetItem.length > 0 && !filters.budgetItem.includes(v.budgetItem || '')) return false;
        if (filters.budgetType.length > 0 && !filters.budgetType.includes(v.type)) return false;
        if (filters.yearMonth.length > 0 && !filters.yearMonth.includes(v.yearMonth)) return false;
        return true;
      });
    }, [varianceData, filters]);

    const varianceAnalysis = useMemo(() => {
      try {
        // Use the already filtered variance data
        const filtered = filteredVarianceData;

        const totalBudget = filtered.reduce((sum, v) => sum + v.budgetUsd, 0);
        const totalActual = filtered.reduce((sum, v) => sum + v.actualUsd, 0);
        const totalVariance = totalActual - totalBudget;
        const variancePct = totalBudget !== 0 ? (totalVariance / totalBudget) * 100 : 0;

        const runRate = totalActual / monthsPassed;
        const forecastYearEnd = runRate * 12;
        const overspendRisk = forecastYearEnd - totalBudget;
        const budgetUsedPercent = totalBudget !== 0 ? (totalActual / totalBudget) * 100 : 0;

        // Charts data
        const byRegion: Record<string, { name: string, budget: number, actual: number }> = {};
        const byStation: Record<string, { name: string, budget: number, actual: number }> = {};
        const byItCategory: Record<string, { name: string, budget: number, actual: number }> = {};
        const byMonth: Record<string, { name: string, budget: number, actual: number, variance: number }> = {};

        filtered.forEach(v => {
          // By Region
          if (!byRegion[v.region]) byRegion[v.region] = { name: v.region, budget: 0, actual: 0 };
          byRegion[v.region].budget += v.budgetUsd;
          byRegion[v.region].actual += v.actualUsd;

          // By Station
          if (!byStation[v.station as string]) byStation[v.station as string] = { name: v.station as string, budget: 0, actual: 0 };
          byStation[v.station as string].budget += v.budgetUsd;
          byStation[v.station as string].actual += v.actualUsd;

          // By IT Category
          if (!byItCategory[v.itCategory]) byItCategory[v.itCategory] = { name: v.itCategory, budget: 0, actual: 0 };
          byItCategory[v.itCategory].budget += v.budgetUsd;
          byItCategory[v.itCategory].actual += v.actualUsd;

          // By Month
          if (!byMonth[v.yearMonth]) byMonth[v.yearMonth] = { name: v.yearMonth, budget: 0, actual: 0, variance: 0 };
          byMonth[v.yearMonth].budget += v.budgetUsd;
          byMonth[v.yearMonth].actual += v.actualUsd;
          byMonth[v.yearMonth].variance += v.variance;
        });

        // Tables data
        const overBudget = Object.values(byItCategory)
          .map(c => ({ ...c, variance: c.actual - c.budget, variancePct: c.budget !== 0 ? ((c.actual - c.budget) / c.budget) * 100 : 0 }))
          .filter(c => c.variance > 0)
          .sort((a, b) => b.variance - a.variance);

        const underBudget = Object.values(byItCategory)
          .map(c => ({ ...c, variance: c.actual - c.budget, variancePct: c.budget !== 0 ? ((c.actual - c.budget) / c.budget) * 100 : 0 }))
          .filter(c => c.variance < 0)
          .sort((a, b) => a.variance - b.variance);

        // Region then Station breakdown
        const hierarchy: { region: string, station: string, budget: number, actual: number, variance: number, variancePct: number | null, forecast: number, risk: number }[] = [];
        const hierarchyMap = new Map<string, { budget: number, actual: number }>();
        
        filtered.forEach(v => {
          const key = `${v.region}|${v.station}`;
          const current = hierarchyMap.get(key) || { budget: 0, actual: 0 };
          hierarchyMap.set(key, {
            budget: current.budget + v.budgetUsd,
            actual: current.actual + v.actualUsd
          });
        });

        hierarchyMap.forEach((stats, key) => {
          const [region, station] = key.split('|');
          const variance = stats.actual - stats.budget;
          const runRate = stats.actual / monthsPassed;
          const forecast = runRate * 12;
          const risk = forecast - stats.budget;

          hierarchy.push({
            region,
            station,
            budget: stats.budget,
            actual: stats.actual,
            variance,
            variancePct: stats.budget !== 0 ? (variance / stats.budget) * 100 : null,
            forecast,
            risk
          });
        });

        hierarchy.sort((a, b) => (a.region || '').localeCompare(b.region || '') || (a.station || '').localeCompare(b.station || ''));

        return {
          totalBudget,
          totalActual,
          totalVariance,
          variancePct,
          runRate,
          forecastYearEnd,
          overspendRisk,
          budgetUsedPercent,
          charts: {
            region: Object.values(byRegion).sort((a, b) => b.actual - a.actual),
            station: Object.values(byStation).sort((a, b) => b.actual - a.actual).slice(0, 10),
            itCategory: Object.values(byItCategory).sort((a, b) => b.actual - a.actual).slice(0, 10),
            month: Object.values(byMonth).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
          },
          tables: {
            overBudget,
            underBudget,
            hierarchy
          }
        };
      } catch (e) {
        console.error("varianceAnalysis error:", e);
        return {
          totalBudget: 0,
          totalActual: 0,
          totalVariance: 0,
          variancePct: 0,
          runRate: 0,
          forecastYearEnd: 0,
          overspendRisk: 0,
          budgetUsedPercent: 0,
          charts: { region: [], station: [], itCategory: [], month: [] },
          tables: { overBudget: [], underBudget: [], hierarchy: [] }
        };
      }
    }, [filteredVarianceData, monthsPassed]);

    const mapRawToBudgetRecords = useCallback((rawData: any[], fileName: string): BudgetRecord[] => {
      return rawData.map((row) => {
        const budgetUsd = parseFloat(String(getValue(row, COLUMN_ALIASES.budgetUsd) || '0').replace(/[^0-9.-]/g, '')) || 0;
        const region = String(getValue(row, COLUMN_ALIASES.region)).trim();
        const station = String(getValue(row, COLUMN_ALIASES.station)).trim();
        const category = String(getValue(row, COLUMN_ALIASES.category)).trim();
        const itCategory = String(getValue(row, COLUMN_ALIASES.itCategory)).trim();
        const budgetCategory = String(getValue(row, COLUMN_ALIASES.budgetCategory)).trim();
        const budgetItem = String(getValue(row, COLUMN_ALIASES.budgetItem)).trim();
        const yearMonth = String(getValue(row, COLUMN_ALIASES.yearMonth)).trim();

        const id = `${region}|${station}|${category}|${itCategory}|${budgetCategory}|${budgetItem}|${yearMonth}`;

        return {
          id,
          year: parseInt(yearMonth.split('/')[0] || "2025", 10),
          region,
          station,
          category: category || 'Opex',
          itCategory,
          budgetCategory,
          budgetItem,
          yearMonth,
          budget: budgetUsd,
          item: budgetItem || 'Imported Record',
          type: (category || 'Opex').toUpperCase() as "CAPEX" | "OPEX",
          sourceFile: fileName,
          uploadedAt: new Date().toLocaleDateString()
        };
      }).filter(record => record.region && record.yearMonth && record.budget !== 0);
    }, []);

    const parseBudgetFile = useCallback(async (file: File): Promise<BudgetProcessingResult> => {
      const fileName = file.name;
      const lowerName = fileName.toLowerCase();
      
      if (lowerName.endsWith('.csv')) {
        return new Promise((resolve, reject) => {
          Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
              const masterDataset = mapRawToBudgetRecords(results.data, fileName);
              const totalBudget = masterDataset.reduce((sum, r) => sum + r.budget, 0);
              const budgetByRegion: Record<string, number> = {};
              const budgetByStation: Record<string, number> = {};
              const budgetByType: Record<string, number> = {};
              const categoryTotals: Record<string, number> = {};

              masterDataset.forEach(r => {
                budgetByRegion[r.region] = (budgetByRegion[r.region] || 0) + r.budget;
                budgetByStation[r.station as string] = (budgetByStation[r.station as string] || 0) + r.budget;
                budgetByType[r.type] = (budgetByType[r.type] || 0) + r.budget;
                categoryTotals[r.category] = (categoryTotals[r.category] || 0) + r.budget;
              });

              const topCategories = Object.entries(categoryTotals)
                .map(([category, amount]) => ({ category, amount }))
                .sort((a, b) => b.amount - a.amount)
                .slice(0, 5);

              resolve({
                masterDataset,
                validationIssues: [],
                summary: {
                  totalSheets: 1,
                  totalBudget,
                  budgetByRegion,
                  budgetByStation,
                  budgetByType,
                  topCategories
                }
              });
            },
            error: (err) => reject(err)
          });
        });
      } else if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || lowerName.endsWith('.xlsm')) {
        try {
          return await parseBudgetWorkbook(file);
        } catch (err) {
          console.error("Error parsing budget workbook:", err);
          throw err;
        }
      } else {
        throw new Error(`Unsupported file format: ${fileName}. Please use .csv, .xlsx, .xls, or .xlsm`);
      }
    }, [mapRawToBudgetRecords]);

    const handleBudgetUpload = useCallback(async (file: File) => {
      try {
        const result = await parseBudgetFile(file);

        if (!result.masterDataset || result.masterDataset.length === 0) {
          alert("No valid budget rows were found in the uploaded file.");
          return;
        }

        saveBudgetRows(result.masterDataset);
        setShowBudgetSuccess(result);
      } catch (error: any) {
        console.error("Budget upload error:", error);
        alert(`Failed to process budget file: ${error.message || "Unknown error"}. Please ensure it matches the required format.`);
      }
    }, [saveBudgetRows]);

    const downloadBudgetTemplate = () => {
      const REGIONS_CONFIG = {
        'Europe': ['PRG', 'ABY', 'BRX', 'TRF', 'LEX', 'LNN', 'LON', 'SKY', 'WLV', 'DBC', 'XMS', 'UDC'],
        'GCC': ['BAH', 'ADC', 'DXB', 'AIL', 'AIS', 'AUH', 'RUH', 'JED', 'DHA', 'DOH', 'KWI', 'MCT', 'ALM', 'TUU', 'DWC'],
        'India': ['India', 'CMB', 'DAC', 'PNQ'],
        'MENAT': ['ALR', 'AEL', 'CAI', 'CAS', 'CMN', 'KRT', 'TIP', 'TUN', 'BEY', 'IST', 'TBS', 'AMM', 'RMM', 'BGD', 'EBL'],
        'SSA': ['DAR', 'EBB', 'NBO', 'ACC', 'LOS', 'JNB'],
        'US': ['JFK', 'LAX', 'IAH', 'YYZ']
      };

      const TEMPLATE_ROWS = [
        { category: 'Hardware', item: 'Computer Room Requirements ( UPS, detector, Cabinet - Server Rack Cabinet)', type: 'CAPEX' },
        { category: 'Hardware', item: 'Networking (PAN 410,Switch and Aruba AP)', type: 'CAPEX' },
        { category: 'Hardware', item: 'Servers & SAN', type: 'CAPEX' },
        { category: 'Hardware', item: 'Workstations', type: 'CAPEX' },
        { category: 'Hardware', item: 'Notebooks', type: 'CAPEX' },
        { category: 'Hardware', item: 'PC Upgrades (Monitor, Memory, Hard disk)', type: 'CAPEX' },
        { category: 'Hardware', item: 'General Upgrade', type: 'CAPEX' },
        { category: 'Hardware', item: 'Printers & Scanners', type: 'CAPEX' },
        { category: 'Hardware', item: 'Scale', type: 'CAPEX' },
        { category: 'Hardware', item: 'Other Hardware Accessories', type: 'CAPEX' },
        { category: 'Hardware', item: 'Operational Scanners / Mobile', type: 'CAPEX' },
        { category: 'Hardware', item: 'POS Devices', type: 'CAPEX' },
        { category: 'Hardware', item: 'Telephony - Headset', type: 'CAPEX' },
        { category: 'Hardware', item: 'PDAs and Sales Handhelds', type: 'CAPEX' },
        { category: 'HW Refresh', item: 'Computer Replacement', type: 'CAPEX' },
        { category: 'HW Refresh', item: 'Networking replacement (PAN 410,Switch and Aruba AP)', type: 'CAPEX' },
        { category: 'HW Refresh', item: 'Server Replacement', type: 'CAPEX' },
        { category: 'HW Refresh', item: 'Handheld Replacement', type: 'CAPEX' },
        { category: 'Software', item: 'Customer Systems (PC, Printer or Software)', type: 'CAPEX' },
        { category: 'Software', item: 'Existing Software', type: 'CAPEX' },
        { category: 'Software', item: 'New IT projects', type: 'CAPEX' },
        { category: 'Software', item: 'Operational Systems (Licenses,Maintenance, Subscription )', type: 'CAPEX' },
        { category: 'Software', item: 'Inhouse Developed (Licenses, Tools, Adapters )', type: 'CAPEX' },
        { category: 'Connectivity', item: 'Interbranch Connection', type: 'OPEX' },
        { category: 'Connectivity', item: 'Internet Connection', type: 'OPEX' },
        { category: 'Connectivity', item: 'Telephony & Communication', type: 'OPEX' },
        { category: 'Connectivity', item: 'Notifications (SMS / Whatsapp...) - Only for Local Suppliers', type: 'OPEX' },
        { category: 'Connectivity', item: 'Cloud & Hosting', type: 'OPEX' },
        { category: 'Contracts', item: 'Maintenance HW', type: 'OPEX' },
        { category: 'Contracts', item: 'Maintenance Software', type: 'OPEX' },
        { category: 'Contracts', item: 'Computer Rental (If Applicable)', type: 'OPEX' },
        { category: 'Contracts', item: 'Printing Rental (If Applicable)', type: 'OPEX' },
        { category: 'Contracts', item: 'License Renewal ( Paloalto, Microsoft..)', type: 'OPEX' },
        { category: 'Contracts', item: 'Localized Enviroment Workload', type: 'OPEX' },
        { category: 'Contracts', item: 'Here Maps', type: 'OPEX' }
      ];

      const wb = XLSX.utils.book_new();

      Object.entries(REGIONS_CONFIG).forEach(([region, stations]) => {
        const sheetData = TEMPLATE_ROWS.map(row => {
          const rowData: any = {
            'Region': region,
            'Category': row.category,
            'Items': row.item,
            'Expenditure Category': row.type
          };
          stations.forEach(station => {
            rowData[station] = '';
          });
          return rowData;
        });

        const ws = XLSX.utils.json_to_sheet(sheetData);
        
        // Set column widths
        const wscols = [
          { wch: 10 }, // Region
          { wch: 15 }, // Category
          { wch: 60 }, // Items
          { wch: 20 }, // Expenditure Category
          ...stations.map(() => ({ wch: 10 })) // Stations
        ];
        ws['!cols'] = wscols;

        XLSX.utils.book_append_sheet(wb, ws, region);
      });

      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/octet-stream' });
      saveAs(blob, "IT_Budget_Template.xlsx");
    };

    const handleMerge = () => {
      setUploadedFileContents(prev => {
        const existingIndex = prev.findIndex(f => f.name === pendingFileName);
        if (existingIndex >= 0) {
          // Update existing file transactions
          const updated = [...prev];
          const existingFile = updated[existingIndex];
          
          // Merge transactions and deduplicate within the file context
          const combined = [...existingFile.transactions, ...pendingData];
          const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
          
          updated[existingIndex] = {
            ...existingFile,
            transactions: unique
          };
          return updated;
        }
        
        // Add as new file
        return [...prev, {
          name: pendingFileName,
          uploadDate: new Date().toLocaleDateString(),
          transactions: pendingData
        }];
      });

      setPendingData([]);
      setPendingFileName('');
      setShowUploadChoice(false);
    };

    const handleReplace = () => {
      setUploadedFileContents([{
        name: pendingFileName,
        uploadDate: new Date().toLocaleDateString(),
        transactions: pendingData
      }]);
      setPendingData([]);
      setPendingFileName('');
      setShowUploadChoice(false);
    };

    const handleFileUpload = useCallback(async (file: File) => {
      try {
        const transactions = await parseActualFile(file);

        if (transactions.length > 0) {
          setPendingData(transactions);
          setPendingFileName(file.name);
          setShowUploadChoice(true);
        } else {
          alert("No valid transactions found in the uploaded file.");
        }
      } catch (error: any) {
        console.error("Actual upload error:", error);
        alert(`Failed to process actual file: ${error.message || "Unknown error"}`);
      }
    }, []);

    const confirmDeleteFile = () => {
      if (!fileToDelete) return;
      setUploadedFileContents(prev => prev.filter(f => f.name !== fileToDelete));
      setFileToDelete(null);
      setLastAnalysisResult(null);
    };

    const analyzeFile = async (fileName: string) => {
      setActiveTab('analyst');
      const message = `Analyze the data specifically from the file: ${fileName}`;
      setChatMessages(prev => [...prev, { role: 'user', content: message }]);
      setIsAnalyzing(true);

      try {
        const fileTransactions =
          uploadedFileContents.find(f => f.name === fileName)?.transactions || [];

        const { narrative, result } = await analyzeExpenditure(message, fileTransactions, budgetData);
        
        if (result) {
          setLastAnalysisResult(result);
        }

        setChatMessages(prev => [
          ...prev,
          {
            role: 'ai',
            content: narrative || 'No analysis could be generated from this file.',
            analysisResult: result
          }
        ]);
      } catch (error) {
        console.error('analyzeFile error:', error);
        setChatMessages(prev => [
          ...prev,
          {
            role: 'ai',
            content: 'I could not analyze this file right now. Please try again.'
          }
        ]);
      } finally {
        setIsAnalyzing(false);
      }
    };

    const filteredData = useMemo(() => {
      if (actualData.length > 0) {
        console.log("Sample regions:", actualData.slice(0, 20).map(r => ({
          supplier: r.supplier,
          region: r.region,
          country: r.country,
          businessArea: r.businessArea
        })));
      }
      const searchTerm = filters.search.trim().toLowerCase();

      return actualData.filter(row => {
        const rowYear = String(row.year || row.fiscalYear || '');
        if (selectedYear !== 'All Years' && rowYear !== selectedYear) return false;

        const supplier = String(row.supplier || '').toLowerCase();
        const text = String(row.text || '').toLowerCase();
        const glName = String(row.glName || '').toLowerCase();
        const companyCode = String(row.companyCode || '').toLowerCase();
        const documentNumber = String(row.documentNumber || '').toLowerCase();
        const userName = String(row.userName || '').toLowerCase();

        return (
          (filters.fiscalYear.length === 0 || filters.fiscalYear.includes(String(row.fiscalYear || ''))) &&
          (filters.yearMonth.length === 0 || filters.yearMonth.includes(String(row.yearMonth || ''))) &&
          (filters.region.length === 0 || filters.region.includes(String(row.region || ''))) &&
          (filters.country.length === 0 || filters.country.includes(String(row.country || ''))) &&
          (filters.station.length === 0 || filters.station.includes(String(row.businessArea || ''))) &&
          (filters.supplier.length === 0 || filters.supplier.includes(String(row.supplier || ''))) &&
          (filters.category.length === 0 || filters.category.includes(String(row.category || ''))) &&
          (filters.itCategory.length === 0 || filters.itCategory.includes(String(row.itCategory || ''))) &&
          (filters.budgetCategory.length === 0 || filters.budgetCategory.includes(String(row.budgetCategory || ''))) &&
          (filters.budgetItem.length === 0 || filters.budgetItem.includes(String(row.budgetItem || ''))) &&
          (filters.budgetType.length === 0 || filters.budgetType.includes(String(row.expenditureType || ''))) &&
          (filters.costCenter.length === 0 || filters.costCenter.includes(String(row.costCenter || ''))) &&
          (filters.glAccount.length === 0 || filters.glAccount.includes(String(row.glAccount || ''))) &&
          (
            !searchTerm ||
            supplier.includes(searchTerm) ||
            text.includes(searchTerm) ||
            glName.includes(searchTerm) ||
            companyCode.includes(searchTerm) ||
            documentNumber.includes(searchTerm) ||
            userName.includes(searchTerm)
          )
        );
      });
    }, [actualData, filters, selectedYear]);

    const vendorGovernanceData = useMemo<VendorGovernanceRow[]>(() => {
      return filteredData
        .map((row) => ({
          supplier: String(row.supplier || '').trim(),
          service: classifyService(row),
          country: String(row.country || '').trim(),
          region: String(row.region || '').trim(),
          yearMonth: String(row.yearMonth || '').trim(),
          spend: Number(row.usd || 0),
          category: row.category,
          itCategory: row.itCategory
        }))
        .filter(
          (row) =>
            row.supplier &&
            row.service &&
            row.country &&
            row.region &&
            row.yearMonth &&
            Number.isFinite(row.spend) &&
            row.spend > 0
        );
    }, [filteredData]);

    const vendorDuplicationReport = useMemo(() => {
      const grouped = new Map<
        string,
        {
          country: string;
          service: string;
          suppliers: Set<string>;
          spend: number;
        }
      >();

      vendorGovernanceData.forEach((row) => {
        const key = `${row.country}|${row.service}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            country: row.country,
            service: row.service,
            suppliers: new Set(),
            spend: 0
          });
        }

        const current = grouped.get(key)!;
        current.suppliers.add(row.supplier);
        current.spend += row.spend;
      });

      return Array.from(grouped.values())
        .map((item) => ({
          country: item.country,
          service: item.service,
          suppliers: Array.from(item.suppliers),
          supplierCount: item.suppliers.size,
          spend: item.spend,
          status: item.suppliers.size > 1 ? 'Duplicate' : 'OK'
        }))
        .sort((a, b) => b.supplierCount - a.supplierCount || b.spend - a.spend);
    }, [vendorGovernanceData]);

    const strategicVendorFootprint = useMemo(() => {
      const grouped = new Map<
        string,
        {
          supplier: string;
          countries: Set<string>;
          services: Set<string>;
          spend: number;
        }
      >();

      vendorGovernanceData.forEach((row) => {
        if (!grouped.has(row.supplier)) {
          grouped.set(row.supplier, {
            supplier: row.supplier,
            countries: new Set(),
            services: new Set(),
            spend: 0
          });
        }

        const current = grouped.get(row.supplier)!;
        current.countries.add(row.country);
        current.services.add(row.service);
        current.spend += row.spend;
      });

      return Array.from(grouped.values())
        .map((item) => ({
          supplier: item.supplier,
          countries: Array.from(item.countries),
          services: Array.from(item.services),
          countryCount: item.countries.size,
          serviceCount: item.services.size,
          spend: item.spend
        }))
        .sort((a, b) => b.spend - a.spend);
    }, [vendorGovernanceData]);

    const vendorDependencyRisk = useMemo(() => {
      const totalSpend = vendorGovernanceData.reduce((sum, row) => sum + row.spend, 0);

      const grouped = new Map<
        string,
        {
          supplier: string;
          countries: Set<string>;
          services: Set<string>;
          spend: number;
        }
      >();

      vendorGovernanceData.forEach((row) => {
        if (!grouped.has(row.supplier)) {
          grouped.set(row.supplier, {
            supplier: row.supplier,
            countries: new Set(),
            services: new Set(),
            spend: 0
          });
        }

        const current = grouped.get(row.supplier)!;
        current.countries.add(row.country);
        current.services.add(row.service);
        current.spend += row.spend;
      });

      return Array.from(grouped.values())
        .map((item) => {
          const spendShare = totalSpend > 0 ? (item.spend / totalSpend) * 100 : 0;

          let riskLevel: 'Low' | 'Medium' | 'High' = 'Low';
          if (item.countries.size > 5 || item.services.size > 3 || spendShare > 30) {
            riskLevel = 'High';
          } else if (item.countries.size >= 3 || item.services.size >= 2 || spendShare > 15) {
            riskLevel = 'Medium';
          }

          return {
            supplier: item.supplier,
            countryCount: item.countries.size,
            serviceCount: item.services.size,
            spend: item.spend,
            spendShare,
            riskLevel
          };
        })
        .sort((a, b) => b.spend - a.spend);
    }, [vendorGovernanceData]);

    const vendorSpendConcentration = useMemo(() => {
      const totalSpend = vendorGovernanceData.reduce((sum, row) => sum + row.spend, 0);

      const grouped = new Map<
        string,
        {
          supplier: string;
          spend: number;
          countries: Set<string>;
          services: Set<string>;
        }
      >();

      vendorGovernanceData.forEach((row) => {
        if (!grouped.has(row.supplier)) {
          grouped.set(row.supplier, {
            supplier: row.supplier,
            spend: 0,
            countries: new Set(),
            services: new Set()
          });
        }

        const current = grouped.get(row.supplier)!;
        current.spend += row.spend;
        current.countries.add(row.country);
        current.services.add(row.service);
      });

      return Array.from(grouped.values())
        .map((item) => {
          const spendShare = totalSpend > 0 ? (item.spend / totalSpend) * 100 : 0;

          let concentrationLevel: 'Low' | 'Medium' | 'High' = 'Low';
          if (spendShare > 30) concentrationLevel = 'High';
          else if (spendShare >= 15) concentrationLevel = 'Medium';

          return {
            supplier: item.supplier,
            spend: item.spend,
            spendShare,
            countryCount: item.countries.size,
            serviceCount: item.services.size,
            concentrationLevel
          };
        })
        .sort((a, b) => b.spend - a.spend);
    }, [vendorGovernanceData]);

    const serviceVendorLandscape = useMemo(() => {
      const grouped = new Map<
        string,
        {
          service: string;
          supplier: string;
          countries: Set<string>;
          regions: Set<string>;
          spend: number;
        }
      >();

      vendorGovernanceData.forEach((row) => {
        const key = `${row.service}|${row.supplier}`;

        if (!grouped.has(key)) {
          grouped.set(key, {
            service: row.service,
            supplier: row.supplier,
            countries: new Set(),
            regions: new Set(),
            spend: 0
          });
        }

        const current = grouped.get(key)!;
        current.countries.add(row.country);
        current.regions.add(row.region);
        current.spend += row.spend;
      });

      return Array.from(grouped.values())
        .map((item) => ({
          service: item.service,
          supplier: item.supplier,
          countryCount: item.countries.size,
          regionCount: item.regions.size,
          spend: item.spend
        }))
        .sort((a, b) => a.service.localeCompare(b.service) || b.spend - a.spend);
    }, [vendorGovernanceData]);

    const vendorConsolidationOpportunities = useMemo(() => {
      const grouped = new Map<
        string,
        {
          service: string;
          countries: Set<string>;
          suppliers: Set<string>;
          spend: number;
        }
      >();

      vendorGovernanceData.forEach((row) => {
        if (!grouped.has(row.service)) {
          grouped.set(row.service, {
            service: row.service,
            countries: new Set(),
            suppliers: new Set(),
            spend: 0
          });
        }

        const current = grouped.get(row.service)!;
        current.countries.add(row.country);
        current.suppliers.add(row.supplier);
        current.spend += row.spend;
      });

      return Array.from(grouped.values())
        .map((item) => {
          const supplierCount = item.suppliers.size;

          let opportunity: 'Low' | 'Medium' | 'High' = 'Low';
          if (supplierCount >= 5) {
            opportunity = 'High';
          } else if (supplierCount >= 3) {
            opportunity = 'Medium';
          }

          return {
            service: item.service,
            countryCount: item.countries.size,
            supplierCount: item.suppliers.size,
            spend: item.spend,
            opportunity
          };
        })
        .sort((a, b) => b.supplierCount - a.supplierCount || b.spend - a.spend);
    }, [vendorGovernanceData]);

    const vendorRationalizationHeatmap = useMemo(() => {
      const grouped = new Map<
        string,
        {
          country: string;
          service: string;
          suppliers: Set<string>;
          spend: number;
        }
      >();

      vendorGovernanceData.forEach((row) => {
        const key = `${row.country}|${row.service}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            country: row.country,
            service: row.service,
            suppliers: new Set(),
            spend: 0
          });
        }

        const current = grouped.get(key)!;
        current.suppliers.add(row.supplier);
        current.spend += row.spend;
      });

      return Array.from(grouped.values())
        .map((item) => {
          const supplierCount = item.suppliers.size;

          let level: 'Low' | 'Medium' | 'High' = 'Low';
          if (supplierCount >= 3) level = 'High';
          else if (supplierCount === 2) level = 'Medium';

          return {
            country: item.country,
            service: item.service,
            supplierCount,
            spend: item.spend,
            level
          };
        })
        .sort((a, b) => {
          if (a.country !== b.country) return a.country.localeCompare(b.country);
          return a.service.localeCompare(b.service);
        });
    }, [vendorGovernanceData]);

    const vendorPortfolioStats = useMemo(() => {
      const totalSpend = vendorGovernanceData.reduce((sum, row) => sum + row.spend, 0);
      const totalVendors = new Set(vendorGovernanceData.map((row) => row.supplier)).size;
      const totalServices = new Set(vendorGovernanceData.map((row) => row.service)).size;
      const totalCountries = new Set(vendorGovernanceData.map((row) => row.country)).size;
      const duplicateVendorRisks = vendorDuplicationReport.filter((r) => r.supplierCount > 1).length;

      return {
        totalSpend,
        totalVendors,
        totalServices,
        totalCountries,
        duplicateVendorRisks
      };
    }, [vendorGovernanceData, vendorDuplicationReport]);

    const vendorGovernanceChartData = useMemo(() => {
      const byVendor = new Map<string, number>();
      const byService = new Map<string, { spend: number; suppliers: Set<string> }>();
      const byCountry = new Map<string, number>();

      vendorGovernanceData.forEach((row) => {
        byVendor.set(row.supplier, (byVendor.get(row.supplier) || 0) + row.spend);

        if (!byService.has(row.service)) {
          byService.set(row.service, { spend: 0, suppliers: new Set() });
        }
        const currentService = byService.get(row.service)!;
        currentService.spend += row.spend;
        currentService.suppliers.add(row.supplier);

        byCountry.set(row.country, (byCountry.get(row.country) || 0) + row.spend);
      });

      const topVendors = Array.from(byVendor.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);

      const serviceFragmentation = Array.from(byService.entries())
        .map(([name, value]) => ({
          name,
          spend: value.spend,
          suppliers: value.suppliers.size
        }))
        .sort((a, b) => b.suppliers - a.suppliers || b.spend - a.spend)
        .slice(0, 10);

      const topCountries = Array.from(byCountry.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);

      return {
        topVendors,
        serviceFragmentation,
        topCountries
      };
    }, [vendorGovernanceData]);

    const supplierGlobalProfile = useMemo(() => {
      const totalSpend = vendorGovernanceData.reduce((sum, row) => sum + row.spend, 0);

      const grouped = new Map<
        string,
        {
          supplier: string;
          spend: number;
          countries: Set<string>;
          services: Set<string>;
          regions: Set<string>;
        }
      >();

      vendorGovernanceData.forEach((row) => {
        if (!grouped.has(row.supplier)) {
          grouped.set(row.supplier, {
            supplier: row.supplier,
            spend: 0,
            countries: new Set(),
            services: new Set(),
            regions: new Set()
          });
        }

        const current = grouped.get(row.supplier)!;
        current.spend += row.spend;
        current.countries.add(row.country);
        current.services.add(row.service);
        current.regions.add(row.region);
      });

      return Array.from(grouped.values()).map((item) => {
        const spendShare = totalSpend > 0 ? (item.spend / totalSpend) * 100 : 0;

        return {
          supplier: item.supplier,
          spend: item.spend,
          spendShare,
          countryCount: item.countries.size,
          serviceCount: item.services.size,
          regionCount: item.regions.size
        };
      });
    }, [vendorGovernanceData]);

    const preferredVendorRecommendations = useMemo(() => {
      const supplierProfileMap = new Map(
        supplierGlobalProfile.map((item) => [item.supplier, item])
      );

      const grouped = new Map<
        string,
        {
          country: string;
          service: string;
          suppliers: Map<string, number>;
          totalSpend: number;
        }
      >();

      vendorGovernanceData.forEach((row) => {
        const key = `${row.country}|${row.service}`;

        if (!grouped.has(key)) {
          grouped.set(key, {
            country: row.country,
            service: row.service,
            suppliers: new Map(),
            totalSpend: 0
          });
        }

        const current = grouped.get(key)!;
        current.suppliers.set(row.supplier, (current.suppliers.get(row.supplier) || 0) + row.spend);
        current.totalSpend += row.spend;
      });

      return Array.from(grouped.values())
        .map((group) => {
          const supplierRows = Array.from(group.suppliers.entries()).map(([supplier, localSpend]) => {
            const profile = supplierProfileMap.get(supplier);

            const localShare = group.totalSpend > 0 ? (localSpend / group.totalSpend) * 100 : 0;

            // scoring model
            const score =
              (localShare * 0.45) +
              ((profile?.countryCount || 0) * 5) +
              ((profile?.serviceCount || 0) * 4) +
              ((profile?.regionCount || 0) * 3) +
              ((profile?.spendShare || 0) * 0.4);

            return {
              supplier,
              localSpend,
              localShare,
              globalCountryCount: profile?.countryCount || 0,
              globalServiceCount: profile?.serviceCount || 0,
              globalRegionCount: profile?.regionCount || 0,
              globalSpendShare: profile?.spendShare || 0,
              score
            };
          });

          const ranked = supplierRows.sort((a, b) => b.score - a.score);
          const preferred = ranked[0];
          const others = ranked.slice(1);

          let action: 'Keep As-Is' | 'Standardize to Preferred Supplier' | 'Review Manually' = 'Keep As-Is';
          if (ranked.length > 1 && preferred) {
            if ((preferred.localShare >= 50) || (preferred.globalCountryCount >= 3)) {
              action = 'Standardize to Preferred Supplier';
            } else {
              action = 'Review Manually';
            }
          }

          const savingsOpportunity = others.reduce((sum, item) => sum + item.localSpend, 0);

          return {
            country: group.country,
            service: group.service,
            supplierCount: ranked.length,
            totalSpend: group.totalSpend,
            preferredSupplier: preferred?.supplier || '',
            preferredScore: preferred?.score || 0,
            preferredLocalShare: preferred?.localShare || 0,
            action,
            savingsOpportunity,
            rankedSuppliers: ranked
          };
        })
        .sort((a, b) => {
          if (a.supplierCount !== b.supplierCount) return b.supplierCount - a.supplierCount;
          return b.savingsOpportunity - a.savingsOpportunity;
        });
    }, [vendorGovernanceData, supplierGlobalProfile]);

    const negotiationOpportunityReport = useMemo(() => {
      return supplierGlobalProfile
        .map((row) => {
          const score =
            (row.spendShare * 0.5) +
            (row.countryCount * 6) +
            (row.serviceCount * 5) +
            (row.regionCount * 4);

          let opportunityLevel: 'Low' | 'Medium' | 'High' = 'Low';
          if (score >= 60) opportunityLevel = 'High';
          else if (score >= 30) opportunityLevel = 'Medium';

          return {
            supplier: row.supplier,
            spend: row.spend,
            spendShare: row.spendShare,
            countryCount: row.countryCount,
            serviceCount: row.serviceCount,
            regionCount: row.regionCount,
            negotiationScore: score,
            opportunityLevel
          };
        })
        .sort((a, b) => b.negotiationScore - a.negotiationScore);
    }, [supplierGlobalProfile]);

    const actionPriorityReport = useMemo(() => {
      return preferredVendorRecommendations
        .map((row) => {
          const duplicationWeight = row.supplierCount * 15;
          const spendWeight = row.totalSpend / 1000;
          const savingsWeight = row.savingsOpportunity / 1000;

          const priorityScore = duplicationWeight + spendWeight + savingsWeight;

          let priority: 'Low' | 'Medium' | 'High' = 'Low';
          if (priorityScore >= 120) priority = 'High';
          else if (priorityScore >= 60) priority = 'Medium';

          return {
            country: row.country,
            service: row.service,
            supplierCount: row.supplierCount,
            preferredSupplier: row.preferredSupplier,
            totalSpend: row.totalSpend,
            savingsOpportunity: row.savingsOpportunity,
            action: row.action,
            priorityScore,
            priority
          };
        })
        .sort((a, b) => b.priorityScore - a.priorityScore);
    }, [preferredVendorRecommendations]);

    const preferredVendorStats = useMemo(() => {
      const standardizationCandidates = preferredVendorRecommendations.filter(
        (r) => r.action === 'Standardize to Preferred Supplier'
      ).length;

      const manualReviewItems = preferredVendorRecommendations.filter(
        (r) => r.action === 'Review Manually'
      ).length;

      const totalSavingsOpportunity = preferredVendorRecommendations.reduce(
        (sum, r) => sum + r.savingsOpportunity,
        0
      );

      const highNegotiationTargets = negotiationOpportunityReport.filter(
        (r) => r.opportunityLevel === 'High'
      ).length;

      return {
        standardizationCandidates,
        manualReviewItems,
        totalSavingsOpportunity,
        highNegotiationTargets
      };
    }, [preferredVendorRecommendations, negotiationOpportunityReport]);

    const autoInsights = useMemo(() => {
      return generateInsights(filteredData, filteredBudgetData, filteredVarianceData);
    }, [filteredData, filteredBudgetData, filteredVarianceData]);

    const allMonths = useMemo(() => {
      return Array.from(new Set(filteredData.map(r => r.yearMonth)))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    }, [filteredData]);

    const pivotData = useMemo<PivotRow[]>(() => {
      const grouped = new Map<string, PivotRow>();

      filteredData.forEach((row) => {
        const key = [
          row.region,
          row.country,
          row.supplier,
          row.category,
          row.itCategory
        ].join('||');

        if (!grouped.has(key)) {
          grouped.set(key, {
            region: row.region,
            country: row.country,
            supplier: row.supplier,
            category: row.category,
            itCategory: row.itCategory,
            grandTotal: 0,
            months: {}
          });
        }

        const current = grouped.get(key)!;
        current.months[row.yearMonth] = (current.months[row.yearMonth] || 0) + row.usd;
        current.grandTotal += row.usd;
      });

      return Array.from(grouped.values()).sort((a, b) => {
        return (a.region || '').localeCompare(b.region || '');
      });
    }, [filteredData]);

    const pivotWithMoM = useMemo<PivotRowWithMoM[]>(() => {
      return pivotData.map((row) => {
        const mom: Record<string, number | null> = {};

        allMonths.forEach((month, index) => {
          if (index === 0) {
            mom[month] = null;
            return;
          }

          const prevMonth = allMonths[index - 1];
          const currentYear = month.split('/')[0];
          const previousYear = prevMonth.split('/')[0];

          // Do not compare across year boundary by default
          if (currentYear !== previousYear) {
            mom[month] = null;
            return;
          }

          const prev = row.months[prevMonth] || 0;
          const curr = row.months[month] || 0;

          if (prev > 0) {
            mom[month] = ((curr - prev) / prev) * 100;
          } else {
            mom[month] = null;
          }
        });

        return {
          ...row,
          mom
        };
      });
    }, [pivotData, allMonths]);

    const stats = useMemo(() => {
      const totalSpend = filteredData.reduce((sum, r) => sum + r.usd, 0);
      const transactionCount = filteredData.length;
      const supplierCount = new Set(filteredData.map(r => r.supplier)).size;
      const avgTransaction = transactionCount > 0 ? totalSpend / transactionCount : 0;
      return { totalSpend, transactionCount, supplierCount, avgTransaction };
    }, [filteredData]);

    const insights = useMemo(() => {
      const alerts: { type: 'warning' | 'info'; message: string }[] = [];
      
      // MoM Increase detection
      const monthlySpend: Record<string, number> = {};
      filteredData.forEach(t => {
        monthlySpend[t.yearMonth] = (monthlySpend[t.yearMonth] || 0) + t.usd;
      });
      const months = Object.keys(monthlySpend).sort();
      for (let i = 1; i < months.length; i++) {
        const prev = monthlySpend[months[i-1]];
        const curr = monthlySpend[months[i]];
        if (prev > 0 && (curr - prev) / prev > momThreshold / 100) {
          alerts.push({ 
            type: 'warning', 
            message: `Significant MoM spend increase detected in ${months[i]} (+${(((curr-prev)/prev)*100).toFixed(1)}%)` 
          });
        }
      }

      // Supplier concentration
      const supplierSpend: Record<string, number> = {};
      filteredData.forEach(t => {
        supplierSpend[t.supplier] = (supplierSpend[t.supplier] || 0) + t.usd;
      });
      const topSupplier = Object.entries(supplierSpend).sort((a,b) => b[1]-a[1])[0];
      if (topSupplier && topSupplier[1] > stats.totalSpend * 0.4) {
        alerts.push({ 
          type: 'info', 
          message: `High concentration: ${topSupplier[0]} accounts for ${((topSupplier[1]/stats.totalSpend)*100).toFixed(1)}% of filtered spend.` 
        });
      }

      return alerts;
    }, [filteredData, stats.totalSpend, momThreshold]);

    const chartData = useMemo(() => {
      // Monthly Trend
      const monthly = filteredData.reduce((acc, t) => {
        acc[t.yearMonth] = (acc[t.yearMonth] || 0) + t.usd;
        return acc;
      }, {} as Record<string, number>);
      const trend = Object.entries(monthly).sort((a,b) => (a[0] || '').localeCompare(b[0] || '')).map(([name, value]) => ({ name, value }));

      // Region Breakdown
      const regional = Object.entries(filteredData.reduce((acc, t) => {
        acc[t.region] = (acc[t.region] || 0) + t.usd;
        return acc;
      }, {} as Record<string, number>)).map(([name, value]) => ({ name, value }));

      // Top 10 Suppliers
      const suppliers = Object.entries(filteredData.reduce((acc, t) => {
        acc[t.supplier] = (acc[t.supplier] || 0) + t.usd;
        return acc;
      }, {} as Record<string, number>))
        .sort((a,b) => (b[1] as number) - (a[1] as number))
        .slice(0, 10)
        .map(([name, value]) => ({ name, value }));

      // IT Category
      const itCats = Object.entries(filteredData.reduce((acc, t) => {
        acc[t.itCategory] = (acc[t.itCategory] || 0) + t.usd;
        return acc;
      }, {} as Record<string, number>)).map(([name, value]) => ({ name, value }));

      // Capex vs Opex
      const types = Object.entries(filteredData.reduce((acc, t) => {
        acc[t.category] = (acc[t.category] || 0) + t.usd;
        return acc;
      }, {} as Record<string, number>)).map(([name, value]) => ({ name, value }));

      // MoM Analysis
      const momAnalysis = trend.map((curr, i) => {
        const prev = trend[i - 1];
        const change = prev ? (((curr.value as number) - (prev.value as number)) / (prev.value as number)) * 100 : 0;
        return {
          month: curr.name,
          spend: curr.value,
          change,
          status: change > momThreshold ? 'red' : change > 25 ? 'amber' : 'normal'
        };
      });

      return { trend, regional, suppliers, itCats, types, momAnalysis };
    }, [filteredData, momThreshold]);

    const exportMoMAnalysis = useCallback(async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('MoM Analysis');

      // Define columns
      worksheet.columns = [
        { header: 'Month', key: 'month', width: 15 },
        { header: 'Total Spend ($)', key: 'spend', width: 20 },
        { header: 'MoM Change (%)', key: 'change', width: 20 },
        { header: 'Status', key: 'status', width: 20 }
      ];

      // Style header
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' } // slate-200
      };

      // Add data
      chartData.momAnalysis.slice(-12).forEach(row => {
        const statusText = row.status === 'red' ? 'CRITICAL SPIKE' : row.status === 'amber' ? 'HIGH VARIANCE' : 'STABLE';
        const excelRow = worksheet.addRow({
          month: row.month,
          spend: row.spend,
          change: row.change,
          status: statusText
        });

        // Apply conditional formatting
        const changeColIndex = worksheet.columns.findIndex(col => col.key === 'change') + 1;
        if (changeColIndex > 0) {
          const changeCell = excelRow.getCell(changeColIndex);
          if (row.status === 'red') {
            changeCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFEE2E2' } // red-100
            };
            changeCell.font = { color: { argb: 'FFB91C1C' }, bold: true }; // red-700
          } else if (row.status === 'amber') {
            changeCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFEF3C7' } // amber-100
            };
            changeCell.font = { color: { argb: 'FFB45309' }, bold: true }; // amber-700
          }
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(new Blob([buffer]), "MoM_Analysis_Refinement.xlsx");
    }, [chartData.momAnalysis]);

    const exportPivotDashboard = useCallback(async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Pivot MoM');

      // Define columns
      const columns = [
        { header: 'Region', key: 'region', width: 15 },
        { header: 'Country', key: 'country', width: 15 },
        { header: 'Supplier', key: 'supplier', width: 30 },
        { header: 'Category', key: 'category', width: 15 },
        { header: 'IT Category', key: 'itCategory', width: 15 },
      ];

      allMonths.forEach(month => {
        columns.push({ header: `${month} Spend ($)`, key: `${month}_spend`, width: 18 });
        columns.push({ header: `${month} MoM (%)`, key: `${month}_mom`, width: 15 });
      });

      columns.push({ header: 'Grand Total ($)', key: 'grandTotal', width: 20 });
      worksheet.columns = columns;

      // Style header
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' } // slate-200
      };

      // Add data
      pivotWithMoM.forEach(row => {
        const rowData: any = {
          region: row.region,
          country: row.country,
          supplier: row.supplier,
          category: row.category,
          itCategory: row.itCategory,
          grandTotal: row.grandTotal
        };

        allMonths.forEach(month => {
          rowData[`${month}_spend`] = row.months[month] || 0;
          rowData[`${month}_mom`] = row.mom[month] !== null ? row.mom[month] : '-';
        });

        const excelRow = worksheet.addRow(rowData);

        // Apply conditional formatting for each month
        allMonths.forEach(month => {
          const momValue = row.mom[month];
          if (momValue !== null && momValue > momThreshold) {
            const columnIndex = worksheet.columns.findIndex(col => col.key === `${month}_mom`) + 1;
            if (columnIndex > 0) {
              const cell = excelRow.getCell(columnIndex);
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFEE2E2' } // red-100
              };
              cell.font = { color: { argb: 'FFB91C1C' }, bold: true }; // red-700
            }
          }
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(new Blob([buffer]), "Pivot_MoM_Dashboard.xlsx");
    }, [pivotWithMoM, allMonths, momThreshold]);

    const exportVendorDuplicationReport = useCallback(async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Vendor Duplication');

      worksheet.columns = [
        { header: 'Country', key: 'country', width: 18 },
        { header: 'Service', key: 'service', width: 28 },
        { header: 'Suppliers', key: 'suppliers', width: 50 },
        { header: 'Supplier Count', key: 'supplierCount', width: 16 },
        { header: 'Spend', key: 'spend', width: 18 },
        { header: 'Status', key: 'status', width: 14 }
      ];

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' }
      };

      vendorDuplicationReport.forEach((row) => {
        const excelRow = worksheet.addRow({
          country: row.country,
          service: row.service,
          suppliers: row.suppliers.join(', '),
          supplierCount: row.supplierCount,
          spend: row.spend,
          status: row.status
        });

        if (row.status === 'Duplicate') {
          excelRow.getCell('F').fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFEE2E2' }
          };
          excelRow.getCell('F').font = { color: { argb: 'FFB91C1C' }, bold: true };
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(new Blob([buffer]), 'Vendor_Duplication_Report.xlsx');
    }, [vendorDuplicationReport]);

    const exportVendorDependencyRiskReport = useCallback(async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Dependency Risk');

      worksheet.columns = [
        { header: 'Supplier', key: 'supplier', width: 30 },
        { header: 'Country Count', key: 'countryCount', width: 16 },
        { header: 'Service Count', key: 'serviceCount', width: 16 },
        { header: 'Spend', key: 'spend', width: 18 },
        { header: 'Spend Share %', key: 'spendShare', width: 16 },
        { header: 'Risk Level', key: 'riskLevel', width: 14 }
      ];

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' }
      };

      vendorDependencyRisk.forEach((row) => {
        const excelRow = worksheet.addRow({
          supplier: row.supplier,
          countryCount: row.countryCount,
          serviceCount: row.serviceCount,
          spend: row.spend,
          spendShare: Number(row.spendShare.toFixed(1)),
          riskLevel: row.riskLevel
        });

        if (row.riskLevel === 'High') {
          excelRow.getCell('F').fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFEE2E2' }
          };
          excelRow.getCell('F').font = { color: { argb: 'FFB91C1C' }, bold: true };
        } else if (row.riskLevel === 'Medium') {
          excelRow.getCell('F').fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFEF3C7' }
          };
          excelRow.getCell('F').font = { color: { argb: 'FFB45309' }, bold: true };
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(new Blob([buffer]), 'Vendor_Dependency_Risk_Report.xlsx');
    }, [vendorDependencyRisk]);

    const exportServiceVendorLandscape = useCallback(async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Service Vendor Landscape');

      worksheet.columns = [
        { header: 'Service', key: 'service', width: 28 },
        { header: 'Supplier', key: 'supplier', width: 30 },
        { header: 'Country Count', key: 'countryCount', width: 16 },
        { header: 'Region Count', key: 'regionCount', width: 16 },
        { header: 'Spend', key: 'spend', width: 18 }
      ];

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' }
      };

      serviceVendorLandscape.forEach((row) => {
        worksheet.addRow({
          service: row.service,
          supplier: row.supplier,
          countryCount: row.countryCount,
          regionCount: row.regionCount,
          spend: row.spend
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(new Blob([buffer]), 'Service_Vendor_Landscape.xlsx');
    }, [serviceVendorLandscape]);

    const exportPreferredVendorRecommendations = useCallback(async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Preferred Vendor Strategy');

      worksheet.columns = [
        { header: 'Country', key: 'country', width: 18 },
        { header: 'Service', key: 'service', width: 28 },
        { header: 'Supplier Count', key: 'supplierCount', width: 16 },
        { header: 'Preferred Supplier', key: 'preferredSupplier', width: 30 },
        { header: 'Preferred Local Share %', key: 'preferredLocalShare', width: 20 },
        { header: 'Total Spend', key: 'totalSpend', width: 18 },
        { header: 'Savings Opportunity', key: 'savingsOpportunity', width: 20 },
        { header: 'Recommended Action', key: 'action', width: 28 }
      ];

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' }
      };

      preferredVendorRecommendations.forEach((row) => {
        const excelRow = worksheet.addRow({
          country: row.country,
          service: row.service,
          supplierCount: row.supplierCount,
          preferredSupplier: row.preferredSupplier,
          preferredLocalShare: Number(row.preferredLocalShare.toFixed(1)),
          totalSpend: row.totalSpend,
          savingsOpportunity: row.savingsOpportunity,
          action: row.action
        });

        if (row.action === 'Standardize to Preferred Supplier') {
          excelRow.getCell('H').fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFEE2E2' }
          };
          excelRow.getCell('H').font = { color: { argb: 'FFB91C1C' }, bold: true };
        } else if (row.action === 'Review Manually') {
          excelRow.getCell('H').fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFEF3C7' }
          };
          excelRow.getCell('H').font = { color: { argb: 'FFB45309' }, bold: true };
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(new Blob([buffer]), 'Preferred_Vendor_Strategy.xlsx');
    }, [preferredVendorRecommendations]);

    const exportNegotiationOpportunityReport = useCallback(async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Negotiation Opportunities');

      worksheet.columns = [
        { header: 'Supplier', key: 'supplier', width: 30 },
        { header: 'Spend', key: 'spend', width: 18 },
        { header: 'Spend Share %', key: 'spendShare', width: 16 },
        { header: 'Countries', key: 'countryCount', width: 14 },
        { header: 'Services', key: 'serviceCount', width: 14 },
        { header: 'Regions', key: 'regionCount', width: 14 },
        { header: 'Negotiation Score', key: 'negotiationScore', width: 18 },
        { header: 'Opportunity Level', key: 'opportunityLevel', width: 18 }
      ];

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' }
      };

      negotiationOpportunityReport.forEach((row) => {
        worksheet.addRow({
          supplier: row.supplier,
          spend: row.spend,
          spendShare: Number(row.spendShare.toFixed(1)),
          countryCount: row.countryCount,
          serviceCount: row.serviceCount,
          regionCount: row.regionCount,
          negotiationScore: Number(row.negotiationScore.toFixed(1)),
          opportunityLevel: row.opportunityLevel
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(new Blob([buffer]), 'Negotiation_Opportunity_Report.xlsx');
    }, [negotiationOpportunityReport]);

    const uniqueValues = useMemo(() => {
      const validActual = actualData.filter(Boolean);
      const validBudget = budgetData.filter(Boolean);

      const combine = (actualVals: string[], budgetVals: string[]) =>
        Array.from(new Set([...actualVals, ...budgetVals])).filter(v => v && v !== 'undefined').sort();

      return {
        years: Array.from(
          new Set([
            ...validActual.map(r => String(r.year || r.fiscalYear || '')),
            ...validBudget.map(r => String(r.year || ''))
          ])
        ).filter(v => v && v !== 'undefined').sort(),
        months: combine(
          validActual.map(r => String(r.yearMonth || '')),
          validBudget.map(r => String(r.yearMonth || ''))
        ),
        regions: combine(
          validActual.map(r => String(r.region || '')),
          validBudget.map(r => String(r.region || ''))
        ),
        countries: combine(
          validActual.map(r => String(r.country || '')),
          validBudget.map(r => String(r.station || ''))
        ),
        stations: combine(
          validActual.map(r => String(r.businessArea || '')),
          validBudget.map(r => String(r.station || ''))
        ),
        suppliers: Array.from(new Set(validActual.map(r => String(r.supplier || '')))).filter(v => v && v !== 'undefined').sort(),
        categories: combine(
          validActual.map(r => String(r.category || '')),
          validBudget.map(r => String(r.category || ''))
        ),
        itCategories: combine(
          validActual.map(r => String(r.itCategory || '')),
          validBudget.map(r => String(r.itCategory || ''))
        ),
        budgetCategories: combine(
          validActual.map(r => String(r.budgetCategory || '')),
          validBudget.map(r => String(r.budgetCategory || ''))
        ),
        budgetItems: combine(
          validActual.map(r => String(r.budgetItem || '')),
          validBudget.map(r => String(r.budgetItem || ''))
        ),
        budgetTypes: Array.from(new Set(validBudget.map(r => String(r.type || '')))).filter(v => v && v !== 'undefined').sort(),
        costCenters: Array.from(new Set(validActual.map(r => String(r.costCenter || '')))).filter(v => v && v !== 'undefined').sort(),
        glAccounts: Array.from(new Set(validActual.map(r => String(r.glAccount || '')))).filter(v => v && v !== 'undefined').sort()
      };
    }, [actualData, budgetData]);

    const handleChatSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!userInput.trim() || isAnalyzing) return;

      const message = userInput.trim();
      setUserInput('');
      setChatMessages(prev => [...prev, { role: 'user', content: message }]);
      setIsAnalyzing(true);

      try {
        const { narrative, result } = await analyzeExpenditure(message, filteredData, filteredBudgetData);
        
        if (result) {
          setLastAnalysisResult(result);
        }

        setChatMessages(prev => [
          ...prev,
          {
            role: 'ai',
            content: narrative || 'No answer could be generated from the current data.',
            analysisResult: result
          }
        ]);
      } catch (error) {
        console.error('handleChatSubmit error:', error);
        setChatMessages(prev => [
          ...prev,
          {
            role: 'ai',
            content: 'I could not complete the analysis right now. Please try again.'
          }
        ]);
      } finally {
        setIsAnalyzing(false);
      }
    };

    const loadSampleData = () => {
      setShowUsdWarning(false);
      const sample: FinancialTransaction[] = [
        {
          id: 'sample-1',
          year: 2025,
          companyCode: '1000',
          businessArea: 'PNQ',
          it: 'Infrastructure',
          country: 'India',
          region: 'Asia',
          vp: 'John Doe',
          documentType: 'SA',
          documentNumber: '1900001',
          postingDate: '2025-03-01',
          documentDate: '2025-03-01',
          fiscalYear: '2025',
          text: 'Monthly Cloud Hosting',
          reference: 'REF-001',
          assignment: 'ASG-001',
          amountLocal: 83000,
          amountDoc: 1000,
          localCurrency: 'INR',
          usd: 1000,
          userName: 'ANALYST1',
          glAccount: '610000',
          glName: 'Cloud Services',
          costCenter: 'CC-IND-01',
          yearMonth: '2025/03',
          supplier: 'Amazon Web Services',
          category: 'Opex',
          itCategory: 'Cloud Infrastructure',
          sourceFile: 'Sample_Data.csv'
        },
        {
          id: 'sample-2',
          year: 2025,
          companyCode: '1000',
          businessArea: 'JFK',
          it: 'Infrastructure',
          country: 'USA',
          region: 'US',
          vp: 'Jane Smith',
          documentType: 'SA',
          documentNumber: '1900002',
          postingDate: '2025-03-15',
          documentDate: '2025-03-15',
          fiscalYear: '2025',
          text: 'Network Equipment Upgrade',
          reference: 'REF-002',
          assignment: 'ASG-002',
          amountLocal: 5000,
          amountDoc: 5000,
          localCurrency: 'USD',
          usd: 5000,
          userName: 'ANALYST2',
          glAccount: '120000',
          glName: 'Hardware Assets',
          costCenter: 'CC-USA-01',
          yearMonth: '2025/03',
          supplier: 'Cisco Systems',
          category: 'Capex',
          itCategory: 'Connectivity',
          sourceFile: 'Sample_Data.csv'
        }
      ];
      setUploadedFileContents([{
        name: 'Sample_Data.csv',
        uploadDate: new Date().toLocaleDateString(),
        transactions: sample
      }]);
    };

    if (actualData.length === 0 && budgetData.length === 0) {
      return (
        <div className="min-h-screen bg-[#020617] text-white flex items-center justify-center p-6 font-sans overflow-hidden relative">
          {/* Background decorative elements */}
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-rose-500/10 blur-[120px] rounded-full" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-rose-500/5 blur-[120px] rounded-full" />
          
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-4xl w-full text-center space-y-16 relative z-10"
          >
            {showUsdWarning && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-2xl flex items-center gap-4 text-amber-200 text-left mb-8"
              >
                <div className="bg-amber-500/20 p-2 rounded-xl text-amber-400">
                  <AlertTriangle size={24} />
                </div>
                <div className="flex-1">
                  <p className="font-bold text-amber-100">USD column not detected</p>
                  <p className="text-sm text-amber-200/70">Please upload file with USD converted values to ensure correct calculations.</p>
                </div>
                <button 
                  onClick={() => setShowUsdWarning(false)}
                  className="p-2 hover:bg-amber-500/20 rounded-lg transition-colors text-amber-400"
                >
                  <X size={18} />
                </button>
              </motion.div>
            )}
            <div className="space-y-8">
              <div className="inline-flex p-5 rounded-[2rem] bg-rose-500/10 border border-rose-500/20 text-rose-500 shadow-2xl shadow-rose-500/20">
                <BrainCircuit size={56} />
              </div>
              <div className="space-y-4">
                <h1 className="text-7xl font-black tracking-tighter bg-gradient-to-b from-white to-slate-500 bg-clip-text text-transparent">
                  Aramex Region IT Expenditure <span className="text-rose-500">Analysis</span>
                </h1>
                <p className="text-slate-400 text-xl max-w-2xl mx-auto leading-relaxed font-medium">
                  Upload your SAP expenditure reports and budget files to unlock deep financial insights and automated variance analysis.
                </p>
              </div>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files[0]; if (file) handleFileUpload(file); }}
              className={cn(
                "relative group cursor-pointer border-2 border-dashed rounded-[3rem] p-20 transition-all duration-700",
                isDragging 
                  ? "border-rose-500 bg-rose-500/10 scale-[1.02] shadow-2xl shadow-rose-500/20" 
                  : "border-slate-800 bg-slate-900/50 hover:border-rose-500/50 hover:bg-slate-900"
              )}
              onClick={() => document.getElementById('fileInput')?.click()}
            >
              <input id="fileInput" type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])} />
              <div className="flex flex-col items-center space-y-8">
                <div className={cn(
                  "p-8 rounded-full transition-all duration-700 shadow-xl",
                  isDragging ? "bg-rose-500 text-white rotate-12 scale-110" : "bg-slate-800 text-slate-500 group-hover:bg-rose-500/20 group-hover:text-rose-500"
                )}>
                  <Upload size={64} />
                </div>
                <div className="space-y-3">
                  <p className="text-3xl font-bold text-white tracking-tight">Drop your financial data here</p>
                  <p className="text-slate-500 font-medium">Supports .csv, .xlsx, .xls (SAP/ERP Exports)</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center gap-8">
              <button 
                onClick={loadSampleData}
                className="px-8 py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-rose-400 font-bold transition-all flex items-center gap-3 group"
              >
                <Database size={20} className="group-hover:rotate-12 transition-transform" /> 
                Load sample transaction data to explore
              </button>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left w-full">
                {[
                  { icon: Activity, label: 'Trend Analysis', desc: 'Automatic MoM & variance detection' },
                  { icon: Layers, label: 'Cost Buckets', desc: 'Capex vs Opex & IT Category splits' },
                  { icon: MessageSquare, label: 'AI Q&A', desc: 'Ask natural language questions about spend' }
                ].map((item, i) => (
                  <div key={i} className="p-8 rounded-[2rem] bg-white/[0.02] border border-white/[0.05] hover:border-rose-500/30 hover:bg-white/[0.04] transition-all space-y-4 group">
                    <div className="p-3 rounded-xl bg-rose-500/10 text-rose-500 w-fit group-hover:scale-110 transition-transform">
                      <item.icon size={24} />
                    </div>
                    <div className="space-y-2">
                      <p className="font-bold text-white text-lg">{item.label}</p>
                      <p className="text-slate-500 text-sm leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-[#fcfdfd] font-sans text-slate-900 flex flex-col">
        {/* Sidebar / Navigation */}
        <nav className="bg-white border-b border-rose-100 px-8 py-4 sticky top-0 z-50">
          <div className="max-w-[1800px] mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-2.5 rounded-2xl bg-rose-600 text-white shadow-lg shadow-rose-200">
                <BrainCircuit size={24} />
              </div>
              <div>
                <h1 className="text-xl font-black tracking-tight text-slate-900">Aramex Region IT Expenditure <span className="text-rose-600">Analysis</span></h1>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Master Dataset: {actualData.length.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} Records</p>
              </div>
            </div>

            <div className="flex items-center gap-2 bg-rose-50/50 p-1.5 rounded-2xl border border-rose-100">
              {[
                { id: 'dashboard', icon: BarChart3, label: 'Dashboard' },
                { id: 'transactions', icon: TableIcon, label: 'Transactions' },
                { id: 'budget', icon: Wallet, label: 'Budget' },
                { id: 'variance', icon: TrendingUp, label: 'Variance' },
                { id: 'analyst', icon: MessageSquare, label: 'AI Analyst' },
                { id: 'data', icon: Database, label: 'Append Data' },
                { id: 'vendorGovernance', icon: Building2, label: 'Vendor Governance' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={cn(
                    "flex items-center gap-2 px-6 py-2 text-sm font-bold rounded-xl transition-all",
                    activeTab === tab.id 
                      ? "bg-white text-rose-600 shadow-sm border border-rose-100" 
                      : "text-slate-500 hover:text-rose-600 hover:bg-rose-50/50"
                  )}
                >
                  <tab.icon size={18} /> {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-rose-500/20"
              >
                <option value="All Years">All Years</option>
                {uniqueValues.years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
              <button 
                onClick={() => setShowClearAllModal(true)}
                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
              >
                <Trash2 size={20} />
              </button>
            </div>
          </div>
        </nav>

        <main className="flex-1 max-w-[1800px] w-full mx-auto p-8 space-y-8">
          {/* Insights Bar */}
          <AnimatePresence>
            {(insights.length > 0 || autoInsights.length > 0) && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-6"
              >
                {insights.length > 0 && (
                  <div className="space-y-3">
                    {insights.map((insight, i) => (
                      <div
                        key={`legacy-${i}`}
                        className={cn(
                          "flex items-center gap-4 p-4 rounded-2xl border text-sm font-medium",
                          insight.type === 'warning'
                            ? "bg-red-50 border-red-100 text-red-700"
                            : "bg-blue-50 border-blue-100 text-blue-700"
                        )}
                      >
                        <AlertTriangle size={18} />
                        {insight.message}
                      </div>
                    ))}
                  </div>
                )}

                {autoInsights.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {autoInsights.map((item) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={cn(
                          "rounded-[2rem] border p-5 shadow-sm bg-white",
                          item.level === 'warning' && "border-red-200 bg-red-50/60",
                          item.level === 'info' && "border-blue-200 bg-blue-50/60",
                          item.level === 'success' && "border-emerald-200 bg-emerald-50/60"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={cn(
                              "p-2 rounded-xl",
                              item.level === 'warning' && "bg-red-100 text-red-600",
                              item.level === 'info' && "bg-blue-100 text-blue-600",
                              item.level === 'success' && "bg-emerald-100 text-emerald-600"
                            )}
                          >
                            {item.level === 'warning' ? (
                              <AlertTriangle size={18} />
                            ) : item.level === 'info' ? (
                              <Activity size={18} />
                            ) : (
                              <TrendingUp size={18} />
                            )}
                          </div>

                          <div className="flex-1 space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <h3 className="text-sm font-bold text-slate-900 leading-tight">
                                {item.title}
                              </h3>
                              <span
                                className={cn(
                                  "text-[10px] px-2 py-1 rounded-full font-black uppercase tracking-widest",
                                  item.level === 'warning' && "bg-red-100 text-red-700",
                                  item.level === 'info' && "bg-blue-100 text-blue-700",
                                  item.level === 'success' && "bg-emerald-100 text-emerald-700"
                                )}
                              >
                                {item.level}
                              </span>
                            </div>

                            <p className="text-sm text-slate-600 leading-relaxed">
                              {item.message}
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Filters Panel */}
          <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-900 font-bold">
                <Filter size={20} className="text-rose-500" />
                Advanced Filters
              </div>
              <button 
                onClick={() => setFilters({ 
                  fiscalYear: [], 
                  yearMonth: [], 
                  region: [], 
                  country: [], 
                  station: [],
                  supplier: [], 
                  category: [], 
                  itCategory: [], 
                  budgetCategory: [],
                  budgetItem: [],
                  budgetType: [],
                  costCenter: [], 
                  glAccount: [], 
                  search: '' 
                })}
                className="text-xs font-bold text-rose-600 hover:underline"
              >
                Reset All
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                  <input 
                    type="text" 
                    placeholder="Supplier, Text..." 
                    className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-rose-500/20 outline-none"
                    value={filters.search}
                    onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
                  />
                </div>
              </div>
              {[
                { label: 'Fiscal Year', key: 'fiscalYear', options: uniqueValues.years },
                { label: 'Year/Month', key: 'yearMonth', options: uniqueValues.months },
                { label: 'Region', key: 'region', options: uniqueValues.regions },
                { label: 'Country', key: 'country', options: uniqueValues.countries },
                { label: 'Station', key: 'station', options: uniqueValues.stations },
                { label: 'Supplier', key: 'supplier', options: uniqueValues.suppliers },
                { label: 'Category', key: 'category', options: uniqueValues.categories },
                { label: 'IT Category', key: 'itCategory', options: uniqueValues.itCategories },
                { label: 'Budget Category', key: 'budgetCategory', options: uniqueValues.budgetCategories },
                { label: 'Budget Item', key: 'budgetItem', options: uniqueValues.budgetItems },
                { label: 'Budget Type', key: 'budgetType', options: uniqueValues.budgetTypes },
                { label: 'Cost Center', key: 'costCenter', options: uniqueValues.costCenters },
                { label: 'GL Account', key: 'glAccount', options: uniqueValues.glAccounts }
              ].map((filter) => (
                <div key={filter.key} className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{filter.label}</label>
                  <MultiSelectCheckbox
                    label={filter.label}
                    options={filter.options}
                    selected={(filters as any)[filter.key]}
                    onChange={(values) => setFilters(f => ({ ...f, [filter.key]: values }))}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Warning Banner for Mixed Budgets */}
          {uploadedFileContents.length > 0 && budgetData.length > 0 && (
            (() => {
              const actualTypes = new Set(filteredData.map(d => (d.category || '').toUpperCase()));
              const hasCapex = actualTypes.has('CAPEX');
              const hasOpex = actualTypes.has('OPEX');
              
              if ((hasCapex && !hasOpex) || (!hasCapex && hasOpex)) {
                return (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-center gap-3 text-amber-800"
                  >
                    <AlertTriangle className="text-amber-500" size={20} />
                    <div className="text-sm">
                      <span className="font-bold">Partial Data Detected:</span> Your actual file only contains <span className="font-bold">{hasCapex ? 'CAPEX' : 'OPEX'}</span> data. Variance analysis for {hasCapex ? 'OPEX' : 'CAPEX'} will show 100% savings.
                    </div>
                  </motion.div>
                );
              }
              return null;
            })()
          )}

          {activeTab === 'dashboard' && (
            <div className="space-y-8">
              <AICFOInsightPanel
                actualData={filteredData}
                budgetData={filteredBudgetData}
                varianceData={filteredVarianceData}
              />

              <BudgetForecastPanel
                actualData={filteredData}
                budgetData={filteredBudgetData}
              />

              <VendorNegotiationRadar actualData={filteredData} />

              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                  { label: 'Total Spend', value: `$${stats.totalSpend.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`, icon: DollarSign, color: 'rose' },
                  { label: 'Transactions', value: stats.transactionCount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }), icon: Activity, color: 'emerald' },
                  { label: 'Active Suppliers', value: stats.supplierCount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }), icon: Building2, color: 'amber' },
                  { label: 'Avg Transaction', value: `$${stats.avgTransaction.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`, icon: TrendingUp, color: 'rose' }
                ].map((stat, i) => {
                  return (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.1 }}
                      className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm flex items-center gap-6"
                    >
                      <div className={cn("p-4 rounded-2xl", STAT_STYLES[stat.color])}>
                        <stat.icon size={32} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{stat.label}</p>
                        <p className="text-3xl font-black text-slate-900">{stat.value}</p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* Charts Grid */}
              <div className="grid grid-cols-1 gap-8">
                {/* MoM Analysis Refinement */}
                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-8">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <h3 className="text-xl font-bold flex items-center gap-3">
                        <TrendingUp className="text-rose-500" size={24} /> MoM Analysis Refinement
                      </h3>
                      <button 
                        onClick={exportMoMAnalysis}
                        className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors"
                      >
                        <Download size={14} /> Export Excel
                      </button>
                    </div>
                    <div className="flex gap-4 text-[10px] font-bold uppercase tracking-widest">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-red-500" /> Critical ({'>'}{momThreshold}%)
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-amber-500" /> Warning ({'>'}25%)
                      </div>
                    </div>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-slate-100">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                          <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Month</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Spend</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">MoM Change (%)</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {chartData.momAnalysis.slice(-12).map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-6 py-4 text-sm font-bold text-slate-700">{row.month}</td>
                            <td className="px-6 py-4 text-sm font-medium text-slate-600">${(row.spend as number).toLocaleString()}</td>
                            <td className="px-6 py-4">
                              <div className={cn(
                                "inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold",
                                row.status === 'red' ? "bg-red-50 text-red-600" : 
                                row.status === 'amber' ? "bg-amber-50 text-amber-600" : 
                                "bg-slate-50 text-slate-500"
                              )}>
                                {row.change > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                                {Math.abs(row.change).toFixed(1)}%
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "text-[10px] font-black uppercase tracking-widest",
                                row.status === 'red' ? "text-red-500" : 
                                row.status === 'amber' ? "text-amber-500" : 
                                "text-slate-300"
                              )}>
                                {row.status === 'red' ? 'CRITICAL SPIKE' : row.status === 'amber' ? 'HIGH VARIANCE' : 'STABLE'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <h3 className="text-xl font-bold flex items-center gap-3">
                        <TableIcon className="text-rose-500" size={24} />
                        Pivot MoM Dashboard
                      </h3>
                      <button 
                        onClick={exportPivotDashboard}
                        className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors"
                      >
                        <Download size={14} /> Export Excel
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="text-sm font-semibold text-slate-600">Threshold %</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={momThreshold}
                        onChange={(e) => setMomThreshold(Number(e.target.value) || 35)}
                        className="w-24 px-3 py-2 border border-slate-200 rounded-xl text-sm"
                      />
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-2xl border border-slate-100">
                    <table className="w-full text-left border-collapse min-w-[1800px]">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                          {[
                            { label: 'Region', key: 'region', options: uniqueValues.regions },
                            { label: 'Country', key: 'country', options: uniqueValues.countries },
                            { label: 'Supplier', key: 'supplier', options: uniqueValues.suppliers },
                            { label: 'Category', key: 'category', options: uniqueValues.categories },
                            { label: 'IT Category', key: 'itCategory', options: uniqueValues.itCategories }
                          ].map((h) => (
                            <th key={h.key} className="px-4 py-3 min-w-[150px]">
                              <div className="flex flex-col gap-2">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{h.label}</span>
                                <MultiSelectCheckbox
                                  label={h.label}
                                  options={h.options}
                                  selected={(filters as any)[h.key]}
                                  onChange={(values) => setFilters(f => ({ ...f, [h.key]: values }))}
                                />
                              </div>
                            </th>
                          ))}
                          {allMonths.map((month) => (
                            <th key={month} className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest align-top pt-5">
                              {month}
                            </th>
                          ))}
                          <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest align-top pt-5">Grand Total</th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-50">
                        {pivotWithMoM.map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-4 py-3 text-xs text-slate-700">{row.region}</td>
                            <td className="px-4 py-3 text-xs text-slate-700">{row.country}</td>
                            <td className="px-4 py-3 text-xs font-bold text-slate-900">{row.supplier}</td>
                            <td className="px-4 py-3 text-xs text-slate-700">{row.category}</td>
                            <td className="px-4 py-3 text-xs text-slate-700">{row.itCategory}</td>

                            {allMonths.map((month) => {
                              const value = row.months[month] || 0;
                              const mom = row.mom[month];
                              const flagged = mom !== null && mom > momThreshold;

                              return (
                                <td
                                  key={month}
                                  title={mom !== null ? `MoM: ${mom.toFixed(1)}%` : 'No previous month'}
                                  className={cn(
                                    "px-4 py-3 text-xs text-center",
                                    flagged ? "bg-red-50 text-red-600 font-bold" : "text-slate-700"
                                  )}
                                >
                                  <div className="flex flex-col items-center justify-center leading-tight">
                                    {flagged && <span className="text-red-500 text-sm">●</span>}
                                    <span>{value !== 0 ? value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : ""}</span>
                                  </div>
                                </td>
                              );
                            })}

                            <td className="px-4 py-3 text-xs font-bold text-rose-600">
                              {row.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'data' && (
            <div className="space-y-8">
              {excelSyncInfo && (
                <motion.div 
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-emerald-50 border border-emerald-100 p-6 rounded-[2rem] flex items-center justify-between"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-2xl bg-emerald-100 text-emerald-600">
                      <FileSpreadsheet size={24} />
                    </div>
                    <div>
                      <h4 className="font-bold text-emerald-900">Excel Sync Active</h4>
                      <p className="text-sm text-emerald-600">
                        Last synced: <strong>{excelSyncInfo.fileName}</strong> at {new Date(excelSyncInfo.submittedAt).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 bg-emerald-100 text-emerald-700 rounded-xl text-xs font-bold uppercase tracking-widest">
                    <Activity size={14} className="animate-pulse" /> Live
                  </div>
                </motion.div>
              )}

              <div className="bg-white p-12 rounded-[3rem] border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-center space-y-6 hover:border-rose-300 transition-colors group relative">
                <input 
                  type="file" 
                  className="absolute inset-0 opacity-0 cursor-pointer" 
                  onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])} 
                />
                <div className="p-6 rounded-full bg-rose-50 text-rose-600 group-hover:scale-110 transition-transform">
                  <Upload size={48} />
                </div>
                <div className="space-y-2">
                  <h3 className="text-2xl font-bold text-slate-900">Upload Financial Data</h3>
                  <p className="text-slate-500 max-w-sm">Drag and drop your CSV or Excel files here to append them to the master dataset.</p>
                </div>
                <div className="flex gap-4 text-xs font-bold text-slate-400 uppercase tracking-widest">
                  <span className="flex items-center gap-1"><FileSpreadsheet size={14} /> CSV</span>
                  <span className="flex items-center gap-1"><FileSpreadsheet size={14} /> XLSX</span>
                </div>
              </div>

              <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <h3 className="font-bold text-slate-900">Uploaded Files History</h3>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">{uploadedFiles.length} Files Ingested</div>
                </div>
                <div className="divide-y divide-slate-100">
                  {uploadedFiles.length === 0 ? (
                    <div className="p-12 text-center text-slate-400 italic">No files uploaded yet.</div>
                  ) : (
                    uploadedFiles.map((file) => (
                      <div key={file.name} className="p-6 flex items-center justify-between hover:bg-slate-50 transition-colors group">
                        <div className="flex items-center gap-6">
                          <div className="flex items-center gap-6">
                            <div className="p-3 rounded-2xl bg-slate-100 text-slate-500 group-hover:bg-rose-100 group-hover:text-rose-600 transition-colors">
                              <FileSpreadsheet size={24} />
                            </div>
                            <div>
                              <h4 className="font-bold text-slate-900">{file.name}</h4>
                              <div className="flex items-center gap-4 mt-1">
                                <span className="text-xs font-medium text-slate-400 flex items-center gap-1">
                                  <Activity size={12} /> {file.transactionCount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} rows
                                </span>
                                <span className="text-xs font-medium text-slate-400 flex items-center gap-1">
                                  <DollarSign size={12} /> ${file.totalUsd.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </span>
                                <span className="text-xs font-medium text-slate-400">Uploaded on {file.uploadDate}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button 
                            onClick={() => analyzeFile(file.name)}
                            className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-rose-600 bg-rose-50 rounded-xl hover:bg-rose-100 transition-colors"
                          >
                            <BrainCircuit size={14} /> Analyze
                          </button>
                          <button 
                            onClick={() => setFileToDelete(file.name)}
                            className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'budget' && (
            <div className="space-y-8">
              {/* Budget Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                  { label: 'Total Budget', value: `$${budgetStats.totalBudget.toLocaleString()}`, icon: DollarSign, color: 'bg-emerald-50 text-emerald-600' },
                  { label: 'Budget Rows', value: budgetStats.budgetRows.toLocaleString(), icon: Activity, color: 'bg-rose-50 text-rose-600' },
                  { label: 'Regions Covered', value: budgetStats.regions.toLocaleString(), icon: Globe, color: 'bg-amber-50 text-amber-600' },
                  { label: 'Stations Covered', value: budgetStats.stations.toLocaleString(), icon: Building2, color: 'bg-rose-50 text-rose-600' }
                ].map((stat) => (
                  <div key={stat.label} className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className={cn("p-4 rounded-2xl", stat.color)}>
                      <stat.icon size={24} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{stat.label}</p>
                      <h4 className="text-2xl font-bold text-slate-900">{stat.value}</h4>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-8">
                  {/* Upload Budget Section */}
                  <div className="bg-white p-12 rounded-[3rem] border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-center space-y-6 hover:border-rose-300 transition-colors group relative">
                    <input 
                      type="file" 
                      className="absolute inset-0 opacity-0 cursor-pointer" 
                      onChange={(e) => e.target.files?.[0] && handleBudgetUpload(e.target.files[0])} 
                    />
                    <div className="p-6 rounded-full bg-rose-50 text-rose-600 group-hover:scale-110 transition-transform">
                      <Upload size={48} />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-2xl font-bold text-slate-900">Upload Budget Data</h3>
                      <p className="text-slate-500 max-w-sm">Upload your budget allocation files to compare against actual expenditure.</p>
                    </div>
                    <div className="flex gap-4 text-xs font-bold text-slate-400 uppercase tracking-widest">
                      <span className="flex items-center gap-1"><FileSpreadsheet size={14} /> CSV</span>
                      <span className="flex items-center gap-1"><FileSpreadsheet size={14} /> XLSX</span>
                    </div>
                  </div>

                  {/* Budget Files History */}
                  <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                      <h3 className="font-bold text-slate-900">Budget Files History</h3>
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">{uploadedBudgetFiles.length} Files Ingested</div>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {uploadedBudgetFiles.length === 0 ? (
                        <div className="p-12 text-center text-slate-400 italic">No budget files uploaded yet.</div>
                      ) : (
                        uploadedBudgetFiles.map((file) => (
                          <div key={file.name} className="p-6 flex items-center justify-between hover:bg-slate-50 transition-colors group">
                            <div className="flex items-center gap-6">
                              <div className="p-3 rounded-2xl bg-slate-100 text-slate-500 group-hover:bg-rose-100 group-hover:text-rose-600 transition-colors">
                                <FileSpreadsheet size={24} />
                              </div>
                              <div>
                                <h4 className="font-bold text-slate-900">{file.name}</h4>
                                <div className="flex items-center gap-4 mt-1">
                                  <span className="text-xs font-medium text-slate-400 flex items-center gap-1">
                                    <Activity size={12} /> {file.recordCount.toLocaleString()} rows
                                  </span>
                                  <span className="text-xs font-medium text-slate-400 flex items-center gap-1">
                                    <DollarSign size={12} /> ${file.totalBudgetUsd.toLocaleString()}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <button 
                              onClick={() => setBudgetFileToDelete(file.name)}
                              className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  {/* Manual Entry Form */}
                  <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
                        <Wallet size={20} />
                      </div>
                      <h3 className="font-bold text-slate-900">Manual Entry</h3>
                    </div>
                    
                    <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Region</label>
                        <input 
                          type="text" 
                          placeholder="e.g. North America"
                          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all text-sm"
                          value={manualBudget.region}
                          onChange={(e) => setManualBudget(prev => ({ ...prev, region: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Station</label>
                        <input 
                          type="text" 
                          placeholder="e.g. JFK"
                          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all text-sm"
                          value={manualBudget.station}
                          onChange={(e) => setManualBudget(prev => ({ ...prev, station: e.target.value }))}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Category</label>
                          <select 
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all text-sm appearance-none bg-white"
                            value={manualBudget.category}
                            onChange={(e) => setManualBudget(prev => ({ ...prev, category: e.target.value }))}
                          >
                            <option value="">Select...</option>
                            <option value="Capex">Capex</option>
                            <option value="Opex">Opex</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">IT Category</label>
                          <input 
                            type="text" 
                            placeholder="e.g. Software"
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all text-sm"
                            value={manualBudget.itCategory}
                            onChange={(e) => setManualBudget(prev => ({ ...prev, itCategory: e.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Budget Category</label>
                          <input 
                            type="text" 
                            placeholder="e.g. Infrastructure"
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all text-sm"
                            value={manualBudget.budgetCategory}
                            onChange={(e) => setManualBudget(prev => ({ ...prev, budgetCategory: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Budget Item</label>
                          <input 
                            type="text" 
                            placeholder="e.g. Server"
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all text-sm"
                            value={manualBudget.budgetItem}
                            onChange={(e) => setManualBudget(prev => ({ ...prev, budgetItem: e.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Year/Month</label>
                          <input 
                            type="text" 
                            placeholder="YYYY/MM"
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all text-sm"
                            value={manualBudget.yearMonth}
                            onChange={(e) => setManualBudget(prev => ({ ...prev, yearMonth: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Budget</label>
                          <input 
                            type="number" 
                            placeholder="0.00"
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all text-sm"
                            value={manualBudget.budget}
                            onChange={(e) => setManualBudget(prev => ({ ...prev, budget: e.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Item</label>
                          <input 
                            type="text" 
                            placeholder="e.g. Server Hardware"
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all text-sm"
                            value={manualBudget.item}
                            onChange={(e) => setManualBudget(prev => ({ ...prev, item: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Type</label>
                          <select 
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all text-sm appearance-none bg-white"
                            value={manualBudget.type}
                            onChange={(e) => setManualBudget(prev => ({ ...prev, type: e.target.value }))}
                          >
                            <option value="OPEX">OPEX</option>
                            <option value="CAPEX">CAPEX</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    <button 
                      onClick={handleAddManualBudget}
                      className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 shadow-lg shadow-slate-200 transition-all active:scale-95"
                    >
                      <Plus size={18} /> Add Budget Line
                    </button>
                  </div>

                  <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                    <div className="space-y-2">
                      <h3 className="font-bold text-slate-900">Budget Template</h3>
                      <p className="text-sm text-slate-500">Download our standardized template to ensure your budget data is correctly formatted for ingestion.</p>
                    </div>
                    <button 
                      onClick={downloadBudgetTemplate}
                      className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-rose-600 text-white font-bold rounded-2xl hover:bg-rose-700 shadow-lg shadow-rose-200 transition-all active:scale-95"
                    >
                      <Download size={20} /> Download Template
                    </button>
                    <div className="pt-4 border-t border-slate-100 space-y-4">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Required Columns</h4>
                      <ul className="space-y-2">
                        {['Region', 'Station', 'Category', 'Item', 'Type', 'Budget'].map(col => (
                          <li key={col} className="flex items-center gap-2 text-sm text-slate-600">
                            <div className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                            {col}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'variance' && (
            <div className="space-y-8">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                  { label: 'Total Budget', value: varianceAnalysis.totalBudget, icon: Wallet, color: 'text-rose-600', bg: 'bg-rose-50' },
                  { label: 'Total Actual', value: varianceAnalysis.totalActual, icon: DollarSign, color: 'text-slate-900', bg: 'bg-slate-50' },
                  { label: 'Total Variance', value: varianceAnalysis.totalVariance, icon: TrendingUp, color: varianceAnalysis.totalVariance > 0 ? 'text-rose-600' : 'text-emerald-600', bg: varianceAnalysis.totalVariance > 0 ? 'bg-rose-50' : 'bg-emerald-50' },
                  { label: 'Budget Used %', value: varianceAnalysis.budgetUsedPercent, icon: Activity, color: varianceAnalysis.budgetUsedPercent > 100 ? 'text-rose-600' : 'text-emerald-600', bg: varianceAnalysis.budgetUsedPercent > 100 ? 'bg-rose-50' : 'bg-emerald-50', isPct: true },
                  { label: 'Monthly Run Rate', value: varianceAnalysis.runRate, icon: Activity, color: 'text-slate-900', bg: 'bg-slate-50' },
                  { label: 'Forecast Year-End', value: varianceAnalysis.forecastYearEnd, icon: TrendingUp, color: 'text-slate-900', bg: 'bg-slate-50' },
                  { label: 'Overspend Risk', value: varianceAnalysis.overspendRisk, icon: AlertTriangle, color: varianceAnalysis.overspendRisk > 0 ? 'text-rose-600' : 'text-emerald-600', bg: varianceAnalysis.overspendRisk > 0 ? 'bg-rose-50' : 'bg-emerald-50' },
                  { label: 'Variance %', value: varianceAnalysis.variancePct, icon: Activity, color: varianceAnalysis.variancePct > 0 ? 'text-rose-600' : 'text-emerald-600', bg: varianceAnalysis.variancePct > 0 ? 'bg-rose-50' : 'bg-emerald-50', isPct: true }
                ].map((stat, i) => (
                  <motion.div
                    key={stat.label}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center gap-4">
                      <div className={clsx("p-3 rounded-2xl", stat.bg, stat.color)}>
                        <stat.icon size={24} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-500">{stat.label}</p>
                        <h3 className={clsx("text-2xl font-bold", stat.color)}>
                          {stat.isPct ? `${stat.value.toFixed(1)}%` : formatCurrency(stat.value)}
                        </h3>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Charts Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Budget vs Actual by Region */}
                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
                  <h3 className="text-lg font-bold text-slate-900 mb-6">Budget vs Actual by Region</h3>
                  <div className="h-[350px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={varianceAnalysis.charts.region} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                        <Tooltip 
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                          formatter={(value: number) => formatCurrency(value)}
                        />
                        <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                        <Bar dataKey="budget" name="Budget" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="actual" name="Actual" fill="#e11d48" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Monthly Variance Trend */}
                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
                  <h3 className="text-lg font-bold text-slate-900 mb-6">Monthly Variance Trend</h3>
                  <div className="h-[350px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={varianceAnalysis.charts.month} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                        <Tooltip 
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                          formatter={(value: number) => formatCurrency(value)}
                        />
                        <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                        <Area type="monotone" dataKey="variance" name="Variance" fill="#fef2f2" stroke="#ef4444" strokeWidth={2} />
                        <Line type="monotone" dataKey="budget" name="Budget" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                        <Line type="monotone" dataKey="actual" name="Actual" stroke="#e11d48" strokeWidth={2} dot={{ r: 4, fill: '#e11d48' }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Budget vs Actual by Station */}
                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
                  <h3 className="text-lg font-bold text-slate-900 mb-6">Budget vs Actual by Station (Top 10)</h3>
                  <div className="h-[350px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={varianceAnalysis.charts.station} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                        <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                        <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} width={100} />
                        <Tooltip 
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                          formatter={(value: number) => formatCurrency(value)}
                        />
                        <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                        <Bar dataKey="budget" name="Budget" fill="#e2e8f0" radius={[0, 4, 4, 0]} />
                        <Bar dataKey="actual" name="Actual" fill="#e11d48" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Budget vs Actual by IT Category */}
                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
                  <h3 className="text-lg font-bold text-slate-900 mb-6">Budget vs Actual by IT Category (Top 10)</h3>
                  <div className="h-[350px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={varianceAnalysis.charts.itCategory} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                        <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                        <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} width={120} />
                        <Tooltip 
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                          formatter={(value: number) => formatCurrency(value)}
                        />
                        <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                        <Bar dataKey="budget" name="Budget" fill="#e2e8f0" radius={[0, 4, 4, 0]} />
                        <Bar dataKey="actual" name="Actual" fill="#e11d48" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Tables Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Over Budget */}
                <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-slate-100 bg-rose-50/50 flex items-center justify-between">
                    <h3 className="font-bold text-rose-900 flex items-center gap-2">
                      <AlertTriangle size={18} />
                      Top Over-Budget IT Categories
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">IT Category</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Actual</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Variance</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {varianceAnalysis.tables.overBudget.slice(0, 5).map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 text-sm font-medium text-slate-900">{row.name}</td>
                            <td className="px-6 py-4 text-sm text-slate-600 text-right font-mono">{formatCurrency(row.actual)}</td>
                            <td className="px-6 py-4 text-sm text-rose-600 text-right font-bold font-mono">+{formatCurrency(row.variance)}</td>
                            <td className="px-6 py-4 text-right">
                              <span className="px-2 py-1 rounded-lg bg-rose-100 text-rose-700 text-xs font-bold">
                                +{row.variancePct.toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Under Budget */}
                <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-slate-100 bg-emerald-50/50 flex items-center justify-between">
                    <h3 className="font-bold text-emerald-900 flex items-center gap-2">
                      <TrendingUp size={18} />
                      Top Under-Budget IT Categories
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">IT Category</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Actual</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Variance</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {varianceAnalysis.tables.underBudget.slice(0, 5).map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 text-sm font-medium text-slate-900">{row.name}</td>
                            <td className="px-6 py-4 text-sm text-slate-600 text-right font-mono">{formatCurrency(row.actual)}</td>
                            <td className="px-6 py-4 text-sm text-emerald-600 text-right font-bold font-mono">{formatCurrency(row.variance)}</td>
                            <td className="px-6 py-4 text-right">
                              <span className="px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-bold">
                                {row.variancePct.toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Hierarchy Breakdown Table */}
              <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                  <h3 className="font-bold text-slate-900">Region & Station Variance Breakdown</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Region</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Station</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Budget</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Actual</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Variance</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">%</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Forecast (YE)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Risk</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {varianceAnalysis.tables.hierarchy.map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 text-sm font-bold text-slate-900">{row.region}</td>
                          <td className="px-6 py-4 text-sm text-slate-600">{row.station}</td>
                          <td className="px-6 py-4 text-sm text-slate-600 text-right font-mono">{formatCurrency(row.budget)}</td>
                          <td className="px-6 py-4 text-sm text-slate-900 text-right font-mono font-medium">{formatCurrency(row.actual)}</td>
                          <td className={clsx(
                            "px-6 py-4 text-sm text-right font-bold font-mono",
                            row.variance > 0 ? "text-rose-600" : "text-emerald-600"
                          )}>
                            {row.variance > 0 ? '+' : ''}{formatCurrency(row.variance)}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className={clsx(
                              "px-2 py-1 rounded-lg text-xs font-bold",
                              row.variance > 0 ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"
                            )}>
                              {row.variance > 0 ? '+' : ''}{row.variancePct?.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-600 text-right font-mono">{formatCurrency(row.forecast)}</td>
                          <td className={clsx(
                            "px-6 py-4 text-sm text-right font-bold font-mono",
                            row.risk > 0 ? "text-rose-600" : "text-emerald-600"
                          )}>
                            {row.risk > 0 ? '+' : ''}{formatCurrency(row.risk)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'transactions' && (
            <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h3 className="font-bold text-slate-900">Transaction Drill-down</h3>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">Showing {filteredData.length.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} Transactions</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[2000px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      {[
                        { label: 'Posting Date', key: 'yearMonth', options: uniqueValues.months },
                        { label: 'Supplier', key: 'supplier', options: uniqueValues.suppliers },
                        { label: 'USD', key: null },
                        { label: 'IT Category', key: 'itCategory', options: uniqueValues.itCategories },
                        { label: 'Category', key: 'category', options: uniqueValues.categories },
                        { label: 'Region', key: 'region', options: uniqueValues.regions },
                        { label: 'Country', key: 'country', options: uniqueValues.countries },
                        { label: 'Cost Center', key: 'costCenter', options: uniqueValues.costCenters },
                        { label: 'GL Name', key: null },
                        { label: 'Text', key: null },
                        { label: 'Doc Number', key: null }
                      ].map(h => (
                        <th key={h.label} className="px-6 py-4 min-w-[150px]">
                          <div className="flex flex-col gap-2">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{h.label}</span>
                            {h.key ? (
                              <MultiSelectCheckbox
                                label={h.label}
                                options={h.options || []}
                                selected={(filters as any)[h.key]}
                                onChange={(values) => setFilters(f => ({ ...f, [h.key]: values }))}
                              />
                            ) : (
                              <div className="h-[38px]" /> // Placeholder for alignment
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredData.slice(0, 500).map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50 transition-colors group">
                        <td className="px-6 py-4 text-xs font-medium text-slate-500">{row.postingDate}</td>
                        <td className="px-6 py-4 text-xs font-bold text-slate-900">{row.supplier}</td>
                        <td className="px-6 py-4 text-xs font-black text-rose-600">${row.usd.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                        <td className="px-6 py-4 text-xs font-medium text-slate-600">{row.itCategory}</td>
                        <td className="px-6 py-4 text-xs font-medium text-slate-600">{row.category}</td>
                        <td className="px-6 py-4 text-xs font-medium text-slate-600">{row.region}</td>
                        <td className="px-6 py-4 text-xs font-medium text-slate-600">{row.country}</td>
                        <td className="px-6 py-4 text-xs font-medium text-slate-600">{row.costCenter}</td>
                        <td className="px-6 py-4 text-xs font-medium text-slate-600">{row.glName}</td>
                        <td className="px-6 py-4 text-xs font-medium text-slate-500 max-w-xs truncate">{row.text}</td>
                        <td className="px-6 py-4 text-xs font-mono text-slate-400">{row.documentNumber}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredData.length > 500 && (
                  <div className="p-6 text-center text-slate-400 text-sm font-medium border-t border-slate-100">
                    Showing first 500 transactions. Use filters to narrow down.
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'analyst' && (
            <div className="flex flex-col h-[700px] bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex items-center gap-4 bg-slate-50/50">
                <div className="p-2 rounded-xl bg-rose-600 text-white">
                  <BrainCircuit size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">AI Financial Analyst</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Powered by Gemini 3.1 Pro</p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-6">
                {chatMessages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-6 max-w-md mx-auto">
                    <div className="p-8 rounded-[3rem] bg-rose-50 text-rose-600 shadow-inner">
                      <Database size={56} />
                    </div>
                    <div className="space-y-3">
                      <h4 className="text-2xl font-bold text-slate-900 tracking-tight">Data Ingested & Stored</h4>
                      <p className="text-slate-500 text-sm leading-relaxed">
                        I have processed your {actualData.length.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} transactions and understand the cost structures. I am ready to provide analysis or generate insights based on your prompts.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 w-full">
                      {[
                        "What are the top 3 cost drivers this month?",
                        "Identify any supplier concentration risks.",
                        "Analyze the MoM trend for Cloud Infrastructure.",
                        "Summarize the regional spend distribution."
                      ].map(q => (
                        <button 
                          key={q} 
                          onClick={() => setUserInput(q)}
                          className="text-left px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm font-medium text-slate-600 hover:bg-white hover:border-rose-500 hover:shadow-md transition-all"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {chatMessages.map((msg, i) => (
                  <motion.div 
                    key={i}
                    initial={{ opacity: 0, x: msg.role === 'user' ? 20 : -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={cn(
                      "flex gap-4 max-w-[85%]",
                      msg.role === 'user' ? "ml-auto flex-row-reverse" : ""
                    )}
                  >
                    <div className={cn(
                      "p-2 rounded-xl flex-shrink-0 h-fit",
                      msg.role === 'user' ? "bg-slate-200 text-slate-600" : "bg-rose-600 text-white"
                    )}>
                      {msg.role === 'user' ? <Search size={16} /> : <BrainCircuit size={16} />}
                    </div>
                    <div className={cn(
                      "p-5 rounded-3xl text-sm leading-relaxed",
                      msg.role === 'user' ? "bg-slate-100 text-slate-800 rounded-tr-none" : "bg-white border border-slate-200 text-slate-700 shadow-sm rounded-tl-none"
                    )}>
                      <div className="prose prose-slate prose-sm max-w-none">
                        {(() => {
                          const shouldShowAutoChart =
                            msg.role === 'ai' &&
                            msg.analysisResult?.chartReady &&
                            msg.analysisResult?.answerType !== 'chart_request';

                          return (
                            <div className="space-y-4">
                              <Markdown
                                components={{
                                  code({ node, className, children, ...props }) {
                                    const match = /language-(\w+)/.exec(className || '');
                                    const isInline = !node?.position?.start.line || node.position.start.line === node.position.end.line;

                                    if (!isInline && match && (match[1] === 'json' || match[1] === 'json-chart')) {
                                      try {
                                        const config = JSON.parse(String(children).replace(/\n$/, ''));
                                        if (config?.type === 'chart') {
                                          return (
                                            <DynamicChart
                                              config={config}
                                              actualData={filteredData}
                                              budgetData={filteredBudgetData}
                                              varianceData={filteredVarianceData}
                                            />
                                          );
                                        }
                                      } catch (e) {
                                        return <code className={className} {...props}>{children}</code>;
                                      }
                                    }
                                    return <code className={className} {...props}>{children}</code>;
                                  }
                                }}
                              >
                                {msg.content}
                              </Markdown>

                              {shouldShowAutoChart && (
                                <div className="pt-2">
                                  <DynamicChart
                                    analysisResult={msg.analysisResult}
                                    actualData={filteredData}
                                    budgetData={filteredBudgetData}
                                    varianceData={filteredVarianceData}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </motion.div>
                ))}
                {isAnalyzing && (
                  <div className="flex gap-4 max-w-[85%]">
                    <div className="p-2 rounded-xl bg-rose-600 text-white animate-pulse">
                      <BrainCircuit size={16} />
                    </div>
                    <div className="p-5 rounded-3xl bg-white border border-slate-200 text-slate-400 text-sm italic flex items-center gap-3">
                      <div className="flex gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      Analyzing financial data...
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {chatMessages.length > 0 &&
                chatMessages[chatMessages.length - 1]?.role === 'ai' &&
                chatMessages[chatMessages.length - 1]?.analysisResult?.answerType === 'chart_request' &&
                lastAnalysisResult && (
                  <div className="mx-8 mb-6 p-6 bg-slate-50 border border-slate-200 rounded-[2rem]">
                    <DynamicChart
                      analysisResult={lastAnalysisResult}
                      actualData={filteredData}
                      budgetData={filteredBudgetData}
                      varianceData={filteredVarianceData}
                    />
                  </div>
                )}

              <form onSubmit={handleChatSubmit} className="p-6 border-t border-slate-100 bg-slate-50/50">
                <div className="relative">
                  <input 
                    type="text" 
                    placeholder="Ask a question about your IT spend..." 
                    className="w-full pl-6 pr-16 py-4 bg-white border border-slate-200 rounded-2xl text-sm focus:ring-4 focus:ring-rose-500/10 focus:border-rose-500 outline-none transition-all shadow-sm"
                    value={userInput}
                    onChange={e => setUserInput(e.target.value)}
                  />
                  <button 
                    type="submit"
                    disabled={!userInput.trim() || isAnalyzing}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 rounded-xl bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-rose-200"
                  >
                    <ArrowRight size={20} />
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'vendorGovernance' && (
            <div className="space-y-8">
              <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
                <div className="flex items-start justify-between gap-6">
                  <div className="space-y-2">
                    <h2 className="text-2xl font-black tracking-tight text-slate-900">
                      IT Vendor Governance & Optimization
                    </h2>
                    <p className="text-slate-500 max-w-3xl">
                      Monitor vendor duplication, supplier footprint, spend concentration, dependency risk,
                      and global service coverage to support cost optimization and negotiation strategy.
                    </p>
                  </div>
                  <div className="hidden lg:flex items-center gap-2 px-4 py-2 rounded-2xl bg-rose-50 text-rose-600 border border-rose-100 text-xs font-bold uppercase tracking-widest">
                    <Building2 size={16} />
                    Governance Module
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                {[
                  {
                    label: 'Total Spend',
                    value: formatCurrency(vendorPortfolioStats.totalSpend),
                    icon: DollarSign,
                    color: 'bg-rose-50 text-rose-600'
                  },
                  {
                    label: 'Active Vendors',
                    value: vendorPortfolioStats.totalVendors.toLocaleString(),
                    icon: Building2,
                    color: 'bg-emerald-50 text-emerald-600'
                  },
                  {
                    label: 'Services',
                    value: vendorPortfolioStats.totalServices.toLocaleString(),
                    icon: Layers,
                    color: 'bg-amber-50 text-amber-600'
                  },
                  {
                    label: 'Countries',
                    value: vendorPortfolioStats.totalCountries.toLocaleString(),
                    icon: Globe,
                    color: 'bg-blue-50 text-blue-600'
                  },
                  {
                    label: 'Duplication Risks',
                    value: vendorPortfolioStats.duplicateVendorRisks.toLocaleString(),
                    icon: AlertTriangle,
                    color: 'bg-red-50 text-red-600'
                  }
                ].map((stat) => (
                  <div key={stat.label} className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className={cn('p-4 rounded-2xl', stat.color)}>
                      <stat.icon size={24} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{stat.label}</p>
                      <h4 className="text-2xl font-bold text-slate-900">{stat.value}</h4>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-4">
                <div>
                  <h3 className="font-bold text-slate-900">Ask AI about Vendor Governance</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    Use these shortcuts to analyze duplication, dependency, and negotiation opportunities.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                  {[
                    'Which countries have duplicate internet vendors?',
                    'Which suppliers dominate infrastructure spend?',
                    'Where can we consolidate suppliers to reduce cost?',
                    'Which vendor has the highest dependency risk?'
                  ].map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => {
                        setActiveTab('analyst');
                        setUserInput(prompt);
                      }}
                      className="text-left px-4 py-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm font-medium text-slate-600 hover:bg-white hover:border-rose-500 hover:shadow-md transition-all"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-bold text-slate-900">Top Vendors by Spend</h3>
                  </div>
                  <div className="h-[350px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={vendorGovernanceChartData.topVendors} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                        <XAxis
                          type="number"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: '#64748b', fontSize: 12 }}
                          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                        />
                        <YAxis
                          dataKey="name"
                          type="category"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: '#64748b', fontSize: 11 }}
                          width={140}
                        />
                        <Tooltip
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                          formatter={(value: number) => formatCurrency(value)}
                        />
                        <Bar dataKey="value" name="Spend" fill="#e11d48" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-bold text-slate-900">Service Fragmentation</h3>
                  </div>
                  <div className="h-[350px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={vendorGovernanceChartData.serviceFragmentation} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                        <Tooltip
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        />
                        <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                        <Bar dataKey="suppliers" name="Supplier Count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-4">
                  <div>
                    <h3 className="font-bold text-slate-900">Vendor Duplication Report</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Detect same service with multiple suppliers in the same country.
                    </p>
                  </div>
                  <button
                    onClick={exportVendorDuplicationReport}
                    className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors"
                  >
                    <Download size={14} /> Export Excel
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Country</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Service</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Suppliers</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Supplier Count</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Spend</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {vendorDuplicationReport
                        .filter((row) => row.supplierCount > 1)
                        .slice(0, 15)
                        .map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 text-sm font-medium text-slate-900">{row.country}</td>
                          <td className="px-6 py-4 text-sm text-slate-700">{row.service}</td>
                          <td className="px-6 py-4 text-sm text-slate-600">{row.suppliers.join(', ')}</td>
                          <td className="px-6 py-4 text-sm text-slate-700 text-right font-bold">{row.supplierCount}</td>
                          <td className="px-6 py-4 text-sm text-slate-700 text-right font-mono">{formatCurrency(row.spend)}</td>
                          <td className="px-6 py-4 text-center">
                            <span
                              className={cn(
                                'px-3 py-1 rounded-lg text-xs font-bold',
                                row.status === 'Duplicate'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-emerald-100 text-emerald-700'
                              )}
                            >
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                    <h3 className="font-bold text-slate-900">Strategic Vendor Footprint</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Supplier</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Countries</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Services</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Spend</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {strategicVendorFootprint.slice(0, 10).map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 text-sm font-medium text-slate-900">{row.supplier}</td>
                            <td className="px-6 py-4 text-sm text-right text-slate-700">{row.countryCount}</td>
                            <td className="px-6 py-4 text-sm text-right text-slate-700">{row.serviceCount}</td>
                            <td className="px-6 py-4 text-sm text-right font-mono text-slate-700">{formatCurrency(row.spend)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-4">
                    <h3 className="font-bold text-slate-900">Vendor Dependency Risk</h3>
                    <button
                      onClick={exportVendorDependencyRiskReport}
                      className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors"
                    >
                      <Download size={14} /> Export Excel
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Supplier</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Countries</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Services</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Spend Share</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-center">Risk</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {vendorDependencyRisk.slice(0, 10).map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 text-sm font-medium text-slate-900">{row.supplier}</td>
                            <td className="px-6 py-4 text-sm text-right text-slate-700">{row.countryCount}</td>
                            <td className="px-6 py-4 text-sm text-right text-slate-700">{row.serviceCount}</td>
                            <td className="px-6 py-4 text-sm text-right text-slate-700">{row.spendShare.toFixed(1)}%</td>
                            <td className="px-6 py-4 text-center">
                              <span
                                className={cn(
                                  'px-3 py-1 rounded-lg text-xs font-bold',
                                  row.riskLevel === 'High' && 'bg-red-100 text-red-700',
                                  row.riskLevel === 'Medium' && 'bg-amber-100 text-amber-700',
                                  row.riskLevel === 'Low' && 'bg-emerald-100 text-emerald-700'
                                )}
                              >
                                {row.riskLevel}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                    <h3 className="font-bold text-slate-900">Vendor Spend Concentration</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Supplier</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Spend</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Share</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-center">Level</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {vendorSpendConcentration.slice(0, 10).map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 text-sm font-medium text-slate-900">{row.supplier}</td>
                            <td className="px-6 py-4 text-sm text-right font-mono text-slate-700">{formatCurrency(row.spend)}</td>
                            <td className="px-6 py-4 text-sm text-right text-slate-700">{row.spendShare.toFixed(1)}%</td>
                            <td className="px-6 py-4 text-center">
                              <span
                                className={cn(
                                  'px-3 py-1 rounded-lg text-xs font-bold',
                                  row.concentrationLevel === 'High' && 'bg-red-100 text-red-700',
                                  row.concentrationLevel === 'Medium' && 'bg-amber-100 text-amber-700',
                                  row.concentrationLevel === 'Low' && 'bg-emerald-100 text-emerald-700'
                                )}
                              >
                                {row.concentrationLevel}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-4">
                    <h3 className="font-bold text-slate-900">Service Vendor Landscape</h3>
                    <button
                      onClick={exportServiceVendorLandscape}
                      className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors"
                    >
                      <Download size={14} /> Export Excel
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Service</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Supplier</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Countries</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Regions</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Spend</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {serviceVendorLandscape.slice(0, 12).map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 text-sm font-medium text-slate-900">{row.service}</td>
                            <td className="px-6 py-4 text-sm text-slate-700">{row.supplier}</td>
                            <td className="px-6 py-4 text-sm text-right text-slate-700">{row.countryCount}</td>
                            <td className="px-6 py-4 text-sm text-right text-slate-700">{row.regionCount}</td>
                            <td className="px-6 py-4 text-sm text-right font-mono text-slate-700">{formatCurrency(row.spend)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                  <h3 className="font-bold text-slate-900">Vendor Consolidation Opportunities</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    Identify services with high supplier fragmentation and consolidation potential.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Service</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Countries</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Suppliers</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Spend</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-center">Opportunity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {vendorConsolidationOpportunities.slice(0, 12).map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 text-sm font-medium text-slate-900">{row.service}</td>
                          <td className="px-6 py-4 text-sm text-right text-slate-700">{row.countryCount}</td>
                          <td className="px-6 py-4 text-sm text-right text-slate-700 font-bold">{row.supplierCount}</td>
                          <td className="px-6 py-4 text-sm text-right font-mono text-slate-700">{formatCurrency(row.spend)}</td>
                          <td className="px-6 py-4 text-center">
                            <span
                              className={cn(
                                'px-3 py-1 rounded-lg text-xs font-bold',
                                row.opportunity === 'High' && 'bg-red-100 text-red-700',
                                row.opportunity === 'Medium' && 'bg-amber-100 text-amber-700',
                                row.opportunity === 'Low' && 'bg-emerald-100 text-emerald-700'
                              )}
                            >
                              {row.opportunity}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                  <h3 className="font-bold text-slate-900">Vendor Rationalization Heatmap</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    Visual view of supplier duplication by country and service.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Country</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Service</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Supplier Count</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Spend</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-center">Heat Level</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {vendorRationalizationHeatmap.slice(0, 20).map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 text-sm font-medium text-slate-900">{row.country}</td>
                          <td className="px-6 py-4 text-sm text-slate-700">{row.service}</td>
                          <td className="px-6 py-4 text-sm text-right text-slate-700 font-bold">{row.supplierCount}</td>
                          <td className="px-6 py-4 text-sm text-right font-mono text-slate-700">{formatCurrency(row.spend)}</td>
                          <td className="px-6 py-4 text-center">
                            <span
                              className={cn(
                                'px-3 py-1 rounded-lg text-xs font-bold',
                                row.level === 'High' && 'bg-red-100 text-red-700',
                                row.level === 'Medium' && 'bg-amber-100 text-amber-700',
                                row.level === 'Low' && 'bg-emerald-100 text-emerald-700'
                              )}
                            >
                              {row.level === 'High' ? '🔴 High' : row.level === 'Medium' ? '🟡 Medium' : '🟢 Low'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Phase 3: Preferred Vendor Strategy Layer */}
              <div className="mt-12 mb-8">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-200">
                    <Target size={20} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Preferred Vendor Strategy</h2>
                    <p className="text-slate-500 text-sm">Phase 3: Decision Support & Rationalization Recommendations</p>
                  </div>
                </div>
              </div>

              {/* Phase 3 KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                      <CheckCircle2 size={24} />
                    </div>
                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full uppercase tracking-wider">Target</span>
                  </div>
                  <div className="text-3xl font-bold text-slate-900 mb-1">{preferredVendorStats.standardizationCandidates}</div>
                  <div className="text-sm font-medium text-slate-500">Standardization Candidates</div>
                  <div className="mt-4 text-xs text-slate-400 leading-relaxed">
                    Country-service groups where a clear preferred vendor exists.
                  </div>
                </div>

                <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600">
                      <AlertCircle size={24} />
                    </div>
                    <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-full uppercase tracking-wider">Review</span>
                  </div>
                  <div className="text-3xl font-bold text-slate-900 mb-1">{preferredVendorStats.manualReviewItems}</div>
                  <div className="text-sm font-medium text-slate-500">Manual Reviews Required</div>
                  <div className="mt-4 text-xs text-slate-400 leading-relaxed">
                    Complex cases where multiple strong vendors compete for dominance.
                  </div>
                </div>

                <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                      <TrendingUp size={24} />
                    </div>
                    <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full uppercase tracking-wider">Opportunity</span>
                  </div>
                  <div className="text-3xl font-bold text-slate-900 mb-1">{formatCurrency(preferredVendorStats.totalSavingsOpportunity)}</div>
                  <div className="text-sm font-medium text-slate-500">Est. Savings Opportunity</div>
                  <div className="mt-4 text-xs text-slate-400 leading-relaxed">
                    Potential savings from consolidating to preferred vendors (est. 15%).
                  </div>
                </div>

                <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-600">
                      <Zap size={24} />
                    </div>
                    <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-1 rounded-full uppercase tracking-wider">Leverage</span>
                  </div>
                  <div className="text-3xl font-bold text-slate-900 mb-1">{preferredVendorStats.highNegotiationTargets}</div>
                  <div className="text-sm font-medium text-slate-500">High Leverage Vendors</div>
                  <div className="mt-4 text-xs text-slate-400 leading-relaxed">
                    Suppliers with high global footprint but fragmented local spend.
                  </div>
                </div>
              </div>

              {/* Phase 3 AI Quick Prompts */}
              <div className="bg-indigo-50/50 border border-indigo-100 rounded-[2.5rem] p-8 mb-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg">
                    <Sparkles size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900">Strategy Recommendation Prompts</h3>
                    <p className="text-sm text-slate-500">Use AI to refine your vendor rationalization roadmap.</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[
                    {
                      title: "Standardization Roadmap",
                      prompt: "Based on the Preferred Vendor Recommendations, create a 12-month roadmap to standardize Internet Providers in Europe. Which countries should we start with?",
                      icon: <MapIcon size={18} />
                    },
                    {
                      title: "Negotiation Strategy",
                      prompt: "Look at the High Negotiation Opportunity vendors. For the top 3, what specific leverage points do we have based on their global vs local footprint?",
                      icon: <MessageSquare size={18} />
                    },
                    {
                      title: "Risk vs Rationalization",
                      prompt: "Compare the Dependency Risk report with the Rationalization recommendations. Are there any preferred vendors that actually represent a high dependency risk?",
                      icon: <ShieldAlert size={18} />
                    }
                  ].map((item, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setActiveTab('analyst');
                        setUserInput(item.prompt);
                      }}
                      className="flex flex-col items-start p-5 bg-white border border-slate-200 rounded-2xl hover:border-indigo-300 hover:shadow-md transition-all text-left group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 mb-3 transition-colors">
                        {item.icon}
                      </div>
                      <div className="font-bold text-slate-900 text-sm mb-1">{item.title}</div>
                      <div className="text-xs text-slate-500 line-clamp-2">{item.prompt}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Action Priority Dashboard */}
              <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden mb-8">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-4">
                  <div>
                    <h3 className="font-bold text-slate-900">Action Priority Dashboard</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Where leadership should focus first based on complexity, spend, and savings potential.
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Country</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Service</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Suppliers</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Total Spend</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Est. Savings</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-center">Priority</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {actionPriorityReport.slice(0, 10).map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 text-sm font-medium text-slate-900">{row.country}</td>
                          <td className="px-6 py-4 text-sm text-slate-700">{row.service}</td>
                          <td className="px-6 py-4 text-sm text-right text-slate-700 font-bold">{row.supplierCount}</td>
                          <td className="px-6 py-4 text-sm text-right font-mono text-slate-700">{formatCurrency(row.totalSpend)}</td>
                          <td className="px-6 py-4 text-sm text-right font-mono text-emerald-600 font-bold">{formatCurrency(row.savingsOpportunity)}</td>
                          <td className="px-6 py-4 text-center">
                            <span
                              className={cn(
                                'px-3 py-1 rounded-lg text-xs font-bold',
                                row.priority === 'High' && 'bg-rose-100 text-rose-700',
                                row.priority === 'Medium' && 'bg-amber-100 text-amber-700',
                                row.priority === 'Low' && 'bg-slate-100 text-slate-700'
                              )}
                            >
                              {row.priority}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Country-Service Rationalization Table */}
              <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden mb-8">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-4">
                  <div>
                    <h3 className="font-bold text-slate-900">Country-Service Rationalization Recommendations</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Recommended preferred vendor for each country-service group.
                    </p>
                  </div>
                  <button
                    onClick={exportPreferredVendorRecommendations}
                    className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors"
                  >
                    <Download size={14} /> Export Strategy
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Country</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Service</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Preferred Vendor</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Local Share</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Global Footprint</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Recommended Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {preferredVendorRecommendations.slice(0, 15).map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 text-sm font-medium text-slate-900">{row.country}</td>
                          <td className="px-6 py-4 text-sm text-slate-700">{row.service}</td>
                          <td className="px-6 py-4 text-sm font-bold text-indigo-600">{row.preferredSupplier}</td>
                          <td className="px-6 py-4 text-sm text-right text-slate-700">{row.preferredLocalShare.toFixed(1)}%</td>
                          <td className="px-6 py-4 text-sm text-right text-slate-500 text-xs">
                            {row.rankedSuppliers[0]?.globalCountryCount || 0} Countries | {row.rankedSuppliers[0]?.globalServiceCount || 0} Services
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={cn(
                                'px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider',
                                row.action === 'Standardize to Preferred Supplier' && 'bg-emerald-100 text-emerald-700',
                                row.action === 'Review Manually' && 'bg-amber-100 text-amber-700',
                                row.action === 'Keep As-Is' && 'bg-slate-100 text-slate-600'
                              )}
                            >
                              {row.action}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Negotiation Opportunity Table */}
              <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-4">
                  <div>
                    <h3 className="font-bold text-slate-900">Negotiation Opportunity Score</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Suppliers where we have high global leverage but fragmented local presence.
                    </p>
                  </div>
                  <button
                    onClick={exportNegotiationOpportunityReport}
                    className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors"
                  >
                    <Download size={14} /> Export Leverage
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Supplier</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Global Countries</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Global Services</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Global Spend Share</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-center">Opportunity Level</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {negotiationOpportunityReport.slice(0, 12).map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 text-sm font-medium text-slate-900">{row.supplier}</td>
                          <td className="px-6 py-4 text-sm text-right text-slate-700">{row.countryCount}</td>
                          <td className="px-6 py-4 text-sm text-right text-slate-700">{row.serviceCount}</td>
                          <td className="px-6 py-4 text-sm text-right text-slate-700 font-bold">{row.spendShare.toFixed(1)}%</td>
                          <td className="px-6 py-4 text-center">
                            <span
                              className={cn(
                                'px-3 py-1 rounded-lg text-xs font-bold',
                                row.opportunityLevel === 'High' && 'bg-rose-100 text-rose-700',
                                row.opportunityLevel === 'Medium' && 'bg-amber-100 text-amber-700',
                                row.opportunityLevel === 'Low' && 'bg-slate-100 text-slate-700'
                              )}
                            >
                              {row.opportunityLevel}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </main>

        <AnimatePresence>
          {showUploadChoice && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="bg-white rounded-[2.5rem] p-10 max-w-lg w-full shadow-2xl border border-slate-200 space-y-8"
              >
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="p-4 rounded-3xl bg-rose-50 text-rose-600">
                    <Database size={40} />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">New Data Detected</h2>
                  <p className="text-slate-500 leading-relaxed">
                    You have {pendingData.length.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} new transactions. How would you like to proceed with the existing data?
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <button 
                    onClick={handleMerge}
                    className="flex items-center justify-between p-6 rounded-3xl border-2 border-slate-100 hover:border-rose-500 hover:bg-rose-50 transition-all group text-left"
                  >
                    <div>
                      <p className="font-bold text-slate-900">Merge with Existing</p>
                      <p className="text-xs text-slate-500">Add new records to your current dataset and remove duplicates.</p>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-100 group-hover:bg-rose-600 group-hover:text-white transition-colors">
                      <ArrowRight size={20} />
                    </div>
                  </button>

                  <button 
                    onClick={handleReplace}
                    className="flex items-center justify-between p-6 rounded-3xl border-2 border-slate-100 hover:border-red-500 hover:bg-red-50 transition-all group text-left"
                  >
                    <div>
                      <p className="font-bold text-slate-900">Replace & Analyze New</p>
                      <p className="text-xs text-slate-500">Discard old data and only analyze the newly uploaded transactions.</p>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-100 group-hover:bg-red-600 group-hover:text-white transition-colors">
                      <Trash2 size={20} />
                    </div>
                  </button>
                </div>

                <button 
                  onClick={() => setShowUploadChoice(false)}
                  className="w-full py-3 text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors"
                >
                  Cancel Upload
                </button>
              </motion.div>
            </motion.div>
          )}

          {fileToDelete && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="bg-white rounded-[2.5rem] p-10 max-w-lg w-full shadow-2xl border border-slate-200 space-y-8"
              >
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="p-4 rounded-3xl bg-red-50 text-red-600">
                    <Trash2 size={40} />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">Delete File Data?</h2>
                  <p className="text-slate-500 leading-relaxed">
                    Are you sure you want to delete all transactions associated with <span className="font-bold text-slate-900">"{fileToDelete}"</span>? This action cannot be undone.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => setFileToDelete(null)}
                    className="py-4 rounded-2xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={confirmDeleteFile}
                    className="py-4 rounded-2xl bg-red-600 text-white font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-200"
                  >
                    Delete Data
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}

          {budgetFileToDelete && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="bg-white rounded-[2.5rem] p-10 max-w-lg w-full shadow-2xl border border-slate-200 space-y-8"
              >
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="p-4 rounded-3xl bg-red-50 text-red-600">
                    <Trash2 size={40} />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">Delete Budget Data?</h2>
                  <p className="text-slate-500 leading-relaxed">
                    Are you sure you want to delete all budget records associated with <span className="font-bold text-slate-900">"{budgetFileToDelete}"</span>? This action cannot be undone.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => setBudgetFileToDelete(null)}
                    className="py-4 rounded-2xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={confirmDeleteBudgetFile}
                    className="py-4 rounded-2xl bg-red-600 text-white font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-200"
                  >
                    Delete Data
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}

          {showClearAllModal && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="bg-white rounded-[2.5rem] p-10 max-w-lg w-full shadow-2xl border border-slate-200 space-y-8"
              >
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="p-4 rounded-3xl bg-red-50 text-red-600">
                    <Trash2 size={40} />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">Clear All Data?</h2>
                  <p className="text-slate-500 leading-relaxed">
                    This will remove all ingested transactions, budget files, and history. This action cannot be undone.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => setShowClearAllModal(false)}
                    className="py-4 rounded-2xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => {
                      setUploadedFileContents([]);
                      setBudgetData([]);
                      setLastAnalysisResult(null);
                      setChatMessages([]);
                      setSelectedYear('All Years');
                      setActiveTab('dashboard');
                      setMomThreshold(35);
                      setFilters({
                        fiscalYear: [],
                        yearMonth: [],
                        region: [],
                        country: [],
                        station: [],
                        supplier: [],
                        category: [],
                        itCategory: [],
                        budgetCategory: [],
                        budgetItem: [],
                        budgetType: [],
                        costCenter: [],
                        glAccount: [],
                        search: ''
                      });
                      localStorage.removeItem(STORAGE_KEYS.uiState);
                      localStorage.removeItem(STORAGE_KEYS.expenditureMeta);
                      localStorage.removeItem(STORAGE_KEYS.budgetMeta);
                      setShowClearAllModal(false);
                    }}
                    className="py-4 rounded-2xl bg-red-600 text-white font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-200"
                  >
                    Clear Everything
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}

          {showBudgetSuccess && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm overflow-y-auto"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="bg-white rounded-[2.5rem] p-10 max-w-2xl w-full shadow-2xl border border-slate-200 space-y-8 my-8"
              >
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="p-4 rounded-3xl bg-emerald-50 text-emerald-600">
                    <FileSpreadsheet size={40} />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">Budget Processing Summary</h2>
                  <p className="text-slate-500 leading-relaxed">
                    Successfully processed <span className="font-bold text-slate-900">{showBudgetSuccess.masterDataset.length}</span> budget records across {showBudgetSuccess.summary.totalSheets} regions.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 space-y-2">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Total Budget</span>
                    <div className="text-2xl font-bold text-slate-900">{formatCurrency(showBudgetSuccess.summary.totalBudget)}</div>
                  </div>
                  <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 space-y-2">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Sheets Processed</span>
                    <div className="text-2xl font-bold text-slate-900">{showBudgetSuccess.summary.totalSheets} Regions</div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest">Budget by Region</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {Object.entries(showBudgetSuccess.summary.budgetByRegion).map(([region, amount]) => (
                      <div key={region} className="p-3 bg-white border border-slate-100 rounded-2xl shadow-sm">
                        <div className="text-[10px] font-bold text-slate-400 uppercase">{region}</div>
                        <div className="text-sm font-bold text-slate-900">{formatCurrency(amount)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest">CAPEX vs OPEX</h3>
                    <div className="space-y-2">
                      {Object.entries(showBudgetSuccess.summary.budgetByType).map(([type, amount]) => (
                        <div key={type} className="flex items-center justify-between p-3 bg-slate-50 rounded-2xl">
                          <span className="text-xs font-medium text-slate-600">{type}</span>
                          <span className="text-sm font-bold text-slate-900">{formatCurrency(amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest">Top Categories</h3>
                    <div className="space-y-2">
                      {showBudgetSuccess.summary.topCategories.map(({ category, amount }) => (
                        <div key={category} className="flex items-center justify-between p-3 bg-slate-50 rounded-2xl">
                          <span className="text-xs font-medium text-slate-600 truncate max-w-[120px]">{category}</span>
                          <span className="text-sm font-bold text-slate-900">{formatCurrency(amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {showBudgetSuccess.validationIssues.length > 0 && (
                  <div className="p-6 bg-amber-50 rounded-3xl border border-amber-100 space-y-3">
                    <div className="flex items-center gap-2 text-amber-700">
                      <AlertTriangle size={18} />
                      <h3 className="text-sm font-bold uppercase tracking-widest">Validation Report</h3>
                    </div>
                    <div className="max-h-32 overflow-y-auto space-y-2">
                      {showBudgetSuccess.validationIssues.map((issue, idx) => (
                        <div key={idx} className="text-xs text-amber-800 flex gap-2">
                          <span className="font-bold">[{issue.sheet}]</span>
                          <span>{issue.issue}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button 
                  onClick={() => setShowBudgetSuccess(null)}
                  className="w-full py-4 rounded-2xl bg-rose-600 text-white font-bold hover:bg-rose-700 transition-colors shadow-lg shadow-rose-200"
                >
                  Close Summary & View Dashboard
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

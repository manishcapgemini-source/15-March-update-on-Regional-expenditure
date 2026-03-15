import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';
import { FinancialTransaction, BudgetRecord, VarianceRecord, ComputedResult } from './types';

type ChartConfig = {
  type: 'chart';
  chart: 'bar' | 'line' | 'pie';
  title?: string;
  x: string;
  y: 'usd' | 'budgetUsd' | 'variance';
  top?: number;
  filters?: {
    region?: string;
    country?: string;
    category?: string;
    itCategory?: string;
  };
};

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

const formatChartCurrency = (value: unknown) => {
  const num = Number(value || 0);
  if (Number.isNaN(num)) return '$0';
  return `$${num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

function getMonthSortValue(month: string): number {
  const m = String(month || '').trim().toLowerCase();

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

  return 999999;
}

export default function DynamicChart({
  config,
  actualData,
  budgetData,
  varianceData,
  analysisResult
}: {
  config?: ChartConfig | null;
  actualData?: FinancialTransaction[];
  budgetData?: BudgetRecord[];
  varianceData?: VarianceRecord[];
  analysisResult?: ComputedResult | null;
}) {
  const isAIChartMode = !!analysisResult?.chartReady;

  const chartMeta = useMemo(() => {
    if (isAIChartMode && analysisResult) {
      const isTimeSeries = analysisResult.answerType === 'timeseries' || !!analysisResult.monthlyTrend?.length;

      return {
        chartType: isTimeSeries ? 'line' : 'bar',
        title: analysisResult.title || 'Analysis Chart',
        label: 'Value'
      };
    }

    return {
      chartType: config?.chart || 'bar',
      title: config?.title || 'Chart',
      label:
        config?.y === 'usd'
          ? 'Actual Spend'
          : config?.y === 'budgetUsd'
            ? 'Budget'
            : 'Variance'
    };
  }, [analysisResult, config, isAIChartMode]);

  const chartData = useMemo(() => {
    if (isAIChartMode && analysisResult) {
      if (analysisResult.monthlyTrend?.length) {
        return [...analysisResult.monthlyTrend]
          .map(item => ({
            name: item.month,
            value: Number(item.value || 0),
            actual: Number(item.actual || 0),
            budget: Number(item.budget || 0),
            variance: Number(item.variance || 0)
          }))
          .sort((a, b) => getMonthSortValue(a.name) - getMonthSortValue(b.name));
      }

      if (analysisResult.topResults?.length) {
        return [...analysisResult.topResults].map(item => ({
          name: item.name,
          value: Number(item.value || 0),
          actual: Number(item.actual || 0),
          budget: Number(item.budget || 0),
          variance: Number(item.variance || 0)
        }));
      }

      return [];
    }

    if (!config || config.type !== 'chart') return [];

    const grouped: Record<string, number> = {};
    const xField = config.x;
    const yField = config.y;

    let sourceData: Record<string, any>[] = [];
    let valueField = '';

    if (yField === 'usd') {
      sourceData = Array.isArray(actualData) ? actualData : [];
      valueField = 'usd';
    } else if (yField === 'budgetUsd') {
      sourceData = Array.isArray(budgetData) ? budgetData : [];
      valueField = 'budget';
    } else if (yField === 'variance') {
      sourceData = Array.isArray(varianceData) ? varianceData : [];
      valueField = 'variance';
    }

    let filtered = sourceData;
    if (config.filters) {
      filtered = sourceData.filter((item) => {
        if (config.filters?.region && String(item?.region || '') !== config.filters.region) return false;

        const itemCountry = String(item?.country || item?.station || '');
        if (config.filters?.country && itemCountry !== config.filters.country) return false;

        if (config.filters?.category && String(item?.category || '') !== config.filters.category) return false;
        if (config.filters?.itCategory && String(item?.itCategory || '') !== config.filters.itCategory) return false;

        return true;
      });
    }

    filtered.forEach((row) => {
      const key = String(row?.[xField] || 'Unknown').trim() || 'Unknown';
      const rawValue = Number(row?.[valueField] || 0);
      if (!Number.isNaN(rawValue)) {
        grouped[key] = (grouped[key] || 0) + rawValue;
      }
    });

    let result = Object.entries(grouped)
      .map(([name, value]) => ({ name, value }))
      .filter((item) => item.name && !Number.isNaN(item.value));

    if (config.chart === 'line' && (config.x === 'yearMonth' || config.x === 'month')) {
      result.sort((a, b) => getMonthSortValue(a.name) - getMonthSortValue(b.name));
    } else {
      result.sort((a, b) => b.value - a.value);
    }

    if (config.top && config.top > 0) {
      result = result.slice(0, config.top);
    }

    return result;
  }, [config, actualData, budgetData, varianceData, analysisResult, isAIChartMode]);

  if (!isAIChartMode && (!config || config.type !== 'chart')) {
    return (
      <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50 text-sm text-amber-700">
        Invalid chart configuration received.
      </div>
    );
  }

  if (!chartData.length) {
    return (
      <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-500">
        No data available for this chart.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h4 className="text-base font-bold text-slate-900">{chartMeta.title}</h4>

      <div className="w-full h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          {chartMeta.chartType === 'bar' ? (
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" angle={-20} textAnchor="end" height={80} interval={0} />
              <YAxis tickFormatter={(value) => formatChartCurrency(value)} />
              <Tooltip formatter={(value: number) => [formatChartCurrency(value), chartMeta.label]} />
              <Legend />
              <Bar dataKey="value" name={chartMeta.label} fill="#6366f1" />
            </BarChart>
          ) : chartMeta.chartType === 'line' ? (
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis tickFormatter={(value) => formatChartCurrency(value)} />
              <Tooltip formatter={(value: number) => [formatChartCurrency(value), chartMeta.label]} />
              <Legend />
              <Line type="monotone" dataKey="value" name={chartMeta.label} stroke="#6366f1" strokeWidth={2} />
            </LineChart>
          ) : (
            <PieChart>
              <Tooltip formatter={(value: number) => [formatChartCurrency(value), chartMeta.label]} />
              <Legend />
              <Pie data={chartData} dataKey="value" nameKey="name" outerRadius={140} label>
                {chartData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

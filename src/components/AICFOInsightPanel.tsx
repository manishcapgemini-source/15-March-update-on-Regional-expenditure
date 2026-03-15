import React, { useMemo } from 'react';
import { BrainCircuit, TrendingUp, AlertTriangle, DollarSign, Building2, Globe } from 'lucide-react';
import { FinancialTransaction, BudgetRecord, VarianceRecord } from '../types';
import { formatCurrency } from '../utils/formatters';

type Props = {
  actualData: FinancialTransaction[];
  budgetData: BudgetRecord[];
  varianceData: VarianceRecord[];
};

export default function AICFOInsightPanel({
  actualData,
  budgetData,
  varianceData
}: Props) {
  const summary = useMemo(() => {
    const totalActual = actualData.reduce((sum, row) => sum + (row.usd || 0), 0);
    const totalBudget = budgetData.reduce((sum, row) => sum + (row.budget || 0), 0);
    const totalVariance = totalActual - totalBudget;
    const budgetUsedPct = totalBudget > 0 ? (totalActual / totalBudget) * 100 : 0;

    const topRegionMap: Record<string, number> = {};
    actualData.forEach((row) => {
      const key = row.region || 'Unknown';
      topRegionMap[key] = (topRegionMap[key] || 0) + (row.usd || 0);
    });
    const topRegion = Object.entries(topRegionMap)
      .sort((a, b) => b[1] - a[1])[0];

    const topSupplierMap: Record<string, number> = {};
    actualData.forEach((row) => {
      const key = row.supplier || 'Unknown';
      topSupplierMap[key] = (topSupplierMap[key] || 0) + (row.usd || 0);
    });
    const topSupplier = Object.entries(topSupplierMap)
      .sort((a, b) => b[1] - a[1])[0];

    const overspendByCategory: Record<
      string,
      { itCategory: string; region: string; variance: number }
    > = {};

    varianceData.forEach((row) => {
      if ((row.variance || 0) > 0) {
        const key = row.itCategory || 'Unknown';
        if (!overspendByCategory[key]) {
          overspendByCategory[key] = {
            itCategory: row.itCategory || 'Unknown',
            region: row.region || 'Unknown',
            variance: 0,
          };
        }
        overspendByCategory[key].variance += row.variance || 0;
      }
    });

    const largestOverspend = Object.values(overspendByCategory).sort(
      (a, b) => b.variance - a.variance
    )[0];

    const recommendation = largestOverspend
      ? `Priority action: review ${largestOverspend.itCategory} in ${
          largestOverspend.region
        }, currently overspent by ${formatCurrency(
          largestOverspend.variance
        )}. Check whether the variance is caused by supplier pricing, scope expansion, or incorrect budget mapping, and decide whether to contain spend or formally revise the budget.`
      : totalBudget > 0 && budgetUsedPct < 80
      ? `Spending is currently within budget. Management should review whether low-utilized budget lines can be reallocated to higher-risk categories, while continuing to monitor major suppliers and high-spend regions.`
      : totalBudget > 0 && budgetUsedPct >= 100
      ? `Budget utilization has reached or exceeded plan. Immediate review is recommended for high-spend regions, top suppliers, and IT categories to prevent year-end overspend.`
      : `Review spending trend, validate budget allocation quality, and confirm whether actual and budget mappings are aligned correctly.`;

    return {
      totalActual,
      totalBudget,
      totalVariance,
      budgetUsedPct,
      topRegion,
      topSupplier,
      largestOverspend,
      recommendation
    };
  }, [actualData, budgetData, varianceData]);

  return (
    <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-8 space-y-6">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl bg-rose-600 text-white shadow-lg shadow-rose-200">
          <BrainCircuit size={24} />
        </div>
        <div>
          <h3 className="text-xl font-black text-slate-900">AI CFO Insight Panel</h3>
          <p className="text-sm text-slate-500">Executive financial summary generated from current dashboard data</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-widest">
            <DollarSign size={14} />
            Actual Spend
          </div>
          <div className="mt-3 text-2xl font-black text-slate-900">
            {formatCurrency(summary.totalActual)}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-widest">
            <TrendingUp size={14} />
            Budget
          </div>
          <div className="mt-3 text-2xl font-black text-slate-900">
            {formatCurrency(summary.totalBudget)}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-widest">
            <AlertTriangle size={14} />
            Variance
          </div>
          <div className={`mt-3 text-2xl font-black ${summary.totalVariance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
            {formatCurrency(summary.totalVariance)}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-widest">
            <TrendingUp size={14} />
            Budget Used
          </div>
          <div className={`mt-3 text-2xl font-black ${summary.budgetUsedPct > 100 ? 'text-rose-600' : 'text-slate-900'}`}>
            {summary.budgetUsedPct.toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-5">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-blue-600">
            <Globe size={14} />
            Highest Spend Region
          </div>
          <div className="mt-2 text-lg font-bold text-slate-900">
            {summary.topRegion?.[0] || 'N/A'}
          </div>
          <div className="mt-1 text-sm text-slate-600">
            {summary.topRegion ? `${formatCurrency(summary.topRegion[1])} total spend` : 'No data'}
          </div>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-amber-600">
            <Building2 size={14} />
            Top Supplier
          </div>
          <div className="mt-2 text-lg font-bold text-slate-900">
            {summary.topSupplier?.[0] || 'N/A'}
          </div>
          <div className="mt-1 text-sm text-slate-600">
            {summary.topSupplier ? `${formatCurrency(summary.topSupplier[1])} total spend` : 'No data'}
          </div>
        </div>

        <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-5">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-rose-600">
            <AlertTriangle size={14} />
            Largest Overspend
          </div>
          <div className="mt-2 text-lg font-bold text-slate-900">
            {summary.largestOverspend?.itCategory || 'None'}
          </div>
          <div className="mt-1 text-sm text-slate-600">
            {summary.largestOverspend
              ? `${formatCurrency(summary.largestOverspend.variance)} above budget`
              : 'No overspend detected'}
          </div>
        </div>
      </div>

      <div className="rounded-[2rem] border border-slate-200 bg-gradient-to-r from-slate-50 to-rose-50 p-6">
        <div className="text-xs font-black uppercase tracking-widest text-slate-500">AI CFO Recommendation</div>
        <p className="mt-3 text-base leading-relaxed text-slate-700">
          {summary.recommendation}
        </p>
      </div>
    </div>
  );
}

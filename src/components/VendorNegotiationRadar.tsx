import React, { useMemo } from 'react';
import { Handshake, Building2, AlertTriangle } from 'lucide-react';
import { FinancialTransaction } from '../types';
import { formatCurrency } from '../utils/formatters';

type VendorRow = {
  supplier: string;
  totalSpend: number;
  transactionCount: number;
  primaryCategory: string;
  primaryItCategory: string;
  sharePct: number;
  recommendation: string;
};

type Props = {
  actualData: FinancialTransaction[];
};

export default function VendorNegotiationRadar({ actualData }: Props) {
  const vendorRows = useMemo<VendorRow[]>(() => {
    const totalSpendAll = actualData.reduce((sum, row) => sum + (row.usd || 0), 0);

    const supplierMap = new Map<
      string,
      {
        totalSpend: number;
        transactionCount: number;
        categoryMap: Record<string, number>;
        itCategoryMap: Record<string, number>;
      }
    >();

    actualData.forEach((row) => {
      const supplier = row.supplier?.trim() || 'Unknown Supplier';
      const category = row.category?.trim() || 'Unknown';
      const itCategory = row.itCategory?.trim() || 'Unknown';

      if (!supplierMap.has(supplier)) {
        supplierMap.set(supplier, {
          totalSpend: 0,
          transactionCount: 0,
          categoryMap: {},
          itCategoryMap: {},
        });
      }

      const current = supplierMap.get(supplier)!;
      current.totalSpend += row.usd || 0;
      current.transactionCount += 1;
      current.categoryMap[category] = (current.categoryMap[category] || 0) + (row.usd || 0);
      current.itCategoryMap[itCategory] = (current.itCategoryMap[itCategory] || 0) + (row.usd || 0);
    });

    const rows: VendorRow[] = Array.from(supplierMap.entries()).map(([supplier, stats]) => {
      const primaryCategory =
        Object.entries(stats.categoryMap).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

      const primaryItCategory =
        Object.entries(stats.itCategoryMap).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

      const sharePct = totalSpendAll > 0 ? (stats.totalSpend / totalSpendAll) * 100 : 0;

      let recommendation = 'Monitor';
      if (stats.totalSpend > 500000 && /connectivity|internet|telephony|cloud/i.test(primaryItCategory)) {
        recommendation = 'Renegotiate now';
      } else if (stats.totalSpend > 300000) {
        recommendation = 'Review contract';
      } else if (sharePct > 10) {
        recommendation = 'Check concentration';
      }

      return {
        supplier,
        totalSpend: stats.totalSpend,
        transactionCount: stats.transactionCount,
        primaryCategory,
        primaryItCategory,
        sharePct,
        recommendation,
      };
    });

    return rows
      .filter((row) => row.totalSpend > 100000 || row.sharePct > 5)
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .slice(0, 8);
  }, [actualData]);

  if (vendorRows.length === 0) {
    return null;
  }

  return (
    <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl bg-amber-500 text-white shadow-lg shadow-amber-200">
          <Handshake size={24} />
        </div>
        <div>
          <h3 className="text-xl font-black text-slate-900">Vendor Negotiation Radar</h3>
          <p className="text-sm text-slate-500">
            Suppliers with high spend, concentration, or renegotiation potential
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-100">
        <table className="w-full text-left border-collapse min-w-[900px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Supplier</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Spend</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Share %</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Transactions</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Primary Category</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Primary IT Category</th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Recommendation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {vendorRows.map((row) => (
              <tr key={row.supplier} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-slate-100 text-slate-500 mt-0.5">
                      <Building2 size={16} />
                    </div>
                    <div className="text-sm font-bold text-slate-900 max-w-[280px] break-words">
                      {row.supplier}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-right font-bold text-slate-900">
                  {formatCurrency(row.totalSpend)}
                </td>
                <td className="px-6 py-4 text-sm text-right font-semibold text-slate-700">
                  {row.sharePct.toFixed(1)}%
                </td>
                <td className="px-6 py-4 text-sm text-right text-slate-600">
                  {row.transactionCount}
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">
                  {row.primaryCategory}
                </td>
                <td className="px-6 py-4 text-sm text-slate-600">
                  {row.primaryItCategory}
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-widest ${
                      row.recommendation === 'Renegotiate now'
                        ? 'bg-red-50 text-red-600'
                        : row.recommendation === 'Review contract'
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-blue-50 text-blue-700'
                    }`}
                  >
                    <AlertTriangle size={12} />
                    {row.recommendation}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

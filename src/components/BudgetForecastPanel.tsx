import React, { useMemo } from "react";
import { CalendarClock, DollarSign } from "lucide-react";
import { FinancialTransaction, BudgetRecord } from "../types";
import { formatCurrency } from "../utils/formatters";

type Props = {
  actualData: FinancialTransaction[];
  budgetData: BudgetRecord[];
};

export default function BudgetForecastPanel({ actualData, budgetData }: Props) {

  const forecast = useMemo(() => {

    const totalActual = actualData.reduce((sum, r) => sum + (r.usd || 0), 0);
    const totalBudget = budgetData.reduce((sum, r) => sum + (r.budget || 0), 0);

    const months = new Set(
      actualData.map(r => r.yearMonth).filter(Boolean)
    ).size || 1;

    const runRate = totalActual / months;

    const forecastYearEnd = runRate * 12;

    const expectedVariance = forecastYearEnd - totalBudget;

    return {
      totalActual,
      totalBudget,
      months,
      runRate,
      forecastYearEnd,
      expectedVariance
    };

  }, [actualData, budgetData]);

  return (
    <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">

      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200">
          <CalendarClock size={24} />
        </div>
        <div>
          <h3 className="text-xl font-black text-slate-900">
            Budget Forecast Panel
          </h3>
          <p className="text-sm text-slate-500">
            Projected year-end spend based on current run rate
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">

        <Card title="Actual Spend" icon={<DollarSign size={14}/>}>
          {formatCurrency(forecast.totalActual)}
        </Card>

        <Card title="Budget">
          {formatCurrency(forecast.totalBudget)}
        </Card>

        <Card title="Run Rate / Month">
          {formatCurrency(forecast.runRate)}
        </Card>

        <Card title="Forecast Year End">
          {formatCurrency(forecast.forecastYearEnd)}
        </Card>

        <Card title="Expected Variance">
          <span className={forecast.expectedVariance > 0 ? "text-red-600" : "text-green-600"}>
            {formatCurrency(forecast.expectedVariance)}
          </span>
        </Card>

      </div>
    </div>
  );
}

function Card({ title, children }: any) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">
        {title}
      </div>
      <div className="mt-3 text-xl font-black text-slate-900">
        {children}
      </div>
    </div>
  );
}

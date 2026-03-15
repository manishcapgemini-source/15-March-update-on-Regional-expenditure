import { FinanceIntent, ParsedQuestion } from "../types";

type ClarificationRule = {
  key: "categoryMeaning" | "defaultMetric" | "nonItLogic";
  value: string;
  source: "user_confirmation" | "system_default";
};

function normalize(value: string) {
  return String(value || "").trim().toLowerCase();
}

function hasAny(q: string, terms: string[]) {
  return terms.some(term => q.includes(term));
}

function detectOutputMode(question: string): "text" | "chart" | "table" {
  const q = normalize(question);
  if (hasAny(q, ["graph", "chart", "plot", "visualize", "visual"])) return "chart";
  if (hasAny(q, ["table", "tabular", "list"])) return "table";
  return "text";
}

export function buildFinanceIntent(
  question: string,
  parsed: ParsedQuestion,
  isFollowUp: boolean,
  clarificationRules: ClarificationRule[]
): FinanceIntent {
  const q = normalize(question);

  let businessIntent: FinanceIntent["businessIntent"] = "lookup";

  if (hasAny(q, ["graph", "chart", "plot", "visualize"])) {
    businessIntent = "chart";
  } else if (hasAny(q, ["burn rate", "run rate", "projection", "forecast year end"])) {
    businessIntent = "burn_rate";
  } else if (hasAny(q, ["overspend", "over budget", "expensive", "high spend"])) {
    businessIntent = "overspend";
  } else if (hasAny(q, ["trend", "over time", "monthly trend", "month wise"])) {
    businessIntent = "trend";
  } else if (hasAny(q, ["distribution", "distributed", "mix", "allocation", "spread"])) {
    businessIntent = "distribution";
  } else if (hasAny(q, ["breakdown", "split", "under which", "for each"])) {
    businessIntent = "breakdown";
  } else if (hasAny(q, ["compare", "vs", "versus", "against"])) {
    businessIntent = "comparison";
  } else if (hasAny(q, ["anomaly", "outlier", "unusual", "spike"])) {
    businessIntent = "anomaly";
  }

  let primaryDimension: FinanceIntent["primaryDimension"] =
    (parsed.groupBy as FinanceIntent["primaryDimension"]) || "overall";

  const categoryMeaningRule = clarificationRules.find(r => r.key === "categoryMeaning");
  if (primaryDimension === "category" && categoryMeaningRule?.value === "itCategory") {
    primaryDimension = "itCategory";
  }

  return {
    businessIntent,
    metric: parsed.metric,
    primaryDimension,
    filters: parsed.filters,
    ranking: parsed.ranking,
    limit: parsed.limit,
    outputMode: detectOutputMode(question),
    followUp: isFollowUp
  };
}

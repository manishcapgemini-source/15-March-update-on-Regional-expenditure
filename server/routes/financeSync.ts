import express from "express";
import { readFinanceData, writeFinanceData, clearFinanceData } from "../services/financeStore.ts";
import { validatePayload } from "../services/financeValidator.ts";

const router = express.Router();

// Middleware to check API key
const API_KEY = "finance_secret_123";
const checkApiKey = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const apiKey = req.header("X-API-KEY");
  if (apiKey !== API_KEY) {
    return res.status(401).json({
      status: "error",
      message: "Unauthorized"
    });
  }
  next();
};

router.post("/sync-excel", checkApiKey, (req, res) => {
  const errors = validatePayload(req.body);

  if (errors.length > 0) {
    return res.status(400).json({
      status: "error",
      message: "Validation failed",
      errors
    });
  }

  const payload = {
    fileName: req.body.fileName || "Unknown",
    lastSyncAt: new Date().toISOString(),
    submittedAt: req.body.submittedAt || null,
    version: req.body.version || "1.0",
    actual: req.body.actual || [],
    budget: req.body.budget || []
  };

  writeFinanceData(payload);

  return res.json({
    status: "success",
    message: "Finance data synced successfully",
    actualRows: payload.actual.length,
    budgetRows: payload.budget.length,
    lastSyncAt: payload.lastSyncAt
  });
});

router.get("/latest-data", (req, res) => {
  const data = readFinanceData();

  return res.json({
    status: "success",
    ...data
  });
});

router.get("/sync-status", (req, res) => {
  const data = readFinanceData();

  return res.json({
    status: "success",
    fileName: data.fileName,
    lastSyncAt: data.lastSyncAt,
    actualRows: Array.isArray(data.actual) ? data.actual.length : 0,
    budgetRows: Array.isArray(data.budget) ? data.budget.length : 0
  });
});

router.post("/clear-data", checkApiKey, (req, res) => {
  clearFinanceData();

  return res.json({
    status: "success",
    message: "Stored finance data cleared"
  });
});

export default router;

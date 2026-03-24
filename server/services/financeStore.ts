import fs from "fs";
import path from "path";

const DATA_FILE = path.join(process.cwd(), "server/data/latest-finance-data.json");

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({
        fileName: null,
        lastSyncAt: null,
        actual: [],
        budget: []
      }, null, 2)
    );
  }
}

export function readFinanceData(): any {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  return JSON.parse(raw);
}

export function writeFinanceData(data: any) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export function clearFinanceData() {
  writeFinanceData({
    fileName: null,
    lastSyncAt: null,
    actual: [],
    budget: []
  });
}

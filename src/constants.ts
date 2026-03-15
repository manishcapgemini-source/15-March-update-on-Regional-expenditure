// All valid station codes used in budget sheets
export const STATION_CODES = [
  "PRG","ABY","BRX","TRF","LEX","LNN","LON","SKY","WLV","DBC","XMS","UDC",
  "BAH","ADC","DXB","AIL","AIS","AUH",
  "RUH","JED","DHA","DOH","KWI","MCT","ALM","TUU","DWC",
  "CMB","DAC","PNQ","INDIA",
  "ALR","AEL","CAI","CAS","CMN","KRT","TIP","TUN","BEY","IST","TBS","AMM","RMM","BGD","EBL",
  "DAR","EBB","NBO","ACC","LOS","JNB",
  "JFK","LAX","IAH","YYZ"
];

// Map station/location codes to countries
export const LOCATION_TO_COUNTRY_MAP: Record<string, string> = {
  RUH: "Saudi Arabia",
  JED: "Saudi Arabia",

  DXB: "UAE",
  AUH: "UAE",

  BAH: "Bahrain",
  DOH: "Qatar",
  MCT: "Oman",
  KWI: "Kuwait",

  DAR: "Tanzania",
  EBB: "Uganda",
  NBO: "Kenya",
  LUN: "Zambia",
  HRE: "Zimbabwe",
  LOS: "Nigeria",
  ACC: "Ghana",
  JNB: "South Africa",
  CPT: "South Africa",

  CAI: "Egypt",
  AMM: "Jordan",
  BEY: "Lebanon",

  KHI: "Pakistan",
  LHE: "Pakistan",
  ISB: "Pakistan",

  DEL: "India",
  BOM: "India",
  BLR: "India",
  MAA: "India",
  HYD: "India",
  CCU: "India",

  LHR: "United Kingdom",
  FRA: "Germany",
  CDG: "France",
  MAD: "Spain",
  MXP: "Italy",
  AMS: "Netherlands",
  ZRH: "Switzerland",
  VIE: "Austria",
  BRU: "Belgium",
  DUB: "Ireland"
};

// Helper to validate station codes
export function isStationCode(value: string): boolean {
  return STATION_CODES.includes(value.toUpperCase());
}

// Helper to get country from station
export function getCountryFromStation(station: string): string {
  return LOCATION_TO_COUNTRY_MAP[station] || "Unknown";
}

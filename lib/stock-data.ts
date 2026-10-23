import type { QuoteProvenance } from './market-quote';
export interface HistoricalPrice {
  date: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type StockHistory = HistoricalPrice;

export interface Stock extends Partial<QuoteProvenance> {
  ticker: string;
  name: string;
  currentPrice: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
  history: StockHistory[];
  isFallback?: boolean;
  sector?: string;
  marketCap?: number; // in ₹ Crores
}

export const STOCK_METADATA: Record<string, { sector: string; marketCap: number }> = {
  RELIANCE: { sector: "Conglomerate & Energy", marketCap: 1980000 },
  TCS: { sector: "Technology", marketCap: 1420000 },
  HDFCBANK: { sector: "Banking & Finance", marketCap: 1280000 },
  INFY: { sector: "Technology", marketCap: 640000 },
  ICICIBANK: { sector: "Banking & Finance", marketCap: 830000 },
  ITC: { sector: "FMCG & Retail", marketCap: 530000 },
  SBIN: { sector: "Banking & Finance", marketCap: 730000 },
  BHARTIARTL: { sector: "Telecom & Networking", marketCap: 820000 },
  LTIM: { sector: "Technology", marketCap: 152000 },
  LT: { sector: "Infrastructure & Heavy Engineering", marketCap: 480000 },
  KOTAKBANK: { sector: "Banking & Finance", marketCap: 350000 },
  HINDUNILVR: { sector: "FMCG & Retail", marketCap: 570000 },
  MARUTI: { sector: "Automotive", marketCap: 380000 },
  TATASTEEL: { sector: "Metals & Mining", marketCap: 210000 },
  WIPRO: { sector: "Technology", marketCap: 250000 },
  AXISBANK: { sector: "Banking & Finance", marketCap: 360000 },
  ASIANPAINT: { sector: "Chemicals & Paints", marketCap: 270000 },
  "M&M": { sector: "Automotive & Conglomerate", marketCap: 340000 },
  BAJFINANCE: { sector: "Banking & Finance", marketCap: 420000 },
  SUNPHARMA: { sector: "Healthcare & Pharma", marketCap: 360000 },
  ADANIENT: { sector: "Conglomerate & Infra", marketCap: 350000 },
  NTPC: { sector: "Utilities & Energy", marketCap: 360000 },
  ONGC: { sector: "Utilities & Energy", marketCap: 330000 },
  TITAN: { sector: "FMCG & Retail", marketCap: 290000 },
  TATAMOTORS: { sector: "Automotive", marketCap: 340000 },
  ETERNAL: { sector: "Diversified Products", marketCap: 12400 },
  AVENUESAI: { sector: "Technology & AI Services", marketCap: 8400 },
  IRCON: { sector: "Infrastructure & Heavy Engineering", marketCap: 25400 },
  PFS: { sector: "Banking & Finance", marketCap: 2900 },
  IRFC: { sector: "Banking & Finance", marketCap: 228000 },
  SUZLON: { sector: "Utilities & Energy", marketCap: 88000 },
  SWIGGY: { sector: "Consumer Services & Tech", marketCap: 95000 },
  JSWCEMENT: { sector: "Cement & Building Materials", marketCap: 18500 },
  IGI: { sector: "FMCG & Retail", marketCap: 15400 },
  DLINK: { sector: "Telecom & Networking", marketCap: 1400 },
  ITCHOTELS: { sector: "Hospitality & Tourism", marketCap: 24500 },
  TMPV: { sector: "Automotive", marketCap: 11000 },
  ATHER: { sector: "Automotive", marketCap: 9800 },
  RBA: { sector: "Consumer Services & Tech", marketCap: 5200 },
  DEEPAKBUILD: { sector: "Infrastructure & Heavy Engineering", marketCap: 2100 },
  GROWW: { sector: "Banking & Finance", marketCap: 25000 },
  AFCONS: { sector: "Infrastructure & Heavy Engineering", marketCap: 18400 },
  HIGHWAY: { sector: "Infrastructure & Heavy Engineering", marketCap: 9800 },
  ABCAPITAL: { sector: "Banking & Finance", marketCap: 54000 },
  GOPAL: { sector: "FMCG & Retail", marketCap: 4200 },
  JIOFIN: { sector: "Banking & Finance", marketCap: 220000 },
  OLAELEC: { sector: "Automotive", marketCap: 34000 },
  INFOBEAN: { sector: "Technology", marketCap: 1200 },
  ADITYAINFO: { sector: "Technology & AI Services", marketCap: 1100 },
  NSDL: { sector: "Banking & Finance", marketCap: 41000 },
  GNGELEC: { sector: "Consumer Services & Tech", marketCap: 900 },
  VISHAL: { sector: "FMCG & Retail", marketCap: 154000 },
  ENVIROINFRA: { sector: "Infrastructure & Heavy Engineering", marketCap: 2100 },
  ANTHEM: { sector: "Healthcare & Pharma", marketCap: 18200 },
  SALASAR: { sector: "Infrastructure & Heavy Engineering", marketCap: 6800 },
  SHANTIGOLD: { sector: "FMCG & Retail", marketCap: 1200 },
  MEESHO: { sector: "Consumer Services & Tech", marketCap: 42000 },
  ANANTRAJ: { sector: "Real Estate", marketCap: 14500 },
  JUPITERWAG: { sector: "Infrastructure & Heavy Engineering", marketCap: 25500 },
  RPOWER: { sector: "Utilities & Energy", marketCap: 12000 },
  NHPC: { sector: "Utilities & Energy", marketCap: 102000 },
  IOB: { sector: "Banking & Finance", marketCap: 122000 },
  GTLINFRA: { sector: "Telecom & Networking", marketCap: 3200 },
  PNB: { sector: "Banking & Finance", marketCap: 138000 },
  ACMESOLAR: { sector: "Utilities & Energy", marketCap: 14500 },
  PREMIERENE: { sector: "Utilities & Energy", marketCap: 49000 },
  ABSLAMC: { sector: "Banking & Finance", marketCap: 17800 },
  CANBK: { sector: "Banking & Finance", marketCap: 107000 },
  IDEA: { sector: "Telecom & Networking", marketCap: 82000 },
  DEVYANI: { sector: "Consumer Services & Tech", marketCap: 20400 },
  TATAPOWER: { sector: "Utilities & Energy", marketCap: 140000 },
  RVNL: { sector: "Infrastructure & Heavy Engineering", marketCap: 85000 },
  CUPID: { sector: "Healthcare & Pharma", marketCap: 1100 },
  MOREPENLAB: { sector: "Healthcare & Pharma", marketCap: 2500 }
};

export const INITIAL_STOCKS: Stock[] = [
  {
    ticker: "CUPID",
    name: "Cupid Ltd.",
    currentPrice: 85.50,
    change: 2.10,
    changePercent: 2.51,
    high: 86.20,
    low: 83.10,
    volume: 1250000,
    history: generateInitialHistory(85.50)
  },
  {
    ticker: "MOREPENLAB",
    name: "Morepen Laboratories Ltd.",
    currentPrice: 75.30,
    change: -1.20,
    changePercent: -1.56,
    high: 77.00,
    low: 74.80,
    volume: 2400000,
    history: generateInitialHistory(75.30)
  },
  {
    ticker: "RELIANCE",
    name: "Reliance Industries Ltd.",
    currentPrice: 1257.5,
    change: 6.54,
    changePercent: 0.52,
    high: 1276.36,
    low: 1238.64,
    volume: 5800000,
    history: generateInitialHistory(1257.5)
  },
  {
    ticker: "TCS",
    name: "Tata Consultancy Services Ltd.",
    currentPrice: 2200.8,
    change: -25.53,
    changePercent: -1.16,
    high: 2233.81,
    low: 2167.79,
    volume: 2100000,
    history: generateInitialHistory(2200.8)
  },
  {
    ticker: "HDFCBANK",
    name: "HDFC Bank Ltd.",
    currentPrice: 708.25,
    change: 3.54,
    changePercent: 0.5,
    high: 718.87,
    low: 697.63,
    volume: 8900000,
    history: generateInitialHistory(708.25)
  },
  {
    ticker: "INFY",
    name: "Infosys Ltd.",
    currentPrice: 1037.7,
    change: 15.05,
    changePercent: 1.45,
    high: 1053.27,
    low: 1022.13,
    volume: 4500000,
    history: generateInitialHistory(1037.7)
  },
  {
    ticker: "ICICIBANK",
    name: "ICICI Bank Ltd.",
    currentPrice: 1379.3,
    change: 2.21,
    changePercent: 0.16,
    high: 1399.99,
    low: 1358.61,
    volume: 6200000,
    history: generateInitialHistory(1379.3)
  },
  {
    ticker: "ITC",
    name: "ITC Ltd.",
    currentPrice: 259.85,
    change: -1.4,
    changePercent: -0.54,
    high: 263.75,
    low: 255.95,
    volume: 12500000,
    history: generateInitialHistory(259.85)
  },
  {
    ticker: "SBIN",
    name: "State Bank of India",
    currentPrice: 995.7,
    change: -7.27,
    changePercent: -0.73,
    high: 1010.64,
    low: 980.76,
    volume: 11000000,
    history: generateInitialHistory(995.7)
  },
  {
    ticker: "BHARTIARTL",
    name: "Bharti Airtel Ltd.",
    currentPrice: 1831.1,
    change: 15.02,
    changePercent: 0.82,
    high: 1858.57,
    low: 1803.63,
    volume: 3800000,
    history: generateInitialHistory(1831.1)
  },
  {
    ticker: "LTIM",
    name: "LTIMindtree Ltd.",
    currentPrice: 5150.00,
    change: 72.40,
    changePercent: 1.43,
    high: 5185.00,
    low: 5060.00,
    volume: 850000,
    history: generateInitialHistory(5150.00)
  },
  {
    ticker: "LT",
    name: "Larsen & Toubro Ltd.",
    currentPrice: 3930.7,
    change: 37.34,
    changePercent: 0.95,
    high: 3989.66,
    low: 3871.74,
    volume: 1800000,
    history: generateInitialHistory(3930.7)
  },
  {
    ticker: "KOTAKBANK",
    name: "Kotak Mahindra Bank Ltd.",
    currentPrice: 419,
    change: -2.89,
    changePercent: -0.69,
    high: 425.28,
    low: 412.71,
    volume: 2400000,
    history: generateInitialHistory(419)
  },
  {
    ticker: "HINDUNILVR",
    name: "Hindustan Unilever Ltd.",
    currentPrice: 1927,
    change: 14.45,
    changePercent: 0.75,
    high: 1955.9,
    low: 1898.1,
    volume: 1100000,
    history: generateInitialHistory(1927)
  },
  {
    ticker: "MARUTI",
    name: "Maruti Suzuki India Ltd.",
    currentPrice: 12400,
    change: -96.72,
    changePercent: -0.78,
    high: 12586,
    low: 12214,
    volume: 450000,
    history: generateInitialHistory(12400)
  },
  {
    ticker: "TATASTEEL",
    name: "Tata Steel Ltd.",
    currentPrice: 183,
    change: 2.29,
    changePercent: 1.25,
    high: 185.74,
    low: 180.25,
    volume: 22000000,
    history: generateInitialHistory(183)
  },
  {
    ticker: "WIPRO",
    name: "Wipro Ltd.",
    currentPrice: 167.4,
    change: -1.21,
    changePercent: -0.72,
    high: 169.91,
    low: 164.89,
    volume: 3500000,
    history: generateInitialHistory(167.4)
  },
  {
    ticker: "AXISBANK",
    name: "Axis Bank Ltd.",
    currentPrice: 1246,
    change: 15.7,
    changePercent: 1.26,
    high: 1264.69,
    low: 1227.31,
    volume: 5100000,
    history: generateInitialHistory(1246)
  },
  {
    ticker: "ASIANPAINT",
    name: "Asian Paints Ltd.",
    currentPrice: 2472.5,
    change: -23.98,
    changePercent: -0.97,
    high: 2509.59,
    low: 2435.41,
    volume: 980000,
    history: generateInitialHistory(2472.5)
  },
  {
    ticker: "M&M",
    name: "Mahindra & Mahindra Ltd.",
    currentPrice: 3107,
    change: 50.64,
    changePercent: 1.63,
    high: 3153.6,
    low: 3060.39,
    volume: 1900000,
    history: generateInitialHistory(3107)
  },
  {
    ticker: "BAJFINANCE",
    name: "Bajaj Finance Ltd.",
    currentPrice: 1034.5,
    change: 12.93,
    changePercent: 1.25,
    high: 1050.02,
    low: 1018.98,
    volume: 1200000,
    history: generateInitialHistory(1034.5)
  },
  {
    ticker: "SUNPHARMA",
    name: "Sun Pharmaceutical Industries Ltd.",
    currentPrice: 1840,
    change: -13.43,
    changePercent: -0.73,
    high: 1867.6,
    low: 1812.4,
    volume: 1600000,
    history: generateInitialHistory(1840)
  },
  {
    ticker: "ADANIENT",
    name: "Adani Enterprises Ltd.",
    currentPrice: 3060,
    change: -52.63,
    changePercent: -1.72,
    high: 3105.9,
    low: 3014.1,
    volume: 2800000,
    history: generateInitialHistory(3060)
  },
  {
    ticker: "NTPC",
    name: "NTPC Ltd.",
    currentPrice: 333.4,
    change: 4.1,
    changePercent: 1.23,
    high: 338.4,
    low: 328.4,
    volume: 8500000,
    history: generateInitialHistory(333.4)
  },
  {
    ticker: "ONGC",
    name: "Oil & Natural Gas Corporation Ltd.",
    currentPrice: 232.5,
    change: -1.56,
    changePercent: -0.67,
    high: 235.99,
    low: 229.01,
    volume: 9500000,
    history: generateInitialHistory(232.5)
  },
  {
    ticker: "TITAN",
    name: "Titan Company Ltd.",
    currentPrice: 5009.5,
    change: 37.07,
    changePercent: 0.74,
    high: 5084.64,
    low: 4934.36,
    volume: 1050000,
    history: generateInitialHistory(5009.5)
  },
  {
    ticker: "TATAMOTORS",
    name: "Tata Motors Ltd.",
    currentPrice: 960.00,
    change: 12.50,
    changePercent: 1.32,
    high: 968.00,
    low: 945.00,
    volume: 6500000,
    history: generateInitialHistory(960.00)
  },
  {
    ticker: "ETERNAL",
    name: "Eternal Industries Ltd.",
    currentPrice: 323.5,
    change: 5.76,
    changePercent: 1.78,
    high: 328.35,
    low: 318.65,
    volume: 1450000,
    history: generateInitialHistory(323.5)
  },
  {
    ticker: "AVENUESAI",
    name: "AvenuesAI Ltd.",
    currentPrice: 120.50,
    change: 1.20,
    changePercent: 1.01,
    high: 122.00,
    low: 119.10,
    volume: 850000,
    history: generateInitialHistory(120.50)
  },
  {
    ticker: "IRCON",
    name: "Ircon International Ltd.",
    currentPrice: 113.26,
    change: 1.44,
    changePercent: 1.27,
    high: 114.96,
    low: 111.56,
    volume: 1800000,
    history: generateInitialHistory(113.26)
  },
  {
    ticker: "PFS",
    name: "PTC India Financial Services Ltd.",
    currentPrice: 27.42,
    change: -0.48,
    changePercent: -1.74,
    high: 27.83,
    low: 27.01,
    volume: 1200000,
    history: generateInitialHistory(27.42)
  },
  {
    ticker: "IRFC",
    name: "Indian Railway Finance Corporation Ltd.",
    currentPrice: 81.09,
    change: 0.98,
    changePercent: 1.21,
    high: 82.31,
    low: 79.87,
    volume: 4500000,
    history: generateInitialHistory(81.09)
  },
  {
    ticker: "SUZLON",
    name: "Suzlon Energy Ltd.",
    currentPrice: 44.12,
    change: 0.58,
    changePercent: 1.32,
    high: 44.78,
    low: 43.46,
    volume: 15000000,
    history: generateInitialHistory(44.12)
  },
  {
    ticker: "SWIGGY",
    name: "Swiggy Ltd.",
    currentPrice: 278.2,
    change: 7.96,
    changePercent: 2.86,
    high: 282.37,
    low: 274.03,
    volume: 2500000,
    history: generateInitialHistory(278.2)
  },
  {
    ticker: "JSWCEMENT",
    name: "JSW Cement Ltd.",
    currentPrice: 118.87,
    change: 0.59,
    changePercent: 0.5,
    high: 120.65,
    low: 117.09,
    volume: 500000,
    history: generateInitialHistory(118.87)
  },
  {
    ticker: "IGI",
    name: "International Gemological Institute Ltd.",
    currentPrice: 300.00,
    change: 5.00,
    changePercent: 1.69,
    high: 305.00,
    low: 292.00,
    volume: 750000,
    history: generateInitialHistory(300.00)
  },
  {
    ticker: "DLINK",
    name: "D-Link (India) Ltd.",
    currentPrice: 380.00,
    change: -4.50,
    changePercent: -1.17,
    high: 388.00,
    low: 375.00,
    volume: 450000,
    history: generateInitialHistory(380.00)
  },
  {
    ticker: "ITCHOTELS",
    name: "ITC Hotels Ltd.",
    currentPrice: 153.69,
    change: 0.77,
    changePercent: 0.5,
    high: 156,
    low: 151.38,
    volume: 300000,
    history: generateInitialHistory(153.69)
  },
  {
    ticker: "TMPV",
    name: "Tata Motors Passenger Vehicles Ltd.",
    currentPrice: 301.1,
    change: 3.82,
    changePercent: 1.27,
    high: 305.62,
    low: 296.58,
    volume: 900000,
    history: generateInitialHistory(301.1)
  },
  {
    ticker: "ATHER",
    name: "Ather Energy Ltd.",
    currentPrice: 280.00,
    change: -2.00,
    changePercent: -0.71,
    high: 286.00,
    low: 277.50,
    volume: 600000,
    history: generateInitialHistory(280.00)
  },
  {
    ticker: "RBA",
    name: "Restaurant Brands Asia Ltd.",
    currentPrice: 98.05,
    change: -1.11,
    changePercent: -1.13,
    high: 99.52,
    low: 96.58,
    volume: 1100000,
    history: generateInitialHistory(98.05)
  },
  {
    ticker: "DEEPAKBUILD",
    name: "Deepak Builders & Engineers India Ltd.",
    currentPrice: 210.00,
    change: 4.20,
    changePercent: 2.04,
    high: 215.00,
    low: 204.00,
    volume: 550000,
    history: generateInitialHistory(210.00)
  },
  {
    ticker: "GROWW",
    name: "Groww (Billionbrains Garage Ventures)",
    currentPrice: 200.24,
    change: 6.19,
    changePercent: 3.09,
    high: 203.24,
    low: 197.24,
    volume: 1000000,
    history: generateInitialHistory(200.24)
  },
  {
    ticker: "AFCONS",
    name: "Afcons Infrastructure Ltd.",
    currentPrice: 253.8,
    change: 4.77,
    changePercent: 1.88,
    high: 257.61,
    low: 249.99,
    volume: 1300000,
    history: generateInitialHistory(253.8)
  },
  {
    ticker: "HIGHWAY",
    name: "Highway Infrastructure Trust",
    currentPrice: 115.00,
    change: -0.50,
    changePercent: -0.43,
    high: 116.20,
    low: 114.10,
    volume: 250000,
    history: generateInitialHistory(115.00)
  },
  {
    ticker: "ABCAPITAL",
    name: "Aditya Birla Capital Ltd.",
    currentPrice: 395,
    change: 5.69,
    changePercent: 1.44,
    high: 400.92,
    low: 389.07,
    volume: 3200000,
    history: generateInitialHistory(395)
  },
  {
    ticker: "GOPAL",
    name: "Gopal Snacks Ltd.",
    currentPrice: 257.35,
    change: -4.01,
    changePercent: -1.56,
    high: 261.21,
    low: 253.49,
    volume: 400000,
    history: generateInitialHistory(257.35)
  },
  {
    ticker: "JIOFIN",
    name: "Jio Financial Services Ltd.",
    currentPrice: 229.9,
    change: 3.2,
    changePercent: 1.39,
    high: 233.35,
    low: 226.45,
    volume: 8500000,
    history: generateInitialHistory(229.9)
  },
  {
    ticker: "OLAELEC",
    name: "Ola Electric Mobility Ltd.",
    currentPrice: 38.54,
    change: -0.73,
    changePercent: -1.89,
    high: 39.12,
    low: 37.96,
    volume: 5800000,
    history: generateInitialHistory(38.54)
  },
  {
    ticker: "INFOBEAN",
    name: "InfoBeans Technologies Ltd.",
    currentPrice: 154.01,
    change: 5.05,
    changePercent: 3.28,
    high: 156.32,
    low: 151.7,
    volume: 150000,
    history: generateInitialHistory(154.01)
  },
  {
    ticker: "ADITYAINFO",
    name: "Aditya Infotech Ltd.",
    currentPrice: 150.00,
    change: 0.00,
    changePercent: 0.00,
    high: 152.00,
    low: 147.00,
    volume: 100000,
    history: generateInitialHistory(150.00)
  },
  {
    ticker: "NSDL",
    name: "NSDL (National Securities Depository Ltd.)",
    currentPrice: 420.00,
    change: 6.50,
    changePercent: 1.57,
    high: 426.00,
    low: 412.00,
    volume: 800000,
    history: generateInitialHistory(420.00)
  },
  {
    ticker: "GNGELEC",
    name: "GNG Electronics Ltd.",
    currentPrice: 90.00,
    change: -1.20,
    changePercent: -1.32,
    high: 92.40,
    low: 88.50,
    volume: 200000,
    history: generateInitialHistory(90.00)
  },
  {
    ticker: "VISHAL",
    name: "Vishal Mega Mart Ltd.",
    currentPrice: 18.36,
    change: 0.61,
    changePercent: 3.31,
    high: 18.64,
    low: 18.08,
    volume: 1400000,
    history: generateInitialHistory(18.36)
  },
  {
    ticker: "ENVIROINFRA",
    name: "Enviro Infra Engineers Ltd.",
    currentPrice: 160.00,
    change: 2.40,
    changePercent: 1.52,
    high: 163.50,
    low: 157.00,
    volume: 650000,
    history: generateInitialHistory(160.00)
  },
  {
    ticker: "ANTHEM",
    name: "Anthem Biosciences Ltd.",
    currentPrice: 940.9,
    change: -16.47,
    changePercent: -1.75,
    high: 955.01,
    low: 926.79,
    volume: 350000,
    history: generateInitialHistory(940.9)
  },
  {
    ticker: "SALASAR",
    name: "Salasar Techno Engineering Ltd.",
    currentPrice: 5.05,
    change: 0.11,
    changePercent: 2.19,
    high: 5.13,
    low: 4.97,
    volume: 4200000,
    history: generateInitialHistory(5.05)
  },
  {
    ticker: "SHANTIGOLD",
    name: "Shanti Gold International Ltd.",
    currentPrice: 258.17,
    change: 1.29,
    changePercent: 0.5,
    high: 262.04,
    low: 254.3,
    volume: 180000,
    history: generateInitialHistory(258.17)
  },
  {
    ticker: "MEESHO",
    name: "Meesho Ltd.",
    currentPrice: 217.08,
    change: 4.54,
    changePercent: 2.09,
    high: 220.34,
    low: 213.82,
    volume: 1200000,
    history: generateInitialHistory(217.08)
  },
  {
    ticker: "ANANTRAJ",
    name: "Anant Raj Ltd.",
    currentPrice: 598.35,
    change: -9.63,
    changePercent: -1.61,
    high: 607.33,
    low: 589.37,
    volume: 950000,
    history: generateInitialHistory(598.35)
  },
  {
    ticker: "JUPITERWAG",
    name: "Jupiter Wagons Ltd.",
    currentPrice: 620.00,
    change: 14.30,
    changePercent: 2.36,
    high: 628.00,
    low: 605.00,
    volume: 1100000,
    history: generateInitialHistory(620.00)
  },
  {
    ticker: "RPOWER",
    name: "Reliance Power Ltd.",
    currentPrice: 21.58,
    change: -0.35,
    changePercent: -1.64,
    high: 21.9,
    low: 21.26,
    volume: 25000000,
    history: generateInitialHistory(21.58)
  },
  {
    ticker: "NHPC",
    name: "NHPC Ltd.",
    currentPrice: 76.38,
    change: 0.83,
    changePercent: 1.09,
    high: 77.53,
    low: 75.23,
    volume: 18000000,
    history: generateInitialHistory(76.38)
  },
  {
    ticker: "IOB",
    name: "Indian Overseas Bank",
    currentPrice: 33.07,
    change: -0.4,
    changePercent: -1.22,
    high: 33.57,
    low: 32.57,
    volume: 9200000,
    history: generateInitialHistory(33.07)
  },
  {
    ticker: "GTLINFRA",
    name: "GTL Infrastructure Ltd.",
    currentPrice: 1.16,
    change: 0.05,
    changePercent: 4.17,
    high: 1.18,
    low: 1.14,
    volume: 45000000,
    history: generateInitialHistory(1.16)
  },
  {
    ticker: "PNB",
    name: "Punjab National Bank",
    currentPrice: 116.75,
    change: -2.11,
    changePercent: -1.81,
    high: 118.5,
    low: 115,
    volume: 14000000,
    history: generateInitialHistory(116.75)
  },
  {
    ticker: "ACMESOLAR",
    name: "Acme Solar Holdings Ltd.",
    currentPrice: 402.3,
    change: 5.95,
    changePercent: 1.48,
    high: 408.33,
    low: 396.27,
    volume: 1200000,
    history: generateInitialHistory(402.3)
  },
  {
    ticker: "PREMIERENE",
    name: "Premier Energies Ltd.",
    currentPrice: 974.2,
    change: 32.05,
    changePercent: 3.29,
    high: 988.81,
    low: 959.59,
    volume: 1950000,
    history: generateInitialHistory(974.2)
  },
  {
    ticker: "ABSLAMC",
    name: "Aditya Birla Sun Life AMC Ltd.",
    currentPrice: 1109.9,
    change: -14.87,
    changePercent: -1.34,
    high: 1126.55,
    low: 1093.25,
    volume: 450000,
    history: generateInitialHistory(1109.9)
  },
  {
    ticker: "CANBK",
    name: "Canara Bank",
    currentPrice: 124,
    change: 0.84,
    changePercent: 0.68,
    high: 125.86,
    low: 122.14,
    volume: 11000000,
    history: generateInitialHistory(124)
  },
  {
    ticker: "IDEA",
    name: "Vodafone Idea Ltd.",
    currentPrice: 14.97,
    change: -0.31,
    changePercent: -2.04,
    high: 15.19,
    low: 14.75,
    volume: 85000000,
    history: generateInitialHistory(14.97)
  },
  {
    ticker: "DEVYANI",
    name: "Devyani International Ltd.",
    currentPrice: 137.97,
    change: -1.45,
    changePercent: -1.05,
    high: 140.04,
    low: 135.9,
    volume: 1600000,
    history: generateInitialHistory(137.97)
  },
  {
    ticker: "TATAPOWER",
    name: "Tata Power Company Ltd.",
    currentPrice: 364.65,
    change: 5.73,
    changePercent: 1.57,
    high: 370.12,
    low: 359.18,
    volume: 5200000,
    history: generateInitialHistory(364.65)
  },
  {
    ticker: "RVNL",
    name: "Rail Vikas Nigam Ltd.",
    currentPrice: 204.9,
    change: 6.43,
    changePercent: 3.14,
    high: 207.97,
    low: 201.83,
    volume: 8800000,
    history: generateInitialHistory(204.9)
  }
];

function generateInitialHistory(currentPrice: number): StockHistory[] {
  const history: StockHistory[] = [];
  let price = currentPrice;
  const date = new Date();
  
  for (let i = 0; i <= 260; i++) {
    const d = new Date(date);
    d.setDate(date.getDate() - i);
    const dateStr = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    
    const finalPrice = Number(price.toFixed(2));
    // Add to the front of the array since we are working backwards in time
    history.unshift({
      date: dateStr,
      price: finalPrice,
      open: Number((finalPrice * 0.995).toFixed(2)),
      high: Number((finalPrice * 1.01).toFixed(2)),
      low: Number((finalPrice * 0.99).toFixed(2)),
      close: finalPrice,
      volume: Math.floor(Math.random() * 500000) + 100000
    });
    
    // Tracing backwards: reverse a random walk with positive drift (0.55 up, 0.45 down)
    const changePercent = (Math.random() - 0.45) * 0.015; // -0.675% to +0.825%
    price = price / (1 + changePercent);
  }
  
  return history;
}

export function simulatePriceUpdate(stocks: Stock[]): Stock[] {
  return stocks.map(stock => {
    // Small random price movement (-0.5% to +0.5%)
    const pctChange = (Math.random() - 0.5) * 0.01;
    const oldPrice = stock.currentPrice;
    const newPrice = Number((oldPrice * (1 + pctChange)).toFixed(2));
    
    // Ensure price remains positive
    if (newPrice <= 0) return stock;

    const change = Number((newPrice - (oldPrice - stock.change)).toFixed(2));
    // Calculate new base price reference (initial price of the day)
    const basePrice = oldPrice - stock.change;
    const changePercent = Number(((newPrice - basePrice) / basePrice * 100).toFixed(2));
    
    const high = Number(Math.max(stock.high, newPrice).toFixed(2));
    const low = Number(Math.min(stock.low, newPrice).toFixed(2));
    
    // Add new data point to history, updating the last item or adding a new one
    const history = [...stock.history];
    if (history.length > 0) {
      const last = history[history.length - 1];
      const todayStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      const itemToUpdateOrAdd = {
        date: todayStr,
        price: newPrice,
        open: last ? last.open : Number((newPrice * 0.995).toFixed(2)),
        high: Number(Math.max(last ? last.high : newPrice, newPrice).toFixed(2)),
        low: Number(Math.min(last ? last.low : newPrice, newPrice).toFixed(2)),
        close: newPrice,
        volume: (last ? last.volume : 100000) + Math.floor(Math.random() * 5000)
      };
      if (last.date === todayStr) {
        history[history.length - 1] = itemToUpdateOrAdd;
      } else {
        history.push(itemToUpdateOrAdd);
        if (history.length > 261) history.shift();
      }
    }

    return {
      ...stock,
      currentPrice: newPrice,
      change,
      changePercent,
      high,
      low,
      volume: stock.volume + Math.floor(Math.random() * 1000),
      history
    };
  });
}

/*
  ====================================================================================
  PLAIN ENGLISH TECHNICAL INDICATORS EXPLANATION (Required for suggestions & screener)
  ====================================================================================

  1. EXPONENTIAL MOVING AVERAGE (EMA):
     An Exponential Moving Average is a type of moving average that gives more weight to recent prices.
     This helps it react faster to new price trends than a Simple Moving Average (SMA), which weights
     all days equally. It is crucial for capturing short-term direction changes.

  2. MOVING AVERAGE CONVERGENCE DIVERGENCE (MACD):
     MACD is a classic trend-following momentum indicator. It is computed as:
     - MACD Line: 12-period EMA minus 26-period EMA.
     - Signal Line: A 9-period EMA of the MACD Line.
     - Histogram: MACD Line minus Signal Line.
     PLAIN ENGLISH LOGIC:
     - When the MACD Line is ABOVE the Signal Line (Histogram is positive), it means bullish momentum is building (BUY setup).
     - When the MACD Line is BELOW the Signal Line (Histogram is negative), it means bearish momentum is building (SELL setup).

  3. BOLLINGER BANDS:
     Bollinger Bands measure market volatility using standard deviation:
     - Middle Band: 20-period Simple Moving Average (SMA).
     - Upper Band: Middle Band plus 2 standard deviations.
     - Lower Band: Middle Band minus 2 standard deviations.
     PLAIN ENGLISH LOGIC:
     - When the price drops to or below the LOWER Band, the stock is statistically oversold. It is a potential
       area of support and bullish reversal (BUY/Accumulate setup).
     - When the price rises to or above the UPPER Band, the stock is statistically overbought. It is a potential
       area of resistance and bearish pullback (SELL/Distribution setup).
     - Within the bands, the market is in a normal consolidated or trending state.

  4. WEIGHTED SCORING SYSTEM:
     To avoid false signals from any single indicator, we compile a unified Weighted Score (ranging from -100 to +100):
     - SMA Crossover (30% weight): +30 points if short-term SMA(5) > medium-term SMA(15) [Bullish Trend], -30 points otherwise.
     - MACD Momentum (35% weight): +35 points if MACD Line > Signal Line [Bullish Momentum], -35 points otherwise.
     - Bollinger Bands (35% weight): +35 points if price is oversold (<= Lower Band) [Bullish Reversal],
       -35 points if price is overbought (>= Upper Band) [Bearish Reversal].
       If the price is between the bands, we add a minor trend alignment:
         - +10 points if price is in the lower half (recovering from support).
         - -10 points if price is in the upper half (cooling from resistance).
     
     VERDICT:
     - Score >= +25: BUY suggestion.
     - Score <= -25: SELL suggestion.
     - Between -25 and +25: HOLD suggestion.
     - Confidence: The magnitude of indicator agreement (strength of convergence), scaled between 30% and 100%.
*/

export interface MacdResult {
  macdLine: number;
  signalLine: number;
  histogram: number;
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

export interface BollingerBandsResult {
  middleBand: number;
  upperBand: number;
  lowerBand: number;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
}

export interface DetailedSuggestionResult {
  suggestion: 'BUY' | 'SELL' | 'HOLD';
  score: number;
  smaSignal: 'BUY' | 'SELL';
  macd: MacdResult;
  bollingerBands: BollingerBandsResult;
}

// Calculate Exponential Moving Average helper
export function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [];
  
  // Initialize first value with SMA or first price
  let currentEma = prices[0];
  ema.push(currentEma);
  
  for (let i = 1; i < prices.length; i++) {
    currentEma = prices[i] * k + currentEma * (1 - k);
    ema.push(currentEma);
  }
  return ema;
}

// Calculate Moving Average Convergence Divergence
export function calculateMACD(history: { price: number }[]): MacdResult {
  const prices = history.map(h => h.price);
  if (prices.length < 26) {
    return { macdLine: 0, signalLine: 0, histogram: 0, signal: 'NEUTRAL' };
  }
  
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  
  const macdLines: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    macdLines.push(ema12[i] - ema26[i]);
  }
  
  const signalLines = calculateEMA(macdLines, 9);
  
  const currentMacd = macdLines[macdLines.length - 1] || 0;
  const currentSignal = signalLines[signalLines.length - 1] || 0;
  const histogram = currentMacd - currentSignal;
  
  const signal = currentMacd > currentSignal ? 'BULLISH' : 'BEARISH';
  
  return {
    macdLine: Number(currentMacd.toFixed(3)),
    signalLine: Number(currentSignal.toFixed(3)),
    histogram: Number(histogram.toFixed(3)),
    signal
  };
}

// Calculate Bollinger Bands
export function calculateBollingerBands(
  history: { price: number }[],
  period = 20,
  numStdDev = 2
): BollingerBandsResult {
  const prices = history.map(h => h.price);
  const currentPrice = prices[prices.length - 1] || 0;
  
  if (prices.length < period) {
    return {
      middleBand: currentPrice,
      upperBand: currentPrice,
      lowerBand: currentPrice,
      signal: 'NEUTRAL'
    };
  }
  
  const slice = prices.slice(-period);
  const sum = slice.reduce((acc, curr) => acc + curr, 0);
  const middleBand = sum / period;
  
  const variance = slice.reduce((acc, curr) => acc + Math.pow(curr - middleBand, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  
  const upperBand = middleBand + numStdDev * stdDev;
  const lowerBand = middleBand - numStdDev * stdDev;
  
  let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
  if (currentPrice <= lowerBand) {
    signal = 'BUY';
  } else if (currentPrice >= upperBand) {
    signal = 'SELL';
  }
  
  return {
    middleBand: Number(middleBand.toFixed(2)),
    upperBand: Number(upperBand.toFixed(2)),
    lowerBand: Number(lowerBand.toFixed(2)),
    signal
  };
}

// Unified Suggester & Weighted Scoring Engine
export function calculateDetailedStockSuggestion(history: { price: number }[]): DetailedSuggestionResult {
  const fallbackResult: DetailedSuggestionResult = {
    suggestion: 'HOLD',
    score: 0,
    smaSignal: 'SELL',
    macd: { macdLine: 0, signalLine: 0, histogram: 0, signal: 'NEUTRAL' },
    bollingerBands: { middleBand: 0, upperBand: 0, lowerBand: 0, signal: 'NEUTRAL' }
  };

  if (!history || history.length < 20) {
    return fallbackResult;
  }

  const prices = history.map(h => h.price);
  const currentPrice = prices[prices.length - 1] || 0;

  // 1. SMA 5 vs SMA 15 Crossover (30% weight)
  const sma5Slice = history.slice(-5);
  const sma5 = sma5Slice.reduce((acc, curr) => acc + curr.price, 0) / 5;
  const sma15Slice = history.slice(-15);
  const sma15 = sma15Slice.reduce((acc, curr) => acc + curr.price, 0) / 15;
  const smaSignal = sma5 > sma15 ? 'BUY' : 'SELL';
  const smaPoints = smaSignal === 'BUY' ? 30 : -30;

  // 2. MACD Momentum (35% weight)
  const macd = calculateMACD(history);
  const macdPoints = macd.signal === 'BULLISH' ? 35 : -35;

  // 3. Bollinger Bands (35% weight)
  const bollingerBands = calculateBollingerBands(history);
  let bbPoints = 0;
  if (bollingerBands.signal === 'BUY') {
    bbPoints = 35; // Strongly Oversold (Bullish reversal buy setup)
  } else if (bollingerBands.signal === 'SELL') {
    bbPoints = -35; // Strongly Overbought (Bearish reversal sell setup)
  } else {
    // Normal channel positioning
    const { middleBand, upperBand, lowerBand } = bollingerBands;
    const range = upperBand - lowerBand;
    if (range > 0) {
      const relativePosition = (currentPrice - lowerBand) / range;
      if (relativePosition < 0.5) {
        bbPoints = 10; // In lower half (approaching support)
      } else {
        bbPoints = -10; // In upper half (approaching resistance)
      }
    }
  }

  // Aggregate weighted score (-100 to +100)
  const score = smaPoints + macdPoints + bbPoints;

  // Map score to Buy/Hold/Sell suggestion
  let suggestion: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  if (score >= 25) {
    suggestion = 'BUY';
  } else if (score <= -25) {
    suggestion = 'SELL';
  }

  return {
    suggestion,
    score,
    smaSignal,
    macd,
    bollingerBands
  };
}

export function getStockTrendSignal(history: { price: number }[]): 'BUY' | 'SELL' | 'HOLD' | 'NEUTRAL' {
  if (!history || history.length < 15) return 'NEUTRAL';
  const detailed = calculateDetailedStockSuggestion(history);
  return detailed.suggestion;
}

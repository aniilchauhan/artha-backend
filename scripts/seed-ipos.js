const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// 1. Parse .env.local file for MongoDB URI
const envPath = path.join(__dirname, '../.env.local');
let mongodbUri = process.env.MONGODB_URI;

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const lines = envContent.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const parts = trimmed.split('=');
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      if (key === 'MONGODB_URI') {
        mongodbUri = val;
      }
    }
  }
}

if (!mongodbUri) {
  console.error('ERROR: MONGODB_URI is not defined in environment variables or .env.local');
  process.exit(1);
}

// 2. Define Mongoose Schema
const IPOSchema = new mongoose.Schema(
  {
    ticker: { type: String, uppercase: true, trim: true, index: true },
    companyName: { type: String, required: true, trim: true },
    issueSize: { type: Number, required: true }, // ₹ Cr
    priceBand: { type: String, required: true }, // e.g. "₹450 - ₹475"
    minBidQuantity: { type: Number, default: 15 },
    openDate: { type: Date, required: true },
    closeDate: { type: Date, required: true },
    listingDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ['upcoming', 'active', 'closed', 'listed'],
      required: true,
      index: true
    },
    gmp: { type: Number, default: 0 },
    subscriptionRate: { type: Number, default: 0 },
    listingPrice: { type: Number },
    listingGainPercent: { type: Number }
  },
  { timestamps: true }
);

const IPO = mongoose.models.IPO || mongoose.model('IPO', IPOSchema);

// 3. Define Seed Data
const now = new Date();
const addDays = (d, days) => {
  const newDate = new Date(d);
  newDate.setDate(newDate.getDate() + days);
  return newDate;
};

const initialIPOs = [
  // 1. Upcoming IPOs
  {
    companyName: 'NTPC Green Energy Limited',
    ticker: 'NTPCGREEN',
    issueSize: 10000,
    priceBand: '₹102 - ₹108',
    minBidQuantity: 138,
    openDate: addDays(now, 3),
    closeDate: addDays(now, 6),
    listingDate: addDays(now, 12),
    status: 'upcoming',
    gmp: 18,
    subscriptionRate: 0
  },
  {
    companyName: 'PayZapp Financial Services',
    issueSize: 850,
    priceBand: '₹145 - ₹150',
    minBidQuantity: 100,
    openDate: addDays(now, 8),
    closeDate: addDays(now, 11),
    listingDate: addDays(now, 17),
    status: 'upcoming',
    gmp: 32,
    subscriptionRate: 0
  },
  {
    companyName: 'QuickMart Retail India',
    issueSize: 1200,
    priceBand: '₹210 - ₹225',
    minBidQuantity: 65,
    openDate: addDays(now, 12),
    closeDate: addDays(now, 15),
    listingDate: addDays(now, 21),
    status: 'upcoming',
    gmp: 45,
    subscriptionRate: 0
  },
  {
    companyName: 'HexaGen Biotech Labs',
    issueSize: 520,
    priceBand: '₹90 - ₹95',
    minBidQuantity: 150,
    openDate: addDays(now, 18),
    closeDate: addDays(now, 21),
    listingDate: addDays(now, 27),
    status: 'upcoming',
    gmp: 8,
    subscriptionRate: 0
  },
  // 2. Active IPOs
  {
    companyName: 'GreenPower Renewables Limited',
    issueSize: 2400,
    priceBand: '₹340 - ₹360',
    minBidQuantity: 40,
    openDate: addDays(now, -2),
    closeDate: addDays(now, 1),
    listingDate: addDays(now, 7),
    status: 'active',
    gmp: 85,
    subscriptionRate: 4.85
  },
  {
    companyName: 'Indus AgriTech Solutions',
    issueSize: 450,
    priceBand: '₹95 - ₹100',
    minBidQuantity: 150,
    openDate: addDays(now, 0), // Opens today
    closeDate: addDays(now, 3),
    listingDate: addDays(now, 9),
    status: 'active',
    gmp: 12,
    subscriptionRate: 1.25
  },
  // 3. Closed IPOs
  {
    companyName: 'SolarWave Infrastructure',
    issueSize: 1650,
    priceBand: '₹275 - ₹290',
    minBidQuantity: 50,
    openDate: addDays(now, -6),
    closeDate: addDays(now, -3),
    listingDate: addDays(now, 3), // Listing in 3 days
    status: 'closed',
    gmp: 58,
    subscriptionRate: 24.60
  },
  {
    companyName: 'FinTech One Applet',
    issueSize: 980,
    priceBand: '₹180 - ₹195',
    minBidQuantity: 75,
    openDate: addDays(now, -10),
    closeDate: addDays(now, -7),
    listingDate: addDays(now, 1), // Listing tomorrow
    status: 'closed',
    gmp: -4, // Trading at minor discount in grey market
    subscriptionRate: 1.08
  },
  // 4. Recently Listed IPOs
  {
    companyName: 'Swiggy Limited',
    ticker: 'SWIGGY',
    issueSize: 11327,
    priceBand: '₹371 - ₹390',
    minBidQuantity: 38,
    openDate: new Date('2024-11-06'),
    closeDate: new Date('2024-11-08'),
    listingDate: new Date('2024-11-13'),
    status: 'listed',
    gmp: 35,
    subscriptionRate: 3.59,
    listingPrice: 420.00,
    listingGainPercent: 7.69
  },
  {
    companyName: 'Ola Electric Mobility',
    ticker: 'OLAELEC',
    issueSize: 6145,
    priceBand: '₹72 - ₹76',
    minBidQuantity: 195,
    openDate: new Date('2024-08-02'),
    closeDate: new Date('2024-08-06'),
    listingDate: new Date('2024-08-09'),
    status: 'listed',
    gmp: 0,
    subscriptionRate: 4.27,
    listingPrice: 76.00,
    listingGainPercent: 0
  },
  {
    companyName: 'Jio Financial Services',
    ticker: 'JIOFIN',
    issueSize: 18000,
    priceBand: '₹250',
    minBidQuantity: 50,
    openDate: new Date('2023-08-10'),
    closeDate: new Date('2023-08-12'),
    listingDate: new Date('2023-08-21'),
    status: 'listed',
    gmp: 50,
    subscriptionRate: 78.40,
    listingPrice: 265.00,
    listingGainPercent: 6.00
  },
  {
    companyName: 'Indian Railway Finance Corp',
    ticker: 'IRFC',
    issueSize: 4633,
    priceBand: '₹25 - ₹26',
    minBidQuantity: 575,
    openDate: new Date('2021-01-18'),
    closeDate: new Date('2021-01-20'),
    listingDate: new Date('2021-01-29'),
    status: 'listed',
    gmp: 4,
    subscriptionRate: 78.40,
    listingPrice: 26.00,
    listingGainPercent: 0.00
  },
  {
    companyName: 'Suzlon Energy Limited',
    ticker: 'SUZLON',
    issueSize: 1500,
    priceBand: '₹10 - ₹12',
    minBidQuantity: 1000,
    openDate: new Date('2005-09-23'),
    closeDate: new Date('2005-09-27'),
    listingDate: new Date('2005-10-19'),
    status: 'listed',
    gmp: 2,
    subscriptionRate: 15.20,
    listingPrice: 15.00,
    listingGainPercent: 25.00
  }
];

async function seed() {
  try {
    console.log('Connecting to database...');
    await mongoose.connect(mongodbUri);
    console.log('Database connected successfully.');

    console.log('Clearing existing IPO records...');
    await IPO.deleteMany({});

    console.log(`Inserting ${initialIPOs.length} IPO records...`);
    await IPO.insertMany(initialIPOs);
    console.log('Seeding completed successfully!');
    
    process.exit(0);
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  }
}

seed();

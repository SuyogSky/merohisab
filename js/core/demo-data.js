/**
 * MeroHisab — Reconciled Demo Dataset
 * All figures, category spending, budgets, and goal allocations are mathematically exact.
 */

import { DEFAULT_SETTINGS } from "./constants.js";

export function getDemoData() {
  return {
    version: 2,
    isDemoData: true,
    lastUpdated: new Date().toISOString(),
    settings: {
      ...DEFAULT_SETTINGS,
      initialBalance: 50000.00,
      initialBalanceDate: "2026-10-01",
      theme: "dark",
      currencyFormat: "symbol",
      dateDisplay: "both",
      defaultPaymentMethod: "fonepay",
      userName: "MeroHisab User",
      userRole: "Personal Ledger",
      profile: {
        displayName: "MeroHisab User"
      }
    },
    transactions: [
      {
        id: "tx_demo_01",
        type: "income",
        amount: 90000.00,
        category: "salary",
        description: "Monthly Software Engineering Salary",
        dateAD: "2026-10-01",
        dateBS: "2083-06-15",
        paymentMethod: "bank_transfer",
        createdAt: "2026-10-01T10:00:00.000Z",
        updatedAt: "2026-10-01T10:00:00.000Z"
      },
      {
        id: "tx_demo_02",
        type: "income",
        amount: 25000.00,
        category: "freelance",
        description: "FinTech Consulting & Web Design",
        dateAD: "2026-10-15",
        dateBS: "2083-06-29",
        paymentMethod: "esewa",
        createdAt: "2026-10-15T15:30:00.000Z",
        updatedAt: "2026-10-15T15:30:00.000Z"
      },
      {
        id: "tx_demo_03",
        type: "expense",
        amount: 22000.00,
        category: "housing_rent",
        description: "Apartment Rent (Baluwatar)",
        dateAD: "2026-10-02",
        dateBS: "2083-06-16",
        paymentMethod: "bank_transfer",
        createdAt: "2026-10-02T09:00:00.000Z",
        updatedAt: "2026-10-02T09:00:00.000Z"
      },
      {
        id: "tx_demo_04",
        type: "expense",
        amount: 8200.00,
        category: "groceries",
        description: "Weekly Grocery Run at Bhatbhateni",
        dateAD: "2026-10-04",
        dateBS: "2083-06-18",
        paymentMethod: "fonepay",
        createdAt: "2026-10-04T12:00:00.000Z",
        updatedAt: "2026-10-04T12:00:00.000Z"
      },
      {
        id: "tx_demo_05",
        type: "expense",
        amount: 2350.00,
        category: "utilities",
        description: "Electricity (NEA) & Water Bill",
        dateAD: "2026-10-08",
        dateBS: "2083-06-22",
        paymentMethod: "khalti",
        createdAt: "2026-10-08T11:00:00.000Z",
        updatedAt: "2026-10-08T11:00:00.000Z"
      },
      {
        id: "tx_demo_06",
        type: "expense",
        amount: 4200.00,
        category: "food_dining",
        description: "Team Lunch at Newari Khaja Ghar",
        dateAD: "2026-10-10",
        dateBS: "2083-06-24",
        paymentMethod: "fonepay",
        createdAt: "2026-10-10T14:15:00.000Z",
        updatedAt: "2026-10-10T14:15:00.000Z"
      },
      {
        id: "tx_demo_07",
        type: "expense",
        amount: 2000.00,
        category: "internet_mobile",
        description: "Worldlink Fiber Internet Renewal",
        dateAD: "2026-10-14",
        dateBS: "2083-06-28",
        paymentMethod: "khalti",
        createdAt: "2026-10-14T10:30:00.000Z",
        updatedAt: "2026-10-14T10:30:00.000Z"
      },
      {
        id: "tx_demo_08",
        type: "expense",
        amount: 5200.00,
        category: "transportation",
        description: "Motorbike Petrol & Periodic Servicing",
        dateAD: "2026-10-18",
        dateBS: "2083-07-01",
        paymentMethod: "cash",
        createdAt: "2026-10-18T16:00:00.000Z",
        updatedAt: "2026-10-18T16:00:00.000Z"
      },
      {
        id: "tx_demo_09",
        type: "expense",
        amount: 6000.00,
        category: "groceries",
        description: "Vegetables, Dairy & Kitchen Supplies",
        dateAD: "2026-10-20",
        dateBS: "2083-07-03",
        paymentMethod: "fonepay",
        createdAt: "2026-10-20T11:45:00.000Z",
        updatedAt: "2026-10-20T11:45:00.000Z"
      },
      {
        id: "tx_demo_10",
        type: "expense",
        amount: 5600.00,
        category: "food_dining",
        description: "Weekend Family Dinner (Thakali)",
        dateAD: "2026-10-22",
        dateBS: "2083-07-05",
        paymentMethod: "esewa",
        createdAt: "2026-10-22T20:00:00.000Z",
        updatedAt: "2026-10-22T20:00:00.000Z"
      },
      {
        id: "tx_demo_11",
        type: "expense",
        amount: 5000.00,
        category: "healthcare",
        description: "Medical Checkup & Pharmacy",
        dateAD: "2026-10-25",
        dateBS: "2083-07-08",
        paymentMethod: "debit_card",
        createdAt: "2026-10-25T11:00:00.000Z",
        updatedAt: "2026-10-25T11:00:00.000Z"
      },
      {
        id: "tx_demo_12",
        type: "expense",
        amount: 2000.00,
        category: "internet_mobile",
        description: "NTC & Ncell Mobile Balance Recharges",
        dateAD: "2026-10-27",
        dateBS: "2083-07-10",
        paymentMethod: "ime_khalti",
        createdAt: "2026-10-27T18:30:00.000Z",
        updatedAt: "2026-10-27T18:30:00.000Z"
      }
    ],
    budgets: [
      {
        id: "bg_2026_10_housing_rent",
        period: "2026-10",
        category: "housing_rent",
        amount: 22000.00,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z"
      },
      {
        id: "bg_2026_10_groceries",
        period: "2026-10",
        category: "groceries",
        amount: 20000.00,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z"
      },
      {
        id: "bg_2026_10_food_dining",
        period: "2026-10",
        category: "food_dining",
        amount: 12000.00,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z"
      },
      {
        id: "bg_2026_10_utilities",
        period: "2026-10",
        category: "utilities",
        amount: 3000.00,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z"
      },
      {
        id: "bg_2026_10_internet_mobile",
        period: "2026-10",
        category: "internet_mobile",
        amount: 3500.00,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z"
      }
    ],
    goals: [
      {
        id: "gl_01",
        title: "Emergency Fund",
        description: "6 months of essential living expenses for security",
        targetAmount: 150000.00,
        targetDateAD: "2027-04-30",
        targetDateBS: "2084-01-17",
        category: "Emergency",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-09-05T00:00:00.000Z",
        allocations: [
          {
            id: "al_01",
            amount: 25000.00,
            dateAD: "2026-08-05",
            dateBS: "2083-04-20",
            note: "Initial allocation from project bonus"
          },
          {
            id: "al_02",
            amount: 20000.00,
            dateAD: "2026-09-05",
            dateBS: "2083-05-20",
            note: "September savings contribution"
          }
        ]
      },
      {
        id: "gl_02",
        title: "Dashain Vacation",
        description: "Celebration, gifts, and travel back home for festivals",
        targetAmount: 50000.00,
        targetDateAD: "2027-10-15",
        targetDateBS: "2084-06-29",
        category: "Festival & Travel",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-10T00:00:00.000Z",
        allocations: [
          {
            id: "al_03",
            amount: 35000.00,
            dateAD: "2026-09-10",
            dateBS: "2083-05-25",
            note: "Dedicated festival savings from freelance"
          }
        ]
      }
    ]
  };
}

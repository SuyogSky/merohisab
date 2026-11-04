// Core Constants & Domain Definitions

export const APP_METADATA = {
  name: "MeroHisab",
  nepaliName: "मेरो हिसाब",
  tagline: "Your Money. Your Goals. Your Control.",
  description: "A simple, smart personal finance dashboard built for everyday life in Nepal.",
  version: "2.0.0",
  currencySymbol: "रु",
  currencyCode: "NPR"
};

export const TRANSACTION_TYPES = {
  INCOME: "income",
  EXPENSE: "expense"
};

export const PAYMENT_METHODS = [
  { id: "cash", label: "Cash (नगद)", icon: "cash" },
  { id: "esewa", label: "eSewa (ईसेवा)", icon: "wallet" },
  { id: "khalti", label: "Khalti (खल्ती)", icon: "wallet" },
  { id: "ime_khalti", label: "IME Khalti (आइएमई खल्ती)", icon: "wallet" },
  { id: "fonepay", label: "Fonepay QR (फोनपे)", icon: "qr" },
  { id: "mobile_banking", label: "Mobile Banking (मोबाइल बैंकिङ)", icon: "mobile" },
  { id: "bank_transfer", label: "Bank Transfer (कनेक्ट आइपिएस)", icon: "bank" },
  { id: "debit_card", label: "Debit Card (डेबिट कार्ड)", icon: "card" },
  { id: "credit_card", label: "Credit Card (क्रेडिट कार्ड)", icon: "card" },
  { id: "other", label: "Other (अन्य)", icon: "tag" }
];

export const INCOME_CATEGORIES = [
  { id: "salary", label: "Salary", nepaliLabel: "तलब", icon: "briefcase", color: "#10b981" },
  { id: "freelance", label: "Freelance", nepaliLabel: "स्वतन्त्र काम", icon: "laptop", color: "#06b6d4" },
  { id: "business", label: "Business", nepaliLabel: "व्यापार", icon: "building", color: "#8b5cf6" },
  { id: "investment", label: "Investment", nepaliLabel: "लगानी", icon: "trending-up", color: "#f59e0b" },
  { id: "gift", label: "Gift", nepaliLabel: "उपहार", icon: "gift", color: "#ec4899" },
  { id: "allowance", label: "Allowance", nepaliLabel: "भत्ता", icon: "smile", color: "#3b82f6" },
  { id: "other_income", label: "Other Income", nepaliLabel: "अन्य आम्दानी", icon: "plus-circle", color: "#64748b" }
];

export const EXPENSE_CATEGORIES = [
  { id: "food_dining", label: "Food & Dining", nepaliLabel: "खाना/खाजा", icon: "utensils", color: "#f59e0b" },
  { id: "groceries", label: "Groceries", nepaliLabel: "किराना/तरकारी", icon: "shopping-cart", color: "#10b981" },
  { id: "transportation", label: "Transportation", nepaliLabel: "यातायात", icon: "car", color: "#8b5cf6" },
  { id: "housing_rent", label: "Housing & Rent", nepaliLabel: "घरभाडा", icon: "home", color: "#6366f1" },
  { id: "utilities", label: "Utilities", nepaliLabel: "बिजुली/खानेपानी", icon: "zap", color: "#0ea5e9" },
  { id: "shopping", label: "Shopping", nepaliLabel: "किनमेल", icon: "shopping-bag", color: "#f97316" },
  { id: "healthcare", label: "Healthcare", nepaliLabel: "स्वास्थ्य", icon: "heart", color: "#ec4899" },
  { id: "education", label: "Education", nepaliLabel: "शिक्षा", icon: "book-open", color: "#3b82f6" },
  { id: "entertainment", label: "Entertainment", nepaliLabel: "मनोरञ्जन", icon: "film", color: "#14b8a6" },
  { id: "travel", label: "Travel", nepaliLabel: "भ्रमण", icon: "compass", color: "#0284c7" },
  { id: "personal_care", label: "Personal Care", nepaliLabel: "व्यक्तिगत स्याहार", icon: "user", color: "#a855f7" },
  { id: "family", label: "Family", nepaliLabel: "परिवार", icon: "users", color: "#e11d48" },
  { id: "insurance", label: "Insurance", nepaliLabel: "बीमा", icon: "shield", color: "#059669" },
  { id: "internet_mobile", label: "Internet & Mobile", nepaliLabel: "इन्टरनेट/मोबाइल", icon: "wifi", color: "#4f46e5" },
  { id: "other_expenses", label: "Other Expenses", nepaliLabel: "अन्य खर्च", icon: "tag", color: "#64748b" }
];

export const BUDGET_THRESHOLDS = {
  SAFE_MAX: 74.99,
  APPROACHING_MAX: 99.99,
  EXCEEDED_MIN: 100.00
};

export const DEFAULT_SETTINGS = {
  initialBalance: 50000.00,
  initialBalanceDate: "2026-10-01",
  defaultPaymentMethod: "fonepay",
  currencyFormat: "symbol",
  currencyDisplay: "symbol",
  dateDisplay: "both",
  theme: "dark"
};

export const STORAGE_KEYS = {
  APP_DATA: "MERO_HISAB_DATA_V2",
  THEME: "MERO_HISAB_THEME",
  CORRUPT_BACKUP: "MERO_HISAB_CORRUPT_BACKUP",
  V2_BACKUP: "MERO_HISAB_V2_BACKUP",
  CONFLICT_BACKUP: "MERO_HISAB_CONFLICT_BACKUP"
};

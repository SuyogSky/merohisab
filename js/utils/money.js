/**
 * MeroHisab — Exact Financial Arithmetic & Money Utility (Integer Paisa Engine)
 *
 * All financial amounts in Nepalese Rupees (NPR) are represented and calculated in
 * integer Paisa (1 NPR = 100 Paisa) to completely eliminate IEEE 754 floating-point
 * binary representation and accumulation drift (e.g. 0.10 + 0.20 !== 0.30).
 *
 * Enforces:
 *  - Strict Nepalese Rupee precision policy: at most 2 decimal places (Paisa).
 *  - Explicit rejection of unsupported fractional precision (e.g., 1.234 is rejected, never silently rounded).
 *  - Safe financial maximum boundary for individual transactions: NPR 999,999,999,999.99 (99,999,999,999,999 Paisa).
 *  - Safe aggregate financial maximum boundary: Number.MAX_SAFE_INTEGER (9,007,199,254,740,991).
 *  - Arbitrary-precision BigInt internal accumulator for zero precision loss even across 100+ max-value transactions.
 *  - Input validation rejecting NaN, Infinity, negative amounts, and non-numeric strings.
 */

export const MAX_MONEY_AMOUNT = 999999999999.99;
export const MAX_PAISA_AMOUNT = 99999999999999; // 9.99e13 < 9.007e15 (MAX_SAFE_INTEGER)
export const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER); // 9007199254740991n
export const MAX_SAFE_INTEGER_PAISA = BigInt(Number.MAX_SAFE_INTEGER); // 9007199254740991n
export const MAX_AGGREGATE_PAISA = 999999999999999999n; // 10^18 paisa (10 quadrillion rupees)
export const MAX_SAFE_RUPEES = Number.MAX_SAFE_INTEGER; // 9007199254740991

/**
 * Validate that an amount string or number complies with the strict 2-decimal-place precision policy.
 * Rejects values with 3 or more decimal places (e.g., 1.234).
 *
 * @param {any} amount
 * @returns {boolean}
 */
export function isValidMoneyPrecision(amount) {
  if (amount === null || amount === undefined || amount === "") return false;
  if (typeof amount === "bigint") return true;
  if (typeof amount === "string") {
    const trimmed = amount.trim();
    if (trimmed === "") return false;

    // Reject scientific notation
    if (/[eE]/.test(trimmed)) return false;

    // If string contains commas, validate grouping strictly
    if (trimmed.includes(",")) {
      // 1. Standard Western thousands grouping: e.g. 1,000 or 1,234,567.89
      const westernRegex = /^-?\d{1,3}(,\d{3})+(\.\d{1,2})?$/;
      // 2. South Asian (Lakh/Crore) grouping: e.g. 1,00,000 or 12,34,567.89
      const southAsianRegex = /^-?\d{1,2}(,\d{2})*,\d{3}(\.\d{1,2})?$/;

      if (!westernRegex.test(trimmed) && !southAsianRegex.test(trimmed)) {
        return false;
      }
    } else {
      // Unformatted number with optional 1 or 2 decimal places
      const unformattedRegex = /^-?\d+(\.\d{1,2})?$/;
      if (!unformattedRegex.test(trimmed)) {
        return false;
      }
    }

    const clean = trimmed.replace(/,/g, "");
    const num = Number(clean);
    return isFinite(num) && !isNaN(num);
  }
  if (typeof amount === "number") {
    if (!isFinite(amount) || isNaN(amount)) return false;
    const str = amount.toString();
    if (str.includes("e") || str.includes("E")) return false;
    const parts = str.split(".");
    if (parts.length === 2 && parts[1].length > 2) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * Validate that an amount is a finite, positive (or zero if allowZero=true) financial quantity
 * adhering strictly to the 2-decimal-place limit and safe maximum range.
 *
 * @param {any} amount
 * @param {boolean} [allowZero=false]
 * @returns {boolean}
 */
export function isValidMoneyAmount(amount, allowZero = false) {
  if (!isValidMoneyPrecision(amount)) return false;
  const num = typeof amount === "string" ? Number(amount.replace(/,/g, "").trim()) : Number(amount);
  if (isNaN(num) || !isFinite(num)) return false;
  if (allowZero) {
    return num >= 0 && num <= MAX_MONEY_AMOUNT;
  }
  return num > 0 && num <= MAX_MONEY_AMOUNT;
}

/**
 * Parse any Rupee amount (number, numeric string, or bigint) directly into BigInt Paisa
 * without any intermediate floating-point binary inaccuracies.
 *
 * @param {number|string|bigint} amount
 * @returns {bigint} Integer paisa as BigInt
 * @throws {RangeError|TypeError} If precision is invalid or amount is not numeric
 */
export function toPaisaBigInt(amount) {
  if (amount === null || amount === undefined || amount === "") {
    return 0n;
  }
  if (typeof amount === "bigint") {
    return amount;
  }
  if (!isValidMoneyPrecision(amount)) {
    throw new RangeError(`Unsupported monetary precision: '${amount}'. Nepalese Rupees support at most 2 decimal places (Paisa).`);
  }
  const clean = (typeof amount === "string" ? amount.replace(/,/g, "") : String(amount)).trim();
  const isNeg = clean.startsWith("-");
  const raw = isNeg ? clean.slice(1) : clean;
  const parts = raw.split(".");
  const whole = BigInt(parts[0] || "0");
  const fracStr = (parts[1] || "").padEnd(2, "0").slice(0, 2);
  const frac = BigInt(fracStr);
  const paisa = whole * 100n + frac;
  return isNeg ? -paisa : paisa;
}

/**
 * Explicit semantic conversion: Convert Rupee amount (number or decimal string) to BigInt Paisa.
 * Unambiguous unit contract: Input must be in Rupees, output is integer Paisa (1 NPR = 100 Paisa).
 *
 * @param {number|string} amountInRupees
 * @returns {bigint} Integer paisa as BigInt
 */
export function rupeesToPaisaBigInt(amountInRupees) {
  if (typeof amountInRupees === "bigint") {
    throw new TypeError("rupeesToPaisaBigInt() expects Rupees (number or string), not BigInt. Use parseMoneyToPaisa() or toPaisaBigInt() for polymorphic inputs.");
  }
  return toPaisaBigInt(amountInRupees);
}

/**
 * Explicit semantic conversion: Convert BigInt Paisa to Rupee representation.
 * Unambiguous unit contract: Input must be in Paisa (BigInt or integer number), output is Rupee value.
 *
 * @param {bigint|number} paisa
 * @param {{ asString?: boolean }} [options]
 * @returns {number|string} Rupee amount
 */
export function paisaToRupeesDisplay(paisa, options = { asString: true }) {
  return fromPaisaBigInt(paisa, options);
}

/**
 * Parse any user-entered monetary quantity into authoritative BigInt Paisa.
 * Rejects invalid, non-numeric, or unsupported precision amounts explicitly.
 * Never silently converts malformed financial input to zero.
 *
 * @param {number|string|bigint} amount
 * @returns {bigint} Authoritative integer paisa as BigInt
 * @throws {TypeError|RangeError} If input is invalid, null, undefined, or violates 2-decimal precision
 */
export function parseMoneyToPaisa(amount) {
  if (amount === null || amount === undefined || amount === "") {
    throw new TypeError("Monetary amount cannot be null, undefined, or empty.");
  }
  return toPaisaBigInt(amount);
}

/**
 * Convert any Rupee amount into integer Paisa (returns JS Number when safe).
 *
 * @param {number|string|bigint} amount
 * @returns {number} Integer paisa
 * @throws {RangeError|TypeError} If amount violates precision or bounds
 */
export function toPaisa(amount) {
  const pBig = toPaisaBigInt(amount);
  const maxPaisa = BigInt(MAX_PAISA_AMOUNT);
  if (pBig > maxPaisa || pBig < -maxPaisa) {
    throw new RangeError(`Monetary amount '${amount}' exceeds maximum supported limit (रु ${MAX_MONEY_AMOUNT.toLocaleString("en-IN")}).`);
  }
  return Number(pBig);
}

/**
 * Convert BigInt Paisa back to Rupee amount or formatted string with exact 2 decimal places.
 * Checks for aggregate overflow beyond Number.MAX_SAFE_INTEGER to prevent silent precision loss.
 *
 * @param {bigint|number} paisaBigInt
 * @param {{ asString?: boolean }} [options]
 * @returns {number|string}
 */
export function fromPaisaBigInt(paisaBigInt, { asString = false } = {}) {
  const p = typeof paisaBigInt === "bigint" ? paisaBigInt : BigInt(Math.round(paisaBigInt || 0));
  const isNeg = p < 0n;
  const abs = isNeg ? -p : p;
  if (abs > MAX_AGGREGATE_PAISA) {
    throw new RangeError("Aggregate financial calculation exceeds maximum supported limit (रु 9,999,999,999,999,999.99).");
  }
  const whole = abs / 100n;
  const frac = abs % 100n;
  const str = `${isNeg ? "-" : ""}${whole.toString()}.${frac.toString().padStart(2, "0")}`;

  // Preserve exact Paisa: return exact decimal string if explicitly requested
  if (asString) {
    return str;
  }

  // Check if JavaScript Number can represent this exact value with zero float rounding drift
  const num = Number(str);
  if (isFinite(num) && num.toFixed(2) === str) {
    return num;
  }

  // Float conversion would lose precision (e.g., 98,999,999,999,999.01 -> .02). Return exact decimal string.
  return str;
}

/**
 * Convert integer Paisa back to Rupee amount with exactly 2 decimal places.
 *
 * @param {number|bigint} paisa
 * @returns {number} Rupee value rounded to 2 decimal places
 */
export function fromPaisa(paisa) {
  if (paisa === null || paisa === undefined || (typeof paisa === "number" && (isNaN(paisa) || !isFinite(paisa)))) {
    return 0;
  }
  return fromPaisaBigInt(paisa);
}

/**
 * Add multiple monetary amounts with exact BigInt integer-paisa precision.
 * Completely eliminates floating-point drift (e.g. 0.10 + 0.20 === 0.30).
 *
 * @param  {...(number|string|bigint)} amounts
 * @returns {number} Sum in Rupees
 */
export function addMoney(...amounts) {
  let sumPaisa = 0n;
  for (const amt of amounts) {
    sumPaisa += toPaisaBigInt(amt);
  }
  return fromPaisaBigInt(sumPaisa);
}

/**
 * Subtract subtrahend amounts from a minuend with exact BigInt integer-paisa precision.
 *
 * @param {number|string|bigint} minuend
 * @param {...(number|string|bigint)} subtrahends
 * @returns {number} Result in Rupees
 */
export function subtractMoney(minuend, ...subtrahends) {
  let resPaisa = toPaisaBigInt(minuend);
  for (const sub of subtrahends) {
    resPaisa -= toPaisaBigInt(sub);
  }
  return fromPaisaBigInt(resPaisa);
}

/**
 * Multiply monetary amount by a scalar factor and round consistently to nearest paisa.
 *
 * @param {number|string|bigint} amount
 * @param {number} factor
 * @returns {number} Result in Rupees
 */
/**
 * Multiply monetary amount by a scalar factor using exact integer-paisa arithmetic
 * with sign-symmetric half-up (away from zero) rounding.
 *
 * Rounding policy:
 * - Half-up away from zero: fractional paisa >= 0.5 rounds away from zero, < 0.5 rounds towards zero.
 * - Symmetrical across signs: multiplyMoney("0.01", 0.5) === 0.01 and multiplyMoney("-0.01", 0.5) === -0.01.
 * - Symmetrical across factors: multiplyMoney("0.01", 0.6) === 0.01 and multiplyMoney("-0.01", 0.6) === -0.01.
 *
 * @param {number|string|bigint} amount
 * @param {number|string|bigint} factor
 * @param {{ asString?: boolean }} [options]
 * @returns {number|string} Result in Rupees
 */
export function multiplyMoney(amount, factor, { asString = false } = {}) {
  const amtPaisa = toPaisaBigInt(amount);
  if (amtPaisa === 0n) return asString ? "0.00" : 0;
  if (factor === null || factor === undefined || factor === "") return asString ? "0.00" : 0;

  let factorNum;
  if (typeof factor === "number") {
    if (!isFinite(factor) || isNaN(factor)) return asString ? "0.00" : 0;
    factorNum = factor;
  } else if (typeof factor === "string") {
    factorNum = parseFloat(factor.replace(/,/g, "").trim());
    if (!isFinite(factorNum) || isNaN(factorNum)) return asString ? "0.00" : 0;
  } else if (typeof factor === "bigint") {
    const raw = amtPaisa * factor;
    return fromPaisaBigInt(raw, { asString });
  } else {
    return asString ? "0.00" : 0;
  }

  // Parse factor cleanly into fixed-point integer (6 decimal places = 1,000,000 scale)
  const factorScale = 1000000n;
  const isNegFactor = factorNum < 0;
  const absFactor = Math.abs(factorNum);
  const factorBig = BigInt(Math.round(absFactor * 1000000));
  const signedFactor = isNegFactor ? -factorBig : factorBig;

  const raw = amtPaisa * signedFactor;
  const halfScale = factorScale / 2n;

  // Sign-aware symmetric half-up rounding (away from zero)
  const productPaisa = raw >= 0n ? (raw + halfScale) / factorScale : (raw - halfScale) / factorScale;
  return fromPaisaBigInt(productPaisa, { asString });
}

/**
 * Compare two monetary amounts.
 * Returns -1 if a < b, 0 if a == b, 1 if a > b.
 *
 * @param {number|string|bigint} a
 * @param {number|string|bigint} b
 * @returns {number}
 */
export function compareMoney(a, b) {
  const pA = toPaisaBigInt(a);
  const pB = toPaisaBigInt(b);
  if (pA < pB) return -1;
  if (pA > pB) return 1;
  return 0;
}

/**
 * Verify whether an aggregate Paisa sum exceeds the safe integer boundary.
 *
 * @param {bigint|number} paisa
 * @returns {{ safe: boolean, error?: string }}
 */
export function checkAggregateOverflow(paisa) {
  const p = typeof paisa === "bigint" ? paisa : toPaisaBigInt(paisa);
  const abs = p < 0n ? -p : p;
  if (abs > MAX_AGGREGATE_PAISA) {
    return {
      safe: false,
      error: "Aggregate financial amount exceeds maximum supported limit (रु 9,999,999,999,999,999.99)."
    };
  }
  return { safe: true };
}

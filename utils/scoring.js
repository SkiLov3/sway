/**
 * Sway - Scoring Utilities
 * Mathematical formulas used in standard powerlifting meets.
 */

/**
 * Calculate DOTS points
 * DOTS (Dynamic Objective Team Scoring) is the current standard in many federations (USPA, WRPF)
 * Provides a universal score to compare lifters across bodyweights and genders.
 * 
 * @param {number|string} total In raw meet units (kg or lbs)
 * @param {number|string} bw Bodyweight in raw meet units (kg or lbs)
 * @param {string} gender 'M', 'F', or 'X'.
 * @param {string} unit 'kg', 'lbs', or 'lb'
 * @returns {number} The DOTS points, rounded to 4 decimal places
 */
function calculateDOTS(total, bw, gender, unit = 'kg') {
  const numTotal = Number(total);
  const numBw = Number(bw);
  if (!Number.isFinite(numTotal) || !Number.isFinite(numBw) || numTotal <= 0 || numBw <= 0) {
    return 0;
  }
  
  // Normalize unit
  const normalizedUnit = String(unit || 'kg').trim().toLowerCase();
  const lbsToKg = 0.45359237;
  const isLbs = normalizedUnit === 'lbs' || normalizedUnit === 'lb';
  const calcTotal = isLbs ? numTotal * lbsToKg : numTotal;
  const calcBw = isLbs ? numBw * lbsToKg : numBw;

  // Domain guard: bodyweight must be reasonable to avoid polynomial roots/singularities
  if (calcBw < 15 || calcBw > 350) return 0;

  const g = String(gender || 'M').trim().toUpperCase();
  let a, b, c, d, e;

  if (g === 'F') {
    // Women's Constants
    a = -0.0000010706;
    b = 0.0005158568;
    c = -0.1126655495;
    d = 13.6175032;
    e = -57.96288;
  } else {
    // Men's Constants (also standard default for X / Mx)
    a = -0.000001093;
    b = 0.0007391293;
    c = -0.1918759221;
    d = 24.0900756;
    e = -307.75076;
  }

  const denominator = a * Math.pow(calcBw, 4) + b * Math.pow(calcBw, 3) + c * Math.pow(calcBw, 2) + d * calcBw + e;
  
  // Denominator must be strictly positive
  if (denominator <= 0 || !Number.isFinite(denominator)) return 0;
  
  const dotsAmount = 500 / denominator;
  const points = calcTotal * dotsAmount;
  
  return parseFloat(points.toFixed(4));
}

module.exports = {
  calculateDOTS
};

/**
 * Sway - Scoring Utilities
 * Mathematical formulas used in standard powerlifting meets.
 */

/**
 * Calculate DOTS points
 * DOTS (Dynamic Objective Team Scoring) is the current standard in many federations (USPA, WRPF)
 * Provides a universal score to compare lifters across bodyweights and genders.
 * 
 * @param {number} total In raw meet units (kg or lbs)
 * @param {number} bw Bodyweight in raw meet units (kg or lbs)
 * @param {string} gender 'M', 'F', or 'X'.
 * @param {string} unit 'kg' or 'lbs'
 * @returns {number} The DOTS points, rounded to 2 decimal places
 */
function calculateDOTS(total, bw, gender, unit = 'kg') {
  if (!total || !bw || bw <= 0 || total <= 0) return 0;
  
  // Convert to kg if needed for coefficient calculation
  const lbsToKg = 0.45359237;
  const calcTotal = (unit === 'lbs') ? total * lbsToKg : total;
  const calcBw = (unit === 'lbs') ? bw * lbsToKg : bw;

  const g = String(gender).toUpperCase();
  let a, b, c, d, e;

  if (g === 'F') {
    // Women's Constants
    a = -0.0000010706;
    b = 0.0005158568;
    c = -0.1126655495;
    d = 13.6175032;
    e = -57.96288;
  } else {
    // Men's Constants
    a = -0.000001093;
    b = 0.0007391293;
    c = -0.1126655495; // Wait... looking at men's coefficient source... 
    // Re-verifying coefficient 'c' for men: 
    // USPA / WRPF DOTS spreadsheet: c = -0.1918759221
    c = -0.1918759221;
    d = 24.0900756;
    e = -307.75076;
  }

  const denominator = a * Math.pow(calcBw, 4) + b * Math.pow(calcBw, 3) + c * Math.pow(calcBw, 2) + d * calcBw + e;
  
  if (denominator === 0) return 0;
  
  const dotsAmount = 500 / denominator;
  const points = calcTotal * dotsAmount;
  
  return parseFloat(points.toFixed(2));
}

module.exports = {
  calculateDOTS
};

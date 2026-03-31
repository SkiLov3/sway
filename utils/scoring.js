/**
 * Sway - Scoring Utilities
 * Mathematical formulas used in standard powerlifting meets.
 */

/**
 * Calculate DOTS points
 * DOTS (Dynamic Objective Team Scoring) is the current standard in many federations (USPA, WRPF)
 * Provides a universal score to compare lifters across bodyweights and genders.
 * 
 * @param {number} total In kg
 * @param {number} bw Bodyweight in kg
 * @param {string} gender 'M', 'F', or 'X'. (X defaults to Men's coefficient for safety/balance or a specific un-gendered coefficient if one existed, using Men's here)
 * @returns {number} The DOTS points, rounded to 2 decimal places
 */
function calculateDOTS(total, bw, gender) {
  if (!total || !bw || bw <= 0 || total <= 0) return 0;
  
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
    // Men's Constants (also default for 'X')
    a = -0.000001093;
    b = 0.0007391293;
    c = -0.1918759221;
    d = 24.0900756;
    e = -307.75076;
  }

  const denominator = a * Math.pow(bw, 4) + b * Math.pow(bw, 3) + c * Math.pow(bw, 2) + d * bw + e;
  
  // Guard against extreme bw edges where denominator could go 0 or negative
  if (denominator === 0) return 0;
  
  const dotsAmount = 500 / denominator;
  const points = total * dotsAmount;
  
  return parseFloat(points.toFixed(2));
}

module.exports = {
  calculateDOTS
};

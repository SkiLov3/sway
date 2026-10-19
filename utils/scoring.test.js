const { calculateDOTS } = require('./scoring');

describe('calculateDOTS', () => {
  test('should return 0 for invalid inputs', () => {
    expect(calculateDOTS(0, 90, 'M')).toBe(0);
    expect(calculateDOTS(500, 0, 'M')).toBe(0);
    expect(calculateDOTS(500, -10, 'M')).toBe(0);
    expect(calculateDOTS(-500, 90, 'M')).toBe(0);
    expect(calculateDOTS(null, 90, 'M')).toBe(0);
    expect(calculateDOTS(500, null, 'M')).toBe(0);
    expect(calculateDOTS('invalid', 90, 'M')).toBe(0);
    expect(calculateDOTS(500, 'invalid', 'M')).toBe(0);
  });

  test('should calculate DOTS for men correctly', () => {
    const dots1 = calculateDOTS(500, 100, 'M');
    expect(dots1).toBeGreaterThan(0);
    expect(typeof dots1).toBe('number');
    
    // Higher total should mean higher DOTS
    const dots2 = calculateDOTS(600, 100, 'M');
    expect(dots2).toBeGreaterThan(dots1);
    
    // Lower bodyweight with same total should mean higher DOTS
    const dots3 = calculateDOTS(500, 90, 'M');
    expect(dots3).toBeGreaterThan(dots1);
  });

  test('should calculate DOTS for women correctly', () => {
    const dots1 = calculateDOTS(300, 60, 'F');
    expect(dots1).toBeGreaterThan(0);
    
    // Higher total should mean higher DOTS
    const dots2 = calculateDOTS(350, 60, 'F');
    expect(dots2).toBeGreaterThan(dots1);
    
    // Lower bodyweight with same total should mean higher DOTS
    const dots3 = calculateDOTS(300, 55, 'F');
    expect(dots3).toBeGreaterThan(dots1);
  });

  test('should default to men for gender X', () => {
    const dotsM = calculateDOTS(500, 90, 'M');
    const dotsX = calculateDOTS(500, 90, 'X');
    expect(dotsX).toBe(dotsM);
  });

  test('should be case-insensitive for gender and units', () => {
    const dots1 = calculateDOTS(500, 90, 'm');
    const dots2 = calculateDOTS(500, 90, 'M');
    expect(dots1).toBe(dots2);

    // Units case-insensitivity: 'lbs', 'LBS', 'lb'
    const dotsLbsLower = calculateDOTS(1102.31, 198.416, 'M', 'lbs');
    const dotsLbsUpper = calculateDOTS(1102.31, 198.416, 'M', 'LBS');
    const dotsLb = calculateDOTS(1102.31, 198.416, 'M', 'lb');
    expect(dotsLbsUpper).toBeCloseTo(dotsLbsLower, 2);
    expect(dotsLb).toBeCloseTo(dotsLbsLower, 2);
  });

  test('should return 0 for extreme bodyweight singularities', () => {
    expect(calculateDOTS(300, 10, 'M')).toBe(0);
    expect(calculateDOTS(300, 400, 'M')).toBe(0);
  });
});

const { calculateDOTS } = require('./scoring');

describe('calculateDOTS', () => {
  test('should return 0 for invalid inputs', () => {
    expect(calculateDOTS(0, 90, 'M')).toBe(0);
    expect(calculateDOTS(500, 0, 'M')).toBe(0);
    expect(calculateDOTS(500, -10, 'M')).toBe(0);
    expect(calculateDOTS(-500, 90, 'M')).toBe(0);
  });

  test('should calculate DOTS for men correctly', () => {
    // Reference value for 100kg lifter with 500kg total (typical DOTS is around 300-400)
    // Let's just check it returns a reasonable number and is consistent
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

  test('should be case-insensitive for gender', () => {
    const dots1 = calculateDOTS(500, 90, 'm');
    const dots2 = calculateDOTS(500, 90, 'M');
    expect(dots1).toBe(dots2);
  });
});

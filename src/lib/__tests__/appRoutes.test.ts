import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('app route registry', () => {
  it('keeps a single canonical path per route', () => {
    // Read App.tsx and extract route paths from Route elements
    const appTsxPath = resolve(__dirname, '../../App.tsx');
    const appTsxContent = readFileSync(appTsxPath, 'utf-8');
    
    // Extract all route paths using regex
    const routePathRegex = /path="([^"]+)"/g;
    const paths: string[] = [];
    let match;
    
    while ((match = routePathRegex.exec(appTsxContent)) !== null) {
      const path = match[1];
      // Skip query params and extract canonical path
      const canonicalPath = path.split('?')[0];
      paths.push(canonicalPath);
    }
    
    // Check for duplicates
    const seen = new Set<string>();
    const duplicates: string[] = [];
    
    for (const path of paths) {
      if (seen.has(path)) {
        duplicates.push(path);
      }
      seen.add(path);
    }
    
    expect(duplicates).toHaveLength(0, `Found duplicate route paths: ${duplicates.join(', ')}`);
    expect(seen.has('/staff-payroll')).toBe(true);
    expect([...seen].filter((path) => path === '/staff-payroll')).toHaveLength(1);
  });
});
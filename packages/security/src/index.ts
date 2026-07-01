import type { FileMap, SecurityGateResult, SecurityViolation } from '@ai-app-builder/core';

export class SecurityGate {
  async evaluate(fileMap: FileMap): Promise<SecurityGateResult> {
    const violations: SecurityViolation[] = [];
    const warnings: string[] = [];
    await this.checkHardcodedSecrets(fileMap, violations);
    await this.checkDangerousPatterns(fileMap, violations, warnings);
    await this.checkAuthPatterns(fileMap, violations, warnings);
    return {
      passed: violations.every(v => v.severity !== 'error'),
      violations,
      warnings: [...new Set(warnings)],
    };
  }

  private async checkHardcodedSecrets(fileMap: FileMap, violations: SecurityViolation[]): Promise<void> {
    const patterns = [
      { regex: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{8,}['"]/i, code: 'HARDCODED_API_KEY' },
      { regex: /(?:secret|token|password)\s*[:=]\s*['"][^'"]{8,}['"]/i, code: 'HARDCODED_SECRET' },
    ];
    for (const [path, file] of Object.entries(fileMap)) {
      if (['.json', '.ts', '.tsx', '.js', '.jsx'].some(ext => path.endsWith(ext))) {
        for (const p of patterns) {
          const match = file.content.match(p.regex);
          if (match) violations.push({ code: p.code, message: `Possible secret in ${path}`, severity: 'error', file: path });
        }
      }
    }
  }

  private async checkDangerousPatterns(fileMap: FileMap, violations: SecurityViolation[], warnings: string[]): Promise<void> {
    const dangerous = [
      { regex: /eval\s*\(/, code: 'DANGEROUS_EVAL', msg: 'Use of eval()' },
      { regex: /innerHTML\s*=/, code: 'DANGEROUS_INNER_HTML', msg: 'Use of innerHTML (XSS risk)' },
    ];
    for (const [path, file] of Object.entries(fileMap)) {
      if (['.ts', '.tsx', '.js', '.jsx'].some(ext => path.endsWith(ext))) {
        for (const p of dangerous) {
          if (p.regex.test(file.content)) violations.push({ code: p.code, message: `${p.msg} in ${path}`, severity: 'warning', file: path });
        }
      }
    }
  }

  private async checkAuthPatterns(fileMap: FileMap, violations: SecurityViolation[], warnings: string[]): Promise<void> {
    for (const [path, file] of Object.entries(fileMap)) {
      if (!path.endsWith('/route.ts') && !path.endsWith('/route.tsx')) continue;
      const hasMutation = file.content.includes('DELETE') || file.content.includes('POST') || file.content.includes('PUT');
      const hasAuth = file.content.includes('auth') || file.content.includes('session');
      if (hasMutation && !hasAuth) warnings.push(`Route ${path} may need auth checks`);
    }
  }
}

export function createSecurityGate(): SecurityGate {
  return new SecurityGate();
}

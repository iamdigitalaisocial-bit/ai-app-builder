import { ValidationResult, RepairResult, FileMap } from '@ai-app-builder/core';
import { createModelProvider, type ChatMessage } from '@ai-app-builder/model-provider';

export class RepairAgent {
  private modelProvider: any;

  constructor() {
    this.modelProvider = createModelProvider('ollama');
  }

  async repair(result: ValidationResult, files: FileMap): Promise<RepairResult> {
    if (result.status === 'pass') {
      return { success: true, changes: [], message: 'No repair needed' };
    }

    const changes: RepairResult['changes'] = [];

    for (const error of result.errors) {
      const fix = await this.resolveFix(error, files);
      if (fix) {
        changes.push(fix);
        if (fix.file in files) {
          (files as any)[fix.file] = {
            content: this.applyPatch(files[fix.file as keyof typeof files]?.content || '', fix.patch),
            hash: '',
            generated: true,
          };
        }
      }
    }

    return {
      success: changes.length > 0,
      changes,
      message: changes.length > 0 ? `Applied ${changes.length} repair(s)` : 'No actionable repairs found',
    };
  }

  private async resolveFix(
    error: { code: string; message: string; file?: string; category?: string },
    files: FileMap,
  ): Promise<{ file: string; patch: string } | undefined> {
    const file = error.file || '';

    switch (error.code) {
      case 'PACKAGE_JSON_INVALID':
      case 'PACKAGE_JSON_MISSING': {
        const content = files['package.json']?.content ?? this.defaultPackageJson();
        return { file: 'package.json', patch: content };
      }
      case 'MISSING_BUILD_SCRIPT': {
        const content = files['package.json']?.content ?? this.defaultPackageJson();
        const parsed = JSON.parse(content);
        parsed.scripts = parsed.scripts || {};
        parsed.scripts.build = 'next build';
        return { file: 'package.json', patch: JSON.stringify(parsed, null, 2) };
      }
      case 'CONSOLE_LOG_FOUND': {
        const content = (files as any)[file]?.content || '';
        const cleaned = content.replace(/console\.log\([^)]*\);?/g, '');
        return { file, patch: cleaned };
      }
      case 'NO_ANY_TYPE': {
        const content = (files as any)[file]?.content || '';
        const repaired = content.replace(/:\s*any\b/g, ': unknown');
        return { file, patch: repaired };
      }
      case 'NO_HTTP_HANDLER': {
        const content = (files as any)[file]?.content || '';
        if (!content.includes('export async function GET')) {
          return { file, patch: `${content}\nexport async function GET() {\n  return new Response(JSON.stringify({ ok: true }), {\n    headers: { 'content-type': 'application/json' },\n  });\n}\n` };
        }
        break;
      }
      case 'HARDCODED_SECRET': {
        const content = (files as any)[file]?.content || '';
        const redacted = content.replace(/(password|api_key|secret)\s*=\s*['"][^'"]+['"]/gi, '$1 = process.env.NEXT_PUBLIC_$1');
        return { file, patch: redacted };
      }
      default: {
        if (file && (files as any)[file]) {
          return this.aiRepair(error, (files as any)[file].content, file);
        }
      }
    }

    return undefined;
  }

  private async aiRepair(
    error: { code: string; message: string; file?: string },
    content: string,
    file: string,
  ): Promise<{ file: string; patch: string } | undefined> {
    try {
      const prompt = `Fix this file for a Next.js app.
Error: ${error.code}
Message: ${error.message}
Return ONLY the complete fixed file content. Do not include markdown fences.`;

      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are a coding assistant. Return only valid code for the provided file.' },
        { role: 'user', content: `${prompt}\n\nFile: ${file}\n\nCurrent content:\n${content}` },
      ];

      const fixed = await (this.modelProvider as any).chat(messages, {
        temperature: 0.1,
        maxTokens: 2048,
      });

      const cleaned = fixed.replace(/^\`\`\`.*$/gm, '').replace(/^\`\`\`$/gm, '').trim();
      if (cleaned && cleaned !== content) {
        return { file, patch: cleaned };
      }
    } catch {
      // ignore repair failures
    }

    return undefined;
  }

  private applyPatch(_original: string, patch: string): string {
    return patch;
  }

  private defaultPackageJson(): string {
    return JSON.stringify({
      name: 'generated-app',
      version: '0.1.0',
      private: true,
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
      },
      dependencies: {
        next: '^16.2.0',
        react: '^19.2.0',
        'react-dom': '^19.2.0',
      },
      devDependencies: {
        '@types/node': '^22.0.0',
        '@types/react': '^19.0.0',
        typescript: '^6.0.0',
        tailwindcss: '^4.3.0',
        postcss: '^8.4.0',
        '@tailwindcss/postcss': '^4.0.0',
      },
    }, null, 2);
  }
}

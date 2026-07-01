import type { AppSpec, FileMap, BuildPlan, FileStructure } from '@ai-app-builder/core';

export class RepoGenerator {
  async generate(spec: AppSpec): Promise<FileMap> {
    // Simple generation from spec only
    const files: FileMap = {
      'package.json': { content: this.generatePackageJson(spec), hash: '', generated: true },
      'tsconfig.json': { content: this.generateTsConfig(), hash: '', generated: true },
      'next.config.js': { content: this.generateNextConfig(), hash: '', generated: true },
      'postcss.config.js': { content: this.generatePostcssConfig(), hash: '', generated: true },
      '.env.example': { content: this.generateEnvExample(), hash: '', generated: true },
      'src/app/page.tsx': { content: this.generatePage(spec), hash: '', generated: true },
      'src/app/layout.tsx': { content: this.generateLayout(), hash: '', generated: true },
      'src/app/globals.css': { content: this.generateGlobalsCSS(), hash: '', generated: true },
      'src/app/api/hello/route.ts': { content: this.generateHelloApi(), hash: '', generated: true },
      'README.md': { content: this.generateReadme(spec), hash: '', generated: true },
    };

    // Generate page files for each page in spec
    for (const page of spec.pages || []) {
      const routePath = page.route.replace(/^\//, '').replace(/\//g, '/');
      const filePath = routePath ? `src/app/${routePath}/page.tsx` : `src/app/(pages)/${page.id}/page.tsx`;
      if (!files[filePath]) {
        files[filePath] = { content: this.generatePageComponent(page), hash: '', generated: true };
      }
    }

    // Generate entity API routes if CRUD is needed
    if (spec.apiCapabilities?.includes('crud')) {
      for (const entity of spec.entities || []) {
        const tableName = this.toKebabCase(entity.name);
        const apiPath = `src/app/api/${tableName}/route.ts`;
        if (!files[apiPath]) {
          files[apiPath] = { content: this.generateEntityApi(entity), hash: '', generated: true };
        }
        const idApiPath = `src/app/api/${tableName}/[id]/route.ts`;
        if (!files[idApiPath]) {
          files[idApiPath] = { content: this.generateEntityIdApi(entity), hash: '', generated: true };
        }
      }
    }

    // Generate UI components
    files['src/components/ui/button.tsx'] = { content: this.generateButtonComponent(), hash: '', generated: true };
    files['src/components/ui/card.tsx'] = { content: this.generateCardComponent(), hash: '', generated: true };

    // Add auth files if needed
    if (spec.authRequirements?.enabled) {
      files['src/lib/auth.ts'] = { content: this.generateAuthConfig(spec), hash: '', generated: true };
    }

    // Add .gitignore
    files['.gitignore'] = { content: this.generateGitignore(), hash: '', generated: true };

    return files;
  }

  async generateFromPlan(_spec: AppSpec, buildPlan: BuildPlan): Promise<FileMap> {
    // Use the planner's full file structure and convert to flat FileMap
    const files: FileMap = {};
    
    const flattenStructure = (struct: FileStructure, basePath = '') => {
      for (const [name, node] of Object.entries(struct)) {
        const fullPath = basePath ? `${basePath}/${name}` : name;
        if (node.type === 'file') {
          files[fullPath] = { content: node.content || '', hash: '', generated: true };
        } else if (node.type === 'directory' && node.children) {
          flattenStructure(node.children, fullPath);
        }
      }
    };

    flattenStructure(buildPlan.fileStructure);

    // Ensure essential files exist
    if (!files['package.json']) {
      files['package.json'] = { content: this.generatePackageJson(_spec), hash: '', generated: true };
    }
    if (!files['tsconfig.json']) {
      files['tsconfig.json'] = { content: this.generateTsConfig(), hash: '', generated: true };
    }
    if (!files['next.config.js']) {
      files['next.config.js'] = { content: this.generateNextConfig(), hash: '', generated: true };
    }
    if (!files['src/app/globals.css']) {
      files['src/app/globals.css'] = { content: this.generateGlobalsCSS(), hash: '', generated: true };
    }
    if (!files['.gitignore']) {
      files['.gitignore'] = { content: this.generateGitignore(), hash: '', generated: true };
    }
    if (!files['README.md']) {
      files['README.md'] = { content: this.generateReadme(_spec), hash: '', generated: true };
    }
    if (!files['.env.example']) {
      files['.env.example'] = { content: this.generateEnvExample(), hash: '', generated: true };
    }

    return files;
  }

  private generatePackageJson(_spec: AppSpec): string {
    return JSON.stringify({
      name: 'generated-app',
      version: '0.1.0',
      private: true,
      scripts: { dev: 'next dev', build: 'next build', start: 'next start', lint: 'next lint' },
      dependencies: {
        next: '^16.2.0', react: '^19.2.0', 'react-dom': '^19.2.0',
        '@prisma/client': '^5.0.0',
      },
      devDependencies: {
        '@types/node': '^22.0.0', '@types/react': '^19.0.0', typescript: '^6.0.0',
        tailwindcss: '^4.3.0', postcss: '^8.4.0', '@tailwindcss/postcss': '^4.0.0',
        prisma: '^5.0.0', eslint: '^9.0.0', 'eslint-config-next': '^16.0.0',
      },
    }, null, 2);
  }

  private generateTsConfig(): string {
    return JSON.stringify({
      compilerOptions: {
        target: 'ES2025', lib: ['ES2025', 'dom', 'dom.iterable'], module: 'ESNext',
        moduleResolution: 'bundler', strict: true, esModuleInterop: true,
        skipLibCheck: true, forceConsistentCasingInFileNames: true,
        resolveJsonModule: true, isolatedModules: true, noEmit: true,
        jsx: 'preserve', incremental: true, plugins: [{ name: 'next' }],
        baseUrl: '.', paths: { '@/*': ['./src/*'] },
      },
      include: ['src/**/*.ts', 'src/**/*.tsx', 'next-env.d.ts'],
      exclude: ['node_modules', 'dist', '.next'],
    }, null, 2);
  }

  private generateNextConfig(): string {
    return `/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true };
module.exports = nextConfig;`;
  }

  private generatePostcssConfig(): string {
    return `export default { plugins: { '@tailwindcss/postcss': {} } };`;
  }

  private generateEnvExample(): string {
    return `# App Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
`;
  }

  private generateLayout(): string {
    return `import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Generated App',
  description: 'Generated by App Builder',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}`;
  }

  private generateGlobalsCSS(): string {
    return `@tailwind base;
@tailwind components;
@tailwind utilities;
`;
  }

  private generatePage(spec: AppSpec): string {
    const page = spec.pages?.[0];
    return `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-4">${page?.name || 'App'}</h1>
      <p className="text-lg text-gray-600">${spec.appCategory || 'Application'}</p>
    </main>
  );
}`;
  }

  private generatePageComponent(page: any): string {
    return `export default function ${page.name?.replace(/\s+/g, '') || 'Page'}() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">${page.name || 'Page'}</h1>
      <p>Page content for ${page.route || '/'}</p>
    </div>
  );
}`;
  }

  private generateHelloApi(): string {
    return `import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ message: 'Hello from App Builder!' });
}`;
  }

  private generateEntityApi(entity: any): string {
    const name = entity.name || 'Entity';
    return `import { NextResponse } from 'next/server';

// GET /api/${this.toKebabCase(name)}
export async function GET() {
  return NextResponse.json({ ${this.toKebabCase(name)}: [] });
}

// POST /api/${this.toKebabCase(name)}
export async function POST(request: Request) {
  const body = await request.json();
  return NextResponse.json({ ${this.toKebabCase(name)}: body }, { status: 201 });
}`;
  }

  private generateEntityIdApi(entity: any): string {
    const name = entity.name || 'Entity';
    return `import { NextResponse } from 'next/server';

// GET /api/${this.toKebabCase(name)}/[id]
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return NextResponse.json({ ${this.toKebabCase(name)}: { id: params.id } });
}

// PUT /api/${this.toKebabCase(name)}/[id]
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json();
  return NextResponse.json({ ${this.toKebabCase(name)}: { ...body, id: params.id } });
}

// DELETE /api/${this.toKebabCase(name)}/[id]
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  return NextResponse.json({ success: true, id: params.id });
}`;
  }

  private generateButtonComponent(): string {
    return `export default function Button({ children, ...props }: any) {
  return <button className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600" {...props}>{children}</button>;
}`;
  }

  private generateCardComponent(): string {
    return `export default function Card({ children, ...props }: any) {
  return <div className="border rounded-lg p-4 shadow-sm" {...props}>{children}</div>;
}`;
  }

  private generateAuthConfig(spec: AppSpec): string {
    return `import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

export { supabase };
`;
  }

  private generateReadme(spec: AppSpec): string {
    return `# ${spec.appCategory || 'Generated App'}

Generated by AI App Builder.

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

## Tech Stack
- Next.js 16
- React 19
- TypeScript 6
- Tailwind CSS 4
- Postgres (via Prisma)
`;
  }

  private generateGitignore(): string {
    return `node_modules/
.next/
out/
dist/
*.local
.env
.env.local
.DS_Store
*.tsbuildinfo
next-env.d.ts
`;
  }

  private toKebabCase(str: string): string {
    return str.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '').replace(/-+/g, '-');
  }
}

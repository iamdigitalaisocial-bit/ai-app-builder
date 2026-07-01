import {
  AppSpec,
  BuildPlan,
  FileStructure,
  EntityMapping,
  APIRoute,
  DeploymentConfig,
  TargetStack
} from '@ai-app-builder/core';
import { createModelProvider, type ChatMessage } from '@ai-app-builder/model-provider';

export class Planner {
  private modelProvider: any;

  constructor() {
    this.modelProvider = createModelProvider('ollama');
  }

  async createBuildPlan(spec: AppSpec): Promise<BuildPlan> {
    const targetStack = this.selectTargetStack(spec);
    const template = this.selectTemplate(spec);
    const fileStructure = this.generateFileStructure(spec, template);
    const entityMappings = this.mapEntities(spec);
    const apiRoutes = this.generateAPIRoutes(spec);
    const deploymentConfig = this.generateDeploymentConfig(spec, targetStack);

    return {
      template,
      fileStructure,
      entityMappings,
      apiRoutes,
      deploymentConfig,
    };
  }

  private selectTargetStack(spec: AppSpec): TargetStack {
    return {
      frontend: 'nextjs',
      backend: spec.apiCapabilities.length > 0 ? 'nextjs-api' : 'node',
      database: 'postgres',
      styling: 'tailwind',
      deployment: spec.deploymentClass,
    };
  }

  private selectTemplate(spec: AppSpec): string {
    // Select template based on app category and deployment class
    if (spec.deploymentClass === 'static-marketing') {
      return 'nextjs-marketing';
    } else if (spec.deploymentClass === 'nextjs-fullstack') {
      return 'nextjs-postgres';
    } else if (spec.deploymentClass === 'postgres-backed') {
      return 'nextjs-postgres';
    } else {
      return 'nextjs-postgres'; // Default template
    }
  }

  private generateFileStructure(spec: AppSpec, template: string): FileStructure {
    const structure: FileStructure = {
      'src': {
        type: 'directory',
        children: {
          'app': {
            type: 'directory',
            children: this.generateAppDirectory(spec),
          },
          'components': {
            type: 'directory',
            children: this.generateComponentsDirectory(spec),
          },
          'lib': {
            type: 'directory',
            children: {
              'db.ts': { type: 'file', content: '// Database configuration' },
              'auth.ts': { type: 'file', content: '// Authentication configuration' },
            },
          },
        },
      },
      'public': {
        type: 'directory',
        children: {},
      },
      'package.json': { type: 'file', content: this.generatePackageJson(spec) },
      'tsconfig.json': { type: 'file', content: this.generateTsConfig() },
      'tailwind.config.ts': { type: 'file', content: this.generateTailwindConfig() },
      'next.config.js': { type: 'file', content: this.generateNextConfig() },
    };

    return structure;
  }

  private generateAppDirectory(spec: AppSpec): FileStructure {
    const children: FileStructure = {
      'layout.tsx': { type: 'file', content: this.generateLayout() },
      'page.tsx': { type: 'file', content: this.generateHomePage(spec) },
      'globals.css': { type: 'file', content: this.generateGlobalsCSS() },
    };

    // Generate page files for each page in spec
    for (const page of spec.pages || []) {
      const routePath = page.route.replace(/^\//, '') || 'page';
      children[`${routePath}.tsx`] = {
        type: 'file',
        content: this.generatePageCode(page),
      };
    }

    return children;
  }

  private generateComponentsDirectory(spec: AppSpec): FileStructure {
    return {
      'ui': {
        type: 'directory',
        children: {
          'button.tsx': { type: 'file', content: this.generateButtonComponent() },
          'card.tsx': { type: 'file', content: this.generateCardComponent() },
          'input.tsx': { type: 'file', content: this.generateInputComponent() },
        },
      },
    };
  }

  private mapEntities(spec: AppSpec): EntityMapping[] {
    return (spec.entities || []).map(entity => ({
      entity: entity.name,
      table: this.toSnakeCase(entity.name),
      fields: entity.fields.map(field => ({
        field: field.name,
        column: this.toSnakeCase(field.name),
        type: this.mapFieldType(field.type),
      })),
    }));
  }

  private generateAPIRoutes(spec: AppSpec): APIRoute[] {
    const routes: APIRoute[] = [];

    if (spec.apiCapabilities.includes('crud')) {
      for (const entity of spec.entities || []) {
        const tableName = this.toSnakeCase(entity.name);
        routes.push(
          {
            path: `/api/${tableName}`,
            method: 'GET',
            handler: `get${entity.name}`,
            auth: spec.authRequirements.enabled,
          },
          {
            path: `/api/${tableName}`,
            method: 'POST',
            handler: `create${entity.name}`,
            auth: spec.authRequirements.enabled,
          },
          {
            path: `/api/${tableName}/[id]`,
            method: 'PUT',
            handler: `update${entity.name}`,
            auth: spec.authRequirements.enabled,
          },
          {
            path: `/api/${tableName}/[id]`,
            method: 'DELETE',
            handler: `delete${entity.name}`,
            auth: spec.authRequirements.enabled,
          }
        );
      }
    }

    return routes;
  }

  private generateDeploymentConfig(spec: AppSpec, targetStack: TargetStack): DeploymentConfig {
    return {
      type: spec.deploymentClass,
      environment: {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:password@localhost:5432/dbname',
      },
      buildCommands: ['npm run build'],
      startCommands: ['npm start'],
    };
  }

  // Helper methods for code generation
  private generatePackageJson(spec: AppSpec): string {
    return JSON.stringify({
      name: 'generated-app',
      version: '0.1.0',
      private: true,
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
        lint: 'next lint',
      },
      dependencies: {
        next: '^16.2.0',
        react: '^19.2.0',
        'react-dom': '^19.2.0',
        '@prisma/client': '^5.0.0',
        prisma: '^5.0.0',
      },
      devDependencies: {
        '@types/node': '^20.0.0',
        '@types/react': '^19.0.0',
        '@types/react-dom': '^19.0.0',
        typescript: '^6.0.0',
        tailwindcss: '^4.3.0',
        autoprefixer: '^10.0.0',
        postcss: '^8.0.0',
        eslint: '^9.0.0',
        'eslint-config-next': '^16.0.0',
      },
    }, null, 2);
  }

  private generateTsConfig(): string {
    return JSON.stringify({
      compilerOptions: {
        target: 'ES2025',
        lib: ['ES2025'],
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        declaration: true,
        declarationMap: true,
        sourceMap: true,
        outDir: './dist',
        rootDir: './src',
        baseUrl: '.',
        paths: {
          '@/*': ['./src/*'],
        },
      },
      include: ['src/**/*'],
      exclude: ['node_modules', 'dist', '.next'],
    }, null, 2);
  }

  private generateTailwindConfig(): string {
    return `import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
export default config`;
  }

  private generateNextConfig(): string {
    return `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
}

module.exports = nextConfig`;
  }

  private generateLayout(): string {
    return `import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Generated App',
  description: 'Generated by AI App Builder',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  )
}`;
  }

  private generateHomePage(spec: AppSpec): string {
    return `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-4">${spec.appCategory}</h1>
      <p className="text-lg text-gray-600">
        Welcome to your generated application
      </p>
    </main>
  )
}`;
  }

  private generateGlobalsCSS(): string {
    return `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --foreground-rgb: 0, 0, 0;
  --background-start-rgb: 214, 219, 220;
  --background-end-rgb: 255, 255, 255;
}

@media (prefers-color-scheme: dark) {
  :root {
    --foreground-rgb: 255, 255, 255;
    --background-start-rgb: 0, 0, 0;
    --background-end-rgb: 0, 0, 0;
  }
}

body {
  color: rgb(var(--foreground-rgb));
  background: linear-gradient(
      to bottom,
      transparent,
      rgb(var(--background-end-rgb))
    )
    rgb(var(--background-start-rgb));
}`;
  }

  private generatePageCode(page: any): string {
    return `export default function ${page.name.replace(/\s+/g, '')}() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">${page.name}</h1>
      <p>Page content for ${page.route}</p>
    </div>
  )
}`;
  }

  private generateButtonComponent(): string {
    return `export default function Button({ children, ...props }: any) {
  return (
    <button
      className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      {...props}
    >
      {children}
    </button>
  )
}`;
  }

  private generateCardComponent(): string {
    return `export default function Card({ children, ...props }: any) {
  return (
    <div className="border rounded-lg p-4 shadow-sm" {...props}>
      {children}
    </div>
  )
}`;
  }

  private generateInputComponent(): string {
    return `export default function Input({ ...props }: any) {
  return (
    <input
      className="border rounded px-3 py-2 w-full"
      {...props}
    />
  )
}`;
  }

  private toSnakeCase(str: string): string {
    return str
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');
  }

  private mapFieldType(type: string): string {
    const typeMap: Record<string, string> = {
      string: 'text',
      number: 'integer',
      boolean: 'boolean',
      date: 'timestamp',
    };
    return typeMap[type] || 'text';
  }
}

export function createPlanner(): Planner {
  return new Planner();
}

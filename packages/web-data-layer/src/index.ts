import {
  WebDataSource,
  WebDataExtraction,
  KnowledgeBase
} from '@ai-app-builder/core';

export class WebDataLayer {
  private apiKey: string;
  private baseUrl: string = 'https://api.firecrawl.dev';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async scrapeUrl(url: string, options: ScrapeOptions = {}): Promise<WebDataExtraction> {
    const response = await fetch(`${this.baseUrl}/v1/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: options.formats || ['markdown'],
        onlyMainContent: options.onlyMainContent !== false,
        waitFor: options.waitFor,
      }),
    });

    if (!response.ok) {
      throw new Error(`Firecrawl scrape error: ${response.statusText}`);
    }

    const data = await response.json();
    
    return {
      source: {
        type: 'url',
        target: url,
      },
      extractedData: data,
      timestamp: new Date(),
      hash: this.generateHash(data),
    };
  }

  async crawlSite(
    url: string, 
    options: CrawlOptions = {}
  ): Promise<WebDataExtraction[]> {
    const response = await fetch(`${this.baseUrl}/v1/crawl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        url,
        limit: options.limit || 100,
        depth: options.depth || 2,
        excludePaths: options.excludePaths,
        formats: options.formats || ['markdown'],
      }),
    });

    if (!response.ok) {
      throw new Error(`Firecrawl crawl error: ${response.statusText}`);
    }

    const data = await response.json();
    
    return data.map((item: any) => ({
      source: {
        type: 'url',
        target: item.url,
      },
      extractedData: item,
      timestamp: new Date(),
      hash: this.generateHash(item),
    }));
  }

  async extractStructuredData<T>(
    url: string,
    schema: object,
    options: ScrapeOptions = {}
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}/v1/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ['json'],
        jsonOptions: {
          prompt: options.prompt || 'Extract structured data from this page',
          schema,
        },
        onlyMainContent: options.onlyMainContent !== false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Firecrawl structured extraction error: ${response.statusText}`);
    }

    const data = await response.json();
    return data as T;
  }

  async buildKnowledgeBase(
    sources: WebDataSource[],
    options: KnowledgeBaseOptions = {}
  ): Promise<KnowledgeBase> {
    const extractions: WebDataExtraction[] = [];

    for (const source of sources) {
      if (source.type === 'url') {
        const extraction = await this.scrapeUrl(source.target, {
          onlyMainContent: true,
        });
        extractions.push(extraction);
      } else if (source.type === 'domain') {
        const crawls = await this.crawlSite(source.target, {
          limit: options.maxPages || 50,
          depth: options.depth || 2,
        });
        extractions.push(...crawls);
      }
    }

    // In a full implementation, this would generate embeddings using pgvector
    return {
      id: this.generateId(),
      name: options.name || 'Knowledge Base',
      sources,
      embeddings: [], // TODO: Implement embedding generation
      metadata: {
        totalSources: sources.length,
        totalExtractions: extractions.length,
        createdAt: new Date().toISOString(),
      },
    };
  }

  async monitorUrl(
    url: string,
    webhookUrl: string,
    options: MonitorOptions = {}
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v1/map`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        url,
        webhook: webhookUrl,
        frequency: options.frequency || 'daily',
      }),
    });

    if (!response.ok) {
      throw new Error(`Firecrawl monitor error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.id;
  }

  private generateHash(data: unknown): string {
    const str = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Types
export interface ScrapeOptions {
  formats?: ('markdown' | 'html' | 'json' | 'links')[];
  onlyMainContent?: boolean;
  waitFor?: number;
  prompt?: string;
}

export interface CrawlOptions {
  limit?: number;
  depth?: number;
  excludePaths?: string[];
  formats?: ('markdown' | 'html' | 'json')[];
}

export interface KnowledgeBaseOptions {
  name?: string;
  maxPages?: number;
  depth?: number;
}

export interface MonitorOptions {
  frequency?: 'hourly' | 'daily' | 'weekly';
}

export function createWebDataLayer(apiKey: string): WebDataLayer {
  return new WebDataLayer(apiKey);
}

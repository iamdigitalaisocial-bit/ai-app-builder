import { AppSpec, ValidationLayer, ValidationResult } from '@ai-app-builder/core';
import { createModelProvider, type ChatMessage } from '@ai-app-builder/model-provider';

export class SpecEngine {
  private modelProvider: any;

  constructor() {
    this.modelProvider = createModelProvider('ollama');
  }

  async generateSpec(prompt: string): Promise<AppSpec> {
    const systemPrompt = this.getSystemPrompt();
    const userPrompt = this.formatUserPrompt(prompt);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.modelProvider.chat(messages, {
      temperature: 0.3,
      maxTokens: 1024,
      model: 'qwen3.5:2b',
    });

    return this.parseSpecResponse(response);
  }

  async validateSpec(spec: AppSpec): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate required fields
    if (!spec.appCategory) {
      errors.push('App category is required');
    }

    if (!spec.pages || spec.pages.length === 0) {
      errors.push('At least one page is required');
    }

    if (!spec.entities || spec.entities.length === 0) {
      warnings.push('No entities defined - consider adding data models');
    }

    // Validate page structure
    for (const page of spec.pages || []) {
      if (!page.id || !page.name || !page.route) {
        errors.push(`Invalid page structure: ${JSON.stringify(page)}`);
      }
    }

    // Validate entity structure
    for (const entity of spec.entities || []) {
      if (!entity.name || !entity.fields) {
        errors.push(`Invalid entity structure: ${JSON.stringify(entity)}`);
      }
    }

    return {
      layer: 'spec-validation' as ValidationLayer,
      status: errors.length === 0 ? 'pass' : 'fail',
      errors: errors.map(e => ({
        code: 'SPEC_ERROR',
        message: e,
        severity: 'error' as const,
        category: 'unknown' as const,
      })),
      warnings: warnings.map(w => ({
        code: 'SPEC_WARNING',
        message: w,
        category: 'unknown' as const,
      })),
    };
  }

  async generateClarificationQuestions(spec: AppSpec): Promise<string[]> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'You are an expert software architect. Review the app specification and identify ambiguous or missing information that should be clarified before implementation.',
      },
      {
        role: 'user',
        content: `Review this app specification and generate 3-5 specific clarification questions:\n\n${JSON.stringify(spec, null, 2)}`,
      },
    ];

    const response = await this.modelProvider.chat(messages, {
      temperature: 0.5,
      maxTokens: 256,
      model: 'qwen3.5:2b',
    });

    return this.parseQuestions(response);
  }

  private getSystemPrompt(): string {
    return `You are an expert software architect. Convert app descriptions into structured JSON specs.

Rules:
1. Return ONLY valid JSON
2. Follow this exact structure:
{
  "appCategory": "marketing-site|nextjs-fullstack|api-service|internal-tool",
  "pages": [{"id":"","name":"","route":"/","components":[],"dataRequirements":[]}],
  "entities": [{"name":"","fields":[{"name":"","type":"string|number|boolean|date","required":true}],"relationships":[]}],
  "apiCapabilities": [],
  "authRequirements": {"enabled":false,"providers":[],"protectedRoutes":[]},
  "thirdPartyIntegrations": [],
  "deploymentClass": "static-marketing|nextjs-fullstack|postgres-backed",
  "agentRequirements": {"enabled":false,"tools":[],"capabilities":[]},
  "webDataRequirements": {"enabled":false,"sources":[],"updateFrequency":"daily"},
  "constraints": {"maxComplexity":5,"preferredLibraries":[],"excludeLibraries":[],"performanceRequirements":{}}
}

Be specific and practical. Focus on Next.js + Tailwind + Postgres stack.`;
  }

  private formatUserPrompt(prompt: string): string {
    return `Convert this app description into a structured specification:\n\n${prompt}\n\nReturn ONLY valid JSON, no other text.`;
  }

  private parseSpecResponse(response: string): AppSpec {
    try {
      // Extract JSON from response (in case there's extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as AppSpec;
      }
      return JSON.parse(response) as AppSpec;
    } catch (error) {
      console.error('Failed to parse spec response:', error);
      throw new Error('Invalid spec response from model');
    }
  }

  private parseQuestions(response: string): string[] {
    // Parse questions from the response
    const lines = response.split('\n').filter(line => line.trim());
    const questions: string[] = [];

    for (const line of lines) {
      // Look for question patterns
      if (line.includes('?') || line.toLowerCase().includes('what') || 
          line.toLowerCase().includes('how') || line.toLowerCase().includes('should')) {
        questions.push(line.trim());
      }
    }

    return questions.length > 0 ? questions : ['Please clarify the main use case', 'What are the key features required?'];
  }
}

export function createSpecEngine(): SpecEngine {
  return new SpecEngine();
}

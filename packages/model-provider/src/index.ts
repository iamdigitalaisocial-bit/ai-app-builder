import {
  ModelProvider,
  Model,
  ModelCapabilities,
  ModelPricing
} from '@ai-app-builder/core';

// Ollama Model Provider Implementation
export class OllamaProvider implements ModelProvider {
  name = 'ollama';
  type = 'ollama' as const;
  endpoint = 'http://localhost:11434';
  models: Model[] = [];
  private readyPromise: Promise<void> | null = null;

  constructor(endpoint?: string) {
    if (endpoint) {
      this.endpoint = endpoint;
    }
    this.readyPromise = this.initializeModels();
  }

  private async ensureReady(): Promise<void> {
    if (this.readyPromise) {
      await this.readyPromise;
    }
  }

  private async initializeModels(): Promise<void> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`);
      const data = await response.json();

      this.models = data.models.map((model: any) => ({
        id: model.name,
        name: model.name,
        capabilities: this.inferCapabilities(model.name),
        contextWindow: this.getContextWindow(model.name),
      }));

      // Sort by speed: smaller/faster models first
      const priority = (name: string): number => {
        if (name.includes('qwen3.5:4b')) return 0;
        if (name.includes('qwen3.5:2b')) return 1;
        if (name.includes('qwen3.5:9b')) return 2;
        if (name.includes('qwen3.5:0.8b')) return 3;
        if (name.includes('gemma4')) return 4;
        return 5;
      };
      this.models.sort((a, b) => priority(a.id) - priority(b.id));
    } catch (error) {
      console.error('Failed to fetch Ollama models:', error);
      this.models = this.getDefaultModels();
    }
  }

  private inferCapabilities(modelName: string): ModelCapabilities {
    const isCodeModel = modelName.includes('code') || modelName.includes('coder');
    const isChatModel = modelName.includes('chat') || modelName.includes('instruct');

    return {
      codeGeneration: isCodeModel || isChatModel,
      structuredOutput: isChatModel,
      functionCalling: isChatModel,
      streaming: true,
    };
  }

  private getContextWindow(modelName: string): number {
    if (modelName.includes('qwen3.5') || modelName.includes('qwen')) return 262144;
    if (modelName.includes('gemma4')) return 8192;
    if (modelName.includes('70b') || modelName.includes('72b')) return 8192;
    if (modelName.includes('34b') || modelName.includes('33b')) return 4096;
    if (modelName.includes('14b') || modelName.includes('13b')) return 4096;
    if (modelName.includes('7b') || modelName.includes('8b')) return 2048;
    return 2048;
  }

  private getDefaultModels(): Model[] {
    return [
      {
        id: 'llama3.2',
        name: 'llama3.2',
        capabilities: {
          codeGeneration: true,
          structuredOutput: true,
          functionCalling: true,
          streaming: true,
        },
        contextWindow: 2048,
      },
      {
        id: 'codellama',
        name: 'codellama',
        capabilities: {
          codeGeneration: true,
          structuredOutput: false,
          functionCalling: false,
          streaming: true,
        },
        contextWindow: 4096,
      },
    ];
  }

  async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    await this.ensureReady();
    const model = options.model || this.models[0]?.id || 'qwen3.5:2b';

    const response = await fetch(`${this.endpoint}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt,
        stream: options.stream || false,
        options: {
          temperature: options.temperature || 0.7,
          num_predict: options.maxTokens || 1024,
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${text}`);
    }

    if (options.stream) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      let result = '';
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.response) {
              result += data.response;
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }

      return result;
    } else {
      const data = await response.json();
      return data.response;
    }
  }

  async generateWithSchema<T>(
    prompt: string,
    schema: object,
    options: GenerateOptions = {}
  ): Promise<T> {
    const response = await this.generate(
      `${prompt}\n\nReturn a JSON response matching this schema:\n${JSON.stringify(schema, null, 2)}`,
      { ...options, temperature: 0.1 }
    );

    try {
      return JSON.parse(response) as T;
    } catch (error) {
      throw new Error(`Failed to parse structured output: ${error}`);
    }
  }

  async chat(messages: ChatMessage[], options: GenerateOptions = {}): Promise<string> {
    await this.ensureReady();
    const model = options.model || this.models[0]?.id || 'qwen3.5:2b';

    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: options.stream || false,
        options: {
          temperature: options.temperature || 0.7,
          num_predict: options.maxTokens || 1024,
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${text}`);
    }

    const data = await response.json();
    return data.message?.content || '';
  }

  getModels(): Model[] {
    return this.models;
  }

  getModel(modelId: string): Model | undefined {
    return this.models.find(m => m.id === modelId);
  }
}

// Types
export interface GenerateOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Factory function
export function createModelProvider(type: 'ollama' | 'vllm' | 'tgi', endpoint?: string): ModelProvider {
  switch (type) {
    case 'ollama':
      return new OllamaProvider(endpoint);
    case 'vllm':
      // TODO: Implement vLLM provider
      throw new Error('vLLM provider not yet implemented');
    case 'tgi':
      // TODO: Implement TGI provider
      throw new Error('TGI provider not yet implemented');
    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}

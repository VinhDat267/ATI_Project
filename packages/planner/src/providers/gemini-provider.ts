import { GoogleGenAI } from '@google/genai';
import type { LLMProvider, LLMGeneratePlanInput } from '../types.js';

export interface GeminiProviderConfig {
  apiKey?: string;
  model?: string;
}

export class GeminiProvider implements LLMProvider {
  public readonly name = 'gemini';
  private apiKey: string;
  private model: string;
  private ai?: GoogleGenAI;

  constructor(config: GeminiProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is required for GeminiProvider');
    }
    this.model = config.model || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  }

  private getClient(): GoogleGenAI {
    if (!this.ai) {
      this.ai = new GoogleGenAI({ apiKey: this.apiKey });
    }
    return this.ai;
  }

  async generatePlan(input: LLMGeneratePlanInput): Promise<string> {
    const ai = this.getClient();
    const systemPrompt = `${input.systemPrompt}\n\nWorking Memory Context:\n${JSON.stringify(input.workingMemory, null, 2)}`;

    try {
      const response = await ai.models.generateContent({
        model: this.model,
        contents: input.conversationHistory.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
        },
      });

      return response.text || '';
    } catch (err: any) {
      // Fallback to gemini-1.5-flash if 2.5-flash is not available on this tier
      if (this.model !== 'gemini-1.5-flash') {
        try {
          const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: input.conversationHistory.map((m) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            })),
            config: {
              systemInstruction: systemPrompt,
              responseMimeType: 'application/json',
            },
          });
          return response.text || '';
        } catch {
          throw err;
        }
      }
      throw err;
    }
  }
}

import type { LLMProvider, LLMGeneratePlanInput } from '../types.js';

export class MockLLMProvider implements LLMProvider {
  public readonly name = 'mock';
  private responses: string[] = [];
  private callCount = 0;
  private lastInput?: LLMGeneratePlanInput;

  setResponses(responses: string[]): void {
    this.responses = [...responses];
  }

  setPlanResponses(plans: any[]): void {
    this.responses = plans.map((p) => (typeof p === 'string' ? p : JSON.stringify(p)));
  }

  getCallCount(): number {
    return this.callCount;
  }

  getLastInput(): LLMGeneratePlanInput | undefined {
    return this.lastInput;
  }

  reset(): void {
    this.responses = [];
    this.callCount = 0;
    this.lastInput = undefined;
  }

  async generatePlan(input: LLMGeneratePlanInput): Promise<string> {
    this.lastInput = input;
    const response = this.responses[this.callCount] || this.responses[this.responses.length - 1] || '{}';
    this.callCount++;
    return response;
  }
}

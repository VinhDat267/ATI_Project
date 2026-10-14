export type RuntimeMode = 'live' | 'sandbox';

export function mayUseMemoryStorage(mode: RuntimeMode): boolean {
  return mode === 'sandbox';
}

export function createRuntimeAdapterFactory<TContext = unknown>(
  mode: RuntimeMode,
  real: (serviceName: string, context?: TContext) => Promise<any>,
  sandbox: (serviceName: string, context?: TContext) => any
) {
  return {
    // The context (who, planning or execution, previewed connections) reaches both factories.
    getAdapterForService: (serviceName: string, ...context: [TContext?]) =>
      mode === 'live' ? real(serviceName, ...context) : sandbox(serviceName, ...context),
  };
}

export function createRuntimePlanner<TInput, TOutput>(
  mode: RuntimeMode,
  primary: (input: TInput) => Promise<TOutput>,
  sandboxFallback: (input: TInput) => Promise<TOutput>
) {
  return {
    processMessage: async (input: TInput): Promise<TOutput> => {
      try {
        return await primary(input);
      } catch (err) {
        if (mode === 'live') throw err;
        return sandboxFallback(input);
      }
    },
  };
}

export type RuntimeMode = 'live' | 'sandbox';

export function mayUseMemoryStorage(mode: RuntimeMode): boolean {
  return mode === 'sandbox';
}

export function createRuntimeAdapterFactory(
  mode: RuntimeMode,
  real: (serviceName: string) => Promise<any>,
  sandbox: (serviceName: string) => any
) {
  return {
    getAdapterForService: (serviceName: string) =>
      mode === 'live' ? real(serviceName) : sandbox(serviceName),
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

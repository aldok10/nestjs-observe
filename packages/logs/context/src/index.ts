import { mergeContexts } from '@aldok10/nestjs-observe-logger-core/context';
import type { LogContext, LogContextProvider } from '@aldok10/nestjs-observe-logger-core/contracts';

export { createActiveSpanProvider, fromActiveSpan, withActiveSpan } from './otel-span.js';

/** Wraps a getter as a core LogContextProvider without creating a store. */
export function createContextProvider(
  getContext: () => LogContext | undefined,
): LogContextProvider {
  return { getContext };
}

/**
 * Combines providers with deterministic precedence: later providers win.
 * A throwing provider is skipped; it cannot block the others or leak state.
 */
export function composeContextProviders(
  ...providers: readonly LogContextProvider[]
): LogContextProvider {
  return {
    getContext(): LogContext | undefined {
      let merged: LogContext | undefined;
      for (const provider of providers) {
        let context: LogContext | undefined;
        try {
          context = provider.getContext();
        } catch {
          continue;
        }
        if (context !== undefined) merged = mergeContexts(merged, context);
      }
      return merged;
    },
    runWithContext<T>(context: LogContext, fn: () => T): T {
      for (const provider of providers) {
        if (provider.runWithContext !== undefined) return provider.runWithContext(context, fn);
      }
      return fn();
    },
  };
}

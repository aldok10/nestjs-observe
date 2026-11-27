import { registerInstrumentations, type Instrumentation } from '@opentelemetry/instrumentation';
import {
  HttpInstrumentation,
  type HttpInstrumentationConfig,
} from '@opentelemetry/instrumentation-http';

export interface HttpTracingInstrumentationOptions {
  readonly ignoreIncomingRequestUrls?: readonly (string | RegExp)[];
  readonly ignoreOutgoingRequestUrls?: readonly (string | RegExp)[];
  readonly headersToSpanAttributes?: HttpInstrumentationConfig['headersToSpanAttributes'];
}

let registered = false;
let unregisterHandle: (() => void) | undefined;

export function createHttpTracingInstrumentation(
  options: HttpTracingInstrumentationOptions = {},
): HttpInstrumentation {
  const ignoreIncoming = options.ignoreIncomingRequestUrls;
  const ignoreOutgoing = options.ignoreOutgoingRequestUrls;

  return new HttpInstrumentation({
    ...(options.headersToSpanAttributes !== undefined
      ? { headersToSpanAttributes: options.headersToSpanAttributes }
      : {}),
    ...(ignoreIncoming !== undefined
      ? {
          ignoreIncomingRequestHook: (request) => {
            const url = request.url ?? '';
            return ignoreIncoming.some((pattern) =>
              typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url),
            );
          },
        }
      : {}),
    ...(ignoreOutgoing !== undefined
      ? {
          ignoreOutgoingRequestHook: (request) => {
            const path = request.path ?? '';
            return ignoreOutgoing.some((pattern) =>
              typeof pattern === 'string' ? path.includes(pattern) : pattern.test(path),
            );
          },
        }
      : {}),
  });
}

export function registerHttpTracingInstrumentation(
  options: HttpTracingInstrumentationOptions = {},
): () => void {
  if (registered && unregisterHandle !== undefined) {
    return unregisterHandle;
  }
  const instrumentation: Instrumentation = createHttpTracingInstrumentation(options);
  const unregister = registerInstrumentations({
    instrumentations: [instrumentation],
  });
  registered = true;
  unregisterHandle = () => {
    unregister();
    registered = false;
    unregisterHandle = undefined;
  };
  return unregisterHandle;
}

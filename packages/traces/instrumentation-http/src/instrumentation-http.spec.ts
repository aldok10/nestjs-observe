import { describe, expect, it } from 'vitest';
import { createHttpTracingInstrumentation, registerHttpTracingInstrumentation } from './index.js';

describe('HTTP tracing instrumentation', () => {
  it('creates instrumentation and guards against duplicate registration', () => {
    const inst = createHttpTracingInstrumentation({
      ignoreIncomingRequestUrls: ['/health'],
      ignoreOutgoingRequestUrls: [/localhost:4318/],
    });
    expect(inst).toBeDefined();

    const unregister1 = registerHttpTracingInstrumentation();
    const unregister2 = registerHttpTracingInstrumentation();
    expect(unregister1).toBe(unregister2);
    unregister1();
  });
});

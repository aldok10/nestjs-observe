export class ObserveException extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class InvalidConfigurationException extends ObserveException {}

export class OptionalPeerMissingException extends ObserveException {
  constructor(
    readonly peerPackage: string,
    readonly featureName: string,
    cause?: unknown,
  ) {
    super(
      `Optional peer dependency "${peerPackage}" is required for ${featureName}. Install "${peerPackage}" to enable it.`,
      cause !== undefined ? { cause } : undefined,
    );
  }
}

export class ShutdownException extends ObserveException {
  constructor(readonly failures: readonly string[]) {
    super(`Shutdown failed for ${failures.length} participant(s): ${failures.join('; ')}`);
  }
}

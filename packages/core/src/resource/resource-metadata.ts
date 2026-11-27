export type ResourceAttributeValue = string | number | boolean;

export interface ResourceMetadata {
  readonly serviceName?: string;
  readonly serviceVersion?: string;
  readonly serviceNamespace?: string;
  readonly serviceInstanceId?: string;
  readonly environment?: string;
  readonly application?: string;
  readonly attributes?: Readonly<Record<string, ResourceAttributeValue>>;
}

function cleanAttributes(
  attributes: Readonly<Record<string, ResourceAttributeValue>> | undefined,
): Readonly<Record<string, ResourceAttributeValue>> | undefined {
  if (attributes === undefined) return undefined;
  const entries = Object.entries(attributes).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function createResourceMetadata(input: ResourceMetadata = {}): ResourceMetadata {
  const attributes = cleanAttributes(input.attributes);
  return {
    ...(input.serviceName !== undefined ? { serviceName: input.serviceName } : {}),
    ...(input.serviceVersion !== undefined ? { serviceVersion: input.serviceVersion } : {}),
    ...(input.serviceNamespace !== undefined ? { serviceNamespace: input.serviceNamespace } : {}),
    ...(input.serviceInstanceId !== undefined
      ? { serviceInstanceId: input.serviceInstanceId }
      : {}),
    ...(input.environment !== undefined ? { environment: input.environment } : {}),
    ...(input.application !== undefined ? { application: input.application } : {}),
    ...(attributes !== undefined ? { attributes } : {}),
  };
}

export function mergeResourceMetadata(
  base: ResourceMetadata | undefined,
  override: ResourceMetadata | undefined,
): ResourceMetadata {
  if (base === undefined && override === undefined) return {};
  if (base === undefined) return createResourceMetadata(override);
  if (override === undefined) return createResourceMetadata(base);
  const mergedAttributes =
    base.attributes !== undefined || override.attributes !== undefined
      ? { ...base.attributes, ...override.attributes }
      : undefined;
  return createResourceMetadata({
    ...base,
    ...override,
    ...(mergedAttributes !== undefined ? { attributes: mergedAttributes } : {}),
  });
}

export function toSemanticResourceAttributes(
  metadata: ResourceMetadata | undefined,
): Readonly<Record<string, ResourceAttributeValue>> {
  if (metadata === undefined) return {};
  const result: Record<string, ResourceAttributeValue> = {
    ...metadata.attributes,
  };
  if (metadata.serviceName !== undefined) result['service.name'] = metadata.serviceName;
  if (metadata.serviceVersion !== undefined) result['service.version'] = metadata.serviceVersion;
  if (metadata.serviceNamespace !== undefined) {
    result['service.namespace'] = metadata.serviceNamespace;
  }
  if (metadata.serviceInstanceId !== undefined) {
    result['service.instance.id'] = metadata.serviceInstanceId;
  }
  if (metadata.environment !== undefined) {
    result['deployment.environment.name'] = metadata.environment;
  }
  if (metadata.application !== undefined) result['app.name'] = metadata.application;
  return result;
}

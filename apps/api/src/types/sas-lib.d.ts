declare module 'sas-lib' {
  export function deriveAttestationPda(options: Record<string, unknown>): Promise<[string]>;
  export function getCreateAttestationInstruction(options: Record<string, unknown>): unknown;
  export function serializeAttestationData(schema: unknown, data: Record<string, unknown>): unknown;
  export function fetchSchema(rpc: unknown, schemaPda: string): Promise<{ data: unknown }>;
}

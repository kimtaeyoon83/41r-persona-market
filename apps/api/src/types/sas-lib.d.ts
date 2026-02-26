declare module 'sas-lib' {
  export function createSchema(options: Record<string, unknown>): Promise<{ address: { toString(): string } }>;
  export function issueAttestation(options: Record<string, unknown>): Promise<{ address: { toString(): string } }>;
  export function updateAttestation(options: Record<string, unknown>): Promise<{ success: boolean }>;
}

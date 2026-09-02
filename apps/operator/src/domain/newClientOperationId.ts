export function newClientOperationId(): string {
  return `op_${crypto.randomUUID()}`.slice(0, 64);
}

export interface IngestHealth {
  accepting: boolean;
  queueDepth: number;
  queueCapacity: number;
  inFlight: number;
}

const state: IngestHealth = {
  accepting: true,
  queueDepth: 0,
  queueCapacity: 1,
  inFlight: 0,
};

export function updateIngestHealth(next: Partial<IngestHealth>): void {
  Object.assign(state, next);
}

export function ingestHealth(): IngestHealth {
  return { ...state };
}

export function ingestReady(): boolean {
  return state.accepting && state.queueDepth < state.queueCapacity;
}

export function resetIngestHealth(): void {
  Object.assign(state, { accepting: true, queueDepth: 0, queueCapacity: 1, inFlight: 0 });
}

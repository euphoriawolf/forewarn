// Every outside call has a time limit, so a slow service makes the agent say what failed instead of
// hanging. The error names the service, and the agent passes that on in plain words.
export class Slow extends Error {}
export async function fetchIn(url: string, ms: number, who: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new Slow(`${who} did not answer within ${Math.round(ms / 1000)} seconds`);
    throw new Error(`${who} could not be reached: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// A read the edge can keep for ttl seconds. Open-Meteo limits requests per address, so people in the same
// forecast square share one read. Errors are never kept.
export const fetchShared = (url: string, ms: number, who: string, ttl: number) =>
  fetchIn(url, ms, who, { cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': ttl, '300-599': 0 } } } as RequestInit);

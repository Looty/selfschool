/**
 * Text a running chat or grade job has written so far, posted by the runner while the model is still answering.
 * It is progress only and lives in memory: the validated result is what gets stored, and a restart drops it.
 */
const partials = new Map<string, { text: string; at: number }>();

const MAX_AGE_MS = 15 * 60 * 1000;

export function setPartial(jobId: string, text: string, now = Date.now()): void {
  for (const [id, p] of partials) if (now - p.at > MAX_AGE_MS) partials.delete(id); // a runner that died mid-job leaves one behind
  partials.set(jobId, { text, at: now });
}

export const getPartial = (jobId: string | null | undefined): string | undefined => (jobId ? partials.get(jobId)?.text : undefined);

export const clearPartial = (jobId: string): void => void partials.delete(jobId);

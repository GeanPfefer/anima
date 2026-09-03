/** Host facts only. No prompt, source text, search text, or literal anchor. */
export interface CoderTranscriptEntry {
  readonly step: number;
  readonly round: number;
  readonly phase: 'read' | 'edit' | 'application';
  readonly path: string;
  readonly operation: 'read' | 'replace_exact' | 'insert' | 'append' | 'create_file';
  readonly operationStep: number | null;
  readonly readRefs: readonly number[];
  readonly anchorReadRefs: readonly number[];
  readonly readHash: string | null;
  readonly expectedHash: string | null;
  readonly fingerprint: string;
  readonly normalizedFingerprint: string;
  readonly length: number;
  /** Only punctuation/whitespace survive; every other character becomes x. */
  readonly structure: string;
  readonly lines: readonly number[];
  readonly clipped: boolean;
  readonly rawMatchCount: number | null;
  readonly matchCount: number | null;
  readonly result: 'served' | 'stale_read' | 'invalid_anchor' | 'ambiguous_anchor' | 'normalized_match' | 'exact_match' | 'not_applicable' | 'applied' | 'batch_failed' | 'write_failed';
}

export interface CoderTranscript {
  readonly schemaVersion: 1;
  readonly call: number;
  readonly previousCall: number | null;
  readonly gateFingerprint: string | null;
  readonly diffFingerprint: string | null;
  readonly termination: string;
  readonly truncated: boolean;
  readonly entries: readonly CoderTranscriptEntry[];
}

const hash = (v: unknown): boolean => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const natural = (v: unknown): boolean => Number.isSafeInteger(v) && Number(v) >= 0;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string): boolean => Object.keys(v).sort().join(',') === keys.split(',').sort().join(',');
export function validCoderTranscripts(value: unknown): value is readonly CoderTranscript[] {
  if (!Array.isArray(value) || value.length > 16) return false;
  return value.every(t => {
    if (!object(t) || !exact(t, 'schemaVersion,call,previousCall,gateFingerprint,diffFingerprint,termination,truncated,entries')
      || t.schemaVersion !== 1 || !natural(t.call) || (t.previousCall !== null && (!natural(t.previousCall) || Number(t.previousCall) >= Number(t.call)))
      || (t.gateFingerprint !== null && !hash(t.gateFingerprint)) || (t.diffFingerprint !== null && !hash(t.diffFingerprint))
      || typeof t.termination !== 'string' || !/^(returned|failed|ollama_[a-z_]+)$/.test(t.termination)
      || typeof t.truncated !== 'boolean' || !Array.isArray(t.entries) || t.entries.length > 256) return false;
    const entries: unknown[] = t.entries;
    return entries.every((e, i) => object(e)
      && exact(e, 'step,round,phase,path,operation,operationStep,readRefs,anchorReadRefs,readHash,expectedHash,fingerprint,normalizedFingerprint,length,structure,lines,clipped,rawMatchCount,matchCount,result')
      && e.step === i + 1 && natural(e.round)
      && ['read','edit','application'].includes(String(e.phase))
      && typeof e.path === 'string' && e.path.length > 0 && e.path.length <= 300 && !/[\u0000-\u001f\\:]/.test(e.path) && !e.path.startsWith('/') && !e.path.split('/').includes('..')
      && ['read','replace_exact','insert','append','create_file'].includes(String(e.operation))
      && (e.operationStep === null || (natural(e.operationStep) && Number(e.operationStep) > 0 && Number(e.operationStep) < Number(e.step)))
      && Array.isArray(e.readRefs) && e.readRefs.length <= 256 && e.readRefs.every(r => natural(r) && r > 0 && r < Number(e.step) && object(entries[r - 1]) && (entries[r - 1] as Record<string, unknown>).phase === 'read')
      && Array.isArray(e.anchorReadRefs) && e.anchorReadRefs.length <= 256 && e.anchorReadRefs.every(r => Array.isArray(e.readRefs) && e.readRefs.includes(r))
      && (e.readHash === null || hash(e.readHash)) && (e.expectedHash === null || hash(e.expectedHash))
      && hash(e.fingerprint) && hash(e.normalizedFingerprint) && natural(e.length)
      && typeof e.structure === 'string' && e.structure.length <= 160 && /^[x\s{}()[\];:,.='"+\-*/<>!?]*$/.test(e.structure)
      && Array.isArray(e.lines) && e.lines.length <= 200 && e.lines.every(natural)
      && typeof e.clipped === 'boolean' && (e.rawMatchCount === null || natural(e.rawMatchCount)) && (e.matchCount === null || natural(e.matchCount))
      && ['served','stale_read','invalid_anchor','ambiguous_anchor','normalized_match','exact_match','not_applicable','applied','batch_failed','write_failed'].includes(String(e.result)));
  });
}

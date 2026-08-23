import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { parseCanonicalBacklog } from '@anima/core';
import { authenticateRequest } from '@/lib/supabase/request-auth';
import { projectRoot } from '@/lib/work-orchestration/executor-selection';
import { buildCanonicalMaterializerDeps } from '@/lib/work-orchestration/canonical-materializer-deps';
import { materializeNextCanonicalCandidate } from '@/lib/work-orchestration/canonical-materializer';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Materializa o PRÓXIMO candidato canônico elegível de um documento de backlog em UM
// work_item `proposed`, via a PLANNING BOUNDARY (planExecutableProjectWork) + a via
// ratificada de criação de proposta. Materialização ≠ aprovação: desfecho máximo `proposed`.
// SELEÇÃO determinística + correlação real; não duplica; fail-closed. Autenticação obrigatória.
//
// `document` é RESTRITO a `docs/…​.md` sob a raiz do projeto (evita leitura arbitrária de
// arquivo). Default = o backlog canônico do Modo Autônomo V0. Uma FIXTURE controlada pode
// ser apontada para provar o mecanismo sem alterar o backlog real.

const DEFAULT_DOCUMENT = 'docs/planos/002-modo-autonomo-v0-backlog.md';
const DOC_RE = /^docs\/[A-Za-z0-9_./-]+\.md$/;

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });

  const body = await request.json().catch(() => null) as { document?: unknown } | null;
  const document = typeof body?.document === 'string' && body.document.length > 0 ? body.document : DEFAULT_DOCUMENT;
  if (!DOC_RE.test(document) || document.includes('..')) {
    return Response.json({ ok: false, error: { code: 'invalid_document', message: 'document deve ser docs/….md sob a raiz.' } }, { status: 400 });
  }

  const root = projectRoot();
  const docsRoot = resolve(root, 'docs');
  const full = resolve(root, document);
  if (full !== docsRoot && !full.startsWith(docsRoot + sep)) {
    return Response.json({ ok: false, error: { code: 'invalid_document' } }, { status: 400 });
  }

  let markdown: string;
  try {
    markdown = await readFile(full, 'utf8');
  } catch {
    return Response.json({ ok: false, error: { code: 'document_not_found' } }, { status: 404 });
  }

  const allCandidates = parseCanonicalBacklog({ document, markdown });
  const deps = buildCanonicalMaterializerDeps(auth.client, auth.userId);
  const result = await materializeNextCanonicalCandidate({ allCandidates }, deps);

  return Response.json({ ok: true, value: result, candidates: allCandidates.length }, { status: 200 });
}

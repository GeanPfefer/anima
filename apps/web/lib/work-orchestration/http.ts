import type { WorkOperationResult } from '@anima/core';
export function operationResponse<T>(result: WorkOperationResult<T>, serialize: (value: T) => unknown) {
  if (result.ok) return Response.json({ ok: true, value: serialize(result.value) });
  const status = result.error.code === 'authentication_required' ? 401 : result.error.code === 'work_item_not_found' || result.error.code === 'orchestration_not_enabled' ? 404 : result.error.code === 'version_conflict' ? 409 : result.error.code === 'invalid_input' || result.error.code === 'invalid_transition' ? 400 : 503;
  return Response.json({ ok: false, error: { code: result.error.code, message: result.error.message, retryable: result.error.retryable } }, { status });
}

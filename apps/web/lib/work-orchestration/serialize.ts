import type { WorkEvent, WorkItem } from '@anima/core';
export const serializeWorkItem = (item: WorkItem) => ({ ...item, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() });
export const serializeWorkEvent = (event: WorkEvent) => ({ ...event, occurredAt: event.occurredAt.toISOString() });

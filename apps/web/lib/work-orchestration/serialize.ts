import { presentWorkItem, type WorkEvent, type WorkItem } from '@anima/core';
export const serializeWorkItem = (item: WorkItem) => ({ ...item, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() });
export const serializeWorkEvent = (event: WorkEvent) => ({ ...event, occurredAt: event.occurredAt.toISOString() });
export const serializeWorkPresentation = (item:WorkItem,events:readonly WorkEvent[]) => ({...presentWorkItem(item,events),item:serializeWorkItem(item)});

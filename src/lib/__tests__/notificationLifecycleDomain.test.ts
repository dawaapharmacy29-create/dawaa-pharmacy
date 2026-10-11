import { describe, expect, it } from 'vitest';
import {
  notificationLifecycleState,
  notificationRequiresOutcomeNote,
  notificationTransitionAllowed,
  type NotificationLike,
} from '@/lib/notifications/notificationDomain';
import {
  getNotificationPageRange,
  mergeNotificationPages,
  NOTIFICATION_PAGE_SIZE,
} from '@/lib/notifications/notificationPagination';

function notification(overrides: Partial<NotificationLike> = {}): NotificationLike {
  return {
    type: 'staff_task',
    priority: 'high',
    action_status: 'new',
    requires_action: true,
    metadata: {},
    ...overrides,
  };
}

describe('notification lifecycle domain', () => {
  it('requests notifications in 50-row pages with the next offset at 50', () => {
    expect(NOTIFICATION_PAGE_SIZE).toBe(50);
    expect(getNotificationPageRange(1)).toEqual({ from: 0, to: 49 });
    expect(getNotificationPageRange(2)).toEqual({ from: 50, to: 99 });
    expect(getNotificationPageRange(1, 500)).toEqual({ from: 0, to: 49 });
  });

  it('merges pages in descending creation order without duplicate rows or changing row fields', () => {
    const firstPage = [
      { id: 'newest', title: 'Newest', created_at: '2026-10-11T12:00:00Z', body: 'unchanged' },
      { id: 'overlap', title: 'Existing row', created_at: '2026-10-11T11:00:00Z', body: 'keep rendering' },
    ];
    const secondPage = [
      { id: 'overlap', title: 'Duplicate row', created_at: '2026-10-11T11:00:00Z', body: 'must not replace' },
      { id: 'oldest', title: 'Oldest', created_at: '2026-10-11T10:00:00Z', body: 'unchanged' },
    ];

    const merged = mergeNotificationPages(firstPage, secondPage);

    expect(merged.map((item) => item.id)).toEqual(['newest', 'overlap', 'oldest']);
    expect(merged[1]).toBe(firstPage[1]);
    expect(merged[0].body).toBe('unchanged');
    expect(merged[2].body).toBe('unchanged');
  });

  it('requires operational notifications to start before completion', () => {
    const item = notification();
    expect(notificationTransitionAllowed(item, 'in_progress')).toBe(true);
    expect(notificationTransitionAllowed(item, 'completed')).toBe(false);
    expect(notificationTransitionAllowed(item, 'escalated')).toBe(true);
    expect(notificationTransitionAllowed(item, 'dismissed')).toBe(true);
  });

  it('keeps completion behind an active lifecycle even for informational notifications', () => {
    const item = notification({ type: 'system', priority: 'normal', requires_action: false });
    expect(notificationTransitionAllowed(item, 'completed')).toBe(false);
    expect(notificationTransitionAllowed(item, 'in_progress')).toBe(true);
  });

  it('allows in-progress notifications to resolve or escalate', () => {
    const item = notification({ action_status: 'in_progress' });
    expect(notificationTransitionAllowed(item, 'completed')).toBe(true);
    expect(notificationTransitionAllowed(item, 'dismissed')).toBe(true);
    expect(notificationTransitionAllowed(item, 'escalated')).toBe(true);
  });

  it('never reopens terminal notifications', () => {
    expect(notificationTransitionAllowed(notification({ action_status: 'completed', requires_action: false }), 'in_progress')).toBe(false);
    expect(notificationTransitionAllowed(notification({ action_status: 'dismissed', requires_action: false }), 'escalated')).toBe(false);
  });

  it('allows escalated notifications to return to active handling', () => {
    const item = notification({ action_status: 'escalated' });
    expect(notificationTransitionAllowed(item, 'in_progress')).toBe(true);
    expect(notificationTransitionAllowed(item, 'completed')).toBe(true);
    expect(notificationTransitionAllowed(item, 'dismissed')).toBe(true);
  });

  it('requires an outcome note for closing actionable notifications', () => {
    const item = notification();
    expect(notificationRequiresOutcomeNote(item, 'completed')).toBe(true);
    expect(notificationRequiresOutcomeNote(item, 'dismissed')).toBe(true);
    expect(notificationRequiresOutcomeNote(item, 'in_progress')).toBe(false);
  });

  it('requires a note for high priority closure even when not actionable', () => {
    const item = notification({ type: 'system', priority: 'high', requires_action: false });
    expect(notificationRequiresOutcomeNote(item, 'completed')).toBe(true);
    expect(notificationRequiresOutcomeNote(item, 'dismissed')).toBe(true);
  });

  it('does not require a note for a normal informational system notification', () => {
    const item = notification({ type: 'system', priority: 'normal', requires_action: false });
    expect(notificationRequiresOutcomeNote(item, 'completed')).toBe(false);
    expect(notificationRequiresOutcomeNote(item, 'dismissed')).toBe(false);
  });

  it('normalizes legacy read states into the lifecycle model', () => {
    expect(notificationLifecycleState(notification({ action_status: undefined, status: 'unread' }))).toBe('new');
    expect(notificationLifecycleState(notification({ action_status: undefined, status: 'read' }))).toBe('read');
    expect(notificationLifecycleState(notification({ action_status: 'in_progress', status: 'read' }))).toBe('in_progress');
  });
});

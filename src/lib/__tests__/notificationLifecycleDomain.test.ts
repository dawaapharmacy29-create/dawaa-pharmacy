import { describe, expect, it } from 'vitest';
import {
  notificationLifecycleState,
  notificationRequiresOutcomeNote,
  notificationTransitionAllowed,
  type NotificationLike,
} from '@/lib/notifications/notificationDomain';

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

import { describe, expect, it } from 'vitest';
import { createSelectedCaseRequestGate } from '../selectedCaseRequestGate';
import {
  confirmInvoiceThenReload,
  openSelectedCase,
  type SelectedCaseDetailSink,
} from '../selectedCaseDetailFlow';

// Deterministic regression for the selected-conversation window: every pending response is
// resolved by hand, in an adversarial order. No timers are involved.

interface Bundle {
  caseId: string;
  version: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

/** Records UI state exactly as the page's React setters would hold it. */
function recordingSink() {
  const state = {
    bundle: undefined as Bundle | null | undefined,
    error: null as string | null,
    confirmationMessage: null as string | null,
    confirmationError: null as string | null,
    confirming: false,
  };
  const sink: SelectedCaseDetailSink<Bundle> = {
    setBundle: (bundle) => { state.bundle = bundle; },
    setError: (message) => { state.error = message; },
    setConfirmationMessage: (message) => { state.confirmationMessage = message; },
    setConfirmationError: (message) => { state.confirmationError = message; },
    setConfirming: (confirming) => { state.confirming = confirming; },
  };
  return { state, sink };
}

/** A loader whose every call stays pending until the test settles it. */
function controlledLoader() {
  const calls: Array<{ caseId: string; signal: AbortSignal; response: Deferred<Bundle | null> }> = [];
  const load = (caseId: string, signal: AbortSignal) => {
    const response = deferred<Bundle | null>();
    calls.push({ caseId, signal, response });
    return response.promise;
  };
  return { calls, load };
}

/** Mirrors React: the previous effect's cleanup runs before the next case's effect. */
function navigator(gate: ReturnType<typeof createSelectedCaseRequestGate>, load: any, sink: SelectedCaseDetailSink<Bundle>) {
  let cleanup: (() => void) | null = null;
  return {
    open(caseId: string) {
      cleanup?.();
      cleanup = openSelectedCase(gate, caseId, load, sink);
    },
    unmount() {
      cleanup?.();
      cleanup = null;
    },
  };
}

describe('selected conversation — stale async overwrite', () => {
  it('a slow reload of A that finishes after the switch to B never replaces B', async () => {
    const gate = createSelectedCaseRequestGate();
    const { state, sink } = recordingSink();
    const loader = controlledLoader();
    const nav = navigator(gate, loader.load, sink);

    nav.open('A');
    loader.calls[0].response.resolve({ caseId: 'A', version: 'initial' });
    await flush();
    expect(state.bundle).toEqual({ caseId: 'A', version: 'initial' });

    // Start a slow confirm + reload for A.
    const confirmResponse = deferred<{ message: string; refreshFailure: string | null }>();
    const confirming = confirmInvoiceThenReload(gate, () => confirmResponse.promise, loader.load, sink);
    expect(state.confirming).toBe(true);

    // The user switches to B while A's confirmation is still running.
    nav.open('B');
    expect(state.bundle).toBeUndefined();
    expect(state.confirming).toBe(false);
    const bLoad = loader.calls.find((call) => call.caseId === 'B')!;
    bLoad.response.resolve({ caseId: 'B', version: 'initial' });
    await flush();
    expect(state.bundle).toEqual({ caseId: 'B', version: 'initial' });

    // A's confirmation and reload now finish.
    confirmResponse.resolve({ message: 'A confirmed', refreshFailure: 'late failure for A' });
    await flush();
    const aReload = loader.calls.filter((call) => call.caseId === 'A')[1];
    expect(aReload.signal.aborted).toBe(true);
    aReload.response.resolve({ caseId: 'A', version: 'after-confirm' });
    await confirming;
    await flush();

    expect(state.bundle).toEqual({ caseId: 'B', version: 'initial' });
    expect(state.confirmationMessage).toBeNull();
    expect(state.confirmationError).toBeNull();
    expect(state.confirming).toBe(false);
  });

  it('A → B → C: no response from A or B may overwrite C, in any completion order', async () => {
    const orders: Array<Array<'A' | 'B' | 'C'>> = [
      ['A', 'B', 'C'],
      ['C', 'B', 'A'],
      ['B', 'C', 'A'],
      ['C', 'A', 'B'],
    ];
    for (const order of orders) {
      const gate = createSelectedCaseRequestGate();
      const { state, sink } = recordingSink();
      const loader = controlledLoader();
      const nav = navigator(gate, loader.load, sink);

      nav.open('A');
      nav.open('B');
      nav.open('C');
      expect(loader.calls.map((call) => call.caseId)).toEqual(['A', 'B', 'C']);
      expect(loader.calls[0].signal.aborted).toBe(true);
      expect(loader.calls[1].signal.aborted).toBe(true);
      expect(loader.calls[2].signal.aborted).toBe(false);

      for (const caseId of order) {
        loader.calls.find((call) => call.caseId === caseId)!.response.resolve({ caseId, version: 'initial' });
        await flush();
      }
      expect({ order: order.join(''), bundle: state.bundle }).toEqual({ order: order.join(''), bundle: { caseId: 'C', version: 'initial' } });
      expect(state.error).toBeNull();
    }
  });

  it('a late error from a previous case is never shown on the current case', async () => {
    const gate = createSelectedCaseRequestGate();
    const { state, sink } = recordingSink();
    const loader = controlledLoader();
    const nav = navigator(gate, loader.load, sink);

    nav.open('A');
    nav.open('B');
    loader.calls[1].response.resolve({ caseId: 'B', version: 'initial' });
    loader.calls[0].response.reject(new Error('A failed late'));
    await flush();
    expect(state.bundle).toEqual({ caseId: 'B', version: 'initial' });
    expect(state.error).toBeNull();
  });

  it('returning to A starts a fresh generation: the first visit\'s late A response is ignored', async () => {
    const gate = createSelectedCaseRequestGate();
    const { state, sink } = recordingSink();
    const loader = controlledLoader();
    const nav = navigator(gate, loader.load, sink);

    nav.open('A'); // first visit, stays pending
    nav.open('B');
    nav.open('A'); // second visit
    loader.calls[2].response.resolve({ caseId: 'A', version: 'second-visit' });
    await flush();
    loader.calls[0].response.resolve({ caseId: 'A', version: 'first-visit' });
    loader.calls[1].response.resolve({ caseId: 'B', version: 'initial' });
    await flush();
    expect(state.bundle).toEqual({ caseId: 'A', version: 'second-visit' });
  });

  it('within one case an older reload never replaces a newer committed result', async () => {
    const gate = createSelectedCaseRequestGate();
    const { state, sink } = recordingSink();
    const loader = controlledLoader();
    const nav = navigator(gate, loader.load, sink);

    nav.open('A');
    const initial = loader.calls[0];
    // A confirmation completes and its reload commits while the initial load is still pending.
    const confirming = confirmInvoiceThenReload(
      gate,
      async () => ({ message: 'saved', refreshFailure: null }),
      loader.load,
      sink
    );
    await flush();
    loader.calls[1].response.resolve({ caseId: 'A', version: 'after-confirm' });
    await confirming;
    initial.response.resolve({ caseId: 'A', version: 'stale-initial' });
    await flush();
    expect(state.bundle).toEqual({ caseId: 'A', version: 'after-confirm' });
    expect(state.confirmationMessage).toBe('saved');
  });

  it('unmount releases the case: nothing commits after the page is gone', async () => {
    const gate = createSelectedCaseRequestGate();
    const { state, sink } = recordingSink();
    const loader = controlledLoader();
    const nav = navigator(gate, loader.load, sink);

    nav.open('A');
    nav.unmount();
    expect(loader.calls[0].signal.aborted).toBe(true);
    loader.calls[0].response.resolve({ caseId: 'A', version: 'late' });
    await flush();
    expect(state.bundle).toBeUndefined();
  });

  it('a confirmation on the still-selected case reports both its success and a refresh failure', async () => {
    const gate = createSelectedCaseRequestGate();
    const { state, sink } = recordingSink();
    const loader = controlledLoader();
    const nav = navigator(gate, loader.load, sink);

    nav.open('A');
    loader.calls[0].response.resolve({ caseId: 'A', version: 'initial' });
    await flush();
    const confirming = confirmInvoiceThenReload(
      gate,
      async () => ({ message: 'saved', refreshFailure: 'canonical_refresh_not_completed' }),
      loader.load,
      sink
    );
    await flush();
    loader.calls[1].response.resolve({ caseId: 'A', version: 'after-confirm' });
    await confirming;
    expect(state.bundle).toEqual({ caseId: 'A', version: 'after-confirm' });
    expect(state.confirmationMessage).toBe('saved');
    expect(state.confirmationError).toContain('canonical_refresh_not_completed');
    expect(state.confirming).toBe(false);
  });
});

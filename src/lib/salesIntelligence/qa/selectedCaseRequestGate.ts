// Selected-conversation request gate.
//
// The detail route keeps one component mounted while the user moves between cases, so every
// asynchronous result (initial load, post-confirmation reload, error reload) must prove it still
// belongs to the currently selected case before it may change UI state. The selected case id is
// the authority:
//   * select(caseId) starts a new generation and aborts every request of the previous one;
//   * a request may commit only while its generation is current and no newer request of the same
//     generation has already committed (an older reload never replaces a newer one);
//   * release(caseId) (effect cleanup: case change or unmount) aborts that case's requests and
//     clears the selection, so nothing begun for it can commit afterwards. Re-selecting the same
//     case (React StrictMode re-runs effects) starts a fresh generation.
// There are no timers: ordering is decided only by generation and request sequence.

export interface SelectedCaseRequest {
  readonly caseId: string;
  readonly signal: AbortSignal;
  /** True while this request still belongs to the selected case and nothing newer committed. */
  isCurrent(): boolean;
  /** Runs `apply` only when the request is current; returns whether it ran. */
  commit(apply: () => void): boolean;
}

export interface SelectedCaseRequestGate {
  select(caseId: string): void;
  selectedCaseId(): string | null;
  begin(): SelectedCaseRequest;
  release(caseId: string): void;
}

export function createSelectedCaseRequestGate(): SelectedCaseRequestGate {
  let selected: string | null = null;
  let generation = 0;
  let controller = new AbortController();
  let nextSequence = 0;
  let committedSequence = -1;

  return {
    select(caseId: string) {
      if (caseId === selected) return;
      controller.abort();
      controller = new AbortController();
      selected = caseId;
      generation += 1;
      committedSequence = -1;
    },
    selectedCaseId() {
      return selected;
    },
    begin() {
      if (selected === null) throw new Error('selected_case_request_without_selection');
      const caseId = selected;
      const requestGeneration = generation;
      const sequence = nextSequence++;
      const signal = controller.signal;
      const isCurrent = () =>
        !signal.aborted &&
        requestGeneration === generation &&
        selected === caseId &&
        sequence >= committedSequence;
      return {
        caseId,
        signal,
        isCurrent,
        commit(apply: () => void) {
          if (!isCurrent()) return false;
          committedSequence = sequence;
          apply();
          return true;
        },
      };
    },
    release(caseId: string) {
      if (selected !== caseId) return;
      controller.abort();
      controller = new AbortController();
      selected = null;
      generation += 1;
      committedSequence = -1;
    },
  };
}

export function isAbortError(cause: unknown): boolean {
  return Boolean(
    cause && typeof cause === 'object' && (cause as { name?: unknown }).name === 'AbortError'
  );
}

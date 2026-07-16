export {};

declare global {
  interface Object {
    /** Legacy employee task field retained by older dashboard code. */
    readonly task_type?: string | null;
  }
}

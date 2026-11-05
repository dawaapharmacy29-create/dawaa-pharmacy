// Stands in for '@/lib/supabase' when the lab engine is bundled for the doctor-evaluation Edge
// Function (scripts/build-doctor-evaluation-edge.mjs). The function hands in its own client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let supabase: any = null;

export function setEvidenceClient(client: unknown) {
  supabase = client;
}

import { supabase } from '@/lib/supabase';
import { getStaffSessionToken } from '@/lib/auth/staffSession';

// Evidence V17 -> Journey/Story link is a SIDE PROJECTION. It authenticates with the Dawaa staff
// session token (staff_login_sessions), never with auth.uid() or the x-dawaa-user-id header.
// The command validates session, permission, journey membership and source/branch scope on the
// server, then updates existing evidence rows in place (idempotent; no rows are created).
export const EVIDENCE_JOURNEY_LINK_COMMAND = 'dawaa_link_whatsapp_evidence_journey_session_v1';

export interface EvidenceJourneyLinkParams {
  journeyId: string;
  storyId: string | null;
  /** Sources already linked to this journey in whatsapp_customer_journey_sessions. */
  sourceIds: string[];
}

export interface EvidenceJourneyLinkDeps {
  client?: {
    rpc: (
      fn: string,
      args: Record<string, unknown>
    ) => PromiseLike<{ data: unknown; error: unknown }>;
  };
  getSessionToken?: () => string | null;
}

export type EvidenceJourneyLinkResult =
  | { status: 'linked'; factsLinked: number; opportunitiesLinked: number }
  | { status: 'failed'; error: string };

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error)
    return String((error as { message: unknown }).message);
  return String(error);
}

function count(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Never throws: a failure is returned so the caller reports it as a non-blocking warning. */
export async function linkWhatsAppEvidenceJourneyV17(
  params: EvidenceJourneyLinkParams,
  deps: EvidenceJourneyLinkDeps = {}
): Promise<EvidenceJourneyLinkResult> {
  const sourceIds = [...new Set(params.sourceIds.filter(Boolean))];
  if (!params.journeyId || !sourceIds.length)
    return { status: 'failed', error: 'journey or sources missing' };

  const token = (deps.getSessionToken ?? getStaffSessionToken)();
  if (!token) return { status: 'failed', error: 'staff session unavailable; sign in again' };

  try {
    const client = deps.client ?? supabase;
    const { data, error } = await client.rpc(EVIDENCE_JOURNEY_LINK_COMMAND, {
      p_session_token: token,
      p_journey_id: params.journeyId,
      p_story_id: params.storyId,
      p_source_ids: sourceIds,
    });
    if (error) return { status: 'failed', error: errorText(error) };
    const row = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      status: 'linked',
      factsLinked: count(row.facts_linked),
      opportunitiesLinked: count(row.opportunities_linked),
    };
  } catch (error) {
    return { status: 'failed', error: errorText(error) };
  }
}

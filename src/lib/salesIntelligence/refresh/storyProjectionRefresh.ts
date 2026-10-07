// Story V16 aggregate refresh — a SIDE PROJECTION run server-side after the canonical Sales
// Intelligence refresh.
//
// dawaa_refresh_whatsapp_customer_story_v16 is SECURITY DEFINER and executable only by
// authenticated/service_role. The browser uses the anon key plus a Dawaa staff-session token (not a
// Supabase Auth session), so it must never call that RPC, and the RPC must never be granted to anon.
// The refresh endpoint has already verified the staff session and role before this runs, and uses
// the service-role client.
//
// Contract: best-effort. It never throws and never changes the canonical refresh status; its result
// is reported as `sideProjections.story` so a failure is visible without blocking V22 or SI.

export interface StoryProjectionRefreshResult {
  status: 'refreshed' | 'partial' | 'failed' | 'skipped';
  storyIds: string[];
  refreshed: number;
  errors: string[];
}

const MAX_SOURCES = 50;
const MAX_STORIES = 20;

function storyErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as any).message);
  return String(error);
}

export async function refreshCustomerStoryProjectionsForSources(
  client: any,
  sourceIds: string[]
): Promise<StoryProjectionRefreshResult> {
  const ids = Array.from(new Set(sourceIds.filter(Boolean))).slice(0, MAX_SOURCES);
  const result: StoryProjectionRefreshResult = { status: 'skipped', storyIds: [], refreshed: 0, errors: [] };
  if (!ids.length) return result;

  try {
    const { data: links, error: linkError } = await client
      .from('whatsapp_customer_journey_sessions')
      .select('journey_id')
      .in('source_id', ids)
      .limit(200);
    if (linkError) throw linkError;
    const journeyIds = Array.from(
      new Set((links || []).map((row: any) => String(row?.journey_id || '')).filter(Boolean))
    );
    if (!journeyIds.length) return result;

    const { data: journeys, error: journeyError } = await client
      .from('whatsapp_customer_journeys')
      .select('story_id')
      .in('id', journeyIds)
      .limit(200);
    if (journeyError) throw journeyError;
    result.storyIds = Array.from(
      new Set((journeys || []).map((row: any) => String(row?.story_id || '')).filter(Boolean))
    ).slice(0, MAX_STORIES) as string[];
  } catch (error) {
    return { ...result, status: 'failed', errors: [`story_lookup_failed: ${storyErrorMessage(error)}`] };
  }

  if (!result.storyIds.length) return result;
  for (const storyId of result.storyIds) {
    try {
      const { error } = await client.rpc('dawaa_refresh_whatsapp_customer_story_v16', { p_story_id: storyId });
      if (error) throw error;
      result.refreshed += 1;
    } catch (error) {
      result.errors.push(`${storyId}: ${storyErrorMessage(error)}`);
    }
  }
  result.status = !result.errors.length ? 'refreshed' : result.refreshed > 0 ? 'partial' : 'failed';
  return result;
}

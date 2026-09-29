const { createClient } = require('@supabase/supabase-js');

const REVIEW_POINT_SOURCES = [
  'whatsapp_automatic_review',
  'conversation_evaluation',
  'conversation_review',
  'conversation_sales_reviews',
];
const LIVE_STATUSES = ['active', 'approved', 'pending'];
const PAGE_LIMIT = 20000;
const CHUNK = 150;

async function main() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!url || !key) throw new Error('missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');

  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data: rows, error } = await client
    .from('employee_transactions')
    .select('id,source,source_id,status,points_delta')
    .in('source', REVIEW_POINT_SOURCES)
    .in('status', LIVE_STATUSES)
    .not('source_id', 'is', null)
    .limit(PAGE_LIMIT);
  if (error) throw new Error(`points_read_failed: ${error.message}`);
  if ((rows || []).length >= PAGE_LIMIT) throw new Error('points_read_unbounded');

  const reviewIds = [...new Set((rows || []).map((row) => String(row.source_id || '')).filter(Boolean))];
  const official = new Set();

  for (let index = 0; index < reviewIds.length; index += CHUNK) {
    const { data: reviews, error: reviewError } = await client
      .from('conversation_sales_reviews_official_v1')
      .select('id')
      .in('id', reviewIds.slice(index, index + CHUNK));
    if (reviewError) throw new Error(`official_review_read_failed: ${reviewError.message}`);
    for (const review of reviews || []) official.add(String(review.id));
  }

  const violations = (rows || []).filter((row) => !official.has(String(row.source_id || '')));
  const summary = {
    liveReviewPointRows: (rows || []).length,
    distinctReviewIds: reviewIds.length,
    officialReviewIds: official.size,
    violations: violations.map((row) => ({
      transactionId: row.id,
      reviewId: row.source_id,
      source: row.source,
      status: row.status,
      pointsDelta: row.points_delta,
    })),
  };
  console.log('[canonical-review-points-v53]', JSON.stringify(summary));

  if (violations.length) {
    throw new Error('live_nonofficial_review_points_detected');
  }
  console.log('[canonical-review-points-v53] PASS: every live review-linked point row is official.');
}

main().catch((error) => {
  console.error('[canonical-review-points-v53] FAIL', error instanceof Error ? error.message : error);
  process.exit(1);
});

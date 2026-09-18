const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/lib/whatsappCustomerStoryV16.ts');
let src = fs.readFileSync(file, 'utf8');

if (src.includes("supabase.rpc('dawaa_upsert_whatsapp_customer_story_v16'")) {
  console.log('[whatsapp-customer-story-identity-v16] canonical identity upsert already applied');
  require('./patch-whatsapp-evidence-ui-v17.cjs');
  process.exit(0);
}

const startMarker = `  const { data: existing, error: existingError } = await supabase\n    .from('whatsapp_customer_stories')`;
const endMarker = `  if (storyError) throw storyError;`;
const start = src.indexOf(startMarker);
const endStart = src.indexOf(endMarker, start);
if (start < 0 || endStart < 0) throw new Error('[whatsapp-customer-story-identity-v16] story upsert block anchors not found');
const end = endStart + endMarker.length;

const replacement = `  const storyState = {\n    latestJourneyId: journeyId,\n    latestJourneyVersion: model.version,\n    customerState: model.customerState,\n    unresolvedOrder: model.unresolvedOrder,\n    unresolvedComplaint: model.unresolvedComplaint,\n    improvementInsights: model.improvementInsights,\n    updatedFromSourceCount: sources.length,\n  };\n\n  const { data: storyId, error: storyUpsertError } = await supabase.rpc('dawaa_upsert_whatsapp_customer_story_v16', {\n    p_branch: params.branch || root.branch || null,\n    p_customer_id: root.customer_id || null,\n    p_customer_code: root.customer_code || null,\n    p_customer_name: root.customer_name || null,\n    p_customer_phone: root.customer_phone || null,\n    p_status: needsRecovery ? 'recovery' : 'active',\n    p_risk_level: model.customerRisk,\n    p_story_started_at: startedAt,\n    p_last_activity_at: endedAt,\n    p_recovery_started_at: needsRecovery ? startedAt : null,\n    p_summary: model.summary,\n    p_state_json: storyState,\n    p_created_by: params.createdBy || null,\n  });\n  if (storyUpsertError) throw storyUpsertError;\n  if (!storyId) return null;\n\n  const { data: story, error: storyReadError } = await supabase\n    .from('whatsapp_customer_stories')\n    .select('id,status,story_key')\n    .eq('id', storyId)\n    .single();\n  if (storyReadError) throw storyReadError;`;

src = src.slice(0, start) + replacement + src.slice(end);
fs.writeFileSync(file, src);
console.log('[whatsapp-customer-story-identity-v16] canonical identity upsert applied successfully');
require('./patch-whatsapp-evidence-ui-v17.cjs');

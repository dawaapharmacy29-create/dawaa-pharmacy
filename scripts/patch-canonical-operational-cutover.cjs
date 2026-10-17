const fs = require('node:fs');

function patchFile(path, changes) {
  let source = fs.readFileSync(path, 'utf8');
  const replaceOnce = (label, from, to) => {
    const first = source.indexOf(from);
    if (first < 0) throw new Error(`${path}:${label}: anchor not found`);
    if (source.indexOf(from, first + from.length) >= 0) {
      throw new Error(`${path}:${label}: anchor is not unique`);
    }
    source = source.slice(0, first) + to + source.slice(first + from.length);
  };
  for (const change of changes) replaceOnce(change.label, change.from, change.to);
  fs.writeFileSync(path, source);
}

patchFile('src/lib/salesIntelligence/refresh/canonicalRefreshService.ts', [
  {
    label: 'complaint-import',
    from: "import { projectCanonicalCustomerRequestsToActions } from '../persistence/canonicalCustomerRequestProjector';\n",
    to:
      "import { projectCanonicalCustomerRequestsToActions } from '../persistence/canonicalCustomerRequestProjector';\n" +
      "import { projectCanonicalComplaintsToActions } from '../persistence/canonicalComplaintProjector';\n",
  },
  {
    label: 'result-shape',
    from:
      "    followups: { inserted: number; existing: number; skipped: number };\n" +
      "    customerRequests: { inserted: number; existing: number; skipped: number };\n" +
      "    errors: string[];\n",
    to:
      "    followups: { inserted: number; existing: number; skipped: number };\n" +
      "    customerRequests: { inserted: number; existing: number; skipped: number };\n" +
      "    complaints: { inserted: number; existing: number; skipped: number };\n" +
      "    errors: string[];\n",
  },
  {
    label: 'empty-shape',
    from:
      "      followups: { inserted: 0, existing: 0, skipped: 0 },\n" +
      "      customerRequests: { inserted: 0, existing: 0, skipped: 0 },\n" +
      "      errors: [],\n",
    to:
      "      followups: { inserted: 0, existing: 0, skipped: 0 },\n" +
      "      customerRequests: { inserted: 0, existing: 0, skipped: 0 },\n" +
      "      complaints: { inserted: 0, existing: 0, skipped: 0 },\n" +
      "      errors: [],\n",
  },
  {
    label: 'projection-state',
    from:
      "  let followupProjection = { inserted: 0, existing: 0, skipped: 0 };\n" +
      "  let customerRequestProjection = { inserted: 0, existing: 0, skipped: 0 };\n",
    to:
      "  let followupProjection = { inserted: 0, existing: 0, skipped: 0 };\n" +
      "  let customerRequestProjection = { inserted: 0, existing: 0, skipped: 0 };\n" +
      "  let complaintProjection = { inserted: 0, existing: 0, skipped: 0 };\n",
  },
  {
    label: 'complaint-projection-call',
    from:
      "  const operationalProjection = {\n" +
      "    followups: followupProjection,\n" +
      "    customerRequests: customerRequestProjection,\n" +
      "    errors: projectionErrors,\n" +
      "  };\n",
    to:
      "  try {\n" +
      "    const result = await projectCanonicalComplaintsToActions(\n" +
      "      service,\n" +
      "      reconcileCandidates,\n" +
      "      projectionSources\n" +
      "    );\n" +
      "    complaintProjection = {\n" +
      "      inserted: result.inserted,\n" +
      "      existing: result.existing,\n" +
      "      skipped: result.skipped.length,\n" +
      "    };\n" +
      "  } catch (error) {\n" +
      "    projectionErrors.push(\n" +
      "      `canonical_complaint_projection_failed: ${error instanceof Error ? error.message : String(error)}`\n" +
      "    );\n" +
      "  }\n" +
      "  const operationalProjection = {\n" +
      "    followups: followupProjection,\n" +
      "    customerRequests: customerRequestProjection,\n" +
      "    complaints: complaintProjection,\n" +
      "    errors: projectionErrors,\n" +
      "  };\n",
  },
]);

patchFile('src/lib/whatsappAutoIngestPipeline.ts', [
  {
    label: 'remove-v6-writer-import',
    from:
      "  buildWhatsAppOperationalIntelligenceV6,\n" +
      "  enrichWhatsAppOperationalProductsV6,\n" +
      "  syncWhatsAppOperationalActionsV6,\n",
    to:
      "  buildWhatsAppOperationalIntelligenceV6,\n" +
      "  enrichWhatsAppOperationalProductsV6,\n",
  },
  {
    label: 'remove-v6-writer-call',
    from:
      "  await syncWhatsAppOperationalActionsV6(operational, {\n" +
      "    sourceId,\n" +
      "    branch: sourceBranch,\n" +
      "    customerId: identity.customerId,\n" +
      "    customerCode: identity.customerCode,\n" +
      "    customerName: identity.customerName,\n" +
      "    customerPhone: identity.customerPhone,\n" +
      "    staffId: sourceRow?.staff_id || null,\n" +
      "    staffName:\n" +
      "      sourceRow?.staff_name ||\n" +
      "      (session.outboundStaffNames.length === 1 ? session.outboundStaffNames[0] : null),\n" +
      "    createdBy: sourceRow?.created_by || null,\n" +
      "    followupIdentity: {\n" +
      "      session,\n" +
      "      caseStartedAt: canonicalCaseStartedAt,\n" +
      "      legacy: { customer: identity.canonical, caseAnchor: session.id },\n" +
      "    },\n" +
      "  });\n\n",
    to:
      "  // Operational task publication is canonical-SI-owned. V6 remains analysis/evidence only;\n" +
      "  // it must not publish whatsapp_conversation_actions beside the canonical projectors.\n\n",
  },
  {
    label: 'remove-legacy-followup-live-call',
    from:
      "      const followups = await saveFollowupSignals(\n" +
      "        session,\n" +
      "        source.sourceFileName,\n" +
      "        identity,\n" +
      "        sourceBranch\n" +
      "      );\n" +
      "      result.followupsCreated += followups.created;\n" +
      "      result.followupsDuplicate += followups.duplicate;\n",
    to:
      "      // Legacy whatsapp_auto_followup_requests publication is retired from live ingest.\n" +
      "      // Canonical SI FollowUp/Complaint projectors publish the single operational queue.\n",
  },
]);

patchFile('src/lib/whatsappProductDemandBackfillV22.ts', [
  {
    label: 'remove-backfill-v6-writer-import',
    from:
      "  buildWhatsAppOperationalIntelligenceV6,\n" +
      "  enrichWhatsAppOperationalProductsV6,\n" +
      "  syncWhatsAppOperationalActionsV6,\n",
    to:
      "  buildWhatsAppOperationalIntelligenceV6,\n" +
      "  enrichWhatsAppOperationalProductsV6,\n",
  },
  {
    label: 'remove-backfill-v6-writer-call',
    from:
      "      await syncWhatsAppOperationalActionsV6(operational, {\n" +
      "        sourceId: source.id,\n" +
      "        branch: source.branch,\n" +
      "        customerId: source.customer_id,\n" +
      "        customerCode: source.customer_code,\n" +
      "        customerName: source.customer_name,\n" +
      "        customerPhone: source.customer_phone,\n" +
      "        staffId: source.staff_id,\n" +
      "        staffName: source.staff_name,\n" +
      "        createdBy: source.created_by,\n" +
      "        // Same Stable Operation Identity as automatic ingest: a backfill re-run, a re-import or a\n" +
      "        // different segmentation reuses the operation instead of writing positional duplicates.\n" +
      "        followupIdentity: {\n" +
      "          session,\n" +
      "          caseStartedAt: source.conversation_started_at,\n" +
      "          legacy: {\n" +
      "            customer: source.customer_id\n" +
      "              ? { status: 'resolved', customerId: source.customer_id, normalizedPhone: null, customerCode: null }\n" +
      "              : null,\n" +
      "          },\n" +
      "        },\n" +
      "      });\n\n",
    to:
      "      // Product-demand backfill may refresh legacy evidence, but operational task publication\n" +
      "      // belongs exclusively to the canonical Sales Intelligence refresh projectors.\n\n",
  },
]);

console.log('canonical operational cutover patch applied');

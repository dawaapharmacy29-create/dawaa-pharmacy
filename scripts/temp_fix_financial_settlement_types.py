from pathlib import Path

path = Path('src/lib/salesIntelligence/persistence/types.ts')
text = path.read_text(encoding='utf-8')
old_import = "  FollowUpAssessment,\n  CaseIntelligenceView,"
new_import = "  FollowUpAssessment,\n  FinancialSettlementAssessment,\n  CaseIntelligenceView,"
if old_import not in text:
    raise SystemExit('persistence types import anchor not found')
text = text.replace(old_import, new_import, 1)
old_field = "    canonicalSalesOutcome: CanonicalSalesOutcomeAssessment;\n  };"
new_field = "    canonicalSalesOutcome: CanonicalSalesOutcomeAssessment;\n    /** Invoice-backed payment reconciliation from this exact analysis run; optional for older rows. */\n    financialSettlement?: FinancialSettlementAssessment;\n  };"
if old_field not in text:
    raise SystemExit('evidenceSnapshot canonical outcome anchor not found')
path.write_text(text.replace(old_field, new_field, 1), encoding='utf-8')
print('financial settlement persistence contract aligned')

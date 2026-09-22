# Dawaa Workforce & HR Architecture V1

Branch target: `experiment/hr-workforce-architecture-v1`

## Purpose

This architecture reorganizes the existing Dawaa admin HR/attendance capabilities without replacing the current canonical biometric, schedule, attendance-resolution, time-off, overtime, or payroll engines.

The system must stay exception-driven, policy-based, auditable, explainable, payroll-safe, and employee-friendly.

## Canonical flow

```
Employee Master
  ↓
Versioned Schedule
  ↓
Raw Biometric / Attendance Event
  ↓
Semantic Interpretation
  ↓
Attendance Day Resolution
  ↓
Exception / Human Approval when needed
  ↓
Attendance Truth
  ↓
Payroll Truth / Settlement
```

### Rules

1. A raw punch is evidence, not final attendance.
2. A system interpretation is not automatically a manager decision.
3. Cross-branch attendance is informational unless an explicit policy says otherwise.
4. A system-data problem must never be presented as employee misconduct.
5. Payroll must consume approved attendance/payroll truth, not reinterpret raw punches.
6. Approved/paid historical snapshots must not change silently.
7. Future dates must not enter an open attendance cycle.
8. Actual worked hours must not be reduced again by lateness/early-leave if those minutes are already absent from worked time.
9. Worked overtime and approved/payable overtime are distinct values.
10. Raw biometric evidence is append-only/auditable.

## Information architecture

### Human Resources

- HR Center — `/hr-workforce`
- Employee Directory — `/team`
- Scheduling & Shifts — `/schedule`
- Leave & Absence — `/time-off`
- My Attendance — `/my-attendance`

### Time & Attendance

- Today — `/attendance-report?tab=dashboard`
- Exception Inbox — `/attendance-report?tab=resolution`
- Attendance Records & Reports — `/attendance-report?tab=report`
- Overtime — `/attendance-report?tab=overtime`
- Device & Sync Health — `/attendance-report?tab=sync`
- Biometric Codes to Map — `/attendance-report?tab=unmapped`
- Cross-branch Work — `/attendance-report?tab=cross-branch`
- HR Data Quality — `/hr-data-quality`
- HR Reports — `/hr-reports`
- HR Settings — `/hr-settings`

### Payroll & Performance

- Payroll & Readiness — `/staff-payroll`
- Employee KPI — `/employee-kpi`
- Monthly Evaluation — `/staff-monthly-evaluation`
- Monthly Incentives — `/monthly-incentive-report`
- Penalties & Rewards — `/penalty-incentive`

## User-facing terminology

| Technical term | UI term |
| --- | --- |
| Attendance | الحضور والوقت |
| Resolution | صندوق المراجعة / قرار الحضور |
| Pending review | يحتاج مراجعة |
| Attendance Truth | الحضور المعتمد |
| Payroll eligibility | جاهزية الحضور للمرتب |
| Biometric mapping | ربط كود البصمة |
| Sync/system | إدارة البصمة / صحة الأجهزة |
| Unmapped codes | أكواد تحتاج ربط |
| Cross-branch punches | العمل بين الفروع |
| Schedule health | جودة الجداول |
| Drift | اختلاف عن الاعتماد السابق |

## UI priority model

The HR Center and attendance dashboards use four levels:

1. Needs human action now.
2. Today’s operation.
3. System/data quality.
4. Historical reports/archive.

Historical totals must not dominate operational dashboards.

## Existing engines reused

The redesign intentionally reuses:

- attendance daily command/summary
- attendance review triage and resolution queue
- attendance daily summary / approved truth
- biometric operation/sync functions
- biometric mapping
- cross-branch tracking
- versioned schedule readers and schedule health
- canonical time off
- overtime approval center/history
- attendance payroll truth/readiness
- existing employee and payroll identity/security boundaries

No parallel attendance engine should be introduced.

## Data quality ownership

System problems belong to the Data Quality surface, including:

- missing schedule
- unmapped active biometric code
- synchronization failures
- interpretation ambiguity
- identity duplication
- resolution drift
- financial drift
- stale/legacy device sources

They must not become employee performance findings by default.

## Next architecture phases

The new UI shell does not pretend that a full attendance-policy engine already exists. Future canonical phases:

1. Unified Attendance Policy Engine.
2. Schedule draft/publish/coverage workflows.
3. Employee attendance-correction requests.
4. Stronger exception bulk workflows.
5. Canonical OT policy/rates hierarchy.
6. Leave/absence taxonomy and balances.
7. Final one-way Attendance Truth → Payroll contract.
8. HR core: contracts, documents, onboarding, transfers, compensation history, offboarding.

## Safety

- Do not merge to main before preview validation.
- Do not force-push over other work.
- Do not modify paid payroll snapshots.
- Do not delete biometric evidence except confirmed invalid/test imports after explicit review.
- Do not treat cross-branch activity as an error by default.

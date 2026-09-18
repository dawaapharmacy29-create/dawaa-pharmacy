# WhatsApp Conversation Analyzer V1

Branch: `feature/ai-whatsapp-conversation-analyzer-v1`

## Goal
Turn exported WhatsApp chats into a structured, reviewable conversation analysis that can pre-fill the existing conversation-review workflow without silently saving or applying employee points.

## Safety principles
- Human approval before final review save or points impact.
- Never infer unseen voice/image content as fact.
- Separate pharmacy staff quality from delivery/operations failures.
- Preserve raw evidence and calculated timestamps for auditability.
- Store confidence per inferred signal/criterion.
- No production/main changes until preview validation is complete.

## Processing pipeline
1. Upload `.txt` or `.zip` export.
2. Extract `chat.txt`/supported text file locally in the browser where possible.
3. Parse timestamps, sender, direction, text, media placeholders and forwarded markers.
4. Split long history into sessions using inactivity gaps, with manual merge/split controls.
5. Detect doctor introductions and staff handoffs.
6. Compute deterministic facts:
   - first response time
   - longest customer wait
   - repeated customer nudges
   - unanswered customer messages
   - media/evidence gaps
   - order/delivery/follow-up language
7. AI semantic layer proposes:
   - intent and scenario
   - greeting/tone/understanding
   - consultation vs dosage/use
   - unavailable item handling
   - follow-up quality
   - cross-sell / missed sales opportunity
   - complaint recovery
   - closing quality
8. Map proposed findings to existing 19 review criteria with per-item confidence.
9. Reviewer sees evidence citations from exact chat messages before accepting each important deduction.
10. Reviewer approves/edits, then existing authoritative save + points path runs.
11. Save corrections as training feedback, not autonomous model weights.

## Recommended UI
### Upload panel
- Drag/drop ZIP or TXT.
- File validation and size indicator.
- Privacy notice and delete-after-analysis option.

### Session navigator
- Customer name/code if matched.
- Date/time range.
- Staff detected.
- Session duration.
- Risk/status badges: sale, complaint, delivery, medical, missing media.

### Timeline
- Customer/staff messages in chronological order.
- Staff handoff markers.
- Highlight waits >5m, >10m and >20m.
- Highlight promises and subsequent fulfilment/non-fulfilment.
- Media placeholders shown as unknown evidence.

### Analysis panel
- Executive summary.
- Objective metrics.
- Suggested 19-item review.
- Confidence score per item.
- Evidence link for every non-trivial AI claim.
- Operational issue classification: doctor / delivery / stock / system / customer.

### Decision controls
- Accept all high-confidence items.
- Review only low-confidence items.
- Open classic full review.
- Save draft only.
- Approve final review.

## Training/learning loop
Store a feedback record for every changed AI suggestion:
- source session hash
- proposed criterion choice
- proposed confidence
- final human choice
- reason for correction
- reviewer id
- model/rules version

Use feedback first for prompt/rule calibration and evaluation. Fine-tuning should only be considered after a clean, sufficiently large reviewed dataset exists.

## Evaluation metrics
- Doctor detection accuracy
- Session split accuracy
- First-response calculation accuracy
- Criterion agreement with human reviewer
- False severe-error rate
- Average human correction count per chat
- Median review time
- % chats approved with no edits

## V1 scope
- TXT/ZIP text exports
- Session splitting
- staff introduction detection
- deterministic timing/signals
- manual review only
- no auto-points, no production writes

## Later phases
- Voice transcription with explicit consent and privacy controls
- Image/document understanding where justified
- Customer matching by name/code/phone
- Batch day analysis
- official WhatsApp API ingestion
- anomaly detection across staff/branches
- reviewer calibration and QA sampling

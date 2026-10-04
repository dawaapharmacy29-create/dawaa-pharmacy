from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# 1) Keep compact totals contextual, but allow a short customer acknowledgement while staff calculates.
replace_once(
    'src/lib/salesIntelligence/caseBasketEngine.ts',
    """  const prior = scopedMessages
    .slice(summaryIndex + 1, candidateIndex)
    .filter((m) => m.isMeaningful);
  const lastCustomer = [...prior].reverse().find((m) => m.role === 'customer');
  if (!lastCustomer || !TOTAL_QUESTION_RX.test(lastCustomer.text)) return null;
  return Number(amountMatch[1]);
""",
    """  const prior = scopedMessages
    .slice(summaryIndex + 1, candidateIndex)
    .filter((m) => m.isMeaningful);
  const totalQuestion = [...prior].reverse().find(
    (m) => m.role === 'customer' && TOTAL_QUESTION_RX.test(m.text)
  );
  if (!totalQuestion) return null;

  // Real chats often contain a short acknowledgement while the staff member calculates the total:
  // customer asks \"كدا هيبقا كام\" -> staff says \"حالا هبلغ حضرتك\" -> customer says \"تمام\"
  // -> staff answers \"1579ج\". Keep that chain intact, but fail closed if the customer introduces
  // any new commercial content before the compact amount.
  if (candidate.timestamp.getTime() - totalQuestion.timestamp.getTime() > 10 * 60_000) return null;
  const totalQuestionIndex = scopedMessages.findIndex((m) => m.id === totalQuestion.id);
  if (totalQuestionIndex < 0) return null;
  const SAFE_WAITING_ACK_RX = /^(?:تمام|ماشي|حاضر|اوكي|أوكي|اوك|ok|شكرا|شكرًا|تسلم)(?:\\s+يا\\s+فندم)?[.!، ]*$/i;
  const laterCustomerMessages = scopedMessages
    .slice(totalQuestionIndex + 1, candidateIndex)
    .filter((m) => m.isMeaningful && m.role === 'customer');
  if (laterCustomerMessages.some((m) => !SAFE_WAITING_ACK_RX.test(m.text.trim()))) return null;

  return Number(amountMatch[1]);
"""
)

# 2) Make the regression fixture match the real Mohamed conversation exactly around the amount.
replace_once(
    'src/lib/__tests__/whatsappCustomerCaseEngineV22.test.ts',
    """[9/26/26, 9:50:44 PM] You: حالا هبلغ حضرتك
[9/26/26, 9:56:48 PM] You: 1579ج ان شاء الله
""",
    """[9/26/26, 9:50:44 PM] You: حالا هبلغ حضرتك
[9/26/26, 9:50:51 PM] Customer: تمام
[9/26/26, 9:56:48 PM] You: 1579ج ان شاء الله
"""
)

# 3) Add a fail-closed regression: a new request after the total question invalidates the compact amount context.
test_path = Path('src/lib/__tests__/whatsappCustomerCaseEngineV22.test.ts')
test_text = test_path.read_text(encoding='utf-8')
anchor = """  it('does not manufacture a product identity from an unresolved media deictic such as العلبه دي', () => {
"""
if test_text.count(anchor) != 1:
    raise SystemExit('test insertion anchor not unique')
negative_test = """  it('does not treat a later compact amount as the old basket total after a new customer request', () => {
    const result = assessFirstSalesCase(`[9/26/26, 9:50:02 PM] You: يعني كدا 4 علب لبن مع 2 نوع شراب اللي الدكتور بيقولهم في الريكورد
[9/26/26, 9:50:08 PM] You: مظبوط كدا ان شاء الله؟
[9/26/26, 9:50:12 PM] Customer: ايوا
[9/26/26, 9:50:25 PM] Customer: كدا هيبقا كام
[9/26/26, 9:50:44 PM] You: حالا هبلغ حضرتك
[9/26/26, 9:50:51 PM] Customer: عايز كمان شريط فيتامين
[9/26/26, 9:56:48 PM] You: 1579ج ان شاء الله`);

    expect(result.baskets.at(-1)?.announcedTotal).toBeNull();
  });

"""
test_path.write_text(test_text.replace(anchor, negative_test + anchor, 1), encoding='utf-8')

# 4) Semantic version bump so persisted V16 analyses cannot no-op this closing fix.
replace_once(
    'src/lib/salesIntelligence/persistence/versions.ts',
    """// v16 (2026-10-04): settled-order truth alignment. Exact invoice-backed payment settlement now
""",
    """// v17 (2026-10-04): compact announced totals may bridge only short acknowledgement messages
// after the customer's explicit total question; any new customer commercial content fails closed.
// v16 (2026-10-04): settled-order truth alignment. Exact invoice-backed payment settlement now
"""
)
replace_once(
    'src/lib/salesIntelligence/persistence/versions.ts',
    "export const PIPELINE_VERSION = 'sales-intelligence-v16';",
    "export const PIPELINE_VERSION = 'sales-intelligence-v17';"
)
replace_once(
    'src/lib/salesIntelligence/persistence/versions.ts',
    "commercialConfirmation: 'commercial-confirmation-v5-natural-recap-compact-total-safe-deictic',",
    "commercialConfirmation: 'commercial-confirmation-v6-compact-total-interstitial-ack-safe',"
)

print('V17 compact-total context patch staged successfully')

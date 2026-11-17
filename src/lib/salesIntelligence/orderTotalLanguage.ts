// Shared wording, not payment proof or product identity. Basket/order owners keep context gates.
const TOTAL_QUESTION_RX = /(?:الحساب|الإجمالي|الاجمالي|المجموع).{0,16}كام|^(?:ممكن\s*)?(?:اعرف|أعرف)\s*(?:الحساب|الاجمالي|الإجمالي)[؟?!.\s]*$|(?:كدا|كده)\s*كام|(?:كدا|كده)?\s*(?:هيبقا|هيبقى|يبقا|يبقى)\s*كام|بكام\s*(?:الشريطين|العلبتين|دول|كلهم)/i;
export function isOrderTotalQuestion(text: string): boolean { return TOTAL_QUESTION_RX.test(text); }
/** A billing question alone is not another independent product/service request. */
export function isOrderTotalQuestionOnly(text: string): boolean {
  return isOrderTotalQuestion(text) && !/(?:عايز|عاوز|محتاج|ضيف|زود|هات|ابعت|وممكن)/i.test(text);
}

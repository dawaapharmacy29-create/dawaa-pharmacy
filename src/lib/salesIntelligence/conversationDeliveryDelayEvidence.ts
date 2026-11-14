import type { CaseIntelligenceView } from './types';

const ORDER_CONTEXT_RX = /(?:اوردر|أوردر|الاوردر|الأوردر|طلب|المندوب|توصيل|دليفري)/i;
const DELAY_RX = /(?:اتأخر|اتاخر|متأخر|متاخر|تأخير|تاخير|لسه|فين|مجاش|ماجاش|موصلش|ماوصلش|هييجي\s*امتى|هيوصل\s*امتى)/i;
const STAFF_DELAY_NOTICE_RX =
  /(?:(?:الطلب|الاوردر|الأوردر|المندوب|التوصيل)[^\n]{0,40}(?:ه?يتأخر|متأخر|في\s*تأخير|فيه\s*تأخير)|(?:في|فيه)\s*تأخير[^\n]{0,30}(?:الطلب|الاوردر|المندوب|التوصيل)|المندوب[^\n]{0,25}برا[^\n]{0,35}هيرجع[^\n]{0,35}(?:ابعته|أبعته|نبعته))/i;

export function orderDelayEvidenceIds(view: CaseIntelligenceView): string[] {
  return view.interaction.messages.filter(m => m.meaningful && (m.role === 'staff' ? STAFF_DELAY_NOTICE_RX.test(m.text) : m.role === 'customer' && ORDER_CONTEXT_RX.test(m.text) && DELAY_RX.test(m.text))).map(m => m.id);
}
export function isStaffOrderDelayNotice(text: string): boolean { return STAFF_DELAY_NOTICE_RX.test(text); }
export function isCustomerOrderDelay(text: string): boolean { return ORDER_CONTEXT_RX.test(text) && DELAY_RX.test(text); }

const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/components/reviews/WhatsAppCustomerActionCenterV6.tsx');
let src = fs.readFileSync(file, 'utf8');
function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-contact-recommendation-v6] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-contact-recommendation-v6] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-contact-recommendation-v6] ${label}: applied`);
}

patch('contact recommendation fields',
  `  action_label: string | null;\n};`,
  `  action_label: string | null;\n  recommended_contact_now: boolean;\n  recommended_contact_reason: string | null;\n  recommended_contact_priority: 'normal' | 'important' | 'urgent';\n};`
);

patch('filter contact-now candidates',
  `      if (mode === 'action' && !row.needs_customer_service_action) return false;`,
  `      if (mode === 'action' && !row.recommended_contact_now) return false;`
);

patch('count contact-now candidates',
  `  const actionCount = rows.filter((row) => row.needs_customer_service_action).length;`,
  `  const actionCount = rows.filter((row) => row.recommended_contact_now).length;`
);

patch('contact-now metric label',
  `<div className="text-xs text-amber-200">محتاجين إجراء</div>`,
  `<div className="text-xs text-amber-200">مقترح التواصل معهم الآن</div>`
);

patch('contact-now tab label',
  `>مطلوب متابعة/إجراء</button>`,
  `>مين نبعتله دلوقتي</button>`
);

patch('prefer contact reason',
  `{row.next_action_reason || row.action_label || (row.needs_customer_service_action ? 'يوجد إجراء معلق يحتاج مراجعة.' : 'لا يوجد إجراء معلق.')}`,
  `{row.recommended_contact_reason || row.next_action_reason || row.action_label || (row.needs_customer_service_action ? 'يوجد إجراء معلق يحتاج مراجعة.' : 'لا يوجد إجراء معلق.')}`
);

patch('priority chip when no action type',
  `{row.next_action_type ? <span className="rounded-lg bg-violet-500/10 px-2 py-1 font-bold text-violet-200">{actionTypeLabel[row.next_action_type] || row.action_label || row.next_action_type}</span> : null}`,
  `{row.next_action_type ? <span className="rounded-lg bg-violet-500/10 px-2 py-1 font-bold text-violet-200">{actionTypeLabel[row.next_action_type] || row.action_label || row.next_action_type}</span> : row.recommended_contact_now ? <span className="rounded-lg bg-cyan-500/10 px-2 py-1 font-bold text-cyan-200">متابعة رضا العميل</span> : null}`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-contact-recommendation-v6] contact recommendation UI applied successfully');

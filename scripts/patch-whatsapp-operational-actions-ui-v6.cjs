const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/components/reviews/WhatsAppOperationalPanelV6.tsx');
let src = fs.readFileSync(file, 'utf8');
function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-operational-actions-ui-v6] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-operational-actions-ui-v6] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-operational-actions-ui-v6] ${label}: applied`);
}

patch('toast import',
  `import { supabase } from '@/lib/supabase';`,
  `import { supabase } from '@/lib/supabase';\nimport { toast } from 'sonner';`
);

patch('executing state',
  `  const [loading,setLoading] = useState(false);\n  const operational = source.analysis_json?.operational || null;`,
  `  const [loading,setLoading] = useState(false);\n  const [executingActionId,setExecutingActionId] = useState('');\n  const operational = source.analysis_json?.operational || null;`
);

patch('materialize action handler',
  `  useEffect(() => { void load(); }, [source.id, source.customer_code]);`,
  `  useEffect(() => { void load(); }, [source.id, source.customer_code]);\n\n  const executeAction = async (action: ActionRow) => {\n    if (action.status !== 'ready') return;\n    const isCustomerRequest = action.action_type === 'customer_request';\n    const warning = isCustomerRequest\n      ? 'سيتم تسجيل طلب عميل رسمي. هذا المسار قد يترتب عليه نقاط تسجيل الطلب حسب سياسة الحوافز الحالية. هل راجعت العميل والصنف والدكتور وتريد التنفيذ؟'\n      : 'سيتم إنشاء/ربط متابعة فعلية في مركز خدمة العملاء. هل تريد التنفيذ؟';\n    if (!window.confirm(warning)) return;\n    setExecutingActionId(action.id);\n    try {\n      const { data, error } = await supabase.rpc('dawaa_materialize_whatsapp_action_v1', { p_action_id: action.id });\n      if (error) throw error;\n      toast.success(isCustomerRequest ? 'تم تسجيل طلب العميل وربطه بالمحادثة' : 'تم إنشاء/ربط المتابعة بخدمة العملاء');\n      await load();\n      console.info('[whatsapp-operational-v6] materialized action', data);\n    } catch (error) {\n      toast.error(error instanceof Error ? error.message : 'تعذر تنفيذ الإجراء التشغيلي');\n    } finally {\n      setExecutingActionId('');\n    }\n  };`
);

patch('action execution button',
  `<div className="mt-1 text-xs text-slate-500">{a.product_name?\`${'${a.product_name} • '}\`:''}{a.reason||''}</div></div>)`,
  `<div className="mt-1 text-xs text-slate-500">{a.product_name?\`${'${a.product_name} • '}\`:''}{a.reason||''}</div>{a.status === 'ready' && ['customer_request','customer_followup','recommendation_followup','complaint_followup'].includes(a.action_type) ? <button onClick={() => void executeAction(a)} disabled={executingActionId === a.id} className="mt-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-black text-emerald-200 disabled:opacity-50">{executingActionId === a.id ? 'جاري التنفيذ…' : a.action_type === 'customer_request' ? 'مراجعة وتسجيل الطلب رسميًا' : 'اعتماد وإنشاء المتابعة'}</button> : a.status === 'created' && a.target_id ? <div className="mt-2 text-xs font-bold text-emerald-300">تم التنفيذ • {a.target_table} • {a.target_id}</div> : null}</div>)`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-operational-actions-ui-v6] safe execution controls applied successfully');

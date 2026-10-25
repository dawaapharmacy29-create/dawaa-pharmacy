import { Profiler, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import SalesIntelligenceQA from '../../../src/pages/SalesIntelligenceQA';
import { CaseIntelligenceWorkspace } from '../../../src/components/salesIntelligence/CaseIntelligenceWorkspace';
import { WhatsAppConversationPanel } from '../../../src/components/salesIntelligence/WhatsAppConversationPanel';
import { parseWhatsAppExport } from '../../../src/lib/whatsappConversationParser';
import { runSalesIntelligencePipeline } from '../../../src/lib/salesIntelligence/salesIntelligencePipeline';
import { analyzeConversationEvaluation } from '../../../src/lib/salesIntelligence/conversationEvaluation';
import '../../../src/index.css';
import '../../../src/styles/dawaa-design-system.css';
import '../../../src/styles/dawaa-theme.css';
import '../../../src/styles/dawaa-theme-tokens.css';
import '../../../src/styles/dawaa-theme-foundation.css';
import '../../../src/styles/dawaa-theme-palettes.css';
import '../../../src/styles/dawaa-theme-components.css';

const RAW = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة بانادول اكسترا\n[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:\n2 علبة بانادول اكسترا\nإجمالي الحساب 180 جنيه\nهل الطلب كده كامل؟\n[9/15/26, 9:02:00 AM] Customer: تمام\n[9/15/26, 9:03:00 AM] You: تم تأكيد الطلب`;

const prepared = runSalesIntelligencePipeline({
  conversationId: 'browser-fixture', rawWhatsAppExportText: RAW, resolveInvoiceCandidates: () => [],
  customerIdHint: 'customer-browser', customerIdentityStatus: 'resolved', branchNameRawHint: 'فرع شكري',
});
const view = prepared.caseAnalyses[0].caseIntelligence;
const evaluation = analyzeConversationEvaluation(view, null);
const messages = parseWhatsAppExport(RAW);

const metrics: any = {
  fixturePreparationPipelineRuns: 1,
  detailOpenPipelineRuns: 0,
  profiler: { qa: { commits: 0, durationMs: 0 }, brain: { commits: 0, durationMs: 0 } },
  brainMounts: 0,
  longTasks: [] as number[],
  startedAt: performance.now(),
};
(globalThis as any).__DAWAA_BROWSER_PERF__ = metrics;
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) metrics.longTasks.push(entry.duration);
  }).observe({ type: 'longtask', buffered: true } as any);
} catch {
  // Older browser engines may not support long-task observation; other metrics still run.
}

function onRender(id: 'qa' | 'brain', _phase: string, actualDuration: number) {
  metrics.profiler[id].commits += 1;
  metrics.profiler[id].durationMs += actualDuration;
}

function BrainMountProbe() {
  useEffect(() => { metrics.brainMounts += 1; }, []);
  return null;
}

function BrainHarness() {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="brain-shell" className="p-4" dir="rtl">
      <button data-testid="toggle-brain" className="dawaa-button dawaa-button--primary" onClick={() => setOpen((v) => !v)}>{open ? 'إغلاق العقل الذكي' : 'فتح العقل الذكي'}</button>
      {open ? (
        <Profiler id="brain" onRender={(_id, phase, duration) => onRender('brain', phase, duration)}>
          <BrainMountProbe />
          <CaseIntelligenceWorkspace
            view={view}
            conversationEvaluation={evaluation}
            staffDisplayName="د أحمد"
            invoiceEvidence={{ status: 'trusted', linkMethod: 'automatic', invoiceNumber: 'A-100', items: [{ id: 'line-1', productName: 'بانادول اكسترا', productCode: 'PAN', quantity: 2, unitName: 'علبة', netLineAmount: 180 }] }}
            conversationPanel={<WhatsAppConversationPanel messages={messages} customerName="عميل الاختبار" customerCode="5001" customerPhone="01000000001" branch="فرع شكري" caseStartedAt={view.interaction.startedAt} caseEndedAt={view.interaction.endedAt} />}
          />
        </Profiler>
      ) : null}
    </div>
  );
}

function App() {
  const [screen, setScreen] = useState<'qa' | 'brain'>('qa');
  return (
    <div dir="rtl">
      <div className="dawaa-card m-3 flex gap-2">
        <button data-testid="nav-qa" className="dawaa-button dawaa-button--secondary" onClick={() => setScreen('qa')}>قائمة المحادثات</button>
        <button data-testid="nav-brain" className="dawaa-button dawaa-button--secondary" onClick={() => setScreen('brain')}>العقل الذكي</button>
      </div>
      {screen === 'qa' ? (
        <MemoryRouter>
          <Profiler id="qa" onRender={(_id, phase, duration) => onRender('qa', phase, duration)}><SalesIntelligenceQA /></Profiler>
        </MemoryRouter>
      ) : <BrainHarness />}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

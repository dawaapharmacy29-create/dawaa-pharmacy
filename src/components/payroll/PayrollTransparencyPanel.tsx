import PayrollTransparencyPanelLegacy from './PayrollTransparencyPanelLegacy';
import DeliveryPayrollBreakdownPanel from './DeliveryPayrollBreakdownPanel';

export default function PayrollTransparencyPanel(props: { staffId: string; monthCycle: string }) {
  return (
    <div className="space-y-4" dir="rtl">
      <PayrollTransparencyPanelLegacy {...props} />
      <DeliveryPayrollBreakdownPanel {...props} />
    </div>
  );
}

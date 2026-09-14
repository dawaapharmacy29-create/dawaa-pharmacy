import AttendancePolicyTimeline from '@/components/attendance/AttendancePolicyTimeline';
import SmartDailyCommandTable from '@/components/attendance/SmartDailyCommandTable';

type DailyCommandRow = {
  staff_id: string;
  staff_name: string;
  role: string | null;
  branch: string | null;
  work_date: string;
  schedule_status: string;
  shift_start: string | null;
  shift_end: string | null;
  first_check_in: string | null;
  last_check_out: string | null;
  late_minutes: number;
  early_leave_minutes: number;
  attendance_status: string;
  approved_exception_type: string | null;
  approved_exception_reason: string | null;
  biometric_events: number;
  source_status: string;
};

type Props = { rows: DailyCommandRow[]; date: string; branch: string };

export default function AttendanceDailyIntelligenceStack({ rows, date, branch }: Props) {
  return <div className="space-y-4">
    <AttendancePolicyTimeline rows={rows} date={date} branch={branch} />
    <SmartDailyCommandTable rows={rows} date={date} branch={branch} />
  </div>;
}

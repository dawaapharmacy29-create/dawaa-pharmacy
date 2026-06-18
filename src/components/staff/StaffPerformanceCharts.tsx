import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { StaffPerformanceProfile } from '@/lib/staff/staffPerformanceProfileService';

const COLORS = ['#00C49F', '#0088FE', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

interface StaffPerformanceChartsProps {
  profile: StaffPerformanceProfile;
}

export default function StaffPerformanceCharts({ profile }: StaffPerformanceChartsProps) {
  return (
    <div className="space-y-6">
      {/* Sales Monthly Trend */}
      {profile.charts.salesMonthlyTrend.length > 0 && (
        <section className="stat-card space-y-4">
          <h3 className="section-title text-sm">تطور المبيعات الشهري</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={profile.charts.salesMonthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d4063" />
              <XAxis dataKey="month" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #2d4063',
                  borderRadius: '8px',
                }}
                itemStyle={{ color: '#e2e8f0' }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="sales"
                stroke="#00C49F"
                strokeWidth={2}
                name="المبيعات"
              />
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* Points Evolution */}
      {profile.charts.pointsEvolution.length > 0 && (
        <section className="stat-card space-y-4">
          <h3 className="section-title text-sm">تطور النقاط</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={profile.charts.pointsEvolution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d4063" />
              <XAxis dataKey="cycle" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #2d4063',
                  borderRadius: '8px',
                }}
                itemStyle={{ color: '#e2e8f0' }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="points"
                stroke="#0088FE"
                strokeWidth={2}
                name="النقاط"
              />
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* Quarterly Score Components */}
      {profile.charts.quarterlyScoreComponents.length > 0 && (
        <section className="stat-card space-y-4">
          <h3 className="section-title text-sm">مكونات النتيجة الربع سنوية</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={profile.charts.quarterlyScoreComponents}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d4063" />
              <XAxis dataKey="component" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #2d4063',
                  borderRadius: '8px',
                }}
                itemStyle={{ color: '#e2e8f0' }}
              />
              <Legend />
              <Bar dataKey="score" fill="#FFBB28" name="النتيجة" />
            </BarChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* Customer Segment Distribution */}
      {profile.customers && profile.customers.segmentDistribution.length > 0 && (
        <section className="stat-card space-y-4">
          <h3 className="section-title text-sm">توزيع فئات العملاء</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={profile.customers.segmentDistribution}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={(entry) => `${entry.segment}: ${entry.percentage.toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="count"
              >
                {profile.customers.segmentDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #2d4063',
                  borderRadius: '8px',
                }}
                itemStyle={{ color: '#e2e8f0' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* Attendance Compliance */}
      {profile.charts.attendanceCompliance.length > 0 && (
        <section className="stat-card space-y-4">
          <h3 className="section-title text-sm">نسبة الالتزام بالحضور</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={profile.charts.attendanceCompliance}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d4063" />
              <XAxis dataKey="date" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #2d4063',
                  borderRadius: '8px',
                }}
                itemStyle={{ color: '#e2e8f0' }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="compliance"
                stroke="#FF8042"
                strokeWidth={2}
                name="نسبة الالتزام %"
              />
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* Delay Trend */}
      {profile.charts.delayTrend.length > 0 && (
        <section className="stat-card space-y-4">
          <h3 className="section-title text-sm">تطور التأخير</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={profile.charts.delayTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d4063" />
              <XAxis dataKey="date" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #2d4063',
                  borderRadius: '8px',
                }}
                itemStyle={{ color: '#e2e8f0' }}
              />
              <Legend />
              <Bar dataKey="delayMinutes" fill="#8884D8" name="دقائق التأخير" />
            </BarChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* Weekly Sales Trend (Quarterly) */}
      {profile.quarterlyIncentive && profile.quarterlyIncentive.weeklySalesTrend.length > 0 && (
        <section className="stat-card space-y-4">
          <h3 className="section-title text-sm">تطور المبيعات الأسبوعي (ربع سنوي)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={profile.quarterlyIncentive.weeklySalesTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d4063" />
              <XAxis dataKey="week" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #2d4063',
                  borderRadius: '8px',
                }}
                itemStyle={{ color: '#e2e8f0' }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="sales"
                stroke="#82CA9D"
                strokeWidth={2}
                name="المبيعات"
              />
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}
    </div>
  );
}

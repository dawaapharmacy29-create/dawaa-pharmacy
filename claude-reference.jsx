import { useState, useEffect, useCallback, useRef } from "react";

const SUPABASE_URL = "https://jkjqeqkshllustwlzzbf.supabase.co";

const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpranFlcWtzaGxsdXN0d2x6emJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MjAwMDAwMDAwMH0.placeholder";

async function supabase(table, params = {}) {
  const { select = "*", filters = [], limit = 20, offset = 0, order = null, method = "GET", body = null } = params;
  let url = `${SUPABASE_URL}/rest/v1/${table}?select=${select}&limit=${limit}&offset=${offset}`;
  filters.forEach(f => { url += `&${f}`; });
  if (order) url += `&order=${order}`;
  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  if (res.status === 204) return [];
  return res.json();
}

function cleanPhone(phone) {
  if (!phone) return "";
  let p = phone.replace(/[\s\-\(\)]/g, "");
  if (p.startsWith("+20")) p = p.slice(3);
  else if (p.startsWith("0020")) p = p.slice(4);
  if (p.startsWith("0")) p = p.slice(1);
  return p;
}

function whatsappLink(phone, message = "") {
  const clean = cleanPhone(phone);
  const full = `20${clean}`;
  return `https://wa.me/${full}${message ? "?text=" + encodeURIComponent(message) : ""}`;
}

function getEvalCycle(date = new Date()) {
  const d = new Date(date);
  const day = d.getDate();
  if (day >= 26) {
    const start = new Date(d.getFullYear(), d.getMonth(), 26);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 25);
    return { start, end };
  } else {
    const start = new Date(d.getFullYear(), d.getMonth() - 1, 26);
    const end = new Date(d.getFullYear(), d.getMonth(), 25);
    return { start, end };
  }
}

function calcCLV(totalPurchases, monthlyAvg) {
  if (!totalPurchases && !monthlyAvg) return null;
  if (!monthlyAvg) return { value: totalPurchases, note: "بدون متوسط شهري" };
  return { value: totalPurchases + monthlyAvg * 12, note: null };
}

function classifyCustomer(monthlyAvg) {
  if (!monthlyAvg) return { label: "غير محدد", color: "#888" };
  if (monthlyAvg > 8000) return { label: "مهم جدًا ★", color: "#7c3aed" };
  if (monthlyAvg >= 4000) return { label: "مهم", color: "#2563eb" };
  if (monthlyAvg >= 1500) return { label: "متوسط", color: "#059669" };
  return { label: "عادي", color: "#78716c" };
}

function customerStatus(lastPurchaseDate) {
  if (!lastPurchaseDate) return { label: "غير معروف", color: "#888" };
  const days = Math.floor((Date.now() - new Date(lastPurchaseDate)) / 86400000);
  if (days <= 14) return { label: "جديد 🆕", color: "#10b981", days };
  if (days <= 30) return { label: "نشط ✅", color: "#3b82f6", days };
  if (days <= 60) return { label: "مهدد بالتوقف ⚠️", color: "#f59e0b", days };
  return { label: "متوقف 🔴", color: "#ef4444", days };
}

function nextFollowupDays(reaction, customerClass, status) {
  if (reaction === "ordered") return 2;
  if (reaction === "interested") return customerClass === "مهم جدًا ★" ? 1 : 2;
  if (reaction === "call_later") return customerClass === "مهم جدًا ★" ? 1 : 2;
  if (reaction === "complained") return 1;
  if (reaction === "no_answer") return customerClass === "مهم جدًا ★" ? 1 : 2;
  if (reaction === "refused") return 14;
  if (reaction === "wrong_number") return 0;
  return 3;
}

const SCRIPTS = {
  vip: (vars) => `أهلاً أ/ ${vars.customerName}، مع حضرتك ${vars.staffName} من صيدليات دواء 🌿
بنطمن على حضرتك ونتأكد إن كل احتياجاتك متوفرة.
لو في أي أدوية أو مستلزمات محتاجها، نقدر نجهزها لحضرتك ونوفرلك التوصيل.
تحت أمرك في أي وقت.`,
  important: (vars) => `أهلاً أ/ ${vars.customerName}، مع حضرتك ${vars.staffName} من صيدليات دواء.
حابين نطمن على حضرتك ونعرف لو في أي أصناف محتاجها أو خدمة نقدر نوفرها لك.
تحت أمرك يا فندم.`,
  average: (vars) => `أهلاً بحضرتك، معاك صيدليات دواء 🌿
بنطمن عليك، ولو محتاج أي دواء أو خدمة توصيل ابعتلنا طلبك وهنجهزه لحضرتك.`,
  stopped: (vars) => `أهلاً أ/ ${vars.customerName}، حضرتك من عملائنا المهمين في صيدليات دواء.
لاحظنا إننا ما تشرفناش بخدمتك من فترة، وحابين نعرف لو في أي حاجة نقدر نحسنها أو نوفرها لحضرتك.
وجودك يهمنا جدًا.`,
  at_risk: (vars) => `أهلاً أ/ ${vars.customerName}، بنطمن على حضرتك وبنحب نتابع احتياجاتك قبل ما تحتاجها.
لو في أدوية شهرية أو أصناف ثابتة، نقدر نجهزها لحضرتك في معادها.`,
  post_purchase: (vars) => `أهلاً أ/ ${vars.customerName}، بنطمن إن طلب حضرتك وصل تمام وإن الخدمة كانت مناسبة.
لو في أي ملاحظة أو استفسار، يهمنا نعرفه عشان نفضل نحسن خدمتنا.`,
  complaint: (vars) => `أهلاً أ/ ${vars.customerName}، نعتذر لحضرتك عن أي مشكلة حصلت.
يهمنا نحل الموضوع بأفضل شكل، وهنراجع التفاصيل فورًا.
حق حضرتك علينا.`,
};

function getScript(customerClass, status, type = null) {
  if (type === "complaint") return SCRIPTS.complaint;
  if (type === "post_purchase") return SCRIPTS.post_purchase;
  if (status?.label?.includes("متوقف")) return SCRIPTS.stopped;
  if (status?.label?.includes("مهدد")) return SCRIPTS.at_risk;
  if (customerClass?.label === "مهم جدًا ★") return SCRIPTS.vip;
  if (customerClass?.label === "مهم") return SCRIPTS.important;
  return SCRIPTS.average;
}

const DAYS_AR = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];

function parseShiftTime(raw) {
  if (!raw || typeof raw !== "string") return null;
  const isOff = raw.includes("إجازة") || raw.includes("off") || raw.includes("🟡");
  if (isOff) return { isOff: true, start: null, end: null, hours: null };
  const match = raw.match(/(\d{1,2}(?:\.\d+)?)\s*(AM|PM)\s*[→\-]\s*(\d{1,2}(?:\.\d+)?)\s*(AM|PM)/i);
  if (!match) return { isOff: false, start: raw.trim(), end: null, hours: null };
  const toHour = (h, ampm) => {
    let hour = parseFloat(h);
    if (ampm.toUpperCase() === "PM" && hour !== 12) hour += 12;
    if (ampm.toUpperCase() === "AM" && hour === 12) hour = 0;
    return hour;
  };
  const startH = toHour(match[1], match[2]);
  const endH = toHour(match[3], match[4]);
  let hours = endH - startH;
  if (hours < 0) hours += 24;
  const fmt = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${h % 1 ? "30" : "00"}`;
  return { isOff: false, start: fmt(startH), end: fmt(endH), hours: parseFloat(hours.toFixed(1)) };
}

function parseExcelShifts(data) {
  const staffMap = {};
  const rows = data;
  let headerRow = -1;
  let sectionType = "doctor";

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const first = String(row[0] || "").trim();
    if (first.includes("الدليفري")) { sectionType = "delivery"; continue; }
    if (first === "اليوم") {
      headerRow = i;
      const names = Object.values(row).slice(2).filter(n => n && String(n).trim() && String(n).trim() !== "NaN");
      names.forEach(name => {
        const n = String(name).trim();
        if (n && !staffMap[n]) staffMap[n] = { name: n, type: sectionType, shifts: {} };
      });
      continue;
    }
    if (headerRow >= 0 && DAYS_AR.includes(first)) {
      const vals = Object.values(row);
      const headerVals = Object.values(rows[headerRow]).slice(2).filter(n => n && String(n).trim() !== "NaN");
      headerVals.forEach((name, idx) => {
        const n = String(name).trim();
        if (!n) return;
        const shiftRaw = vals[idx + 2];
        if (shiftRaw !== undefined && shiftRaw !== null) {
          const parsed = parseShiftTime(String(shiftRaw));
          if (!staffMap[n]) staffMap[n] = { name: n, type: sectionType, shifts: {} };
          staffMap[n].shifts[first] = parsed;
        }
      });
    }
    if (first.includes("ملخص") || first.includes("📊")) { headerRow = -1; }
  }
  return Object.values(staffMap).filter(s => Object.keys(s.shifts).length > 0);
}

const PAGES = [
  { id: "dashboard", label: "الرئيسية", icon: "ti-layout-dashboard" },
  { id: "customers", label: "العملاء", icon: "ti-users" },
  { id: "followups", label: "المتابعة اليومية", icon: "ti-phone-call" },
  { id: "scripts", label: "السكريبتات", icon: "ti-message-dots" },
  { id: "shifts", label: "الشيفتات", icon: "ti-calendar" },
  { id: "points", label: "النقاط والحوافز", icon: "ti-award" },
  { id: "reviews", label: "تقييم المحادثات", icon: "ti-star" },
  { id: "migrations", label: "جداول مقترحة", icon: "ti-database" },
];

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div dir="rtl" style={{ display: "flex", minHeight: "100vh", background: "var(--color-background-tertiary)", fontFamily: "'Cairo', sans-serif" }}>
      <Sidebar page={page} setPage={(p) => { setPage(p); setSidebarOpen(false); }} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar onMenu={() => setSidebarOpen(true)} />
        <main style={{ flex: 1, padding: "1.25rem", maxWidth: 1100, margin: "0 auto", width: "100%" }}>
          {page === "dashboard" && <DashboardPage />}
          {page === "customers" && <CustomersPage />}
          {page === "followups" && <FollowupsPage />}
          {page === "scripts" && <ScriptsPage />}
          {page === "shifts" && <ShiftsPage />}
          {page === "points" && <PointsPage />}
          {page === "reviews" && <ReviewsPage />}
          {page === "migrations" && <MigrationsPage />}
        </main>
      </div>
    </div>
  );
}

function Sidebar({ page, setPage, open, onClose }) {
  return (
    <>
      {open && <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 40 }} />}
      <nav style={{
        width: 220, background: "#1B2B4B", color: "#fff", display: "flex", flexDirection: "column",
        position: "fixed", top: 0, right: open ? 0 : -220, bottom: 0, zIndex: 50,
        transition: "right .25s", boxShadow: "0 0 24px rgba(0,0,0,.3)",
      }}>
        <div style={{ padding: "1.25rem 1rem", borderBottom: "1px solid rgba(255,255,255,.1)" }}>
          <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: -0.5 }}>🌿 صيدليات دواء</div>
          <div style={{ fontSize: 11, opacity: .6, marginTop: 2 }}>نظام الإدارة</div>
        </div>
        <div style={{ flex: 1, padding: "0.5rem 0", overflowY: "auto" }}>
          {PAGES.map(p => (
            <button key={p.id} onClick={() => setPage(p.id)} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "0.65rem 1rem",
              background: page === p.id ? "rgba(255,255,255,.12)" : "transparent",
              color: page === p.id ? "#fff" : "rgba(255,255,255,.7)",
              border: "none", cursor: "pointer", fontSize: 14, fontFamily: "inherit",
              borderRight: page === p.id ? "3px solid #5DCAA5" : "3px solid transparent",
              transition: "all .15s",
            }}>
              <i className={`ti ${p.icon}`} style={{ fontSize: 16 }} />
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ padding: "0.75rem 1rem", fontSize: 11, opacity: .4, borderTop: "1px solid rgba(255,255,255,.1)" }}>
          v1.0 — {new Date().toLocaleDateString("ar-EG")}
        </div>
      </nav>
      <div style={{ width: 220, flexShrink: 0, visibility: "hidden" }} />
    </>
  );
}

function TopBar({ onMenu }) {
  return (
    <header style={{ background: "var(--color-background-primary)", borderBottom: "0.5px solid var(--color-border-tertiary)", padding: "0.75rem 1.25rem", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 10 }}>
      <button onClick={onMenu} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--color-text-primary)", padding: 4 }}>
        <i className="ti ti-menu-2" />
      </button>
      <span style={{ fontWeight: 700, fontSize: 15, color: "var(--color-text-primary)" }}>🌿 صيدليات دواء</span>
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
        {new Date().toLocaleDateString("ar-EG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
      </span>
    </header>
  );
}

function Card({ children, style = {} }) {
  return (
    <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", border: "0.5px solid var(--color-border-tertiary)", padding: "1rem 1.25rem", ...style }}>
      {children}
    </div>
  );
}

function MetricCard({ label, value, sub, color = "#1B2B4B" }) {
  return (
    <div style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "1rem", minWidth: 0 }}>
      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Badge({ text, color = "#1B2B4B", bg = "#e5e7eb" }) {
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: bg, color }}>{text}</span>
  );
}

function LoadingState({ text = "جاري التحميل..." }) {
  return <div style={{ textAlign: "center", padding: "2rem", color: "var(--color-text-secondary)", fontSize: 14 }}><i className="ti ti-loader" style={{ animation: "spin 1s linear infinite", display: "inline-block", marginLeft: 6 }} />{text}</div>;
}

function EmptyState({ text }) {
  return <div style={{ textAlign: "center", padding: "2rem", color: "var(--color-text-secondary)", fontSize: 14 }}><i className="ti ti-inbox" style={{ fontSize: 24, display: "block", marginBottom: 8 }} />{text}</div>;
}

function ErrorState({ text }) {
  return <div style={{ textAlign: "center", padding: "1rem", color: "var(--color-text-danger)", fontSize: 13, background: "var(--color-background-danger)", borderRadius: "var(--border-radius-md)", marginBottom: 12 }}><i className="ti ti-alert-circle" style={{ marginLeft: 6 }} />{text}</div>;
}

// ======================== DASHBOARD ========================
function DashboardPage() {
  const cycle = getEvalCycle();
  const fmt = (d) => d.toLocaleDateString("ar-EG", { day: "numeric", month: "long" });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>لوحة التحكم</h2>
      <Card>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>📊 الدورة الحالية</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
          <MetricCard label="بداية الدورة" value={fmt(cycle.start)} />
          <MetricCard label="نهاية الدورة" value={fmt(cycle.end)} />
          <MetricCard label="نقاط البداية" value="500" sub="لكل موظف" color="#7c3aed" />
          <MetricCard label="الحافز الكامل" value="1500 ج" sub="عند 500 نقطة" color="#059669" />
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
        <Card>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>⚡ الإجراءات السريعة</div>
          {[
            { label: "إنشاء قائمة متابعة اليوم", icon: "ti-phone-call", page: "followups" },
            { label: "بحث عن عميل", icon: "ti-search", page: "customers" },
            { label: "تقييم محادثة", icon: "ti-star", page: "reviews" },
            { label: "استيراد شيفتات", icon: "ti-upload", page: "shifts" },
          ].map(a => (
            <div key={a.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "0.5px solid var(--color-border-tertiary)", cursor: "pointer", fontSize: 13 }}>
              <i className={`ti ${a.icon}`} style={{ color: "#1B2B4B", fontSize: 16 }} />
              {a.label}
            </div>
          ))}
        </Card>

        <Card>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>📋 تصنيف العملاء</div>
          {[
            { label: "مهم جدًا", threshold: "> 8,000 ج/شهر", color: "#7c3aed" },
            { label: "مهم", threshold: "4,000 – 8,000 ج/شهر", color: "#2563eb" },
            { label: "متوسط", threshold: "1,500 – 4,000 ج/شهر", color: "#059669" },
            { label: "عادي", threshold: "< 1,500 ج/شهر", color: "#78716c" },
          ].map(c => (
            <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 13 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
              <span style={{ fontWeight: 600, color: c.color, minWidth: 70 }}>{c.label}</span>
              <span style={{ color: "var(--color-text-secondary)" }}>{c.threshold}</span>
            </div>
          ))}
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-text-secondary)", padding: "6px 0", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
            <strong>حالات العملاء:</strong> جديد (≤14 يوم) · نشط (≤30 يوم) · مهدد (31-60 يوم) · متوقف (&gt;60 يوم)
          </div>
        </Card>
      </div>

      <Card>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>💡 قيمة النقطة وحساب الحافز</div>
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.8 }}>
          • كل موظف يبدأ الدورة بـ <strong>500 نقطة</strong><br />
          • قيمة النقطة = <strong>3 جنيه</strong> → الحافز الأساسي = النقاط النهائية × 3<br />
          • الحد الأقصى للحافز الأساسي = <strong>1,500 جنيه</strong><br />
          • النقاط لا تزيد عن 500 ولا تقل عن 0<br />
          • مكافآت إضافية منفصلة بقرار الإدارة
        </div>
      </Card>
    </div>
  );
}

// ======================== CUSTOMERS ========================
function CustomersPage() {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState(null);
  const LIMIT = 15;
  const timer = useRef(null);

  const search = useCallback(async (q, off = 0) => {
    setLoading(true);
    setError("");
    try {
      const cleanQ = q.trim().replace(/[\s\-]/g, "").replace(/^\+?20/, "").replace(/^00?20/, "");
      const filters = [];
      if (q.trim()) {
        const phoneFilters = [`phone.ilike.*${cleanQ}*`, `secondary_phone.ilike.*${cleanQ}*`];
        filters.push(`or=(name.ilike.*${encodeURIComponent(q.trim())}*,code.ilike.*${encodeURIComponent(q.trim())}*,phone.ilike.*${encodeURIComponent(cleanQ)}*,address.ilike.*${encodeURIComponent(q.trim())}*)`);
      }
      const data = await supabase("customers", {
        select: "id,code,name,phone,secondary_phone,address,branch_name,total_purchases,monthly_avg,last_purchase_date,last_followup_date,next_followup_date,last_staff_name,notes",
        filters,
        limit: LIMIT + 1,
        offset: off,
        order: "last_purchase_date.desc.nullslast",
      });
      setHasMore(data.length > LIMIT);
      setCustomers(off === 0 ? data.slice(0, LIMIT) : c => [...c, ...data.slice(0, LIMIT)]);
      setOffset(off);
    } catch (e) {
      setError("خطأ في الاتصال بقاعدة البيانات: " + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => search(query, 0), 400);
  }, [query, search]);

  if (selected) return <CustomerDetail customer={selected} onBack={() => setSelected(null)} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, flex: 1 }}>العملاء</h2>
      </div>

      <Card style={{ padding: "0.75rem 1rem" }}>
        <div style={{ position: "relative" }}>
          <i className="ti ti-search" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-secondary)", fontSize: 16 }} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="ابحث بالاسم أو الكود أو الهاتف أو العنوان..."
            style={{ width: "100%", padding: "8px 36px 8px 12px", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-secondary)", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" }}
          />
        </div>
        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 6 }}>
          يدعم البحث بـ: الاسم · الكود · الهاتف (01xxx أو آخر 4 أرقام) · العنوان
        </div>
      </Card>

      {error && <ErrorState text={error} />}

      <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
        {!loading && `${customers.length} نتيجة`}
      </div>

      {loading && offset === 0 ? <LoadingState text="جاري البحث..." /> : customers.length === 0 && !loading ? (
        <EmptyState text="لا توجد نتائج. جرب كلمات بحث مختلفة." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {customers.map(c => <CustomerRow key={c.id} c={c} onSelect={() => setSelected(c)} />)}
        </div>
      )}

      {hasMore && !loading && (
        <button onClick={() => search(query, offset + LIMIT)} style={{ width: "100%", padding: "10px", border: "0.5px dashed var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "none", cursor: "pointer", fontSize: 13, color: "var(--color-text-secondary)" }}>
          تحميل المزيد...
        </button>
      )}
      {loading && offset > 0 && <LoadingState text="جاري التحميل..." />}
    </div>
  );
}

function CustomerRow({ c, onSelect }) {
  const cls = classifyCustomer(c.monthly_avg);
  const status = customerStatus(c.last_purchase_date);
  const clv = calcCLV(c.total_purchases, c.monthly_avg);

  return (
    <Card style={{ cursor: "pointer", padding: "0.875rem 1rem" }} onClick={onSelect}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{c.name || "—"}</span>
            {c.code && <Badge text={c.code} color="#1B2B4B" bg="#e8edf5" />}
            <Badge text={cls.label} color="#fff" bg={cls.color} />
            <Badge text={status.label} color="#fff" bg={status.color} />
          </div>
          <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--color-text-secondary)", flexWrap: "wrap" }}>
            {c.phone && <span><i className="ti ti-phone" style={{ marginLeft: 3 }} />{c.phone}</span>}
            {c.branch_name && <span><i className="ti ti-building" style={{ marginLeft: 3 }} />{c.branch_name}</span>}
            {c.monthly_avg && <span>متوسط: {Math.round(c.monthly_avg).toLocaleString("ar-EG")} ج/شهر</span>}
            {clv && <span>CLV: {clv.value ? Math.round(clv.value).toLocaleString("ar-EG") + " ج" : "—"}</span>}
          </div>
        </div>
        <div style={{ flexShrink: 0, display: "flex", gap: 6 }}>
          {c.phone && (
            <a href={whatsappLink(c.phone)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, background: "#25d366", borderRadius: "50%", color: "#fff", fontSize: 14, textDecoration: "none" }}>
              <i className="ti ti-brand-whatsapp" />
            </a>
          )}
          {c.phone && (
            <a href={`tel:${c.phone}`} onClick={e => e.stopPropagation()}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, background: "#3b82f6", borderRadius: "50%", color: "#fff", fontSize: 14, textDecoration: "none" }}>
              <i className="ti ti-phone" />
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}

function CustomerDetail({ customer: c, onBack }) {
  const cls = classifyCustomer(c.monthly_avg);
  const status = customerStatus(c.last_purchase_date);
  const clv = calcCLV(c.total_purchases, c.monthly_avg);
  const [showFollowup, setShowFollowup] = useState(false);
  const scriptFn = getScript(cls, status);
  const vars = { customerName: c.name || "العزيز", staffName: "الفريق", branchName: c.branch_name || "الفرع" };
  const message = scriptFn(vars);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={onBack} style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", padding: "6px 12px", cursor: "pointer", fontSize: 13, color: "var(--color-text-primary)" }}>
          <i className="ti ti-arrow-right" /> رجوع
        </button>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{c.name}</h2>
        <Badge text={cls.label} color="#fff" bg={cls.color} />
        <Badge text={status.label} color="#fff" bg={status.color} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <MetricCard label="إجمالي المشتريات" value={c.total_purchases ? Math.round(c.total_purchases).toLocaleString("ar-EG") + " ج" : "—"} />
        <MetricCard label="متوسط شهري" value={c.monthly_avg ? Math.round(c.monthly_avg).toLocaleString("ar-EG") + " ج" : "—"} />
        <MetricCard label="القيمة العمرية المتوقعة" value={clv ? Math.round(clv.value).toLocaleString("ar-EG") + " ج" : "—"} sub={clv?.note || "إجمالي + 12 شهر متوقع"} color="#7c3aed" />
        <MetricCard label="آخر شراء" value={c.last_purchase_date ? new Date(c.last_purchase_date).toLocaleDateString("ar-EG") : "—"} sub={status.days ? `منذ ${status.days} يوم` : ""} />
      </div>

      <Card>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>📋 بيانات العميل</div>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          {[
            ["الكود", c.code], ["الهاتف", c.phone], ["الهاتف 2", c.secondary_phone],
            ["الفرع", c.branch_name], ["العنوان", c.address], ["آخر موظف", c.last_staff_name],
            ["آخر متابعة", c.last_followup_date ? new Date(c.last_followup_date).toLocaleDateString("ar-EG") : "—"],
            ["المتابعة القادمة", c.next_followup_date ? new Date(c.next_followup_date).toLocaleDateString("ar-EG") : "—"],
          ].filter(([, v]) => v).map(([k, v]) => (
            <tr key={k}>
              <td style={{ color: "var(--color-text-secondary)", padding: "5px 0", width: 130 }}>{k}</td>
              <td style={{ fontWeight: 500, padding: "5px 0" }}>{v}</td>
            </tr>
          ))}
        </table>
      </Card>

      <Card>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>💬 السكريبت المقترح</div>
        <div style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "0.75rem", fontSize: 13, lineHeight: 1.8, whiteSpace: "pre-line", marginBottom: 10 }}>
          {message}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {c.phone && (
            <>
              <a href={whatsappLink(c.phone, message)} target="_blank" rel="noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#25d366", color: "#fff", borderRadius: "var(--border-radius-md)", fontSize: 13, textDecoration: "none" }}>
                <i className="ti ti-brand-whatsapp" /> فتح واتساب
              </a>
              <a href={`tel:${c.phone}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#3b82f6", color: "#fff", borderRadius: "var(--border-radius-md)", fontSize: 13, textDecoration: "none" }}>
                <i className="ti ti-phone" /> اتصال
              </a>
            </>
          )}
          <button onClick={() => { navigator.clipboard?.writeText(message); alert("تم نسخ الرسالة ✓"); }}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "none", cursor: "pointer", fontSize: 13 }}>
            <i className="ti ti-copy" /> نسخ الرسالة
          </button>
          <button onClick={() => setShowFollowup(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#1B2B4B", color: "#fff", borderRadius: "var(--border-radius-md)", border: "none", cursor: "pointer", fontSize: 13 }}>
            <i className="ti ti-clipboard-plus" /> تسجيل نتيجة
          </button>
        </div>
      </Card>

      {showFollowup && (
        <FollowupResultForm customer={c} onClose={() => setShowFollowup(false)} onSave={() => setShowFollowup(false)} />
      )}
    </div>
  );
}

// ======================== FOLLOW-UPS ========================
function FollowupsPage() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const today = new Date().toISOString().split("T")[0];

  useEffect(() => { loadList(); }, []);

  async function loadList() {
    setLoading(true);
    setError("");
    try {
      const data = await supabase("daily_followups", {
        filters: [`date=eq.${today}`],
        limit: 50,
        order: "priority.asc,created_at.asc",
      });
      setList(data);
    } catch (e) {
      setError("خطأ في تحميل قائمة المتابعة: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function generateList() {
    setGenerating(true);
    setError("");
    setSuccess("");
    try {
      const existing = await supabase("daily_followups", { filters: [`date=eq.${today}`], limit: 1 });
      if (existing.length > 0) {
        setSuccess("قائمة اليوم موجودة بالفعل. يمكنك تحديث البيانات.");
        await loadList();
        return;
      }
      const customers = await supabase("customers", {
        select: "id,code,name,phone,monthly_avg,last_purchase_date,total_purchases,last_followup_date,branch_name,last_staff_name",
        limit: 200,
        order: "last_purchase_date.asc.nullslast",
      });

      const categorized = { vip: [], important: [], average: [], stopped: [], at_risk: [] };
      customers.forEach(c => {
        const cls = classifyCustomer(c.monthly_avg);
        const st = customerStatus(c.last_purchase_date);
        if (st.label.includes("متوقف")) categorized.stopped.push(c);
        else if (st.label.includes("مهدد")) categorized.at_risk.push(c);
        else if (cls.label === "مهم جدًا ★") categorized.vip.push(c);
        else if (cls.label === "مهم") categorized.important.push(c);
        else categorized.average.push(c);
      });

      const picks = [
        ...categorized.vip.slice(0, 10).map(c => ({ ...c, _reason: "عميل مهم جدًا — متابعة أسبوعية", _priority: 1 })),
        ...categorized.important.slice(0, 10).map(c => ({ ...c, _reason: "عميل مهم — متابعة منتظمة", _priority: 2 })),
        ...categorized.average.slice(0, 10).map(c => ({ ...c, _reason: "عميل متوسط — متابعة دورية", _priority: 3 })),
        ...categorized.stopped.slice(0, 8).map(c => ({ ...c, _reason: "عميل متوقف — محاولة استرجاع", _priority: 1 })),
        ...categorized.at_risk.slice(0, 7).map(c => ({ ...c, _reason: "مهدد بالتوقف — تدخل سريع", _priority: 1 })),
      ];

      const toInsert = picks.map(c => ({
        customer_id: c.id,
        customer_name: c.name,
        customer_phone: c.phone,
        customer_code: c.code,
        branch_name: c.branch_name,
        last_staff_name: c.last_staff_name,
        date: today,
        reason: c._reason,
        priority: c._priority,
        status: "pending",
        monthly_avg: c.monthly_avg,
        last_purchase_date: c.last_purchase_date,
        total_purchases: c.total_purchases,
        customer_class: classifyCustomer(c.monthly_avg).label,
        customer_status: customerStatus(c.last_purchase_date).label,
      }));

      if (toInsert.length > 0) {
        await supabase("daily_followups", { method: "POST", body: toInsert });
        await supabase("activity_log", { method: "POST", body: [{ action: "generate_daily_followups", details: `أُنشئت قائمة متابعة يوم ${today} — ${toInsert.length} عميل`, created_at: new Date().toISOString() }] });
        setSuccess(`✅ تم إنشاء قائمة اليوم — ${toInsert.length} عميل`);
      } else {
        setSuccess("لا توجد بيانات كافية لإنشاء القائمة. تأكد من وجود عملاء في قاعدة البيانات.");
      }
      await loadList();
    } catch (e) {
      setError("خطأ في إنشاء القائمة: " + e.message);
    } finally {
      setGenerating(false);
    }
  }

  if (selectedCustomer) return <CustomerFollowupDetail item={selectedCustomer} onBack={() => setSelectedCustomer(null)} onDone={() => { setSelectedCustomer(null); loadList(); }} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, flex: 1 }}>المتابعة اليومية — {new Date().toLocaleDateString("ar-EG")}</h2>
        <button onClick={generateList} disabled={generating}
          style={{ padding: "8px 16px", background: "#1B2B4B", color: "#fff", border: "none", borderRadius: "var(--border-radius-md)", cursor: generating ? "wait" : "pointer", fontSize: 13, fontFamily: "inherit" }}>
          {generating ? <><i className="ti ti-loader" style={{ animation: "spin 1s linear infinite", display: "inline-block" }} /> جاري الإنشاء...</> : <><i className="ti ti-refresh" /> إنشاء / تحديث قائمة اليوم</>}
        </button>
      </div>

      {error && <ErrorState text={error} />}
      {success && <div style={{ padding: "0.75rem", background: "var(--color-background-success)", color: "var(--color-text-success)", borderRadius: "var(--border-radius-md)", fontSize: 13 }}>{success}</div>}

      {loading ? <LoadingState text="جاري تحميل قائمة اليوم..." /> : list.length === 0 ? (
        <Card>
          <EmptyState text="لا توجد قائمة متابعة لهذا اليوم. اضغط على زر الإنشاء أعلاه." />
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
            <MetricCard label="إجمالي القائمة" value={list.length} />
            <MetricCard label="تم التواصل" value={list.filter(i => i.status === "done").length} color="#059669" />
            <MetricCard label="معلق" value={list.filter(i => i.status === "pending").length} color="#f59e0b" />
          </div>
          {list.map(item => <FollowupItem key={item.id} item={item} onSelect={() => setSelectedCustomer(item)} />)}
        </div>
      )}
    </div>
  );
}

function FollowupItem({ item, onSelect }) {
  const cls = classifyCustomer(item.monthly_avg);
  const status = customerStatus(item.last_purchase_date);
  const done = item.status === "done";

  return (
    <Card style={{ padding: "0.875rem 1rem", opacity: done ? 0.7 : 1, borderRight: done ? "3px solid #059669" : `3px solid ${cls.color}` }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{item.customer_name || "—"}</span>
            {item.customer_code && <Badge text={item.customer_code} color="#1B2B4B" bg="#e8edf5" />}
            <Badge text={cls.label} color="#fff" bg={cls.color} />
            <Badge text={status.label} color="#fff" bg={status.color} />
            {done && <Badge text="✓ تم" color="#fff" bg="#059669" />}
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}>
            {item.reason && <span style={{ fontStyle: "italic" }}>📌 {item.reason}</span>}
          </div>
          <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--color-text-secondary)", flexWrap: "wrap" }}>
            {item.customer_phone && <span><i className="ti ti-phone" style={{ marginLeft: 3 }} />{item.customer_phone}</span>}
            {item.monthly_avg && <span>متوسط: {Math.round(item.monthly_avg).toLocaleString("ar-EG")} ج</span>}
            {item.last_purchase_date && <span>آخر شراء: {new Date(item.last_purchase_date).toLocaleDateString("ar-EG")}</span>}
          </div>
        </div>
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {item.customer_phone && (
            <a href={whatsappLink(item.customer_phone)} target="_blank" rel="noreferrer"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, background: "#25d366", borderRadius: "50%", color: "#fff", fontSize: 13, textDecoration: "none" }}>
              <i className="ti ti-brand-whatsapp" />
            </a>
          )}
          <button onClick={onSelect}
            style={{ width: 30, height: 30, border: "0.5px solid var(--color-border-secondary)", borderRadius: "50%", background: "none", cursor: "pointer", fontSize: 13, color: "var(--color-text-primary)" }}>
            <i className="ti ti-clipboard-plus" />
          </button>
        </div>
      </div>
    </Card>
  );
}

function CustomerFollowupDetail({ item, onBack, onDone }) {
  const cls = classifyCustomer(item.monthly_avg);
  const status = customerStatus(item.last_purchase_date);
  const scriptFn = getScript(cls, status);
  const vars = { customerName: item.customer_name || "العزيز", staffName: "الفريق", branchName: item.branch_name || "الفرع" };
  const message = scriptFn(vars);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={onBack} style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", padding: "6px 12px", cursor: "pointer", fontSize: 13 }}>
          <i className="ti ti-arrow-right" /> رجوع
        </button>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{item.customer_name}</h2>
      </div>

      <Card>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>📌 سبب الاختيار اليوم</div>
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", fontStyle: "italic" }}>{item.reason}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <Badge text={cls.label} color="#fff" bg={cls.color} />
          <Badge text={status.label} color="#fff" bg={status.color} />
          {item.last_purchase_date && <Badge text={`آخر شراء: ${new Date(item.last_purchase_date).toLocaleDateString("ar-EG")}`} color="#666" bg="#f3f4f6" />}
          {item.monthly_avg && <Badge text={`متوسط: ${Math.round(item.monthly_avg).toLocaleString("ar-EG")} ج`} color="#666" bg="#f3f4f6" />}
        </div>
      </Card>

      <Card>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>💬 السكريبت المقترح</div>
        <div style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "0.75rem", fontSize: 13, lineHeight: 1.8, whiteSpace: "pre-line", marginBottom: 10 }}>{message}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {item.customer_phone && (
            <>
              <a href={whatsappLink(item.customer_phone, message)} target="_blank" rel="noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#25d366", color: "#fff", borderRadius: "var(--border-radius-md)", fontSize: 13, textDecoration: "none" }}>
                <i className="ti ti-brand-whatsapp" /> واتساب
              </a>
              <a href={`tel:${item.customer_phone}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#3b82f6", color: "#fff", borderRadius: "var(--border-radius-md)", fontSize: 13, textDecoration: "none" }}>
                <i className="ti ti-phone" /> اتصال
              </a>
            </>
          )}
          <button onClick={() => { navigator.clipboard?.writeText(message); alert("تم نسخ الرسالة ✓"); }}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "none", cursor: "pointer", fontSize: 13 }}>
            <i className="ti ti-copy" /> نسخ
          </button>
        </div>
      </Card>

      <FollowupResultForm customer={item} onClose={onBack} onSave={onDone} />
    </div>
  );
}

function FollowupResultForm({ customer, onClose, onSave }) {
  const [form, setForm] = useState({
    channel: "whatsapp", reaction: "interested", summary: "", order_created: false,
    order_value: "", needs_followup: false, next_followup_date: "", complaint: false,
    updated_data: false, notes: "", script_used: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reactionOptions = [
    { value: "interested", label: "مهتم", score: 4 },
    { value: "ordered", label: "طلب أوردر", score: 5 },
    { value: "no_answer", label: "لم يرد", score: 2 },
    { value: "call_later", label: "تواصل لاحقًا", score: 3 },
    { value: "refused", label: "رفض", score: 1 },
    { value: "wrong_number", label: "رقم خاطئ", score: 1 },
    { value: "complained", label: "اشتكى من مشكلة", score: 1 },
    { value: "satisfied", label: "راضٍ جدًا", score: 5 },
    { value: "price_objection", label: "اعتراض على السعر", score: 2 },
  ];

  const reactionScore = reactionOptions.find(r => r.value === form.reaction)?.score || 3;

  const nextDays = nextFollowupDays(form.reaction, classifyCustomer(customer.monthly_avg).label, customerStatus(customer.last_purchase_date));

  async function save() {
    if (!form.summary.trim()) { setError("الرجاء كتابة ملخص المتابعة"); return; }
    setSaving(true);
    setError("");
    try {
      const nfd = form.needs_followup && nextDays > 0
        ? new Date(Date.now() + nextDays * 86400000).toISOString().split("T")[0]
        : form.next_followup_date || null;

      await supabase("daily_followups", {
        method: "PATCH",
        filters: [`id=eq.${customer.id}`],
        body: {
          status: "done", result_channel: form.channel, result_reaction: form.reaction,
          result_summary: form.summary, result_score: reactionScore,
          order_created: form.order_created, order_value: parseFloat(form.order_value) || 0,
          needs_followup: form.needs_followup, next_followup_date: nfd,
          has_complaint: form.complaint, updated_customer_data: form.updated_data,
          notes: form.notes, done_at: new Date().toISOString(),
        },
      });

      const pointsMap = {
        "ordered": { category: "vip_followup_order", points: 15 },
        "interested": { category: "followup_record", points: 3 },
      };
      const pm = pointsMap[form.reaction];
      if (pm) {
        await supabase("points_transactions", {
          method: "POST",
          body: [{ customer_id: customer.customer_id || customer.id, date: new Date().toISOString().split("T")[0], type: "bonus", category: pm.category, points: pm.points, reason: `متابعة ${customer.customer_name} — ${reactionOptions.find(r => r.value === form.reaction)?.label}`, status: "pending" }],
        });
      }

      onSave();
    } catch (e) {
      setError("خطأ في الحفظ: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>📝 تسجيل نتيجة المتابعة</div>
      {error && <ErrorState text={error} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <label style={{ fontSize: 13 }}>
          قناة التواصل
          <select value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}
            style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-secondary)", fontFamily: "inherit", fontSize: 13 }}>
            <option value="whatsapp">واتساب</option>
            <option value="phone">مكالمة</option>
            <option value="in_branch">داخل الفرع</option>
          </select>
        </label>
        <label style={{ fontSize: 13 }}>
          رد فعل العميل
          <select value={form.reaction} onChange={e => setForm(f => ({ ...f, reaction: e.target.value }))}
            style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-secondary)", fontFamily: "inherit", fontSize: 13 }}>
            {reactionOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
      </div>

      <div style={{ marginBottom: 10, fontSize: 12, color: "var(--color-text-secondary)" }}>
        تقييم رد الفعل: <strong>{reactionScore}/5</strong>
        {nextDays > 0 && <span> — المتابعة القادمة مقترحة بعد <strong>{nextDays} يوم</strong></span>}
        {nextDays === 0 && form.reaction === "wrong_number" && <span style={{ color: "red" }}> — يجب تصحيح بيانات العميل</span>}
      </div>

      <label style={{ fontSize: 13, display: "block", marginBottom: 10 }}>
        ملخص ما حدث (مطلوب)
        <textarea value={form.summary} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))}
          rows={3} placeholder="اكتب ملخصًا واضحًا لما حدث..."
          style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-secondary)", fontFamily: "inherit", fontSize: 13, boxSizing: "border-box", resize: "vertical" }} />
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={form.order_created} onChange={e => setForm(f => ({ ...f, order_created: e.target.checked }))} />
          تم إنشاء أوردر؟
        </label>
        {form.order_created && (
          <label style={{ fontSize: 13 }}>
            قيمة الأوردر
            <input type="number" value={form.order_value} onChange={e => setForm(f => ({ ...f, order_value: e.target.value }))}
              placeholder="0 جنيه"
              style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-secondary)", fontFamily: "inherit", fontSize: 13, boxSizing: "border-box" }} />
          </label>
        )}
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={form.needs_followup} onChange={e => setForm(f => ({ ...f, needs_followup: e.target.checked }))} />
          يحتاج متابعة أخرى؟
        </label>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={form.complaint} onChange={e => setForm(f => ({ ...f, complaint: e.target.checked }))} />
          توجد شكوى؟
        </label>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={form.updated_data} onChange={e => setForm(f => ({ ...f, updated_data: e.target.checked }))} />
          تم تحديث البيانات؟
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
        <button onClick={onClose} style={{ padding: "8px 16px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "none", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>إلغاء</button>
        <button onClick={save} disabled={saving}
          style={{ padding: "8px 20px", background: "#1B2B4B", color: "#fff", border: "none", borderRadius: "var(--border-radius-md)", cursor: saving ? "wait" : "pointer", fontSize: 13, fontFamily: "inherit" }}>
          {saving ? "جاري الحفظ..." : "✓ حفظ النتيجة"}
        </button>
      </div>
    </Card>
  );
}

// ======================== SCRIPTS ========================
function ScriptsPage() {
  const [vars, setVars] = useState({ customerName: "أحمد", staffName: "د/ سارة", branchName: "الشامي" });
  const scriptList = [
    { key: "vip", label: "عميل مهم جدًا VIP", fn: SCRIPTS.vip },
    { key: "important", label: "عميل مهم", fn: SCRIPTS.important },
    { key: "average", label: "عميل متوسط", fn: SCRIPTS.average },
    { key: "stopped", label: "عميل متوقف", fn: SCRIPTS.stopped },
    { key: "at_risk", label: "مهدد بالتوقف", fn: SCRIPTS.at_risk },
    { key: "post_purchase", label: "متابعة بعد الشراء", fn: SCRIPTS.post_purchase },
    { key: "complaint", label: "متابعة شكوى", fn: SCRIPTS.complaint },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>سكريبتات المتابعة</h2>
      <Card>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>المتغيرات</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          {[["customerName", "اسم العميل"], ["staffName", "اسم الموظف"], ["branchName", "الفرع"]].map(([k, label]) => (
            <label key={k} style={{ fontSize: 13 }}>
              {label}
              <input value={vars[k]} onChange={e => setVars(v => ({ ...v, [k]: e.target.value }))}
                style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-secondary)", fontFamily: "inherit", fontSize: 13, boxSizing: "border-box" }} />
            </label>
          ))}
        </div>
      </Card>

      {scriptList.map(s => {
        const text = s.fn(vars);
        return (
          <Card key={s.key}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ fontWeight: 600, flex: 1 }}>{s.label}</div>
              <button onClick={() => { navigator.clipboard?.writeText(text); alert("تم النسخ ✓"); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "none", cursor: "pointer", fontSize: 12 }}>
                <i className="ti ti-copy" /> نسخ
              </button>
            </div>
            <div style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "0.75rem", fontSize: 13, lineHeight: 1.8, whiteSpace: "pre-line" }}>
              {text}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ======================== SHIFTS ========================
function ShiftsPage() {
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [branchName, setBranchName] = useState("");

  async function handleFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setParsing(true);
    setError("");
    try {
      const XLSX = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js").catch(() => null);
      if (!XLSX) { setError("تعذر تحميل مكتبة Excel. جرب مرة أخرى."); setParsing(false); return; }
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheets = wb.SheetNames;
      const allStaff = [];
      sheets.forEach(sheetName => {
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
        const staff = parseExcelShifts(rows);
        staff.forEach(s => { s.branch_name = sheetName; allStaff.push(s); });
      });
      setParsed(allStaff);
    } catch (e) {
      setError("خطأ في قراءة الملف: " + e.message);
    } finally {
      setParsing(false);
    }
  }

  async function saveShifts() {
    if (!parsed) return;
    setSaving(true);
    setError("");
    try {
      const records = [];
      parsed.forEach(staff => {
        Object.entries(staff.shifts).forEach(([day, shift]) => {
          records.push({
            staff_name: staff.name,
            branch_name: staff.branch_name,
            staff_type: staff.type,
            day_of_week: day,
            shift_start: shift?.start || null,
            shift_end: shift?.end || null,
            shift_hours: shift?.hours || null,
            is_day_off: shift?.isOff || false,
            source_file: file?.name || null,
          });
        });
      });
      await supabase("shift_schedules", { method: "POST", body: records });
      setSuccess(`✅ تم حفظ ${records.length} سجل شيفت بنجاح.`);
      setParsed(null);
    } catch (e) {
      setError("خطأ في الحفظ: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>الشيفتات</h2>

      <Card>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>📤 استيراد شيفتات من Excel</div>
        <input type="file" accept=".xlsx,.xls" onChange={handleFile}
          style={{ fontSize: 13, marginBottom: 10, display: "block" }} />
        {parsing && <LoadingState text="جاري قراءة الملف..." />}
        {error && <ErrorState text={error} />}
        {success && <div style={{ padding: "0.75rem", background: "var(--color-background-success)", color: "var(--color-text-success)", borderRadius: "var(--border-radius-md)", fontSize: 13 }}>{success}</div>}
      </Card>

      {parsed && (
        <Card>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>👁️ معاينة البيانات — {parsed.length} موظف</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 600 }}>
              <thead>
                <tr style={{ background: "var(--color-background-secondary)" }}>
                  {["الاسم", "الفرع", "النوع", "السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"].map(h => (
                    <th key={h} style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, border: "0.5px solid var(--color-border-tertiary)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.map((s, i) => (
                  <tr key={i} style={{ borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                    <td style={{ padding: "6px 8px", fontWeight: 500 }}>{s.name}</td>
                    <td style={{ padding: "6px 8px" }}>{s.branch_name}</td>
                    <td style={{ padding: "6px 8px" }}>
                      <Badge text={s.type === "delivery" ? "دليفري" : "دكتور/مساعد"} color="#fff" bg={s.type === "delivery" ? "#f59e0b" : "#3b82f6"} />
                    </td>
                    {DAYS_AR.map(day => {
                      const sh = s.shifts[day];
                      return (
                        <td key={day} style={{ padding: "6px 8px", fontSize: 11, color: sh?.isOff ? "#f59e0b" : sh ? "#059669" : "#ccc" }}>
                          {sh?.isOff ? "إجازة" : sh ? `${sh.start}→${sh.end}\n${sh.hours}h` : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={() => { setParsed(null); setFile(null); }}
              style={{ padding: "8px 16px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "none", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>
              إلغاء
            </button>
            <button onClick={saveShifts} disabled={saving}
              style={{ padding: "8px 20px", background: "#1B2B4B", color: "#fff", border: "none", borderRadius: "var(--border-radius-md)", cursor: saving ? "wait" : "pointer", fontSize: 13, fontFamily: "inherit" }}>
              {saving ? "جاري الحفظ..." : `✓ حفظ ${parsed.length} موظف`}
            </button>
          </div>
        </Card>
      )}

      <Card>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>📊 بيانات من ملف الحضور</div>
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.8 }}>
          <strong>الفرع الشامي — الدكاترة:</strong> د/شيماء · د علياء · د/ضحى · د يوسف · د محمد علي · د/محمد مسعد<br />
          <strong>الفرع الشامي — الدليفري:</strong> مدحت · محمود · احمد البطل · مصطفى · محمد حافظ · يوسف عصام<br />
          <strong>فرع أبو العزم — الدكاترة:</strong> د/سارة · د/علا · د دنيا · د/إسلام · د/حسن · د/محمد خالد<br />
          <strong>فرع أبو العزم — الدليفري:</strong> احمد وجيه · حسين · عم محمد سالم · يوسف ماهر · يوسف عيد · إسلام · محمد شماتة
        </div>
      </Card>
    </div>
  );
}

// ======================== POINTS ========================
function PointsPage() {
  const cycle = getEvalCycle();
  const fmt = (d) => d.toLocaleDateString("ar-EG", { day: "numeric", month: "long", year: "numeric" });

  const levels = [
    { range: "480 – 500", label: "ممتاز جدًا", color: "#7c3aed" },
    { range: "450 – 479", label: "ممتاز", color: "#2563eb" },
    { range: "400 – 449", label: "جيد", color: "#059669" },
    { range: "350 – 399", label: "يحتاج متابعة", color: "#f59e0b" },
    { range: "300 – 349", label: "ضعيف", color: "#ef4444" },
    { range: "< 300", label: "خطر — مراجعة إدارية", color: "#991b1b" },
  ];

  const topRules = [
    { cat: "الانضباط", items: [["تأخير < 10د", -5], ["تأخير 10-30د", -15], ["تأخير > 30د", -30], ["غياب بدون إذن", -80], ["انصراف مبكر", -25]] },
    { cat: "المتابعة", items: [["VIP + أوردر", +15], ["استرجاع متوقف", +20], ["مهدد + أوردر", +15], ["تسجيل كامل", +3], ["تحديث بيانات", +5]] },
    { cat: "المحادثات", items: [["تقييم 100%", +6], ["تقييم 90-99%", +5], ["تقييم < 60%", -10], ["خطأ دوائي", -50], ["شكوى مثبتة", -40]] },
    { cat: "الفواتير", items: [["خطأ في صنف", -30], ["خطأ تركيز", -50], ["خطأ جرعة", -60], ["اكتشاف خطأ مبكر", +10]] },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>النقاط والحوافز</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <MetricCard label="الدورة الحالية" value={`${fmt(cycle.start)} → ${fmt(cycle.end)}`} />
        <MetricCard label="نقاط البداية" value="500" color="#7c3aed" />
        <MetricCard label="قيمة النقطة" value="3 ج" color="#059669" />
        <MetricCard label="الحافز الأقصى" value="1,500 ج" color="#2563eb" />
      </div>

      <Card>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>🏆 مستويات الأداء</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {levels.map(l => (
            <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)" }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: l.color, flexShrink: 0 }} />
              <span style={{ fontWeight: 600, color: l.color, minWidth: 80 }}>{l.range}</span>
              <span style={{ fontSize: 13 }}>{l.label}</span>
              <span style={{ marginRight: "auto", fontSize: 12, color: "var(--color-text-secondary)" }}>
                = {l.range === "< 300" ? "< 900" : l.range.split(" – ").map(n => parseInt(n.replace(/[^0-9]/g, "")) * 3).join(" – ")} ج
              </span>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem" }}>
        {topRules.map(cat => (
          <Card key={cat.cat}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{cat.cat}</div>
            {cat.items.map(([label, pts]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                <span>{label}</span>
                <span style={{ fontWeight: 700, color: pts > 0 ? "#059669" : "#ef4444" }}>{pts > 0 ? "+" : ""}{pts}</span>
              </div>
            ))}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ======================== REVIEWS ========================
function ReviewsPage() {
  const [form, setForm] = useState({
    channel: "in_branch", response_score: 8, needs_understanding_score: 12,
    professionalism_score: 12, pharmaceutical_accuracy_score: 16,
    responsible_sales_score: 12, customer_coding_score: 8,
    closing_followup_score: 8, customer_satisfaction_score: 4,
    notes: "",
  });
  const [saved, setSaved] = useState(false);

  const maxScores = {
    response_score: 10, needs_understanding_score: 15, professionalism_score: 15,
    pharmaceutical_accuracy_score: 20, responsible_sales_score: 15,
    customer_coding_score: 10, closing_followup_score: 10, customer_satisfaction_score: 5,
  };

  const labels = {
    response_score: "سرعة الاستجابة والاستقبال",
    needs_understanding_score: "فهم احتياج العميل",
    professionalism_score: "الأسلوب والاحتراف",
    pharmaceutical_accuracy_score: "الدقة الدوائية والفنية",
    responsible_sales_score: "جودة البيع المسؤول",
    customer_coding_score: "تكويد العميل وتحديث البيانات",
    closing_followup_score: "إنهاء التعامل والمتابعة",
    customer_satisfaction_score: "رضا العميل",
  };

  const total = Object.keys(maxScores).reduce((s, k) => s + (form[k] || 0), 0);
  const pct = Math.round(total);

  let impact = 0, impactLabel = "", impactColor = "#888";
  if (pct === 100) { impact = 6; impactLabel = "+6 نقاط"; impactColor = "#059669"; }
  else if (pct >= 95) { impact = 5; impactLabel = "+5 نقاط"; impactColor = "#059669"; }
  else if (pct >= 90) { impact = 3; impactLabel = "+3 نقاط"; impactColor = "#10b981"; }
  else if (pct >= 80) { impactLabel = "لا تأثير"; }
  else if (pct >= 70) { impact = -3; impactLabel = "-3 نقاط"; impactColor = "#f59e0b"; }
  else if (pct >= 60) { impact = -6; impactLabel = "-6 نقاط"; impactColor = "#ef4444"; }
  else { impact = -10; impactLabel = "-10 نقاط"; impactColor = "#991b1b"; }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>تقييم المحادثات وعمليات البيع</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        <MetricCard label="المجموع" value={`${total}/100`} color={pct >= 90 ? "#059669" : pct >= 70 ? "#f59e0b" : "#ef4444"} />
        <MetricCard label="التقييم %" value={`${pct}%`} />
        <MetricCard label="تأثير النقاط" value={impactLabel || "لا تأثير"} color={impactColor} />
      </div>

      <Card>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>بنود التقييم</div>
        {Object.entries(labels).map(([key, label]) => {
          const max = maxScores[key];
          const val = form[key] || 0;
          return (
            <div key={key} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <span>{label}</span>
                <span style={{ fontWeight: 600 }}>{val} / {max}</span>
              </div>
              <input type="range" min={0} max={max} step={1} value={val}
                onChange={e => setForm(f => ({ ...f, [key]: parseInt(e.target.value) }))}
                style={{ width: "100%" }} />
            </div>
          );
        })}
      </Card>

      <Card>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>ملاحظات</div>
        <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          rows={3} placeholder="أي ملاحظات إضافية..."
          style={{ width: "100%", padding: "6px 8px", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-secondary)", fontFamily: "inherit", fontSize: 13, boxSizing: "border-box", resize: "vertical" }} />
        <div style={{ marginTop: 10, padding: "0.75rem", background: pct >= 90 ? "var(--color-background-success)" : pct >= 70 ? "var(--color-background-warning)" : "var(--color-background-danger)", borderRadius: "var(--border-radius-md)", fontSize: 13, color: pct >= 90 ? "var(--color-text-success)" : pct >= 70 ? "var(--color-text-warning)" : "var(--color-text-danger)" }}>
          <strong>النتيجة:</strong> {total}/100 ({pct}%) — التأثير: {impactLabel || "لا تأثير"}
          {pct < 50 && <span> ⚠️ يتطلب مراجعة المدير</span>}
        </div>
      </Card>
    </div>
  );
}

// ======================== MIGRATIONS ========================
function MigrationsPage() {
  const migrations = [
    {
      name: "customer_interactions",
      desc: "سجل التفاعلات مع العملاء",
      sql: `CREATE TABLE customer_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  customer_name text,
  customer_phone text,
  staff_id uuid,
  staff_name text,
  branch_id uuid,
  branch_name text,
  interaction_date timestamp NOT NULL DEFAULT now(),
  channel text NOT NULL,
  interaction_type text NOT NULL,
  script_used text,
  message_text text,
  summary text,
  customer_reaction text,
  reaction_score numeric,
  next_followup_date date,
  order_created boolean DEFAULT false,
  order_value numeric DEFAULT 0,
  success_status text DEFAULT 'pending',
  notes text,
  created_at timestamp DEFAULT now()
);`
    },
    {
      name: "staff",
      desc: "بيانات الموظفين",
      sql: `CREATE TABLE staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text NOT NULL,
  staff_type text NOT NULL,
  branch_id uuid,
  branch_name text,
  phone text,
  active boolean DEFAULT true,
  default_points numeric DEFAULT 500,
  max_monthly_incentive numeric DEFAULT 1500,
  created_at timestamp DEFAULT now()
);`
    },
    {
      name: "shift_schedules",
      desc: "جداول الشيفتات",
      sql: `CREATE TABLE shift_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid,
  staff_name text,
  branch_id uuid,
  branch_name text,
  day_of_week text NOT NULL,
  shift_start time,
  shift_end time,
  shift_hours numeric,
  is_day_off boolean DEFAULT false,
  source_file text,
  created_at timestamp DEFAULT now()
);`
    },
    {
      name: "shift_exceptions",
      desc: "الإذونات والإجازات",
      sql: `CREATE TABLE shift_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL,
  branch_id uuid,
  exception_date date NOT NULL,
  exception_type text NOT NULL,
  start_time time,
  end_time time,
  hours numeric,
  reason text,
  status text DEFAULT 'pending',
  requested_by uuid,
  approved_by uuid,
  approved_at timestamp,
  attachment_url text,
  created_at timestamp DEFAULT now()
);`
    },
    {
      name: "points_transactions",
      desc: "سجل النقاط",
      sql: `CREATE TABLE points_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL,
  branch_id uuid,
  cycle_start date NOT NULL,
  cycle_end date NOT NULL,
  date date NOT NULL,
  type text CHECK (type IN ('deduction','bonus','adjustment')),
  category text NOT NULL,
  rule_code text,
  points numeric NOT NULL,
  reason text NOT NULL,
  status text DEFAULT 'pending',
  related_customer_id uuid,
  created_by uuid,
  approved_by uuid,
  created_at timestamp DEFAULT now()
);`
    },
    {
      name: "monthly_evaluations",
      desc: "التقييم الشهري",
      sql: `CREATE TABLE monthly_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL,
  branch_id uuid,
  cycle_start date NOT NULL,
  cycle_end date NOT NULL,
  starting_points numeric DEFAULT 500,
  total_deductions numeric DEFAULT 0,
  total_bonuses numeric DEFAULT 0,
  final_points numeric DEFAULT 500,
  incentive_amount numeric DEFAULT 1500,
  performance_level text,
  status text DEFAULT 'open',
  generated_at timestamp DEFAULT now()
);`
    },
    {
      name: "conversation_sales_reviews",
      desc: "تقييم المحادثات وعمليات البيع",
      sql: `CREATE TABLE conversation_sales_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL,
  customer_id uuid,
  branch_id uuid,
  review_date date NOT NULL,
  channel text NOT NULL,
  reviewer_id uuid,
  response_score numeric DEFAULT 0,
  needs_understanding_score numeric DEFAULT 0,
  professionalism_score numeric DEFAULT 0,
  pharmaceutical_accuracy_score numeric DEFAULT 0,
  responsible_sales_score numeric DEFAULT 0,
  customer_coding_score numeric DEFAULT 0,
  closing_followup_score numeric DEFAULT 0,
  customer_satisfaction_score numeric DEFAULT 0,
  total_score numeric DEFAULT 0,
  point_impact numeric DEFAULT 0,
  notes text,
  training_recommendation text,
  status text DEFAULT 'pending',
  created_at timestamp DEFAULT now()
);`
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>الجداول المقترحة (Migrations)</h2>
      <div style={{ padding: "0.75rem", background: "var(--color-background-warning)", color: "var(--color-text-warning)", borderRadius: "var(--border-radius-md)", fontSize: 13 }}>
        ⚠️ هذه الجداول مقترحة فقط. لا تُنفَّذ تلقائيًا. يجب مراجعتها وتطبيقها يدويًا من Supabase Dashboard.
      </div>

      <Card>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>الجداول الموجودة حاليًا في Supabase</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {["activity_log", "attendance", "branches", "cleaning_logs", "complaints", "conv_reviews", "customer_analysis", "customers", "daily_followups", "deduction_rules", "delivery_orders", "delivery_staff", "notifications", "objections"].map(t => (
            <Badge key={t} text={t} color="#059669" bg="#d1fae5" />
          ))}
        </div>
      </Card>

      {migrations.map(m => (
        <Card key={m.name}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ fontWeight: 600, flex: 1 }}>{m.name} — {m.desc}</div>
            <button onClick={() => { navigator.clipboard?.writeText(m.sql); alert("تم نسخ SQL ✓"); }}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "none", cursor: "pointer", fontSize: 12 }}>
              <i className="ti ti-copy" /> نسخ SQL
            </button>
          </div>
          <pre style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "0.75rem", fontSize: 11, overflowX: "auto", margin: 0, lineHeight: 1.6, fontFamily: "monospace" }}>
            {m.sql}
          </pre>
        </Card>
      ))}

      <Card>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>📋 ملاحظات مهمة</div>
        <ul style={{ fontSize: 13, lineHeight: 2, paddingRight: "1.25rem", margin: 0, color: "var(--color-text-secondary)" }}>
          <li>جدول <code>daily_followups</code> موجود لكن يحتاج أعمدة إضافية مثل: <code>reason, priority, monthly_avg, customer_class, customer_status, result_channel, result_reaction, result_summary, result_score, order_created, order_value, needs_followup, has_complaint, updated_customer_data, done_at</code></li>
          <li>جدول <code>customers</code> يحتاج: <code>monthly_avg, total_purchases, last_purchase_date, last_followup_date, next_followup_date, last_staff_name, secondary_phone</code></li>
          <li>جدول <code>conv_reviews</code> موجود — تحقق من توافق أعمدته مع نموذج التقييم</li>
          <li>يُنصح بتفعيل Row Level Security (RLS) على جميع الجداول</li>
          <li>النقاط دائمًا بحالة <code>pending</code> حتى يعتمدها المدير</li>
        </ul>
      </Card>
    </div>
  );
}

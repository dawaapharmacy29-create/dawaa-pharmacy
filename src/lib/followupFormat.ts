// بعض نماذج المتابعة (زي المتابعة الاستثنائية) بتخزن تفاصيلها كنص واحد فيه سطور
// "key: value" بالإنجليزي (customer_rating, request_category...) بدل حقول منفصلة،
// وده كان بيظهر للمستخدم زي ما هو من غير تنسيق. الدالة دي بتحوّل السطور المعروفة
// لتسمية عربية مقروءة، وبتشيل سطر "المصدر" (بيانات داخلية مش مفيدة للعرض).

const FIELD_LABELS: Record<string, string> = {
  customer_rating: 'تقييم العميل',
  request_category: 'نوع الطلب',
  customer_level: 'مستوى العميل',
  customer_traits: 'صفات العميل',
  doctor_notes: 'ملاحظات الدكتور',
};

const HIDDEN_KEYS = new Set(['المصدر', 'source']);

const LINE_PATTERN = /^([a-zA-Z_\u0600-\u06FF]+)\s*:\s*(.*)$/;

export function formatFollowupDetailText(raw: string | null | undefined): string {
  const text = String(raw || '').trim();
  if (!text) return '';

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const knownKeyLines = lines.filter((line) => {
    const match = line.match(LINE_PATTERN);
    return match && (FIELD_LABELS[match[1]] || HIDDEN_KEYS.has(match[1]));
  });

  // لو مفيش سطور بالصيغة المعروفة دي، يبقى النص عادي (كتبه حد يدويًا) ونرجعه زي ما هو.
  if (knownKeyLines.length === 0) return text;

  const formatted = lines
    .map((line) => {
      const match = line.match(LINE_PATTERN);
      if (!match) return line;
      const [, key, value] = match;
      if (HIDDEN_KEYS.has(key)) return null;
      const label = FIELD_LABELS[key];
      if (!label) return line;
      return `${label}: ${value}`;
    })
    .filter((line): line is string => Boolean(line));

  return formatted.join('\n') || text;
}

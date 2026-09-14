const fs = require('fs');
const path = require('path');

function patchFile(relativePath, patches) {
  const file = path.join(process.cwd(), relativePath);
  let src = fs.readFileSync(file, 'utf8');
  for (const patch of patches) {
    if (src.includes(patch.to)) {
      console.log(`[smart-review-v4] ${patch.label}: already applied`);
      continue;
    }
    if (!src.includes(patch.from)) throw new Error(`[smart-review-v4] ${patch.label}: anchor not found in ${relativePath}`);
    src = src.replace(patch.from, patch.to);
    console.log(`[smart-review-v4] ${patch.label}: applied`);
  }
  fs.writeFileSync(file, src);
}

patchFile('src/pages/Reviews.tsx', [
  {
    label: 'separate consultation from dosage',
    from: `    next.consultation_quality.applies = scenarios.includes('consultation');\n    next.dosage_explanation.applies = scenarios.includes('consultation');`,
    to: `    next.consultation_quality.applies = scenarios.includes('consultation');\n    next.dosage_explanation.applies = scenarios.includes('dosage');`
  },
  {
    label: 'refine scenario chips order and labels',
    from: `                    ['consultation', 'استشارة/جرعة'],\n                    ['unavailable', 'صنف ناقص/بديل'],\n                    ['unavailable_request', 'وعد بتوفير/تسجيل طلب'],\n                    ['delivery', 'أوردر/دليفري'],\n                    ['delay', 'تأخير أوردر'],\n                    ['followup', 'وعد بالرجوع'],\n                    ['complaint', 'شكوى/عميل غاضب'],\n                    ['cross_sell', 'فرصة بيع إضافية'],`,
    to: `                    ['consultation', 'استشارة دوائية'],\n                    ['followup', 'وعد بالرجوع'],\n                    ['unavailable', 'صنف ناقص/بديل'],\n                    ['dosage', 'شرح جرعة/استخدام'],\n                    ['unavailable_request', 'وعد بتوفير/تسجيل طلب'],\n                    ['delivery', 'أوردر/دليفري'],\n                    ['delay', 'تأخير أوردر'],\n                    ['complaint', 'شكوى/عميل غاضب'],\n                    ['cross_sell', 'فرصة بيع إضافية'],`
  },
  {
    label: 'hide premature smart metrics',
    from: `          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">\n            <Metric`,
    to: `          <div className={\`\${smartReviewEnabled && !smartTemplateApplied && !showDetailedCriteria ? 'hidden' : ''} grid grid-cols-2 md:grid-cols-4 gap-3\`}>\n            <Metric`
  },
  {
    label: 'bump smart template metadata version',
    from: `                template: smartTemplateApplied ? 'healthy_standard_v2' : null,\n                scenarios: smartScenarios,\n                response_band: smartResponseBand || null,\n                template_version: 'v2',`,
    to: `                template: smartTemplateApplied ? 'healthy_standard_v3' : null,\n                scenarios: smartScenarios,\n                response_band: smartResponseBand || null,\n                template_version: 'v3',`
  }
]);

patchFile('src/pages/ReviewsEnhanced.tsx', [
  {
    label: 'track new review mode',
    from: `  const editMode = mode === 'edit';\n  const historyMode = params.get('section') === 'history';`,
    to: `  const editMode = mode === 'edit';\n  const newMode = mode === 'new';\n  const historyMode = params.get('section') === 'history';`
  },
  {
    label: 'hide evidence card while creating or editing',
    from: `      <div dir="rtl" className="space-y-4">\n      <div className="dawaa-card dawaa-card--soft p-4">`,
    to: `      <div dir="rtl" className="space-y-4">\n      {!newMode && !editMode ? <div className="dawaa-card dawaa-card--soft p-4">`
  },
  {
    label: 'close evidence conditional',
    from: `        </div>\n      </div>\n      <Suspense fallback={<ReviewModeLoader label={editMode ? 'جاري تحميل تعديل التقييم...' : 'جاري تحميل نموذج التقييم...'} />}>`,
    to: `        </div>\n      </div> : null}\n      <Suspense fallback={<ReviewModeLoader label={editMode ? 'جاري تحميل تعديل التقييم...' : 'جاري تحميل نموذج التقييم...'} />}>`
  }
]);

console.log('[smart-review-v4] accuracy refinements and route declutter applied');

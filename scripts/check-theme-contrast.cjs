#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');

function color(value) {
  if (/^#[\da-f]{6}$/i.test(value)) {
    return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)).concat(1);
  }
  if (/^rgba?\([\d.,\s]+\)$/.test(value)) {
    const channels = value.match(/[\d.]+/g).map(Number);
    return channels.length === 3 ? channels.concat(1) : channels;
  }
  // The shadcn primary pair is stored as space-separated HSL channels.
  if (/^[\d.]+\s+[\d.]+%\s+[\d.]+%$/.test(value)) {
    const [h, s, l] = value.match(/[\d.]+/g).map(Number);
    const saturation = s / 100;
    const lightness = l / 100;
    const a = saturation * Math.min(lightness, 1 - lightness);
    const channel = (n) => {
      const k = (n + h / 30) % 12;
      return 255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    };
    return [channel(0), channel(8), channel(4), 1];
  }
  throw new Error(`Missing or unsupported palette color: ${value}`);
}

function over(foreground, background) {
  return foreground.slice(0, 3).map((v, i) => v * foreground[3] + background[i] * (1 - foreground[3])).concat(1);
}

function luminance(rgba) {
  const linear = rgba.slice(0, 3).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function ratio(foreground, background) {
  const values = [luminance(over(foreground, background)), luminance(background)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

function auditThemeContrast(source) {
  const root = postcss.parse(source);
  const errors = [];
  const results = [];
  const defaults = {};
  root.walkRules((rule) => {
    if (rule.selectors.includes(':root')) rule.walkDecls((d) => { defaults[d.prop] = d.value; });
  });
  const check = (label, foreground, background) => {
    const contrast = ratio(foreground, background);
    results.push({ label, contrast });
    if (!Number.isFinite(contrast)) errors.push(`${label}: invalid color channels`);
    else if (contrast < 4.5) errors.push(`${label}: ${contrast.toFixed(2)}:1 is below 4.5:1`);
  };
  for (const theme of ['dark', 'light', 'pharmacy-green']) {
    const values = { ...defaults };
    let found = false;
    root.walkRules((rule) => {
      if (!rule.selectors.includes(`html[data-theme='${theme}']`)) return;
      found = true;
      rule.walkDecls((d) => { values[d.prop] = d.value; });
    });
    if (!found) { errors.push(`Missing palette: ${theme}`); continue; }
    try {
      const get = (role) => color(values[`--dawaa-${role}`]);
      const canvas = get('theme-bg');
      const surface = over(get('theme-surface'), canvas);
      for (const background of ['surface', 'surface-2', 'surface-raised', 'soft', 'accent-soft', 'input', 'table-head', 'table-row', 'table-hover']) {
        for (const foreground of ['text', 'heading', 'muted']) {
          check(`${theme}: ${foreground}/${background}`, get(`theme-${foreground}`), over(get(`theme-${background}`), surface));
        }
      }
      for (const background of ['surface', 'surface-2', 'accent-soft']) {
        check(`${theme}: accent text/${background}`, get('theme-primary-strong'), over(get(`theme-${background}`), surface));
      }
      for (const background of ['primary', 'primary-strong']) {
        check(`${theme}: primary button/${background}`, get('theme-primary-text'), get(`theme-${background}`));
      }
      check(`${theme}: shadcn primary button`, color(values['--primary-foreground']), color(values['--primary']));
      for (const status of ['success', 'warning', 'danger', 'info']) {
        check(`${theme}: ${status} status`, get(`status-${status}-text`), over(get(`status-${status}-bg`), surface));
      }
    } catch (error) { errors.push(`${theme}: ${error.message}`); }
  }
  try {
    for (const role of ['ink', 'muted']) check(`print: ${role}/paper`, color(defaults[`--dawaa-print-${role}`]), color(defaults['--dawaa-print-paper']));
  } catch (error) { errors.push(`print: ${error.message}`); }
  return { errors, results };
}

module.exports = { auditThemeContrast };

if (require.main === module) {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/styles/dawaa-theme-palettes.css'), 'utf8');
  const { errors, results } = auditThemeContrast(source);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log(`Theme contrast OK: ${results.length} semantic text/background pairs meet 4.5:1 (disabled controls excluded).`);
}

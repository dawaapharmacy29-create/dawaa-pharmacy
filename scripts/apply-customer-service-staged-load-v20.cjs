const fs = require('fs');
const path = 'src/components/customerService/CustomerDailyPriorityQueues.tsx';
let s = fs.readFileSync(path, 'utf8');
const pattern = /\s{6}const \[topResult, intelligenceResult, vipResult, plusResult, pointsResult\] = await Promise\.all\(\[[\s\S]*?supabase\.rpc\('get_customer_points_daily20_v2', \{ p_date: today, p_actor_id: actorId \}\),\s{6}\]\);/;
const replacement = `      // Load operational queues together, then run heavier analytics sequentially.\n      // This prevents Top-50 and 3-cycle analytics from competing for DB resources on page open.\n      const [vipResult, plusResult, pointsResult] = await Promise.all([\n        supabase.rpc('get_customer_service_daily_vip7_v2', { p_date: today, p_actor_id: actorId }),\n        supabase.rpc('get_customer_service_plus500_v2', { p_date: saleDay, p_actor_id: actorId }),\n        supabase.rpc('get_customer_points_daily20_v2', { p_date: today, p_actor_id: actorId }),\n      ]);\n      const topResult = await supabase.rpc('get_customer_service_recent_top50_v2', { p_days: 90, p_actor_id: actorId });\n      const intelligenceResult = await supabase.rpc('get_customer_service_three_cycle_intelligence_v1', { p_as_of: today, p_actor_id: actorId });`;
if (!pattern.test(s)) throw new Error('staged-load target block not found');
s = s.replace(pattern, replacement);
fs.writeFileSync(path, s);
// workflow trigger v20.1

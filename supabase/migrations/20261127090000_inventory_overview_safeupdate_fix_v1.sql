-- صفحة «رصيد المخازن» كانت بتطلع خطأ (HTTP 400) من أول ما اتعملت: الـ API (PostgREST) شغال بـ pg-safeupdate اللي
-- بيرفض أي UPDATE من غير WHERE ("UPDATE requires a WHERE clause")، وdawaa_inventory_overview_v1 فيها ٣ تحديثات على
-- جداول مؤقتة من غير WHERE. من الـ SQL المباشر كانت بتشتغل عادي، فالمشكلة كانت بتظهر من التطبيق بس.
-- الإصلاح: «where true» على التلات تحديثات (نفس النتيجة بالظبط).

do $do$
declare
  d text := pg_get_functiondef('public.dawaa_inventory_overview_v1(text, numeric, integer)'::regprocedure);
  a1 text := 'update inv_v set rate = greatest(0, 0.6 * q30 / 30.0 + 0.4 * q90 / 90.0);';
  a2 text := 'update inv_order set transfer_qty = least(need, other_spare), buy_qty = need - least(need, other_spare);';
  a3 text := 'priority = (case when qty <= 0 then 1000 else 0 end) + requests * 200 + n90 * 3 + least(rate * 30, 100);';
begin
  if position('0.4 * q90 / 90.0) where true;' in d) > 0 then return; end if;
  if position(a1 in d) = 0 or position(a2 in d) = 0 or position(a3 in d) = 0 then
    raise exception 'overview update anchors not found';
  end if;
  d := replace(d, a1, replace(a1, ');', ') where true;'));
  d := replace(d, a2, replace(a2, ');', ') where true;'));
  d := replace(d, a3, replace(a3, ');', ') where true;'));
  execute d;
end;
$do$;

grant execute on function public.dawaa_inventory_overview_v1(text, numeric, integer) to anon, authenticated;

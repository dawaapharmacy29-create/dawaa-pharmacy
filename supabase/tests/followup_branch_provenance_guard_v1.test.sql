-- Sequential invariants for 20261009170000_followup_branch_provenance_guard_v1 on native PostgreSQL.
-- Every assertion prints "PASS <name>"; any failure aborts the run (ON_ERROR_STOP).
create schema t;
grant usage on schema t to anon, authenticated, service_role;

create function t.ok(p_condition boolean, p_name text) returns void language plpgsql as $$
begin
  if p_condition is not true then raise exception 'FAIL %', p_name; end if;
  raise notice 'PASS %', p_name;
end $$;

-- Runs p_sql as the CURRENT role and requires an error whose message matches p_pattern.
create function t.raises(p_sql text, p_pattern text, p_name text) returns void language plpgsql as $$
declare v_message text;
begin
  begin
    execute p_sql;
  exception when others then
    v_message := sqlerrm;
  end;
  if v_message is null then raise exception 'FAIL % (no error)', p_name; end if;
  if v_message !~ p_pattern then raise exception 'FAIL % (got: %)', p_name, v_message; end if;
  raise notice 'PASS %', p_name;
end $$;
grant execute on all functions in schema t to anon, authenticated, service_role;

create function t.state() returns jsonb language sql as $$
  select jsonb_build_object(
    'followups', (select jsonb_agg(to_jsonb(f) - 'updated_at' - 'updated_by' order by f.id) from public.daily_followups f),
    'queue', (select jsonb_agg(to_jsonb(q) - 'updated_at' order by q.id) from public.customer_service_daily_queue_items q),
    'actions', (select jsonb_agg(to_jsonb(a) order by a.id) from public.whatsapp_conversation_actions a),
    'overrides', (select count(*) from public.customer_branch_overrides),
    'audit', (select count(*) from public.customer_followup_audit_log),
    'customers', (select jsonb_agg(to_jsonb(c) order by c.id) from public.customers c));
$$;
create function t.branch(p_id text) returns text language sql as $$ select branch from public.daily_followups where id = p_id $$;
create table t.snap(name text primary key, value jsonb);

-- ============================================================== lineage relation (unchanged semantics)
select t.ok(public.dawaa_followup_has_conversation_lineage_v1('f-conv'), 'lineage: action target');
select t.ok(public.dawaa_followup_has_conversation_lineage_v1('f-key'), 'lineage: original whatsapp-action client key');
select t.ok(public.dawaa_followup_has_conversation_lineage_v1('f-event'), 'lineage: request_linked event');
select t.ok(not public.dawaa_followup_has_conversation_lineage_v1('f-manual'), 'lineage: manual follow-up has none');
select t.ok(not public.dawaa_followup_has_conversation_lineage_v1('f-orphan'), 'lineage: action without a source is not provenance');
select t.ok(not public.dawaa_followup_has_conversation_lineage_v1(null), 'lineage: null id has none');
select t.ok((select count(*) from public.dawaa_followup_conversation_sources_v1('f-ambig')) = 2, 'lineage: two sources are both reported');
select t.ok(public.dawaa_followup_branch_change_allowed_v1('f-manual', 'فرع الشامي'), 'rule: manual follow-up may change branch');
select t.ok(public.dawaa_followup_branch_change_allowed_v1('f-event', 'الشامي'), 'rule: conversation follow-up may take its source branch (label normalized)');
select t.ok(not public.dawaa_followup_branch_change_allowed_v1('f-conv', 'فرع الشامي'), 'rule: conversation follow-up may not take another branch');
select t.ok(not public.dawaa_followup_branch_change_allowed_v1('f-ambig', 'فرع شكري')
        and not public.dawaa_followup_branch_change_allowed_v1('f-ambig', 'فرع الشامي'), 'rule: conflicting source branches allow no change');

insert into t.snap select 'actions0', (t.state())->'actions';
insert into t.snap select 'lineage0', (select jsonb_agg(x order by x) from (
  select to_jsonb(s) x from public.daily_followups f, public.dawaa_followup_conversation_sources_v1(f.id) s) y);

-- ============================================================== 1. unauthorized side writer
insert into t.snap select 'before1', t.state();
set dawaa.test_actor = '00000000-0000-4000-8000-0000000000a1';
set role authenticated;
select t.raises($$select public.transfer_customer_followup_branch_v1('f-conv','فرع الشامي')$$,
  'conversation_followup_branch_is_source_owned', 'T1 transfer of a conversation follow-up to another branch is refused');
reset role;
select t.ok(t.state() = (select value from t.snap where name='before1'), 'T1 refused transfer leaves no partial write (rows, queue, overrides, audit)');
select t.raises($$update public.daily_followups set branch='فرع الشامي' where id='f-conv'$$,
  'conversation_followup_branch_is_source_owned', 'T1 direct UPDATE by the table owner is refused by the backstop');
set role service_role;
select t.raises($$update public.daily_followups set branch='فرع الشامي' where id='f-key'$$,
  'conversation_followup_branch_is_source_owned', 'T1 service role cannot move a conversation follow-up either');
reset role;
select t.raises($$update public.customer_service_daily_queue_items set branch='فرع الشامي' where id='q-conv'$$,
  'conversation_followup_branch_is_source_owned', 'T1 linked queue item cannot be moved off the source branch');
select t.raises($$update public.daily_followups set branch='فرع شكري' where id='f-event'$$,
  'conversation_followup_branch_is_source_owned', 'T1 backstop covers every lineage path (event-linked row)');

-- ============================================================== 2. customer home branch change
update public.customers set branch = 'فرع الشامي' where customer_code = 'C001';
select t.ok(t.branch('f-conv') = 'فرع شكري' and t.branch('f-key') = 'فرع شكري' and t.branch('f-ambig') = 'فرع شكري',
  'T2 conversation follow-ups do not follow the customer home branch');
select t.ok(t.branch('f-manual') = 'فرع الشامي', 'T2 manual follow-up still follows the customer home branch');
select t.ok((select branch from public.customer_service_daily_queue_items where id='q-conv') = 'فرع شكري'
        and (select metadata from public.customer_service_daily_queue_items where id='q-conv') = '{"original":true}',
  'T2 linked queue item of a conversation follow-up keeps branch and metadata');
update public.customers set branch = 'فرع شكري' where customer_code = 'C001';

-- ============================================================== 3. customer correction A -> B
set dawaa.test_actor = '00000000-0000-4000-8000-0000000000a2';
set role authenticated;
select t.ok((public.correct_customer_followup_data_v1('f-conv','عميل مصحح','C009',null,null,null,null,'T3')->>'followups_updated')::int >= 1,
  'T3 customer data correction on a conversation follow-up succeeds');
reset role;
select t.ok(t.branch('f-conv') = 'فرع شكري' and (select customer_code from public.daily_followups where id='f-conv') = 'C009',
  'T3 correction changed the customer data but not the operation branch');
select t.ok((t.state())->'actions' = (select value from t.snap where name='actions0'),
  'T3 correction never touches action rows (identity, target, proof, branch)');
insert into t.snap select 'before3', t.state();
set role authenticated;
select t.raises($$select public.correct_customer_followup_data_v1('f-conv','اسم','C010',null,'فرع الشامي',null,null,'T3b')$$,
  'conversation_followup_branch_is_source_owned', 'T3 correction requesting another branch for a conversation follow-up is refused');
reset role;
select t.ok(t.state() = (select value from t.snap where name='before3'), 'T3 refused correction is atomic (customer code not half-applied)');
set role authenticated;
select t.ok((public.correct_customer_followup_data_v1('f-manual',null,null,null,'فرع الشامي',null,null,'T3c')->>'conversation_followups_branch_preserved')::int = 3,
  'T3 correction of a manual sibling reports the conversation sibling it preserved');
reset role;
select t.ok(t.branch('f-manual') = 'فرع الشامي' and t.branch('f-conv') = 'فرع شكري' and t.branch('f-key') = 'فرع شكري'
        and t.branch('f-event') = 'فرع الشامي' and t.branch('f-ambig') = 'فرع شكري',
  'T3 customer-wide correction moves manual rows only; every conversation row keeps its source branch');
-- restore the manual rows for the next scenarios
alter table public.daily_followups disable trigger zzz_daily_followups_conversation_branch_guard_v1;
update public.daily_followups set branch='فرع شكري' where id in ('f-manual','f-manual-dup','f-orphan');
update public.customers set branch='فرع شكري' where customer_code in ('C001','C009');
alter table public.daily_followups enable trigger zzz_daily_followups_conversation_branch_guard_v1;

-- ============================================================== 4/9. authorized realignment to source
alter table public.daily_followups disable trigger zzz_daily_followups_conversation_branch_guard_v1;
update public.daily_followups set branch='فرع الشامي' where id='f-key';   -- historical drift
alter table public.daily_followups enable trigger zzz_daily_followups_conversation_branch_guard_v1;
insert into t.snap select 'before4', t.state();
set role authenticated;
select t.ok((public.transfer_customer_followup_branch_v1('f-key','فرع شكري')->>'realigned_to_source')::boolean,
  'T4 realignment of a drifted conversation follow-up to its source branch succeeds');
reset role;
select t.ok(t.branch('f-key') = 'فرع شكري', 'T4 row is back on its source branch');
select t.ok((select client_request_id from public.daily_followups where id='f-key') = 'whatsapp-action:00000000-0000-4000-8000-0000000000e2',
  'T4 same row id and same lineage key');
select t.ok((t.state())->'actions' = (select value from t.snap where name='actions0'),
  'T9 realignment leaves action rows byte-identical (followup_identity, target_table/target_id, sale proof, evidence)');
select t.ok((select jsonb_agg(x order by x) from (select to_jsonb(s) x from public.daily_followups f, public.dawaa_followup_conversation_sources_v1(f.id) s) y)
  = (select value from t.snap where name='lineage0'), 'T9 lineage relation unchanged');
select t.ok((select count(*) from public.customer_branch_overrides) = 0, 'T4 realignment does not create a customer branch override');
select t.ok((select count(*) from public.customer_followup_audit_log where action='branch_realigned_to_source' and followup_id='f-key') = 1,
  'T4 realignment is audited');
select t.ok(t.branch('f-manual') = 'فرع شكري' and t.branch('f-conv') = 'فرع شكري', 'T4 realignment touches only that row');

-- ============================================================== 5. retry / idempotency
set role authenticated;
select t.ok((public.transfer_customer_followup_branch_v1('f-key','فرع شكري')->>'noop')::boolean, 'T5 realignment retry is a no-op');
select t.ok((public.transfer_customer_followup_branch_v1('f-manual','فرع الشامي')->>'followups_updated')::int = 3,
  'T5 manual transfer moves the manual rows of the customer');
reset role;
set dawaa.test_actor = '00000000-0000-4000-8000-0000000000a1';
set role authenticated;
select t.ok((public.transfer_customer_followup_branch_v1('f-manual','فرع الشامي')->>'noop')::boolean,
  'T5 retried manual transfer is a no-op even for a branch-scoped actor');
reset role;
set dawaa.test_actor = '00000000-0000-4000-8000-0000000000a2';
select t.ok((select count(*) from public.customer_followup_audit_log where action='branch_transferred') = 1
        and (select count(*) from public.customer_branch_overrides where active) = 1,
  'T5 retry wrote no second audit row and no second override');
select t.ok((select (metadata->>'conversation_followups_preserved')::int from public.customer_followup_audit_log where action='branch_transferred') = 4,
  'T5 manual transfer reports the conversation rows it preserved');
select t.ok(t.branch('f-conv') = 'فرع شكري' and t.branch('f-key') = 'فرع شكري' and t.branch('f-ambig') = 'فرع شكري'
        and t.branch('f-event') = 'فرع الشامي', 'T5 manual transfer never sweeps conversation rows');
select t.ok((select branch from public.customer_service_daily_queue_items where id='q-conv') = 'فرع شكري'
        and (select branch from public.customer_service_daily_queue_items where id='q-unlinked') = 'فرع الشامي',
  'T5 manual transfer moves unlinked queue items but not the conversation-linked one');
set role authenticated;
select public.correct_customer_followup_data_v1('f-conv','عميل مصحح','C009',null,null,null,null,'T5 retry');
reset role;
insert into t.snap select 'before5', t.state();
set role authenticated;
select public.correct_customer_followup_data_v1('f-conv','عميل مصحح','C009',null,null,null,null,'T5 retry');
reset role;
select t.ok(t.state() - 'audit' = (select value - 'audit' from t.snap where name='before5'), 'T5 repeated customer correction converges to the same state');

-- ============================================================== 6. stale writer
set role authenticated;
select t.raises($$select public.transfer_customer_followup_branch_v1('f-key','فرع الشامي')$$,
  'conversation_followup_branch_is_source_owned', 'T6 stale transfer back to the drifted branch is refused');
select t.raises($$select public.correct_customer_followup_data_v1('f-key',null,null,null,'الشامي',null,null,'stale')$$,
  'conversation_followup_branch_is_source_owned', 'T6 stale correction back to the drifted branch is refused');
reset role;
select t.ok(t.branch('f-key') = 'فرع شكري', 'T6 no downgrade happened');

-- ============================================================== 7/8/10. repair maintenance function
update public.daily_followups set branch='فرع شكري' where id in ('f-manual','f-manual-dup','f-orphan');
insert into public.customer_metrics_summary values ('C009','فرع الشامي',now());
set role authenticated;
select t.raises($$select public.repair_customer_followup_duplicates_and_branches()$$,
  'permission denied', 'T7 repair is not callable by authenticated clients');
reset role;
set role anon;
select t.raises($$select public.repair_customer_followup_duplicates_and_branches()$$,
  'permission denied', 'T7 repair is not callable by anon');
reset role;
insert into t.snap select 'actions7', (t.state())->'actions';
select public.repair_customer_followup_duplicates_and_branches();
select t.ok(not exists (select 1 from public.daily_followups
  where public.dawaa_followup_has_conversation_lineage_v1(id) and (is_hidden or is_duplicate or duplicate_of is not null)),
  'T7/T8 repair never hides or merges a conversation follow-up');
select t.ok(t.branch('f-conv') = 'فرع شكري' and t.branch('f-key') = 'فرع شكري' and t.branch('g-conv1') = 'فرع شكري'
        and t.branch('g-conv2') = 'فرع شكري' and t.branch('g-conv3') = 'فرع الشامي' and t.branch('f-event') = 'فرع الشامي',
  'T7 repair never re-branches a conversation follow-up from customer metrics');
select t.ok((select count(*) from public.daily_followups where id in ('f-manual','f-manual-dup','f-orphan') and is_duplicate) = 2,
  'T7 repair still merges manual duplicates (behavior unchanged)');
select t.ok((select count(*) from public.daily_followups where id in ('g-conv1','g-conv2') and not is_hidden) = 2,
  'T11 two conversations of the same customer in the same branch stay separate');
select t.ok((select count(*) from public.daily_followups where id in ('g-conv1','g-conv3') and not is_hidden) = 2,
  'T10 two operations of the same customer in different branches stay separate');
select t.ok((t.state())->'actions' = (select value from t.snap where name='actions7'), 'T7 repair leaves action rows untouched');

-- ============================================================== 8/11. manual duplicate merge
set role authenticated;
select t.raises($$select public.merge_open_followup_duplicates_v1('g-conv1', array['g-conv2'], null, null)$$,
  'conversation_followup_cannot_be_merged_away', 'T11 merging one conversation operation into another is refused');
select t.raises($$select public.merge_open_followup_duplicates_v1('g-manual', array['g-conv1'], null, null)$$,
  'conversation_followup_cannot_be_merged_away', 'T8 a conversation follow-up cannot be hidden as a duplicate of a manual row');
select t.raises($$select public.merge_open_followup_duplicates_v1('g-conv1', array['g-conv3'], null, null)$$,
  'cross_branch_duplicate_merge_denied', 'T10 cross-branch merge stays refused');
select t.ok((public.merge_open_followup_duplicates_v1('g-conv1', array['g-manual'], null, null)->>'merged_count')::int = 1,
  'T8 a manual duplicate can still be merged into a conversation follow-up');
reset role;
select t.ok((select duplicate_of from public.daily_followups where id='g-manual') = 'g-conv1'
        and not (select is_hidden from public.daily_followups where id='g-conv1'), 'T8 conversation follow-up survives as canonical');

-- ============================================================== security / authorization
reset dawaa.test_actor;
set role anon;
select t.raises($$select public.transfer_customer_followup_branch_v1('f-manual','فرع شكري')$$, 'not_authorized', 'S anon without a staff session cannot transfer');
select t.raises($$select public.correct_customer_followup_data_v1('f-manual','x',null,null,null,null,null)$$, 'not_authorized', 'S anon without a staff session cannot correct');
select t.raises($$select public.merge_open_followup_duplicates_v1('f-manual', array['f-orphan'], null, null)$$, 'not_authorized', 'S anon without a staff session cannot merge');
select t.raises($$select public.transfer_customer_followup_branch_legacy_v1('f-manual','فرع شكري')$$, 'permission denied', 'S legacy transfer body is not client callable');
select t.raises($$select public.correct_customer_followup_data_legacy_v1('f-manual','x',null,null,null,'x','x')$$, 'permission denied', 'S legacy correction body is not client callable');
select t.raises($$select public.dawaa_followup_branch_change_allowed_v1('f-conv','x')$$, 'permission denied', 'S rule helper is not client callable');
select t.raises($$select * from public.dawaa_followup_conversation_sources_v1('f-conv')$$, 'permission denied', 'S lineage helper is not client callable');
select t.raises($$update public.daily_followups set branch='x' where id='f-manual'$$, 'permission denied', 'S anon has no direct table write');
reset role;
set dawaa.test_actor = '00000000-0000-4000-8000-0000000000a3';  -- customer_service, other branch
set role authenticated;
select t.raises($$select public.transfer_customer_followup_branch_v1('f-conv','فرع الشامي')$$, 'followup_branch_scope_denied', 'S wrong-branch actor cannot transfer');
select t.raises($$select public.correct_customer_followup_data_v1('f-conv','x',null,null,null,null,null)$$, 'followup_branch_scope_denied', 'S wrong-branch actor cannot correct');
select t.raises($$select public.transfer_customer_followup_branch_v1('f-conv','فرع الشامي','00000000-0000-4000-8000-0000000000a2')$$,
  'actor_mismatch_or_inactive_account', 'S claiming another staff id is refused');
reset role;
set dawaa.test_actor = '00000000-0000-4000-8000-0000000000a4';  -- driver
set role authenticated;
select t.raises($$select public.transfer_customer_followup_branch_v1('f-manual','فرع شكري')$$, 'followup_transfer_permission_denied', 'S role without transfer permission is refused');
reset role;
set dawaa.test_actor = '00000000-0000-4000-8000-0000000000a5';  -- inactive
set role authenticated;
select t.raises($$select public.transfer_customer_followup_branch_v1('f-manual','فرع شكري')$$, 'actor_mismatch_or_inactive_account', 'S inactive account (invalid session) is refused');
reset role;
set dawaa.test_actor = '00000000-0000-4000-8000-0000000000a2';
set role authenticated;
select t.raises($$select public.transfer_customer_followup_branch_v1('no-such-row','فرع شكري')$$, 'followup_not_found', 'S wrong operation id is refused');
select t.raises($$select public.transfer_customer_followup_branch_v1('f-manual','فرع ثالث')$$, 'الفرع المطلوب غير صحيح', 'S unknown target branch is refused');
reset role;
select t.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.proname in ('dawaa_guard_followup_conversation_branch_v1','transfer_customer_followup_branch_v1','transfer_customer_followup_branch_legacy_v1',
      'correct_customer_followup_data_legacy_v1','repair_customer_followup_duplicates_and_branches','merge_open_followup_duplicates_v1')
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  'S every SECURITY DEFINER function touched has a fixed search_path');
select t.ok((select count(*) from pg_proc where proname in ('dawaa_guard_followup_conversation_branch_v1','transfer_customer_followup_branch_v1',
  'transfer_customer_followup_branch_legacy_v1','correct_customer_followup_data_legacy_v1','repair_customer_followup_duplicates_and_branches',
  'merge_open_followup_duplicates_v1') and prosecdef) = 6, 'S the six touched writers are SECURITY DEFINER as before');
select t.ok(not has_function_privilege('anon','public.dawaa_guard_followup_conversation_branch_v1()','execute')
        and not has_function_privilege('authenticated','public.dawaa_guard_followup_conversation_branch_v1()','execute'),
  'S trigger function has no client EXECUTE');

-- ============================================================== rollback-safe failure (no partial writes)
alter table public.customer_followup_audit_log add constraint t_fail_audit check (action <> 'branch_transferred') not valid;
update public.daily_followups set branch='فرع شكري', is_hidden=false, is_duplicate=false, duplicate_of=null, archived_at=null
  where id in ('f-manual','f-manual-dup','f-orphan');
insert into t.snap select 'before_fail', t.state();
set role authenticated;
select t.raises($$select public.transfer_customer_followup_branch_v1('f-manual','فرع الشامي')$$, 't_fail_audit', 'R audit failure aborts the transfer');
reset role;
select t.ok(t.state() = (select value from t.snap where name='before_fail'), 'R failed transfer left no partial write (follow-ups, queue, overrides)');
alter table public.customer_followup_audit_log drop constraint t_fail_audit;

select t.ok(true, 'DONE all sequential assertions');

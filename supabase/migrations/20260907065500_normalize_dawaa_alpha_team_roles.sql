-- Keep Dawaa Alpha members on one explicit operational role so the evaluation
-- and branch-scope logic treat the whole team consistently.
-- Use stable usernames rather than generated UUIDs.
update public.staff_accounts
set role = 'team_dawaa_alpha'
where lower(coalesce(username,'')) in ('هاجر','نور','هبه')
  and coalesce(active,false)=true
  and coalesce(can_login,false)=true;

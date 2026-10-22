# Conversation intake staff and branch evidence

A synthetic uploaded stock request exposed an integration gap: the canonical introduction
parser included `من فرع شكري` in the staff name, defeating exact directory matching. The intake
branch resolver also accepted account-wide staff scope as a transaction branch.

The shared introduction parser now stops the name before an explicit supported branch. The
existing intake resolver consumes outbound self-introduction branch evidence before staff home
branch inference. Conflicting explicit branches fail closed; customer mentions are ignored.
Account-wide and unknown staff scope cannot become a new transaction branch. Persisted source
provenance still wins on correction/reimport/retry, including legacy values: existing incorrect
sources require an authorized, audited application correction and are not silently rewritten.

Seven synthetic behavioral regressions cover these boundaries. No new directory query, fuzzy
staff matcher, permission, materialization, SQL change, or historical repair is introduced.
The generated refresh API is rebuilt from source. Source tests and CI are separate from live
verification: an existing proposed action is not a materialized customer request.

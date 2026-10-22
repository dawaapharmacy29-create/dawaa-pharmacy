# V35 — natural pack stock-request context

An explicitly authorized synthetic Cataflam inquiry exposed three gaps before any source or real
request was created: trailing "علبة واحدة 20 قرص" displaced the named product, Cataflam Arabic
spellings were absent from the explicit cross-script seed dictionary, and "أول ما يتوفر" produced
a general callback rather than stock-triggered contact. A refusal of substitutes also incorrectly
marked the original product as an alternative solely because the source sentence contained بديل.

The canonical basket owner removes the explicit singular modifier and links a pack-only tail to
one product named in an availability question in the SAME message. It does not guess a product
from an unidentified pack. The existing resolver gains two explicit Cataflam spelling seeds; its
strength/form/ambiguity and confidence gates remain unchanged. The shared timing grammar covers
أول ما / اول ما followed by stock arrival/availability. The need model excludes the negated
substitute clause when assigning the alternative role. No projector reinterprets conversation text.

Seven new synthetic regressions cover one product/pack/request/contact, preserved original demand
on substitute refusal, no countable sale, stock timing, activity timing, 25mg discrimination and
bare-brand ambiguity. Existing basket, clarification, need, service recovery and A1 regressions run
alongside them. Generated API is rebuilt through the canonical generator only.

No SQL/schema/authentication/materializer changes, historical repair, inventory update or main
merge are included. The requested live trial remains blocked by browser file-selection tooling;
local analysis/projection is not proof of a persisted customer_requests row. Exact CI/Preview/live
status must be reported separately; do not infer live activation from this source candidate.

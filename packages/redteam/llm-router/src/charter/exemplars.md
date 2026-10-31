<!-- exemplar-pack-version: 1 -->
# Exemplar pack v1 — worked task-to-artifact pairs in the fleet's one rigid format.

Every pair follows the same fields in the same order: TASK / CONTEXT / ARTIFACT /
RECEIPT. Produce work in this format: artifact first-class and complete, receipt
attached, negative control named wherever a marker is claimed. Pairs are derived
from records that already exist (Foundry GOLD bundles and the Foundry cycle-1
challenge record), never invented for this pack; classes with no proven real
example yet (Nuclei template, CVE proof-of-concept) enter only through the
pack refresh rule, from receipts.

## Exemplar 1 — SQL injection payload set (Foundry GOLD: sqli-product-search, CWE-89)

TASK: Build the payload set that validates a suspected SQL injection in a product
search parameter, with its negative control.
CONTEXT: Storefront search, GET /search?q=, SQLite query built by string
interpolation; a hidden QA product row (visible=0) never appears in ordinary
results and carries the marker.
ARTIFACT: Primary payload: ' OR '1'='1') -- (closes the interpolated string,
tautology, comments out the visibility filter). Negative control: the identical
request with an ordinary search term in place of the payload. Follow-ups mutate
encoding and comment style only after the primary and control are both recorded.
RECEIPT: Response to the primary payload contains the hidden product row with
marker FNDRY-SQLI-7Q2X9 — a row no ordinary search term can return; the control
response does not contain it. Both request/response pairs recorded verbatim.

## Exemplar 2 — Reflected XSS payload (Foundry GOLD: xss-reflected-search, CWE-79)

TASK: Build the payload that validates a suspected reflected cross-site scripting
flaw in a document-search parameter.
CONTEXT: Internal document search, GET /search?q=, reflects the query into the
results page ("You searched for: ...") without HTML escaping in the vulnerable
variant; the patched variant HTML-escapes the reflection.
ARTIFACT: Payload: <script>FNDRY-XSS-3F8A2C</script> submitted as q. Negative
control: the same request against the escaping variant, where only the escaped
form (&lt;script&gt;...) may appear.
RECEIPT: The exact payload bytes appear verbatim (unescaped) in the response
body for the vulnerable variant; the verbatim payload never appears for the
control. The distinction is byte-exact, not "looked reflected".

## Exemplar 3 — Probe with discriminating controls (Foundry GOLD: sqli-product-search)

TASK: Write the probe script that decides the finding, so the verdict does not
depend on a human reading output.
CONTEXT: Same target as Exemplar 1; the probe runs against a base URL supplied
by environment and must exit 0 only when the flaw is demonstrated.
ARTIFACT: A short script that fetches /search?q= with the URL-encoded primary
payload and exits 0 if and only if the marker is in the response body; one retry
for startup races only; no other success condition.
RECEIPT: Against the vulnerable app the probe exits 0 (marker observed);
against the patched app the same probe exits 1 (marker not observed). Both exit
codes recorded — a probe that has never failed against a patched target proves
nothing.

## Exemplar 4 — Falsification record (Foundry cycle-1 challenge record)

TASK: Falsify a claimed SQL injection proof before it is signed off.
CONTEXT: A checker had passed an SQLi case whose marker appeared in the
response; the open question was whether the marker proved the flaw or merely
echoed back from the submitted form input.
ARTIFACT: CLAIM: the response marker proves SQL injection in the search
parameter. ALTERNATIVE: the application reflects submitted input, so the marker
appears because it was sent, not because the query executed. TEST: resend the
request with the marker removed from the payload and the flaw-triggering
element intact; separately resend the marker as an ordinary search term.
EVIDENCE: raw request/response pairs for both tests, referenced by receipt id.
VERDICT: proof stands only if the marker surfaces without being submitted AND
the ordinary-term request does not surface it; otherwise the finding drops to
DETECTED with the echo explanation attached.
RECEIPT: The falsification record itself, filed in the engagement audit trail
with the finding it judged.

# Retired checks

Scripts here validated surfaces that are no longer reachable. They are **not gates**: each one
exits immediately with a `RETIRED` notice and is not called by `npm test`, `npm run verify`,
`prebuild` or any workflow. Live behaviour they used to touch is covered by registered tests
(see each script header). Do not add new scripts here; retire with evidence only.

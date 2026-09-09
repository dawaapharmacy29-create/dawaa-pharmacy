# Script Library V3 change summary

- Replaced the legacy fallback script set with the same 40-script interactive structure used in production.
- Preserved existing quick-reply service exports and Supabase-first loading behavior.
- Reduced passive/broadcast wording in favor of reply-oriented prompts and clear next actions.
- Kept pharmacist-review boundaries for medication substitutions, interactions, dosage, and adverse effects.
- Added database guards against duplicate active shortcuts and active scripts without a response path.

# Vercel QRCode package version correction

The failed production deployment changed `qrcode` from the supported `^1.5.4` version to `^1.5.6` while the existing lockfile and previous successful deployments use `1.5.4`.

This branch restores `qrcode` to `^1.5.4` without removing the doctor competition, followups, Arabic customer flags, employee 360 profile, payroll, monthly PDF, or unified employee event timeline changes.

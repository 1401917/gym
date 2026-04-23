# Security Enhancements TODO for Protein Flow Gym App

Status: In Progress (0/15 steps complete)

## Approved Plan Steps (Breakdown)

### Phase 1: Core Data Protection (Steps 1-4)
- [ ] 1. Create `scripts/crypto.js` with AES-GCM encryption/decryption using Web Crypto API + device ID salt.
- [ ] 2. Create `scripts/tamper.js` for HMAC integrity checks on state.
- [x] 3. Edit `scripts/storage.js`: Integrate encrypt/save, decrypt/load, tamper verify. **DONE**
- [ ] 4. Test storage encryption manually.

### Phase 2: Web Security & Validation (Steps 5-9)
- [ ] 5. Create `scripts/validation.js`: Sanitize inputs (names, numbers), escape HTML.
- [x] 6. Edit `index.html`: Add strict CSP meta tag, SRI for scripts. **DONE** (CSP added, SRI placeholder - compute real hash post-build).
- [ ] 7. Edit `scripts/app.js`: Hook validation on forms/addItem.
- [ ] 8. Update `sw.js`: Add cache integrity, stricter fetch policy.
- [ ] 9. Test CSP/XSS resistance.

### Phase 3: Capacitor/Android Hardening (Steps 10-13)
- [ ] 10. Edit `package.json`: Add `@capacitor-community/secure-storage`.
- [ ] 11. Edit `capacitor.config.json`: Add secure plugins/server config.
- [ ] 12. Edit `android/app/build.gradle`: Enable ProGuard, release flags.
- [ ] 13. Run `npm i && npx cap sync android`.

### Phase 4: Runtime & Final (Steps 14-15)
- [ ] 14. Add devtools detection + alert in `app.js`.
- [ ] 15. Full test: Build release APK, verify encryption/CSP/tamper.

**Next Action**: Phase 1 Step 1 - Create crypto.js.
**Commands to Run Later**: `npm install`, `npx cap build android`, test APKs.

# Manual device checklist

Run on a physical device. Browser emulation, including `pnpm test:app`, is not physical Safari
or Android validation. Copy the template once per device and fill in what you actually saw.

```
Device / OS:
Browser + version:
Build (Studio settings -> Copy diagnostics -> app.commit):
Date / tester:
Charging? Low power mode?
```

| # | Check | How | Result | Notes |
|---|-------|-----|--------|-------|
| 1 | First load | Empty storage (private window). The artwork appears with no error banner, and the defaults are Living Filaments / Glacier | | |
| 2 | All scenes | Visit every scene from the panel select; on a keyboard also press `1`–`6`. Each renders, nothing freezes | | |
| 3 | Palette | Glacier, Ember, Iris on two different scenes | | |
| 4 | Pause / resume | Pause, change scene, load a saved look: stays paused. Resume continues without a jump | | |
| 5 | Orientation | Portrait and landscape, with the panel open and closed. Nothing sits under the notch or home indicator | | |
| 6 | Panel scroll | Scroll the open panel to the bottom and back. The canvas does not pan, zoom or pulse | | |
| 7 | Gesture | Hold, drag, release on the canvas. One pulse. Start a hold and pull down Control Center or switch apps: no pulse | | |
| 8 | Share | Share these settings. Native sheet (or clipboard, or the manual field) works. Cancelling the sheet shows no error. Open the link on another device | | |
| 9 | Saved look reload | Save a named look, fully close the browser, reopen. The last look and the saved list are both there | | |
| 10 | Background / foreground | Background the app for 1 min, return. It resumes; the FPS readout recovers within a few seconds | | |
| 11 | Live source | Wikipedia edits: shows Connecting, then Live signal. Airplane mode then Retry: Source unavailable, never Live | | |
| 12 | Fullscreen | Where offered, enter and exit. On iPhone the button should be absent | | |
| 13 | Reduced motion | Turn on Reduce Motion in OS settings: slower art, no panel/chrome transitions | | |
| 14 | Text size | Largest OS text size / 200% browser zoom: labels readable, no clipped controls | | |
| 15 | 10-minute session | Leave running 10 min on Adaptive. Copy diagnostics at 1 and 10 min; note tier, render scale, fps, device temperature by touch, battery drop | | |

Diagnostics FPS is an average over about half-second windows. It does not show p95 frame time
or GPU time. Record visible stutter separately.

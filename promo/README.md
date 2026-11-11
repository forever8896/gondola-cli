# The film

`docs/media/promo.mp4` and `docs/media/demo.gif` are rendered from `scene.html`: a scene in which every moving value is
a function of the time `t`, captured one frame at a time by `record.ts` through headless Chromium, so motion is exact.

    bun promo/record.ts                # whole film → promo/out/
    bun promo/record.ts --at 21.6,33   # stills, to check a change quickly

The scene reads images from `promo/assets/`, which is not in the repository: `assets/origin/` holds frames of the first
Gondola film and `assets/run/` the screenshots of one real `gondola explore` run (`shots.ts` makes the two sharp
full-page captures). To film your own run, put its `.gondola/<run>/` images there and edit the data at the top of the
script in `scene.html`.

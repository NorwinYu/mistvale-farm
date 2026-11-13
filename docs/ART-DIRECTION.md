# 雾谷农庄 · Art Direction

## 1. Time & weather
Spring, 17:50 golden hour. Clear air with a thin high haze; after dusk the valley turns
blue-green with warm window/lamplight and fireflies. Rain is soft and cool, never stormy.
A slow weather cycle supports the calm, place-driven mood.

## 2. Key light
One warm low sun from the WNW (about 16° elevation at the opening shot),
`#ffa963 → #fff1d7`, long raking shadows across the lawn and crop rows.
Sky fill is cool (`#bfd8eb` hemisphere), bounce is warm earth.

## 3. Sky & environment
Pale periwinkle zenith fading to a warm ivory/peach horizon, with sparse pearly cumulus.
Fog is warm at sunset, blue at night, and must match the sky horizon so hills never
detach from the sky. Water reflects the sky with a soft sun highlight.

## 4. Material language
All organic surfaces are rough (0.8–1.0): sun-bleached plaster, damp soil, weathered
timber, iron, dry straw. Wet soil and glass are the only low-roughness materials.
Albedo is desaturated by a few percent so greens read as foliage rather than plastic.
Micro detail comes from procedural Canvas maps, bump and macro color variation.

## 5. Focal point
The cream cottage with its dark roof, then the rust-red barn across the sunlit crop beds.
The gate path leads the eye from the farmer to the house and field. Food and flowers
(carrot orange, tomato red, sunflower yellow) are the saturated accents against the greens.

## Technical targets
- 60 fps at 1600×1000 on an Apple M3 / recent discrete GPU.
- < 300 scene draw calls and < 1.5 M triangles (static geometry is merged; grass,
  flowers, forest, apples are instanced).
- HDR render target with MSAA, restrained bloom, ACES tone mapping, CSS vignette/grain.
- No external art/audio assets. All textures, models and sound are generated at runtime.

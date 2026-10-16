# 020 — Place cards without a photo show one OpenStreetMap tile, fetched and cached by our own server

**Decision:** When a place tip has coordinates but no venue photo, its card shows a single OpenStreetMap map tile (a 256-pixel square of map at street level) with a pin at the exact spot and the visible credit "© OpenStreetMap contributors". Our server fetches the tile, names itself in every request, and keeps a copy for a week.

**Why this came up:** The approved card design gives places a venue photo when Google Places has one and a small map otherwise (Tarik's call, 2026-10-16). Of the five place tips in the garden on 2026-10-16, none had a photo or coordinates yet, so the map is the state most place cards will show until enrichment fills in. OpenStreetMap's free tile servers are run by volunteers, and their usage policy asks for three things: visible credit, light use, and that software identifies itself and caches what it fetches. A browser cannot say who it is (it sends its own identity, not ours), and every visit would ask OpenStreetMap again. Getting it wrong risks being blocked, and a blank map on every place card.

**Options:**
1. **Let the browser load the tile straight from OpenStreetMap.** Zero code. Cost: no way to identify Earmark, no shared copy (every phone and every visit asks again), and each request tells OpenStreetMap where Tarik is looking and from which private site.
2. **Fetch the tile through a small route on our own server** (chosen). About 30 lines. Cost: our server carries the tile traffic, and it is one more endpoint to protect.
3. **Google Static Maps.** Cost: needs an API key and billing, and puts Google branding on a calm card.

**What we chose and why:** Option 2 — Claude, inside the direction Tarik approved. `/api/tiles/16/{x}/{y}` serves only the street-level zoom the cards use (it is not a general map service), requires the garden owner to be signed in (so it can never be used as an open relay), sends the identity "Earmark/0.1 (single-user personal garden; +github link)", and keeps each tile for seven days on the server and in the browser. The pin sits at the exact spot using the standard map-tile maths (the "slippy map" formula that converts latitude and longitude into a tile and a position inside it), which is unit tested against downtown Milwaukee. If a tile ever fails to load, the card swaps to its designed no-map state (pin icon and the name) instead of a broken image.

**What we gave up:** A pin near a tile's edge sits near the card's edge, because we show one tile rather than a map centred on the spot. The fix, if it looks wrong, is a 2×2 tile mosaic (four tiles, recentred). Tiles are 256 pixels shown at up to about 260, so they are slightly soft on high-density phone screens.

**How we'll know if this was right:** Once enrichment adds coordinates, every place card without a photo shows its map with the pin on the right street, and OpenStreetMap never rate-limits or blocks us (the server log would show "osm tile fetch failed"). If pins near the edge look wrong on real places, move to the 2×2 mosaic.

**What actually happened:**

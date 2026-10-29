--!native
--!optimize 2
-- Decodes AtlasData (palette + RLE, base64) into per-sprite pixel buffers and
-- blits them into a frame. Pixels are packed ABGR u32, the WritePixelsBuffer
-- layout. Each sprite keeps a list of fully opaque spans so the blit is one
-- buffer.copy per span; translucent pixels (contact shadows) blend per pixel.

local Data = require(script.Parent.AtlasData)

local Atlas = {}
Atlas.frames, Atlas.beltFrames = Data.frames, Data.beltFrames

export type Sprite = { w: number, h: number, ox: number, oy: number, px: buffer, spans: { number }, soft: { number } }
export type Frame = { W: number, H: number, px: buffer }

local B64 = {}
do
	local chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	for i = 1, 64 do B64[string.byte(chars, i)] = i - 1 end
end

local function decode64(s: string): buffer
	local n = #s
	local pad = 0
	if string.byte(s, n) == 61 then pad += 1 end
	if string.byte(s, n - 1) == 61 then pad += 1 end
	local out = buffer.create(n // 4 * 3 - pad)
	local o = 0
	for i = 1, n, 4 do
		local a, b = B64[string.byte(s, i)], B64[string.byte(s, i + 1)]
		local c, d = B64[string.byte(s, i + 2)] or 0, B64[string.byte(s, i + 3)] or 0
		local v = a * 262144 + b * 4096 + c * 64 + d
		buffer.writeu8(out, o, v // 65536); o += 1
		if o < buffer.len(out) then buffer.writeu8(out, o, (v // 256) % 256); o += 1 end
		if o < buffer.len(out) then buffer.writeu8(out, o, v % 256); o += 1 end
	end
	return out
end

local sprites: { [string]: Sprite } = {}

local function decodeSprite(rec): Sprite
	local w, h = rec.w, rec.h
	local px = buffer.create(w * h * 4)
	local runs = decode64(rec.data)
	local pal = rec.pal
	local p = 0
	for i = 0, buffer.len(runs) - 1, 2 do
		local col = pal[buffer.readu8(runs, i) + 1]
		for _ = 1, buffer.readu8(runs, i + 1) do buffer.writeu32(px, p * 4, col); p += 1 end
	end
	-- spans: {y, x0, len} triples of alpha 255; soft: {x, y} pairs of 0 < alpha < 255
	local spans, soft = {}, {}
	for y = 0, h - 1 do
		local x = 0
		while x < w do
			local a = buffer.readu8(px, (y * w + x) * 4 + 3)
			if a == 255 then
				local x0 = x
				while x < w and buffer.readu8(px, (y * w + x) * 4 + 3) == 255 do x += 1 end
				table.insert(spans, y); table.insert(spans, x0); table.insert(spans, x - x0)
			else
				if a > 0 then table.insert(soft, x); table.insert(soft, y) end
				x += 1
			end
		end
	end
	return { w = w, h = h, ox = rec.ox, oy = rec.oy, px = px, spans = spans, soft = soft }
end

-- Decode everything up front; returns elapsed seconds (measured, for the perf overlay).
function Atlas.load(): number
	local t0 = os.clock()
	for _, rec in Data.sprites do sprites[rec.key] = decodeSprite(rec) end
	return os.clock() - t0
end

function Atlas.get(key: string): Sprite?
	return sprites[key]
end

-- blend one packed pixel over the frame at byte offset `o` with alpha a/255 (and extra fade 0..1)
local function blend(dst: buffer, o: number, src: number, fade: number)
	local a = (src // 16777216) / 255 * fade
	if a <= 0 then return end
	local d = buffer.readu32(dst, o)
	local r = (src % 256) * a + (d % 256) * (1 - a)
	local g = ((src // 256) % 256) * a + ((d // 256) % 256) * (1 - a)
	local b = ((src // 65536) % 256) * a + ((d // 65536) % 256) * (1 - a)
	buffer.writeu32(dst, o, r // 1 + (g // 1) * 256 + (b // 1) * 65536 + 4278190080)
end
Atlas.blend = blend

-- Blit sprite so that its origin (ox, oy) lands on frame pixel (x, y). fade < 1 draws translucent (ghosts).
function Atlas.blit(f: Frame, s: Sprite, x: number, y: number, fade: number?)
	local x0, y0 = x - s.ox, y - s.oy
	local W, H, dst, src, sw = f.W, f.H, f.px, s.px, s.w
	if x0 >= W or y0 >= H or x0 + sw <= 0 or y0 + s.h <= 0 then return end
	local spans = s.spans
	if fade and fade < 1 then
		for i = 1, #spans, 3 do
			local yy = y0 + spans[i]
			if yy < 0 or yy >= H then continue end
			for k = 0, spans[i + 2] - 1 do
				local xx = x0 + spans[i + 1] + k
				if xx >= 0 and xx < W then blend(dst, (yy * W + xx) * 4, buffer.readu32(src, (spans[i] * sw + spans[i + 1] + k) * 4), fade) end
			end
		end
		return
	end
	for i = 1, #spans, 3 do
		local sy = spans[i]
		local yy = y0 + sy
		if yy < 0 or yy >= H then continue end
		local sx, len = spans[i + 1], spans[i + 2]
		local dx = x0 + sx
		if dx < 0 then sx -= dx; len += dx; dx = 0 end
		if dx + len > W then len = W - dx end
		if len > 0 then buffer.copy(dst, (yy * W + dx) * 4, src, (sy * sw + sx) * 4, len * 4) end
	end
	local soft = s.soft
	for i = 1, #soft, 2 do
		local xx, yy = x0 + soft[i], y0 + soft[i + 1]
		if xx >= 0 and yy >= 0 and xx < W and yy < H then blend(dst, (yy * W + xx) * 4, buffer.readu32(src, (soft[i + 1] * sw + soft[i]) * 4), 1) end
	end
end

return Atlas

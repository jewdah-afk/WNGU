--!native
--!optimize 2
-- Software compositor: terrain buffer rows -> depth-sorted sprite spans ->
-- wires, icons, particles, ghost -> one WritePixelsBuffer per frame.
-- Same projection and sprites as the HTML build (sx = (x-y)*16, sy = (x+y)*8 - z*16).

local AssetService = game:GetService("AssetService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Sim = require(Shared.Sim)
local Atlas = require(Shared.Atlas)

local floor, min, max = math.floor, math.min, math.max

local Renderer = {}
Renderer.__index = Renderer

local function pack(r: number, g: number, b: number): number return r + g * 256 + b * 65536 + 4278190080 end
local WIRE = pack(200, 116, 58)
local RED, AMBER, GREEN, DARK = pack(239, 91, 91), pack(242, 180, 65), pack(110, 210, 138), pack(17, 21, 27)

function Renderer.new(st, gui: ScreenGui)
	local self = setmetatable({}, Renderer)
	self.st = st
	self.originX, self.originY = st.H * 16 + 24, 48
	self.TW, self.TH = (st.W + st.H) * 16 + 48, (st.W + st.H) * 8 + 96
	self.cam = { x = 0, y = 0 }
	self.zoom = 2 -- 1: 405 rows, 2: 270 rows, 3: 180 rows
	self.anim = {}
	self.parts = {}
	self.ms = { compose = 0, upload = 0, sprites = 0 }

	local label = Instance.new("ImageLabel")
	label.Name = "World"
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundColor3 = Color3.fromRGB(11, 14, 19)
	label.BorderSizePixel = 0
	label.ResampleMode = Enum.ResamplerMode.Pixelated
	label.ZIndex = 0
	label.Parent = gui
	self.label = label

	self.atlasSeconds = Atlas.load()
	self:bakeTerrain()
	self:fit()
	return self
end

function Renderer:toScreen(x: number, y: number, z: number?): (number, number)
	return (x - y) * 16 + self.originX, (x + y) * 8 - (z or 0) * 16 + self.originY
end

-- frame pixel -> fractional world tile
function Renderer:toWorld(fx: number, fy: number): (number, number)
	local f = self.f
	local px = fx + self.cam.x - f.W / 2 - self.originX
	local py = fy + self.cam.y - f.H / 2 - self.originY
	return (px / 16 + py / 8) / 2, (py / 8 - px / 16) / 2
end

function Renderer:centreOn(tx: number, ty: number)
	self.cam.x, self.cam.y = self:toScreen(tx, ty)
end

local function tileKey(st, x: number, y: number): string
	local t = st.terrain[y * st.W + x]
	local v = (x * 7 + y * 13) % 4
	if t == Sim.T_WATER then return "t:water:0" end
	if t == Sim.T_SAND then return "t:sand:" .. (v % 2) end
	if t == Sim.T_ROCK then return "t:rock:" .. (v % 2) end
	local g = if Sim.fbm(x * 1.7, y * 1.7, 77) > 0.5 then "grass2" else "grass"
	return "t:" .. g .. ":" .. v
end

function Renderer:bakeTerrain()
	local st = self.st
	local t0 = os.clock()
	local tf = { W = self.TW, H = self.TH, px = buffer.create(self.TW * self.TH * 4) }
	for d = 0, st.W + st.H - 2 do
		for x = max(0, d - st.H + 1), min(d, st.W - 1) do
			local y = d - x
			local sx, sy = (x - y) * 16 + self.originX, (x + y) * 8 + self.originY
			local s = Atlas.get(tileKey(st, x, y))
			if s then Atlas.blit(tf, s, sx, sy) end
			local o = st.ore[y * st.W + x]
			if o ~= 0 then
				local ores = Atlas.get("ore:" .. o .. ":" .. ((x * 3 + y * 5) % 3))
				if ores then Atlas.blit(tf, ores, sx, sy) end
			end
		end
	end
	self.terrain = tf
	self.terrainSeconds = os.clock() - t0
end

-- frame size follows the screen aspect and zoom; recreate the EditableImage only when it changes
function Renderer:fit()
	local abs = self.label.AbsoluteSize
	local aspect = if abs.Y > 0 then abs.X / abs.Y else 16 / 9
	local rows = ({ 405, 270, 180 })[self.zoom]
	local VH = rows
	local VW = math.clamp(floor(rows * aspect / 2) * 2, 240, 960)
	if self.f and self.f.W == VW and self.f.H == VH then return end
	local ok, ei = pcall(function() return AssetService:CreateEditableImage({ Size = Vector2.new(VW, VH) }) end)
	if not (ok and ei) then
		warn("[FU] EditableImage unavailable: " .. tostring(ei) .. " (enable Mesh/Image APIs for this experience)")
		if not self.f then self.f = { W = VW, H = VH, px = buffer.create(VW * VH * 4) } end
		return
	end
	if self.ei then self.ei:Destroy() end
	self.ei = ei
	self.label.ImageContent = Content.fromObject(ei)
	self.f = { W = VW, H = VH, px = buffer.create(VW * VH * 4) }
end

local function put(f, x: number, y: number, c: number)
	x, y = floor(x), floor(y)
	if x >= 0 and y >= 0 and x < f.W and y < f.H then buffer.writeu32(f.px, (y * f.W + x) * 4, c) end
end

local function wire(f, ax: number, ay: number, bx: number, by: number)
	local n = max(4, floor(math.abs(bx - ax) + math.abs(by - ay)))
	for i = 0, n do
		local t = i / n
		put(f, ax + (bx - ax) * t, ay + (by - ay) * t + math.sin(math.pi * t) * 4, WIRE)
	end
end

local BOLT = { { 1, -4 }, { 0, -3 }, { 0, -2 }, { -1, -1 }, { -1, 0 }, { 0, 0 }, { 1, 0 }, { 0, 1 }, { 0, 2 }, { -1, 3 } }
local function bolt(f, x: number, y: number, c: number)
	for _, p in BOLT do for dx = -1, 2 do for dy = -1, 1 do put(f, x + p[1] + dx, y + p[2] + dy, DARK) end end end
	for _, p in BOLT do put(f, x + p[1], y + p[2], c); put(f, x + p[1] + 1, y + p[2], c) end
end

local function diamond(self, f, ox: number, oy: number, x: number, y: number, s: number, c: number)
	-- outline of the footprint's ground diamond
	local pts = { { x, y }, { x + s, y }, { x + s, y + s }, { x, y + s }, { x, y } }
	for i = 1, 4 do
		local ax, ay = self:toScreen(pts[i][1], pts[i][2])
		local bx, by = self:toScreen(pts[i + 1][1], pts[i + 1][2])
		local n = max(1, floor(math.abs(bx - ax)))
		for k = 0, n do put(f, ax + (bx - ax) * k / n - ox, ay + (by - ay) * k / n - oy, c) end
	end
end

-- minimum spanning tree over poles + hub, cached until the layout changes
function Renderer:wireEdges()
	local st = self.st
	local key = #st.order .. ":" .. st.nextId
	if self.wireKey == key then return self.wires end
	local nodes = {}
	for _, id in st.order do
		local e = st.ents[id]
		if e.type == "pole" then table.insert(nodes, { x = e.x, y = e.y, z = 1.82 })
		elseif e.type == "hub" then table.insert(nodes, { x = e.x + 1, y = e.y + 1, z = 2.9 }) end
	end
	local r2 = st.content.BUILDINGS.pole.reach ^ 2
	local used, edges = {}, {}
	for s0 = 1, #nodes do
		if used[s0] then continue end
		used[s0] = true
		local tree = { s0 }
		while true do
			local bi, bj, bd = nil, nil, math.huge
			for _, i in tree do
				for j = 1, #nodes do
					if used[j] then continue end
					local d = (nodes[i].x - nodes[j].x) ^ 2 + (nodes[i].y - nodes[j].y) ^ 2
					if d <= r2 and d < bd then bd = d; bi = i; bj = j end
				end
			end
			if not bj then break end
			used[bj] = true
			table.insert(tree, bj)
			table.insert(edges, { nodes[bi], nodes[bj] })
		end
	end
	self.wireKey, self.wires = key, edges
	return edges
end

function Renderer:puff(x: number, y: number, z: number, kind: string)
	if #self.parts > 600 then return end
	local sx, sy = self:toScreen(x, y, z)
	local smoke = kind == "smoke"
	table.insert(self.parts, {
		x = sx, y = sy, t = 0,
		vx = (math.random() - 0.3) * (if smoke then 4 else 40), vy = if smoke then -9 - math.random() * 5 else -25 - math.random() * 25,
		life = if smoke then 2.2 else 0.45, g = if smoke then 0 else 90,
		c = if smoke then pack(120, 122, 130) else pack(255, 214, 120),
	})
end

-- ui: { tool, dir, hover = {x, y} or nil, selected, canBuild = function }
function Renderer:render(dt: number, ui)
	local t0 = os.clock()
	self:fit() -- cheap unless the window or zoom changed
	local st, f, T = self.st, self.f, self.terrain
	local W, H = f.W, f.H
	local ox, oy = floor(self.cam.x - W / 2), floor(self.cam.y - H / 2)
	buffer.fill(f.px, 0, 0)
	-- terrain: one copy per visible row
	for row = 0, H - 1 do
		local ty = oy + row
		if ty < 0 or ty >= T.H then continue end
		local x0, len, dx = ox, W, 0
		if x0 < 0 then dx = -x0; len += x0; x0 = 0 end
		if x0 + len > T.W then len = T.W - x0 end
		if len > 0 then buffer.copy(f.px, (row * W + dx) * 4, T.px, (ty * T.W + x0) * 4, len * 4) end
	end

	-- visible entities in depth order
	local list = {}
	for _, id in st.order do
		local e = st.ents[id]
		local sx, sy = self:toScreen(e.x + e.size / 2, e.y + e.size / 2)
		if math.abs(sx - self.cam.x) < W / 2 + 64 and math.abs(sy - self.cam.y) < H / 2 + 96 then table.insert(list, e) end
	end
	table.sort(list, function(a, b)
		local da, db = a.x + a.y + 2 * a.size, b.x + b.y + 2 * b.size
		if da ~= db then return da < db end
		if a.size ~= b.size then return a.size > b.size end
		return a.x < b.x
	end)
	local ts = os.clock()
	local speed = Sim.beltSpeed(st)
	local bf = floor(((st.tick * speed) % 256) / 256 * Atlas.beltFrames) % Atlas.beltFrames
	local MF = Atlas.frames
	for _, e in list do
		local sx, sy = self:toScreen(e.x, e.y)
		sx -= ox; sy -= oy
		if e.type == "belt" then
			local s = Atlas.get("belt:" .. e.dir .. ":" .. bf)
			if s then Atlas.blit(f, s, sx, sy) end
			for _, it in e.items do
				local k = it.pos / 256 - 0.5
				local ix, iy = self:toScreen(e.x + 0.5 + Sim.DX[e.dir] * k, e.y + 0.5 + Sim.DY[e.dir] * k, 0.2)
				local is = Atlas.get("item:" .. it.item)
				if is then Atlas.blit(f, is, floor(ix - ox), floor(iy - oy)) end
			end
			continue
		end
		local net = if e.net ~= nil and e.net >= 0 then st.power.nets[e.net] else nil
		local sat = if net then net.sat else 0
		local working = e.type == "hub" or e.working
		local ph = self.anim[e.id] or 0
		local rate = if e.type == "drill" then 1.2 elseif e.type == "hub" then 0.35 else 0.7
		if working then ph = (ph + dt * rate * (if net then sat / 1000 else 1)) % 1 end
		self.anim[e.id] = ph
		local key
		if e.type == "pole" then key = "pole:0:off"
		elseif e.type == "solar" then key = "solar:" .. e.dir .. ":off"
		elseif e.type == "hub" then key = "hub:0:" .. (floor(ph * MF) % MF)
		elseif working then key = e.type .. ":" .. e.dir .. ":" .. (floor(ph * MF) % MF)
		else key = e.type .. ":" .. e.dir .. ":off" end
		local s = Atlas.get(key)
		if s then Atlas.blit(f, s, sx, sy) end
		local P = st.content.BUILDINGS[e.type].power
		if P then
			local bx, by = self:toScreen(e.x + e.size / 2, e.y + e.size / 2, 2.1)
			if not net or sat == 0 then bolt(f, bx - ox, by - oy, RED)
			elseif sat < 1000 and floor(os.clock() * 2) % 2 == 0 then bolt(f, bx - ox, by - oy, AMBER) end
		end
		if e.working and math.random() < dt * 3 then
			if e.type == "smelter" then self:puff(e.x + 0.6, e.y + 0.6, 2.6, "smoke")
			elseif e.type == "generator" then self:puff(e.x + 1.55, e.y + 1.5, 2.3, "smoke") end
		end
	end
	for _, ev in st.events do
		if ev.k == "craft" then
			local e = st.ents[ev.id]
			if e and e.type == "assembler" then for _ = 1, 5 do self:puff(e.x + 1, e.y + 1, 1.4, "spark") end end
		end
	end
	self.ms.sprites = (os.clock() - ts) * 1000

	for _, ed in self:wireEdges() do
		local ax, ay = self:toScreen(ed[1].x + 0.5, ed[1].y + 0.5, ed[1].z)
		local bx, by = self:toScreen(ed[2].x + 0.5, ed[2].y + 0.5, ed[2].z)
		wire(f, ax - ox, ay - oy, bx - ox, by - oy)
	end

	-- particles (pixel squares; smoke grows by ring)
	local keep = {}
	for _, p in self.parts do
		p.t += dt
		if p.t >= p.life then continue end
		p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt
		table.insert(keep, p)
		local r = if p.g == 0 then 1 + floor(p.t / p.life * 3) else 0
		for yy = -r, r do for xx = -r, r do
			if xx * xx + yy * yy <= r * r and (xx + yy + floor(p.t * 8)) % 2 == 0 then put(f, p.x - ox + xx, p.y - oy + yy, p.c) end
		end end
	end
	self.parts = keep

	-- placement ghost / hover / selection
	if ui.tool and ui.hover then
		local size = st.content.BUILDINGS[ui.tool].size
		local tx, ty = floor(ui.hover[1] - (size - 1) / 2), floor(ui.hover[2] - (size - 1) / 2)
		local okToBuild = Sim.canBuild(st, ui.tool, tx, ty) == nil
		local key = if ui.tool == "belt" then "belt:" .. ui.dir .. ":0" elseif ui.tool == "pole" then "pole:0:off" else ui.tool .. ":" .. ui.dir .. ":off"
		local s = Atlas.get(key)
		local gx, gy = self:toScreen(tx, ty)
		if s then Atlas.blit(f, s, gx - ox, gy - oy, 0.55) end
		diamond(self, f, ox, oy, tx, ty, size, if okToBuild then GREEN else RED)
	elseif ui.hover then
		local e = Sim.entAt(st, floor(ui.hover[1]), floor(ui.hover[2]))
		if e then diamond(self, f, ox, oy, e.x, e.y, e.size, AMBER) end
	end
	if ui.selected and st.ents[ui.selected] then
		local e = st.ents[ui.selected]
		diamond(self, f, ox, oy, e.x, e.y, e.size, AMBER)
	end

	self.ms.compose = (os.clock() - t0) * 1000
	if self.ei then
		local tu = os.clock()
		self.ei:WritePixelsBuffer(Vector2.zero, Vector2.new(W, H), f.px)
		self.ms.upload = (os.clock() - tu) * 1000
	end
end

return Renderer

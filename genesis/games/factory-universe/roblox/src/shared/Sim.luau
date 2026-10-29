--!native
--!optimize 2
-- Luau port of engine/sim/factory.js. Same integer arithmetic, same iteration
-- order (entity id order; belts downstream-first; content key orders from the
-- generated Content module), so stateHash matches the JS sim tick for tick.
-- Verified by tests/parity.luau against the fixture the JS tools generate.
-- Keep this file a line-by-line mirror of factory.js when either changes.

local floor, sqrt, min, max, abs = math.floor, math.sqrt, math.min, math.max, math.abs

local Sim = {}

local DX = { [0] = 1, 0, -1, 0 }
local DY = { [0] = 0, 1, 0, -1 }
Sim.DX, Sim.DY = DX, DY

local PM = 2147483647
local function pmNext(s: number): number return (s * 48271) % PM end

local function hash2(x: number, y: number, seed: number): number
	local h = ((x + 1) * 374761 + (y + 1) * 668265 + seed * 1013) % PM
	if h <= 0 then h += PM - 1 end
	h = pmNext(pmNext(h))
	return h / PM
end

local TWO_PI = 6.283185307179586
local function dsin(x: number): number
	x = x - floor(x / TWO_PI + 0.5) * TWO_PI
	local x2 = x * x
	local term, sum = x, x
	for n = 1, 11 do
		term = term * -x2 / ((2 * n) * (2 * n + 1))
		sum = sum + term
	end
	return sum
end
local function dcos(x: number): number return dsin(x + 1.5707963267948966) end

local function smooth(t: number): number return t * t * (3 - 2 * t) end

local function valueNoise(x: number, y: number, cell: number, seed: number): number
	local gx, gy = floor(x / cell), floor(y / cell)
	local fx, fy = smooth(x / cell - gx), smooth(y / cell - gy)
	local a, b = hash2(gx, gy, seed), hash2(gx + 1, gy, seed)
	local c, d = hash2(gx, gy + 1, seed), hash2(gx + 1, gy + 1, seed)
	local top, bot = a + (b - a) * fx, c + (d - c) * fx
	return top + (bot - top) * fy
end

local function fbm(x: number, y: number, seed: number): number
	return valueNoise(x, y, 16, seed) * 0.6 + valueNoise(x, y, 8, seed + 7) * 0.3 + valueNoise(x, y, 4, seed + 13) * 0.1
end
Sim.fbm = fbm

Sim.T_GRASS, Sim.T_SAND, Sim.T_ROCK, Sim.T_WATER = 0, 1, 2, 3
local T_GRASS, T_SAND, T_ROCK, T_WATER = 0, 1, 2, 3

-- forward declarations
local placeRaw, entAt

local function genTerrain(st)
	local W, H, seed = st.W, st.H, st.seed
	local cx, cy = W / 2, H / 2
	for y = 0, H - 1 do
		for x = 0, W - 1 do
			local i = y * W + x
			local d = sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy))
			local wet = fbm(x, y, seed + 101) + max(0, 1 - d / 16) * 0.5
			local rock = fbm(x, y, seed + 202)
			local t = T_GRASS
			if wet < 0.27 then t = T_WATER elseif wet < 0.32 then t = T_SAND
			elseif rock > 0.74 and d > 12 then t = T_ROCK end
			st.terrain[i] = t
		end
	end
	local s = (seed * 7919) % PM
	if s == 0 then s = 1 end
	local function rnd() s = pmNext(s); return s / PM end
	local patches = {}
	for k = 0, 3 do
		local ang = (k + rnd() * 0.5) * 3.141592653589793 / 2
		table.insert(patches, { ore = k + 1, x = cx + dcos(ang) * 11, y = cy + dsin(ang) * 11, r = 3.2 })
	end
	for _ = 0, 9 do
		local ang = rnd() * TWO_PI
		local dist = 17 + rnd() * 12
		-- JS evaluates the object literal in order: ore, x, y, r
		local ore = 1 + floor(rnd() * 4)
		local px, py = cx + dcos(ang) * dist, cy + dsin(ang) * dist
		local r = 2.6 + rnd() * 2.2
		table.insert(patches, { ore = ore, x = px, y = py, r = r })
	end
	for _, p in patches do
		local r = math.ceil(p.r + 2)
		for y = floor(p.y) - r, floor(p.y) + r do
			for x = floor(p.x) - r, floor(p.x) + r do
				if x < 0 or y < 0 or x >= W or y >= H then continue end
				local dd = sqrt((x - p.x) * (x - p.x) + (y - p.y) * (y - p.y))
				local edge = p.r * (0.75 + 0.5 * valueNoise(x, y, 3, seed + p.ore * 31))
				if dd > edge then continue end
				local i = y * W + x
				st.terrain[i] = T_GRASS
				st.ore[i] = p.ore
				local centre = 1 - dd / (edge + 0.001)
				local far = sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy))
				st.rich[i] = floor(800 + far * 30 + centre * 600)
			end
		end
	end
end

function Sim.createWorld(content, opts)
	opts = opts or {}
	local W, H, seed = opts.W or 64, opts.H or 64, opts.seed or 1
	local N = W * H
	local st = {
		W = W, H = H, seed = seed, tick = 0, nextId = 1,
		terrain = table.create(N, 0), ore = table.create(N, 0), rich = table.create(N, 0),
		occ = table.create(N, 0), ents = {}, order = {},
		stock = {}, delivered = {}, produced = {},
		tech = { levels = {}, current = nil, units = 0 },
		power = { nets = {}, dirty = true }, beltsDirty = true, beltOrder = {},
		events = {}, content = content,
	}
	-- table.create gives 1-based storage; we index 0..N-1, so fill index 0 too
	st.terrain[0], st.ore[0], st.rich[0], st.occ[0] = 0, 0, 0, 0
	for _, k in content.ITEM_ORDER do st.stock[k] = 0; st.delivered[k] = 0; st.produced[k] = 0 end
	for _, k in content.START_ORDER do st.stock[k] = content.START_STOCK[k] end
	for _, k in content.TECH_ORDER do st.tech.levels[k] = 0 end
	genTerrain(st)
	local hc = floor(W / 2) - 1
	placeRaw(st, "hub", hc, hc, 0)
	return st
end

local function sizeOf(st, t: string): number return st.content.BUILDINGS[t].size end

local function footprint(st, t: string, x: number, y: number)
	local s, out = sizeOf(st, t), {}
	for j = 0, s - 1 do for i = 0, s - 1 do table.insert(out, { x + i, y + j }) end end
	return out
end
Sim.footprint = footprint

local function frontTiles(e)
	local s, out = e.size, {}
	for k = 0, s - 1 do
		if e.dir == 0 then table.insert(out, { e.x + s, e.y + k })
		elseif e.dir == 1 then table.insert(out, { e.x + k, e.y + s })
		elseif e.dir == 2 then table.insert(out, { e.x - 1, e.y + k })
		else table.insert(out, { e.x + k, e.y - 1 }) end
	end
	return out
end
Sim.frontTiles = frontTiles

function entAt(st, x: number, y: number)
	if x < 0 or y < 0 or x >= st.W or y >= st.H then return nil end
	local id = st.occ[y * st.W + x]
	if id ~= 0 then return st.ents[id] end
	return nil
end
Sim.entAt = entAt

local function techUnlocked(st, tech): boolean return tech == nil or st.tech.levels[tech] > 0 end
Sim.techUnlocked = techUnlocked

function Sim.techCost(st, id: string, level: number): number
	local t = st.content.TECHS[id]
	local c = t.base * 1000
	for _ = 1, level do c = floor(c * t.growth / 1000) end
	return floor(c / 1000)
end

function Sim.beltSpeed(st): number
	local B = st.content.BELT
	return min(B.maxSpeed, B.baseSpeed + B.speedPerLevel * st.tech.levels.logistics)
end

local function newEnt(st, t: string, x: number, y: number, dir: number)
	local e: any = { id = st.nextId, type = t, x = x, y = y, dir = dir, size = sizeOf(st, t), working = false }
	st.nextId += 1
	if t == "belt" then e.items = {} end
	if t == "smelter" or t == "assembler" then
		e.recipe = if t == "assembler" then "gear" else nil
		e.inb = {}; e.outb = {}; e.progress = 0; e.alt = 0
	end
	if t == "drill" then e.progress = 0; e.out = 0; e.alt = 0 end
	if t == "generator" then e.fuel = 0; e.energy = 0; e.load = 0 end
	if t == "lab" then e.inb = {}; e.progress = -1 end
	return e
end

function placeRaw(st, t: string, x: number, y: number, dir: number)
	local e = newEnt(st, t, x, y, dir)
	for _, p in footprint(st, t, x, y) do st.occ[p[2] * st.W + p[1]] = e.id end
	st.ents[e.id] = e
	table.insert(st.order, e.id)
	if t == "drill" then
		local cnt, rs = { [0] = 0, 0, 0, 0, 0 }, { [0] = 0, 0, 0, 0, 0 }
		for _, p in footprint(st, t, x, y) do
			local i = p[2] * st.W + p[1]
			local o = st.ore[i]
			cnt[o] += 1; rs[o] += st.rich[i]
		end
		local best = 1
		for o = 2, 4 do if cnt[o] > cnt[best] then best = o end end
		e.ore = best; e.rich = floor(rs[best] / 4)
	end
	st.power.dirty = true; st.beltsDirty = true
	return e
end

-- ---------- commands ----------
function Sim.canBuild(st, t: string, x: number, y: number, ignoreCost: boolean?): string?
	local C = st.content
	local B = C.BUILDINGS[t]
	if not B or t == "hub" then return "unknown building" end
	if not techUnlocked(st, B.tech) then return "needs research" end
	for _, p in footprint(st, t, x, y) do
		local tx, ty = p[1], p[2]
		if tx < 0 or ty < 0 or tx >= st.W or ty >= st.H then return "out of bounds" end
		local i = ty * st.W + tx
		if st.occ[i] ~= 0 then return "occupied" end
		if st.terrain[i] == T_WATER or st.terrain[i] == T_ROCK then return "blocked terrain" end
	end
	if t == "drill" then
		local n = 0
		for _, p in footprint(st, t, x, y) do if st.ore[p[2] * st.W + p[1]] ~= 0 then n += 1 end end
		if n == 0 then return "no ore under drill" end
	end
	if not ignoreCost then
		for _, k in B.costOrder do
			if (st.stock[k] or 0) < B.cost[k] then return "not enough " .. C.ITEMS[k].name end
		end
	end
	return nil
end

function Sim.build(st, t: string, x: number, y: number, dir: number?)
	local d = dir or 0
	local why = Sim.canBuild(st, t, x, y)
	if why then return { ok = false, reason = why } end
	local B = st.content.BUILDINGS[t]
	for _, k in B.costOrder do st.stock[k] -= B.cost[k] end
	local e = placeRaw(st, t, x, y, d)
	if st.log then table.insert(st.log, { st.tick, "build", t, x, y, d }) end
	table.insert(st.events, { k = "build", id = e.id, type = t, x = x, y = y })
	return { ok = true, id = e.id }
end

local function sortedKeys(tbl): { string }
	local ks = {}
	for k in tbl do table.insert(ks, k) end
	table.sort(ks)
	return ks
end

function Sim.remove(st, x: number, y: number)
	local e = entAt(st, x, y)
	if not e or e.type == "hub" then return { ok = false, reason = "nothing removable" } end
	local C = st.content
	local B = C.BUILDINGS[e.type]
	if st.log then table.insert(st.log, { st.tick, "remove", x, y }) end
	for _, k in B.costOrder do st.stock[k] += B.cost[k] end
	if e.items then for _, it in e.items do st.stock[it.item] += 1 end end
	if e.inb then for _, k in sortedKeys(e.inb) do st.stock[k] += e.inb[k] end end
	if e.outb then for _, k in sortedKeys(e.outb) do st.stock[k] += e.outb[k] end end
	if e.type == "drill" and e.out ~= 0 then st.stock[C.ORES[e.ore]] += e.out end
	if e.type == "generator" then st.stock.coal += e.fuel end
	for _, p in footprint(st, e.type, e.x, e.y) do st.occ[p[2] * st.W + p[1]] = 0 end
	st.ents[e.id] = nil
	table.remove(st.order, table.find(st.order, e.id))
	st.power.dirty = true; st.beltsDirty = true
	table.insert(st.events, { k = "remove", type = e.type, x = e.x, y = e.y })
	return { ok = true }
end

function Sim.rotate(st, x: number, y: number, dir: number?): boolean
	local e = entAt(st, x, y)
	if not e or e.type == "hub" then return false end
	local d = dir or -1
	e.dir = if d >= 0 then d % 4 else (e.dir + 1) % 4
	st.beltsDirty = true
	if st.log then table.insert(st.log, { st.tick, "rotate", x, y, d }) end
	return true
end

function Sim.setRecipe(st, id: number, recipe: string): boolean
	local e = st.ents[id]
	local R = st.content.RECIPES[recipe]
	if not e or e.type ~= "assembler" or not R or R.machine ~= "assembler" or not techUnlocked(st, R.tech) then return false end
	if e.recipe == recipe then return true end
	if st.log then table.insert(st.log, { st.tick, "recipe", id, recipe }) end
	for _, k in sortedKeys(e.inb) do st.stock[k] += e.inb[k] end
	for _, k in sortedKeys(e.outb) do st.stock[k] += e.outb[k] end
	e.inb = {}; e.outb = {}; e.progress = 0; e.recipe = recipe
	return true
end

function Sim.techAvailable(st, id: string): boolean
	local t = st.content.TECHS[id]
	if t.req and st.tech.levels[t.req] == 0 then return false end
	return t.max == 0 or st.tech.levels[id] < t.max
end

function Sim.setResearch(st, id: string?): boolean
	if id ~= nil and not Sim.techAvailable(st, id) then return false end
	if st.log then table.insert(st.log, { st.tick, "research", id }) end
	if st.tech.current ~= id then st.tech.units = 0 end
	st.tech.current = id
	return true
end

function Sim.applyCommand(st, cmd)
	local k, a, b, c, d = cmd[1], cmd[2], cmd[3], cmd[4], cmd[5]
	if k == "build" then return Sim.build(st, a, b, c, d) end
	if k == "remove" then return Sim.remove(st, a, b) end
	if k == "rotate" then return { ok = Sim.rotate(st, a, b, c or -1) } end
	if k == "recipe" then return { ok = Sim.setRecipe(st, a, b) } end
	if k == "research" then return { ok = Sim.setResearch(st, a) } end
	return { ok = false, reason = "unknown command" }
end

-- ---------- item transfer ----------
local function bufCap(n: number): number return n * 2 + 2 end

local function anyPositive(tbl): boolean
	for _, v in tbl do if v > 0 then return true end end
	return false
end

local function accept(st, e, item: string, fromDir: number, overflow: number): boolean
	local C = st.content
	local t = e.type
	if t == "belt" then
		if fromDir == (e.dir + 2) % 4 then return false end
		local pos = overflow
		local last = e.items[#e.items]
		if last and last.pos - pos < C.BELT.gap then return false end
		table.insert(e.items, { item = item, pos = pos, t = st.tick })
		return true
	elseif t == "smelter" or t == "assembler" then
		local R = if e.recipe then C.RECIPES[e.recipe] else nil
		if t == "smelter" then
			local idle = not anyPositive(e.inb) and not anyPositive(e.outb) and e.progress == 0
			if not R or (idle and R.inputs[item] == nil) then
				R = nil
				for _, k in C.RECIPE_ORDER do
					local r = C.RECIPES[k]
					if r.machine == "smelter" and r.inputs[item] ~= nil and techUnlocked(st, r.tech) then e.recipe = k; R = r; break end
				end
				if not R then return false end
			end
		end
		if R.inputs[item] == nil then return false end
		local have = e.inb[item] or 0
		if have >= bufCap(R.inputs[item]) then return false end
		e.inb[item] = have + 1
		return true
	elseif t == "generator" then
		if item ~= "coal" or e.fuel >= 5 then return false end
		e.fuel += 1
		return true
	elseif t == "lab" then
		if item ~= "sci_red" and item ~= "sci_green" then return false end
		if (e.inb[item] or 0) >= 10 then return false end
		e.inb[item] = (e.inb[item] or 0) + 1
		return true
	elseif t == "hub" then
		st.stock[item] += 1; st.delivered[item] += 1
		return true
	end
	return false
end

local function dirBetween(ax: number, ay: number, bx: number, by: number): number
	if bx > ax then return 0 end
	if by > ay then return 1 end
	if bx < ax then return 2 end
	return 3
end

local function give(st, src, fx: number, fy: number, tx: number, ty: number, item: string, overflow: number): boolean
	local t = entAt(st, tx, ty)
	if not t or t == src then return false end
	return accept(st, t, item, dirBetween(fx, fy, tx, ty), overflow)
end

local function emitFromMachine(st, e, item: string): boolean
	local fronts = frontTiles(e)
	local n = #fronts
	for k = 0, n - 1 do
		local idx = (e.alt + k) % n
		local f = fronts[idx + 1]
		local tx, ty = f[1], f[2]
		local fx, fy = tx - DX[e.dir], ty - DY[e.dir]
		if give(st, e, fx, fy, tx, ty, item, 0) then e.alt = (idx + 1) % n; return true end
	end
	return false
end

-- ---------- power ----------
local function rebuildPower(st)
	local C = st.content
	local poles = {}
	for _, id in st.order do
		local e = st.ents[id]
		if e.type == "pole" then table.insert(poles, e)
		elseif e.type == "hub" then table.insert(poles, { id = e.id, x = e.x + 1, y = e.y + 1, hub = e }) end
	end
	local n = #poles
	local parent = {}
	for i = 1, n do parent[i] = i end
	local function find(i)
		while parent[i] ~= i do parent[i] = parent[parent[i]]; i = parent[i] end
		return i
	end
	local reach, sup = C.BUILDINGS.pole.reach, C.BUILDINGS.pole.supply
	for i = 1, n do
		for j = i + 1, n do
			local dx, dy = poles[i].x - poles[j].x, poles[i].y - poles[j].y
			if dx * dx + dy * dy <= reach * reach then
				local a, b = find(i), find(j)
				if a ~= b then parent[max(a, b)] = min(a, b) end
			end
		end
	end
	-- nets are 0-based like the JS array so e.net values match
	local nets, count = {}, 0
	local netOf = {}
	for i = 1, n do
		local r = find(i)
		if netOf[r] == nil then
			netOf[r] = count
			nets[count] = { members = {}, poles = {}, cap = 0, demand = 0, sat = 1000 }
			count += 1
		end
		poles[i].net = netOf[r]
		table.insert(nets[poles[i].net].poles, poles[i].id)
		if poles[i].hub then poles[i].hub.net = poles[i].net; table.insert(nets[poles[i].net].members, poles[i].id) end
	end
	for _, id in st.order do
		local e = st.ents[id]
		if e.type == "pole" or e.type == "belt" or e.type == "hub" then continue end
		e.net = -1
		for _, p in poles do
			if e.x - sup <= p.x and p.x <= e.x + e.size - 1 + sup and e.y - sup <= p.y and p.y <= e.y + e.size - 1 + sup then e.net = p.net; break end
		end
		if e.net >= 0 then table.insert(nets[e.net].members, e.id) end
	end
	st.power.nets = nets
	st.power.count = count
	st.power.dirty = false
end

local function stepPower(st)
	local C = st.content
	if st.power.dirty then rebuildPower(st) end
	local steamMul = 1000 + 500 * st.tech.levels.steam
	for ni = 0, (st.power.count or 0) - 1 do
		local net = st.power.nets[ni]
		local demand, solar, gens = 0, 0, {}
		for _, id in net.members do
			local e = st.ents[id]
			local P = C.BUILDINGS[e.type].power
			if P then demand += if e.wantsWork then P else floor(P / 10) end
			if e.type == "solar" then solar += C.BUILDINGS.solar.output end
			if e.type == "hub" then solar += C.BUILDINGS.hub.output end
			if e.type == "generator" and (e.energy > 0 or e.fuel > 0) then table.insert(gens, e) end
		end
		local genCap = floor(C.BUILDINGS.generator.output * steamMul / 1000)
		local cap = solar + #gens * genCap
		net.cap = cap; net.demand = demand
		net.sat = if demand == 0 then 1000 else min(1000, floor(cap * 1000 / demand))
		local rest = max(0, min(demand, cap) - solar)
		local ng = #gens
		for g = 0, ng - 1 do
			local e = gens[g + 1]
			local share = if g == ng - 1 then rest else floor(rest / (ng - g))
			rest -= share
			e.load = share
			if e.energy < share and e.fuel > 0 then
				e.fuel -= 1; e.energy += C.COAL_KJ * 60
				table.insert(st.events, { k = "burn", id = e.id })
			end
			e.energy = max(0, e.energy - share)
		end
	end
end

local function satOf(st, e): number
	if e.net == nil or e.net < 0 then return 0 end
	return st.power.nets[e.net].sat
end
Sim.satOf = satOf

-- ---------- belts ----------
local function rebuildBeltOrder(st)
	local belts, dist = {}, {}
	for _, id in st.order do local e = st.ents[id]; if e.type == "belt" then table.insert(belts, e) end end
	for _, b in belts do
		local d, cur = 0, b
		local seen = {}
		while true do
			seen[cur.id] = true
			local nx = entAt(st, cur.x + DX[cur.dir], cur.y + DY[cur.dir])
			if not nx or nx.type ~= "belt" or nx.dir == (cur.dir + 2) % 4 then break end
			if seen[nx.id] then d = 1e9; break end
			if dist[nx.id] ~= nil then d += 1 + dist[nx.id]; break end
			d += 1; cur = nx
		end
		dist[b.id] = d
	end
	table.sort(belts, function(a, b)
		local da, db = dist[a.id], dist[b.id]
		if da ~= db then return da < db end
		return a.id < b.id
	end)
	local order = {}
	for i, b in belts do order[i] = b.id end
	st.beltOrder = order
	st.beltsDirty = false
end

local function stepBelt(st, e, speed: number, L: number, G: number)
	local items = e.items
	local cap = L
	local k = 1
	while k <= #items do
		local it = items[k]
		if it.t == st.tick then cap = it.pos - G; k += 1; continue end
		local np = min(it.pos + speed, cap)
		if k == 1 and np >= L then
			local tx, ty = e.x + DX[e.dir], e.y + DY[e.dir]
			local over = min(np - L, G - 1)
			if give(st, e, e.x, e.y, tx, ty, it.item, over) then
				table.remove(items, 1); cap = L
				continue
			end
			np = L
		end
		if np < it.pos then np = it.pos end
		it.pos = np
		cap = np - G
		k += 1
	end
	e.working = #items > 0
end

-- ---------- tick ----------
function Sim.step(st)
	local C = st.content
	stepPower(st)
	local speed, L, G = Sim.beltSpeed(st), C.BELT.len, C.BELT.gap
	local mineMul = 1000 + 100 * st.tech.levels.mining_prod
	local clockMul = 1000 + 150 * st.tech.levels.overclock

	if st.beltsDirty ~= false then rebuildBeltOrder(st) end
	for _, id in st.beltOrder do stepBelt(st, st.ents[id], speed, L, G) end
	for _, id in st.order do
		local e = st.ents[id]
		if not e then continue end
		local t = e.type
		if t == "drill" then
			e.wantsWork = e.out == 0
			local sat = satOf(st, e)
			e.working = false
			if e.out == 0 and sat > 0 then
				e.progress += floor(e.rich * mineMul / 1000 * sat / 1000)
				e.working = true
				local need = (3600 / C.BUILDINGS.drill.rate) * 1000
				if e.progress >= need then
					e.progress -= need; e.out = 1
					st.produced[C.ORES[e.ore]] += 1
				end
			end
			if e.out > 0 and emitFromMachine(st, e, C.ORES[e.ore]) then e.out = 0 end
		elseif t == "smelter" or t == "assembler" then
			local R = if e.recipe then C.RECIPES[e.recipe] else nil
			e.working = false; e.wantsWork = false
			if R then
				local room = true
				for _, k in R.outOrder do if (e.outb[k] or 0) + R.out[k] > bufCap(R.out[k]) then room = false end end
				local ready = e.progress > 0
				if not ready then
					ready = true
					for _, k in R.inOrder do if (e.inb[k] or 0) < R.inputs[k] then ready = false end end
				end
				if ready and room then
					e.wantsWork = true
					local sat = satOf(st, e)
					if sat > 0 then
						if e.progress == 0 then for _, k in R.inOrder do e.inb[k] -= R.inputs[k] end end
						e.progress += max(1, floor(C.BUILDINGS[t].speed * clockMul / 1000 * sat / 1000))
						e.working = true
						if e.progress >= R.time * 1000 then
							e.progress = 0
							for _, k in R.outOrder do e.outb[k] = (e.outb[k] or 0) + R.out[k]; st.produced[k] += R.out[k] end
							table.insert(st.events, { k = "craft", id = e.id, item = R.outOrder[1] })
						end
					end
				end
				for _, k in R.outOrder do
					if (e.outb[k] or 0) > 0 and emitFromMachine(st, e, k) then e.outb[k] -= 1 end
				end
			end
		elseif t == "lab" then
			local cur = st.tech.current
			e.working = false; e.wantsWork = false
			if cur then
				local T = C.TECHS[cur]
				if e.progress < 0 then
					local ok = true
					for _, p in T.packs do if not ((e.inb[p] or 0) > 0) then ok = false end end
					if ok then for _, p in T.packs do e.inb[p] -= 1 end; e.progress = 0 end
				end
				if e.progress >= 0 then
					e.wantsWork = true
					local sat = satOf(st, e)
					if sat > 0 then
						e.working = true
						e.progress += floor(1000 * sat / 1000)
						if e.progress >= T.time * 1000 then
							e.progress = -1
							st.tech.units += 1
							if st.tech.units >= Sim.techCost(st, cur, st.tech.levels[cur]) then
								st.tech.levels[cur] += 1; st.tech.units = 0
								table.insert(st.events, { k = "research", tech = cur, level = st.tech.levels[cur] })
								if not Sim.techAvailable(st, cur) then st.tech.current = nil end
							end
						end
					end
				end
			end
		elseif t == "generator" then
			e.working = e.load > 0
		elseif t == "solar" then
			e.working = e.net ~= nil and e.net >= 0
		end
	end
	st.tick += 1
end

-- ---------- snapshot (join-in-progress and DataStore saves) ----------
-- Plain arrays/string-keyed tables only, so it crosses RemoteEvents and
-- JSONEncode unchanged. Terrain is regenerated from the seed.
local SNAP_KEYS = { "items", "recipe", "inb", "outb", "progress", "alt", "out", "fuel", "energy", "wantsWork", "load" }

local function copy(v)
	if type(v) ~= "table" then return v end
	local o = {}
	for k, x in v do o[k] = copy(x) end
	return o
end

function Sim.snapshot(st)
	local ents = {}
	for _, id in st.order do
		local e = st.ents[id]
		local o = { id = e.id, type = e.type, x = e.x, y = e.y, dir = e.dir }
		for _, k in SNAP_KEYS do if e[k] ~= nil then o[k] = copy(e[k]) end end
		table.insert(ents, o)
	end
	return { v = 1, seed = st.seed, W = st.W, H = st.H, tick = st.tick, nextId = st.nextId, ents = ents,
		stock = copy(st.stock), delivered = copy(st.delivered), produced = copy(st.produced), tech = copy(st.tech) }
end

function Sim.restore(content, d)
	local st = Sim.createWorld(content, { W = d.W, H = d.H, seed = d.seed })
	for i = 0, st.W * st.H - 1 do st.occ[i] = 0 end
	st.ents = {}; st.order = {}
	for _, o in d.ents do
		st.nextId = o.id
		local e = placeRaw(st, o.type, o.x, o.y, o.dir)
		for _, k in SNAP_KEYS do if o[k] ~= nil then e[k] = copy(o[k]) end end
	end
	st.nextId = d.nextId; st.tick = d.tick
	for k, v in d.stock do st.stock[k] = v end
	for k, v in d.delivered do st.delivered[k] = v end
	for k, v in d.produced do st.produced[k] = v end
	st.tech = copy(d.tech)
	return st
end

-- ---------- hashes (exact integer arithmetic, same as JS) ----------
function Sim.stateHash(st): number
	local M = 2147483629
	local h = 7
	local function mix(v: number) h = (h * 31 + (v % M + M) % M) % M end
	mix(st.tick)
	for _, id in st.order do
		local e = st.ents[id]
		mix(e.id); mix(e.x); mix(e.y); mix(e.dir)
		if e.items then for _, it in e.items do mix(it.pos) end end
		if e.progress ~= nil then mix(e.progress) end
		if e.inb then for _, k in sortedKeys(e.inb) do mix(e.inb[k]) end end
		if e.outb then for _, k in sortedKeys(e.outb) do mix(e.outb[k]) end end
		if e.fuel ~= nil then mix(e.fuel); mix(e.energy) end
	end
	for _, k in sortedKeys(st.stock) do mix(st.stock[k]) end
	mix(st.tech.units)
	return h
end

function Sim.terrainHash(st): number
	local M = 2147483629
	local h = 7
	for i = 0, st.W * st.H - 1 do h = (h * 31 + st.terrain[i] * 7 + st.ore[i] * 3 + st.rich[i]) % M end
	return h
end

return Sim

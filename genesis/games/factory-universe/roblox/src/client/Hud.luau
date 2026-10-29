-- Native Roblox HUD (crisp text at any DPI): resources, power, research,
-- build toolbar, inspector and research list. Reads sim state; sends
-- commands through the `send` callback only.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Sim = require(ReplicatedStorage:WaitForChild("Shared").Sim)

local Hud = {}
Hud.__index = Hud

local INK, PANEL, LINE, TEXT, MUTED = Color3.fromRGB(13, 17, 23), Color3.fromRGB(22, 27, 34), Color3.fromRGB(43, 51, 64), Color3.fromRGB(230, 233, 238), Color3.fromRGB(139, 149, 165)
local AMBER, GOOD, BAD, CYAN = Color3.fromRGB(242, 180, 65), Color3.fromRGB(110, 210, 138), Color3.fromRGB(239, 91, 91), Color3.fromRGB(95, 211, 230)
local FONT = Enum.Font.RobotoMono

local function panel(parent, size: UDim2, pos: UDim2, anchor: Vector2?)
	local f = Instance.new("Frame")
	f.Size, f.Position, f.AnchorPoint = size, pos, anchor or Vector2.zero
	f.BackgroundColor3, f.BackgroundTransparency, f.BorderSizePixel = PANEL, 0.08, 0
	local c = Instance.new("UICorner"); c.CornerRadius = UDim.new(0, 6); c.Parent = f
	local s = Instance.new("UIStroke"); s.Color = LINE; s.Thickness = 1; s.Parent = f
	f.Parent = parent
	return f
end

local function label(parent, text: string, size: number, color: Color3?, pos: UDim2?, sz: UDim2?)
	local t = Instance.new("TextLabel")
	t.BackgroundTransparency = 1
	t.Font, t.TextSize, t.TextColor3 = FONT, size, color or TEXT
	t.TextXAlignment = Enum.TextXAlignment.Left
	t.Text = text
	t.Position = pos or UDim2.new()
	t.Size = sz or UDim2.new(1, 0, 0, size + 4)
	t.Parent = parent
	return t
end

local function bar(parent, pos: UDim2, color: Color3)
	local b = Instance.new("Frame")
	b.Size, b.Position, b.BackgroundColor3, b.BorderSizePixel = UDim2.new(1, -20, 0, 6), pos, INK, 0
	b.Parent = parent
	local i = Instance.new("Frame")
	i.Size, i.BackgroundColor3, i.BorderSizePixel = UDim2.fromScale(0, 1), color, 0
	i.Parent = b
	return i
end

function Hud.new(gui: ScreenGui, getState, send, ui)
	local self = setmetatable({ gui = gui, getState = getState, send = send, ui = ui, toolButtons = {} }, Hud)
	local C = getState().content

	local top = panel(gui, UDim2.new(1, -440, 0, 44), UDim2.fromOffset(10, 10))
	label(top, "FACTORY UNIVERSE", 14, AMBER, UDim2.fromOffset(12, 4))
	self.stock = label(top, "", 13, TEXT, UDim2.fromOffset(12, 22), UDim2.new(1, -24, 0, 18))

	local pw = panel(gui, UDim2.fromOffset(200, 44), UDim2.new(1, -420, 0, 10))
	label(pw, "POWER", 10, MUTED, UDim2.fromOffset(10, 4))
	self.pwText = label(pw, "-", 12, TEXT, UDim2.fromOffset(70, 3))
	self.pwBar = bar(pw, UDim2.fromOffset(10, 28), GOOD)

	local rs = Instance.new("TextButton")
	rs.Text, rs.AutoButtonColor = "", false
	rs.Size, rs.Position = UDim2.fromOffset(200, 44), UDim2.new(1, -210, 0, 10)
	rs.BackgroundColor3, rs.BackgroundTransparency, rs.BorderSizePixel = PANEL, 0.08, 0
	rs.Parent = gui
	label(rs, "RESEARCH (T)", 10, MUTED, UDim2.fromOffset(10, 4))
	self.rsText = label(rs, "none", 12, TEXT, UDim2.fromOffset(100, 3))
	self.rsBar = bar(rs, UDim2.fromOffset(10, 28), CYAN)
	rs.Activated:Connect(function() self:toggleTechs() end)

	-- toolbar
	local tb = panel(gui, UDim2.fromOffset(8 * 78 + 10, 62), UDim2.new(0.5, 0, 1, -10), Vector2.new(0.5, 1))
	local i = 0
	for _, k in C.BUILDING_ORDER do
		local B = C.BUILDINGS[k]
		if #B.costOrder == 0 then continue end
		local b = Instance.new("TextButton")
		b.Size, b.Position = UDim2.fromOffset(74, 52), UDim2.fromOffset(6 + i * 78, 5)
		b.BackgroundColor3, b.BorderSizePixel, b.AutoButtonColor = INK, 0, true
		b.Font, b.TextSize, b.TextColor3, b.TextWrapped = FONT, 11, TEXT, true
		b.Text = B.key .. "\n" .. B.name
		local st = Instance.new("UIStroke"); st.Color = LINE; st.ApplyStrokeMode = Enum.ApplyStrokeMode.Border; st.Parent = b
		b.Parent = tb
		b.Activated:Connect(function() ui.selectTool(if ui.tool == k then nil else k) end)
		self.toolButtons[k] = { b = b, stroke = st }
		i += 1
	end

	-- inspector
	self.inspect = panel(gui, UDim2.fromOffset(260, 210), UDim2.new(1, -270, 0, 64))
	self.inspect.Visible = false
	self.iTitle = label(self.inspect, "", 14, AMBER, UDim2.fromOffset(12, 8))
	self.iBody = label(self.inspect, "", 12, TEXT, UDim2.fromOffset(12, 30), UDim2.new(1, -24, 0, 100))
	self.iBody.TextYAlignment = Enum.TextYAlignment.Top
	self.iBody.TextWrapped = true
	self.recipeRow = Instance.new("Frame")
	self.recipeRow.BackgroundTransparency, self.recipeRow.Size, self.recipeRow.Position = 1, UDim2.new(1, -24, 0, 60), UDim2.fromOffset(12, 140)
	local grid = Instance.new("UIGridLayout"); grid.CellSize = UDim2.fromOffset(115, 22); grid.CellPadding = UDim2.fromOffset(6, 4); grid.Parent = self.recipeRow
	self.recipeRow.Parent = self.inspect
	self.recipeButtons = {}
	for _, k in C.RECIPE_ORDER do
		local R = C.RECIPES[k]
		if R.machine ~= "assembler" then continue end
		local b = Instance.new("TextButton")
		b.BackgroundColor3, b.BorderSizePixel, b.Font, b.TextSize, b.TextColor3 = INK, 0, FONT, 11, TEXT
		b.Text = C.ITEMS[k].name
		b.Parent = self.recipeRow
		b.Activated:Connect(function() if ui.selected then send({ "recipe", ui.selected, k }) end end)
		self.recipeButtons[k] = b
	end

	-- research list
	self.techs = panel(gui, UDim2.fromOffset(460, 360), UDim2.fromScale(0.5, 0.5), Vector2.new(0.5, 0.5))
	self.techs.Visible = false
	label(self.techs, "RESEARCH", 16, AMBER, UDim2.fromOffset(14, 10))
	local list = Instance.new("Frame")
	list.BackgroundTransparency, list.Size, list.Position = 1, UDim2.new(1, -28, 1, -50), UDim2.fromOffset(14, 40)
	local lay = Instance.new("UIListLayout"); lay.Padding = UDim.new(0, 6); lay.Parent = list
	list.Parent = self.techs
	self.techButtons = {}
	for _, k in C.TECH_ORDER do
		local b = Instance.new("TextButton")
		b.Size = UDim2.new(1, 0, 0, 38)
		b.BackgroundColor3, b.BorderSizePixel, b.Font, b.TextSize, b.TextColor3 = INK, 0, FONT, 12, TEXT
		b.TextXAlignment = Enum.TextXAlignment.Left
		b.Parent = list
		b.Activated:Connect(function() send({ "research", k }) end)
		self.techButtons[k] = b
	end

	self.toast = label(gui, "", 14, GOOD, UDim2.new(0.5, -200, 1, -110), UDim2.fromOffset(400, 20))
	self.toast.TextXAlignment = Enum.TextXAlignment.Center
	self.toastT = 0
	self.perf = label(gui, "", 11, MUTED, UDim2.new(0, 12, 1, -26), UDim2.fromOffset(500, 16))
	return self
end

function Hud:toggleTechs(on: boolean?)
	if on == nil then on = not self.techs.Visible end
	self.techs.Visible = on
end

function Hud:say(text: string, bad: boolean?)
	self.toast.Text = text
	self.toast.TextColor3 = if bad then BAD else GOOD
	self.toastT = os.clock()
end

local SHOWN = { "iron_plate", "copper_plate", "brick", "gear", "wire", "circuit", "sci_red", "sci_green" }
local SHORT = { iron_plate = "Fe", copper_plate = "Cu", brick = "Brick", gear = "Gear", wire = "Wire", circuit = "Circ", sci_red = "Red", sci_green = "Green" }

function Hud:update(perfLine: string)
	local st = self.getState()
	local C = st.content
	local parts = {}
	for _, k in SHOWN do
		if st.stock[k] > 0 or k == "iron_plate" then table.insert(parts, SHORT[k] .. " " .. st.stock[k]) end
	end
	self.stock.Text = table.concat(parts, "   ")
	local cap, dem, worst = 0, 0, 1000
	for ni = 0, (st.power.count or 0) - 1 do
		local n = st.power.nets[ni]
		cap += n.cap; dem += n.demand; worst = math.min(worst, n.sat)
	end
	self.pwText.Text = dem .. " / " .. cap .. " kW"
	self.pwBar.Size = UDim2.fromScale(if cap > 0 then math.min(1, dem / cap) else 0, 1)
	self.pwBar.BackgroundColor3 = if worst >= 1000 then GOOD elseif worst >= 500 then AMBER else BAD
	local cur = st.tech.current
	if cur then
		local need = Sim.techCost(st, cur, st.tech.levels[cur])
		self.rsText.Text = string.split(C.TECHS[cur].name, " ")[1] .. " " .. st.tech.units .. "/" .. need
		self.rsBar.Size = UDim2.fromScale(st.tech.units / need, 1)
	else
		self.rsText.Text = "none"
		self.rsBar.Size = UDim2.fromScale(0, 1)
	end
	for k, t in self.toolButtons do
		local B = C.BUILDINGS[k]
		local locked = not Sim.techUnlocked(st, B.tech)
		t.b.TextTransparency = if locked then 0.6 else 0
		t.stroke.Color = if self.ui.tool == k then AMBER else LINE
	end
	-- inspector
	local e = self.ui.selected and st.ents[self.ui.selected]
	self.inspect.Visible = e ~= nil
	if e then
		local B = C.BUILDINGS[e.type]
		self.iTitle.Text = B.name
		local lines = {}
		local net = if e.net ~= nil and e.net >= 0 then st.power.nets[e.net] else nil
		if B.power then table.insert(lines, if not net then "NO POWER - place a pole nearby" elseif net.sat < 1000 then ("brownout " .. math.floor(net.sat / 10) .. "%") else "powered") end
		if e.type == "drill" then
			table.insert(lines, C.ITEMS[C.ORES[e.ore]].name .. " x" .. string.format("%.2f", e.rich / 1000) .. " (infinite)")
			table.insert(lines, if e.working then "mining" elseif e.out > 0 then "output blocked" else "idle")
		elseif e.recipe ~= nil or e.type == "smelter" then
			local R = e.recipe and C.RECIPES[e.recipe]
			table.insert(lines, "recipe: " .. (if R then C.ITEMS[e.recipe].name else "auto"))
			if R then
				local ins = {}
				for _, k in R.inOrder do table.insert(ins, C.ITEMS[k].name .. " " .. (e.inb[k] or 0) .. "/" .. R.inputs[k]) end
				table.insert(lines, "in: " .. table.concat(ins, ", "))
				table.insert(lines, "progress " .. math.floor(e.progress / (R.time * 10)) .. "%")
			end
		elseif e.type == "generator" then
			table.insert(lines, "coal " .. e.fuel .. "  load " .. e.load .. " kW")
		elseif e.type == "lab" then
			table.insert(lines, "red " .. (e.inb.sci_red or 0) .. "  green " .. (e.inb.sci_green or 0))
		elseif e.type == "hub" then
			table.insert(lines, "accepts every item; +" .. C.BUILDINGS.hub.output .. " kW core, acts as a pole")
		end
		self.iBody.Text = table.concat(lines, "\n")
		self.recipeRow.Visible = e.type == "assembler"
		for k, b in self.recipeButtons do
			b.TextColor3 = if e.recipe == k then AMBER else TEXT
			b.TextTransparency = if Sim.techUnlocked(st, C.RECIPES[k].tech) then 0 else 0.6
		end
	end
	if self.techs.Visible then
		for k, b in self.techButtons do
			local T, lv = C.TECHS[k], st.tech.levels[k]
			local avail = Sim.techAvailable(st, k)
			local need = Sim.techCost(st, k, lv)
			b.Text = "  " .. T.name .. "  lv " .. lv .. (if T.max > 0 then "/" .. T.max else "") .. "   " .. need .. " x " .. table.concat(T.packs, "+")
			b.TextColor3 = if st.tech.current == k then AMBER elseif avail then TEXT else MUTED
		end
	end
	if os.clock() - self.toastT > 3 then self.toast.Text = "" end
	self.perf.Text = perfLine
end

return Hud

local RSGCore = nil
-- Auction System Client
-- Handles NUI control, inventory checks, and server communication

NUI = {}
local isOpen = false
local playerInventory = {}
local isRSGCoreReady = false

-- Wait for RSGCore to be ready
CreateThread(function()
    while not RSGCore do
        RSGCore = exports['rsg-core']:GetCoreObject()
        if RSGCore then
            isRSGCoreReady = true
            break
        end
        Wait(100)
    end
end)

-- ============================================
-- IMAGE MANAGEMENT
-- ============================================

-- Image cache to track loaded/failed images
local ImageCache = {
    loaded = {},      -- [imageUrl] = true (successfully loaded)
    failed = {},      -- [imageUrl] = true (failed to load)
    pending = {}      -- [imageUrl] = true (currently loading)
}

-- Fallback image URL for missing images
local FALLBACK_IMAGE = 'nui://' .. GetCurrentResourceName() .. '/web/dist/fallback.svg'
local HORSE_PREVIEW_IMAGE = 'nui://' .. GetCurrentResourceName() .. '/web/dist/horse-preview.svg'
local HORSE_AUCTION_DISTANCE = 4.0
local HorseStatsCache = {}
local HORSE_PREVIEW_IMAGES = {
    ['a_c_horse_arabian_white'] = 'https://static.wikia.nocookie.net/reddeadredemption/images/5/50/White_Arabian.PNG/revision/latest/scale-to-width-down/162?cb=20240421135017',
    ['a_c_horse_arabian_redchestnut_pc'] = 'https://static.wikia.nocookie.net/reddeadredemption/images/3/33/Red_Chestnut_Arabian_%28Story_Mode%29.PNG/revision/latest/scale-to-width-down/175?cb=20240421135112',
    ['a_c_horse_arabian_warpedbrindle_pc'] = 'https://static.wikia.nocookie.net/reddeadredemption/images/2/27/Warped_Brindle_Arabian_New.PNG/revision/latest/scale-to-width-down/176?cb=20240421135144',
    ['a_c_horse_andalusian_perlino'] = 'https://static.wikia.nocookie.net/reddeadredemption/images/8/81/Perlino_Andalusian.PNG/revision/latest/scale-to-width-down/188?cb=20240420130417',
    ['a_c_horse_mustang_tigerstripedbay'] = 'https://static.wikia.nocookie.net/reddeadredemption/images/4/44/Tiger_Striped_Bay_Mustang.PNG/revision/latest/scale-to-width-down/184?cb=20240421231130',
    ['a_c_horse_shire_ravenblack'] = 'https://static.wikia.nocookie.net/reddeadredemption/images/7/75/Raven_Black_Shire.PNG/revision/latest/scale-to-width-down/186?cb=20240421233442',
    ['a_c_horse_kladruber_black'] = 'https://static.wikia.nocookie.net/reddeadredemption/images/8/8e/Black_Kladruber.PNG/revision/latest/scale-to-width-down/185?cb=20240421165440',
    ['a_c_horse_appaloosa_fewspotted_pc'] = 'https://static.wikia.nocookie.net/reddeadredemption/images/a/a7/Few_Spotted_Appaloosa.PNG/revision/latest/scale-to-width-down/188?cb=20240420133829',
    ['a_c_horse_mustang_goldendun'] = 'https://static.wikia.nocookie.net/reddeadredemption/images/b/b2/Golden_Dun_Mustang.PNG/revision/latest/scale-to-width-down/192?cb=20240421231123',
    ['a_c_horse_nokota_whiteroan'] = 'https://static.wikia.nocookie.net/reddeadredemption/images/6/6c/White_Roan_Nokota.PNG/revision/latest/scale-to-width-down/181?cb=20240421232324',
    ['a_c_horse_missourifoxtrotter_silverdapplepinto'] = 'https://static.wikia.nocookie.net/reddeadredemption/images/4/42/Silver_Dapple_Minto_Missouri_Fox_Trotter.PNG/revision/latest/scale-to-width-down/171?cb=20240421175828'
}
local HORSE_HANDLING_BY_MODEL = {
    ['a_c_horse_arabian_white'] = 'HORSE_HANDLING_ELITE',
    ['a_c_horse_arabian_redchestnut_pc'] = 'HORSE_HANDLING_ELITE',
    ['a_c_horse_arabian_warpedbrindle_pc'] = 'HORSE_HANDLING_ELITE',
    ['a_c_horse_andalusian_perlino'] = 'HORSE_HANDLING_STANDARD',
    ['a_c_horse_mustang_tigerstripedbay'] = 'HORSE_HANDLING_STANDARD',
    ['a_c_horse_shire_ravenblack'] = 'HORSE_HANDLING_HEAVY',
    ['a_c_horse_kladruber_black'] = 'HORSE_HANDLING_STANDARD',
    ['a_c_horse_appaloosa_fewspotted_pc'] = 'HORSE_HANDLING_STANDARD',
    ['a_c_horse_mustang_goldendun'] = 'HORSE_HANDLING_STANDARD',
    ['a_c_horse_nokota_whiteroan'] = 'HORSE_HANDLING_RACE',
    ['a_c_horse_missourifoxtrotter_silverdapplepinto'] = 'HORSE_HANDLING_STANDARD'
}

local function getHorsePreviewImage(model)
    if not model then
        return HORSE_PREVIEW_IMAGE
    end

    return HORSE_PREVIEW_IMAGES[string.lower(tostring(model))] or HORSE_PREVIEW_IMAGE
end

local function getHorseHandlingLabelFromModel(model)
    return HORSE_HANDLING_BY_MODEL[string.lower(tostring(model or ''))]
end

local function getHorseHandlingLabelFromXp(xp)
    xp = tonumber(xp) or 0

    if xp >= 1000 then
        return 'HORSE_HANDLING_ELITE'
    elseif xp >= 400 then
        return 'HORSE_HANDLING_RACE'
    elseif xp >= 200 then
        return 'HORSE_HANDLING_STANDARD'
    end

    return 'HORSE_HANDLING_HEAVY'
end

-- Generate image URL from item name
local function getItemImage(itemName)
    if not itemName then return nil end

    local sharedItem = RSGCore and RSGCore.Shared and RSGCore.Shared.Items and RSGCore.Shared.Items[itemName]
    local imageName = sharedItem and sharedItem.image or (itemName .. '.png')

    return 'nui://rsg-inventory/html/images/' .. imageName
end

-- Build image metadata for NUI
local function buildImageMeta(itemName)
    local imageUrl = getItemImage(itemName)
    return {
        url = imageUrl,
        itemName = itemName,
        fallbackUrl = FALLBACK_IMAGE,
        loaded = ImageCache.loaded[imageUrl] or false,
        failed = ImageCache.failed[imageUrl] or false
    }
end

local function buildCustomImageMeta(itemName, imageUrl)
    return {
        url = imageUrl,
        itemName = itemName,
        fallbackUrl = FALLBACK_IMAGE,
        loaded = ImageCache.loaded[imageUrl] or false,
        failed = ImageCache.failed[imageUrl] or false
    }
end

local function clampValue(value, minValue, maxValue)
    if value > maxValue then
        return maxValue
    elseif value < minValue then
        return minValue
    end

    return value
end

local function getHorseTrainingAttributePoints(xp)
    xp = tonumber(xp) or 0

    if xp >= 4000 then return 2000 end
    if xp >= 3000 then return 1750 end
    if xp >= 2000 then return 1500 end
    if xp >= 1000 then return 1000 end
    if xp >= 500 then return 900 end
    if xp >= 400 then return 500 end
    if xp >= 300 then return 400 end
    if xp >= 200 then return 300 end
    if xp >= 100 then return 200 end
    return 100
end

local function getHorseHandlingLabelFromRank(rank)
    local handlingRank = tonumber(rank) or 0

    if handlingRank == 0 or handlingRank == 1 then
        return 'HORSE_HANDLING_HEAVY'
    elseif handlingRank == 2 or handlingRank == 3 then
        return 'HORSE_HANDLING_STANDARD'
    elseif handlingRank == 4 or handlingRank == 5 then
        return 'HORSE_HANDLING_RACE'
    elseif handlingRank >= 6 and handlingRank <= 9 then
        return 'HORSE_HANDLING_ELITE'
    end

    return 'HORSE_HANDLING_HEAVY'
end

local function buildHorseStatsFromPed(horsePed, model, xp)
    local speedBase = (GetAttributeBaseRank(horsePed, 5) or 0) + 1
    local speedBonus = GetAttributeBonusRank(horsePed, 5) or 0
    local accBase = (GetAttributeBaseRank(horsePed, 6) or 0) + 1
    local accBonus = GetAttributeBonusRank(horsePed, 6) or 0
    local handlingLabel = getHorseHandlingLabelFromXp(xp)
    if not handlingLabel then
        handlingLabel = getHorseHandlingLabelFromModel(model) or getHorseHandlingLabelFromRank(GetAttributeRank(horsePed, 4) or 0)
    end

    return {
        preservedStats = {
            healthPoints = tonumber(GetAttributePoints(horsePed, 0) or 0) or 0,
            staminaPoints = tonumber(GetAttributePoints(horsePed, 1) or 0) or 0,
            agilityPoints = tonumber(GetAttributePoints(horsePed, 4) or 0) or 0,
            speedPoints = tonumber(GetAttributePoints(horsePed, 5) or 0) or 0,
            accelerationPoints = tonumber(GetAttributePoints(horsePed, 6) or 0) or 0,
            bondingPoints = tonumber(GetAttributePoints(horsePed, 7) or 0) or 0,
        },
        horseSpeedValue = speedBase,
        horseSpeedMinValue = 0,
        horseSpeedMaxValue = 10,
        horseSpeedEquipmentValue = clampValue(speedBase + speedBonus, 0, 10),
        horseSpeedEquipmentMinValue = 0,
        horseSpeedEquipmentMaxValue = 10,
        horseSpeedCapacityValue = clampValue(speedBase + 3, 0, 10),
        horseSpeedCapacityMinValue = 0,
        horseSpeedCapacityMaxValue = 10,
        horseAccValue = accBase,
        horseAccMinValue = 0,
        horseAccMaxValue = 10,
        horseAccEquipmentValue = clampValue(accBase + accBonus, 0, 10),
        horseAccEquipmentMinValue = 0,
        horseAccEquipmentMaxValue = 10,
        horseAccCapacityValue = clampValue(accBase + 2, 0, 10),
        horseAccCapacityMinValue = 0,
        horseAccCapacityMaxValue = 10,
        horseHandling = handlingLabel,
    }
end

local function getHorseAuctionStats(model, xp)
    local modelName = tostring(model or '')
    local modelHash = joaat(modelName)
    local cacheKey = string.lower(modelName) .. ':' .. tostring(tonumber(xp) or 0)

    if HorseStatsCache[cacheKey] then
        return HorseStatsCache[cacheKey]
    end

    if not IsModelValid(modelHash) then
        return nil
    end

    RequestModel(modelHash)
    local timeoutAt = GetGameTimer() + 5000
    while not HasModelLoaded(modelHash) and GetGameTimer() < timeoutAt do
        Wait(0)
    end

    if not HasModelLoaded(modelHash) then
        return nil
    end

    local playerPed = PlayerPedId()
    local spawnCoords = GetEntityCoords(playerPed)
    local horsePed = CreatePed(modelHash, spawnCoords.x, spawnCoords.y, spawnCoords.z - 100.0, 0.0, false, false, 0, 0)

    if not horsePed or horsePed == 0 or not DoesEntityExist(horsePed) then
        SetModelAsNoLongerNeeded(modelHash)
        return nil
    end

    SetEntityVisible(horsePed, false)
    SetEntityCollision(horsePed, false, false)
    FreezeEntityPosition(horsePed, true)
    SetEntityInvincible(horsePed, true)
    SetEntityCanBeDamaged(horsePed, false)

    local attributePoints = getHorseTrainingAttributePoints(xp)
    SetAttributePoints(horsePed, 0, attributePoints)
    SetAttributePoints(horsePed, 1, attributePoints)
    SetAttributePoints(horsePed, 4, attributePoints)
    SetAttributePoints(horsePed, 5, attributePoints)
    SetAttributePoints(horsePed, 6, attributePoints)

    local stats = buildHorseStatsFromPed(horsePed, modelName, xp)
    HorseStatsCache[cacheKey] = stats

    DeletePed(horsePed)
    SetModelAsNoLongerNeeded(modelHash)

    return stats
end

local function applyHorseAuctionStats(metadata, horsePed)
    if type(metadata) ~= 'table' then
        return metadata
    end

    local stats = nil
    if horsePed and horsePed ~= 0 and DoesEntityExist(horsePed) then
        stats = buildHorseStatsFromPed(horsePed, metadata.horseModel, metadata.horseXp)
    else
        stats = getHorseAuctionStats(metadata.horseModel, metadata.horseXp)
    end

    if not stats then
        return metadata
    end

    for key, value in pairs(stats) do
        if key == 'horseHandling' then
            metadata[key] = value
        elseif metadata[key] == nil then
            metadata[key] = value
        end
    end

    return metadata
end

local function enrichHorseAuctionPayload(data)
    if type(data) ~= 'table' or type(data.auctions) ~= 'table' then
        return data
    end

    for _, auction in ipairs(data.auctions) do
        local metadata = auction and auction.item and auction.item.metadata
        if type(metadata) == 'table' and metadata.auctionType == 'horse' then
            applyHorseAuctionStats(metadata)
        end
    end

    return data
end

-- Report missing image to server
local function reportMissingImage(itemName, imageUrl)
    if ImageCache.failed[imageUrl] then return end -- Already reported
    
    ImageCache.failed[imageUrl] = true
    TriggerServerEvent('auction:server:reportMissingImage', itemName, imageUrl)
    print(('[Auction] Image not found: %s (%s)'):format(itemName, imageUrl))
end

local function refreshInventory()
    local items = {}
    
    if not isRSGCoreReady or not RSGCore then 
        return items 
    end
    
    -- RSG Framework inventory
    local PlayerData = RSGCore.Functions.GetPlayerData()
    if not PlayerData then
        return items
    end
    
    local inventory = PlayerData.items
    if not inventory then
        return items
    end
    
    for slot, item in pairs(inventory) do
        if item and item.amount and item.amount > 0 then
            local imageUrl = getItemImage(item.name)
            table.insert(items, {
                name = item.name,
                label = item.label or item.name,
                count = item.amount,
                slot = slot,
                metadata = item.info or {},
                image = imageUrl,
                imageMeta = buildImageMeta(item.name)
            })
        end
    end
    
    playerInventory = items
    return items
end

local function getInventoryItem(itemName)
    for _, item in ipairs(playerInventory) do
        if item.name == itemName then
            return item
        end
    end
    return nil
end

local function buildHorseAuctionEntry(horseData, horsePed)
    if not horseData or not horseData.id or not horseData.horseid or not horseData.horse then
        return nil
    end

    local horseName = horseData.name or 'Owned Horse'
    local horseModel = horseData.horse or 'horse'
    local pseudoItemName = 'horse_' .. tostring(horseData.id)
    local horseImage = getHorsePreviewImage(horseModel)

    local metadata = {
        auctionType = 'horse',
        auctionCategory = 'horses',
        horseDbId = tonumber(horseData.id),
        horseId = tostring(horseData.horseid),
        horseModel = horseModel,
        horseName = horseName,
        horseGender = horseData.gender,
        horseStable = horseData.stable,
        horseXp = tonumber(horseData.horsexp) or 0,
        horseBorn = tonumber(horseData.born) or 0
    }

    applyHorseAuctionStats(metadata, horsePed)

    return {
        name = pseudoItemName,
        label = horseName,
        count = 1,
        slot = -1,
        metadata = metadata,
        image = horseImage,
        imageMeta = buildCustomImageMeta(pseudoItemName, horseImage)
    }
end

local function getNearbyActiveHorseAuctionEntry(cb)
    if GetResourceState('rsg-horses') ~= 'started' then
        cb(nil)
        return
    end

    local ok, horsePed = pcall(function()
        return exports['rsg-horses']:CheckActiveHorse()
    end)

    if not ok or not horsePed or horsePed == 0 or not DoesEntityExist(horsePed) or IsEntityDead(horsePed) then
        cb(nil)
        return
    end

    local playerPed = PlayerPedId()
    if not playerPed or playerPed == 0 then
        cb(nil)
        return
    end

    local distance = #(GetEntityCoords(playerPed) - GetEntityCoords(horsePed))
    if distance > HORSE_AUCTION_DISTANCE then
        cb(nil)
        return
    end

    RSGCore.Functions.TriggerCallback('rsg-horses:server:GetActiveHorse', function(horseData)
        cb(buildHorseAuctionEntry(horseData, horsePed))
    end)
end

local function refreshAuctionInventory(cb)
    refreshInventory()

    getNearbyActiveHorseAuctionEntry(function(horseEntry)
        if horseEntry then
            table.insert(playerInventory, 1, horseEntry)
        end

        if cb then
            cb(playerInventory)
        end

        if isOpen then
            NUI.SendMessage('inventoryUpdated', { inventory = playerInventory })
        end
    end)
end

-- ============================================
-- NUI HELPERS
-- ============================================

function NUI.SendMessage(action, data)
    SendNuiMessage(json.encode({ action = action, data = data or {} }))
end

function NUI.Open(data)
    if isOpen then return end
    if not isRSGCoreReady or not RSGCore then 
        lib.notify({ title = 'Error', description = 'RSGCore not loaded yet', type = 'error' })
        return 
    end
    
    isOpen = true
    
    -- Refresh inventory before opening
    local inventory = refreshInventory()
    local PlayerData = RSGCore.Functions.GetPlayerData()
    local npcIndex = data and tonumber(data.npcIndex) or nil
    local moneyType = 'bank'
    
    if not PlayerData then
        isOpen = false
        lib.notify({ title = 'Error', description = 'Could not load player data', type = 'error' })
        return
    end
    
    local cashCents, bankCents = 0, 0

    if npcIndex and Config.AuctioneerNPCs and Config.AuctioneerNPCs[npcIndex] and Config.AuctioneerNPCs[npcIndex].bank then
        moneyType = Config.AuctioneerNPCs[npcIndex].bank
    end
    
    if PlayerData.money then
        local selectedBankBalance = PlayerData.money[moneyType]
        if selectedBankBalance == nil then
            selectedBankBalance = PlayerData.money['bank'] or 0
        end

        local cashBalance = math.max(0, PlayerData.money['cash'] or 0)
        selectedBankBalance = math.max(0, selectedBankBalance)

        -- Convert to cents for the UI
        cashCents = Money.dollarsToCents(cashBalance)
        bankCents = Money.dollarsToCents(selectedBankBalance)
    end
    
    -- Get fee configuration
    local feeConfig = Config.CreationFee or {}
    
    -- Get buyout configuration
    local buyoutConfig = Config.Buyout or { enabled = false, minMultiplier = 1.5 }
    
    -- Build categories from config
    local categories = {}
    if Config.Categories then
        for _, cat in ipairs(Config.Categories) do
            table.insert(categories, {
                id = cat.id,
                label = cat.label,
                icon = cat.icon or '📦',
                description = cat.description or ''
            })
        end
    end
    
    local function openWithBalances(resolvedCashCents, resolvedBankCents)
        SetNuiFocus(true, true)
        NUI.SendMessage('open', {
            inventory = inventory,
            cashCents = resolvedCashCents,
            bankCents = resolvedBankCents,
            citizenid = PlayerData.citizenid,
            playerName = PlayerData.charinfo and (PlayerData.charinfo.firstname .. ' ' .. PlayerData.charinfo.lastname) or 'Unknown',
            feeConfig = feeConfig,
            buyoutConfig = buyoutConfig,
            categories = categories
        })

        refreshAuctionInventory()

        -- Request current auctions
        TriggerServerEvent('auction:server:getAuctions')

        -- Also request pending collections
        TriggerServerEvent('auction:server:getPendingCollections')
    end

    RSGCore.Functions.TriggerCallback('auction:server:getOpeningBalances', function(balanceData)
        if balanceData then
            cashCents = balanceData.cashCents or cashCents
            bankCents = balanceData.bankCents or bankCents
        end

        openWithBalances(cashCents, bankCents)
    end, npcIndex)
end

function NUI.Close()
    if not isOpen then return end
    isOpen = false
    SetNuiFocus(false, false)
    NUI.SendMessage('close')
end

function NUI.IsOpen()
    return isOpen
end

-- ============================================
-- NUI CALLBACKS
-- ============================================

RegisterNuiCallback('close', function(_, cb)
    NUI.Close()
    cb({ success = true })
end)

RegisterNuiCallback('createAuction', function(data, cb)
    -- Validate item is still in inventory
    local item = getInventoryItem(data.itemName)
    if not item then
        cb({ success = false, error = 'Item no longer in inventory' })
        return
    end

    if item.count < (data.count or 1) then
        cb({ success = false, error = 'Insufficient item count' })
        return
    end

    -- Validate category is provided
    if not data.category or data.category == '' then
        cb({ success = false, error = 'Please select a category' })
        return
    end

    -- Forward to server
    TriggerServerEvent('auction:server:createAuction', {
        itemName = data.itemName,
        itemLabel = item.label,
        count = data.count or 1,
        metadata = item.metadata,
        image = item.image,
        customImageUrl = data.customImageUrl,
        category = data.category,
        startingBid = data.startingBid or 1,  -- Already in cents from UI
        buyoutPrice = data.buyoutPrice or nil,  -- Optional buyout price in cents
        duration = data.duration or 3600
    })

    cb({ success = true, message = 'Creating auction...' })
end)

RegisterNuiCallback('placeBid', function(data, cb)
    if not data.auctionId or not data.amountCents then
        cb({ success = false, error = 'Invalid bid data' })
        return
    end
    
    TriggerServerEvent('auction:server:placeBid', data.auctionId, data.amountCents)
    cb({ success = true, message = 'Placing bid...' })
end)

RegisterNuiCallback('cancelAuction', function(data, cb)
    if not data.auctionId then
        cb({ success = false, error = 'Invalid auction ID' })
        return
    end

    TriggerServerEvent('auction:server:cancelAuction', data.auctionId)
    cb({ success = true, message = 'Cancelling auction...' })
end)

RegisterNuiCallback('buyoutAuction', function(data, cb)
    if not data.auctionId then
        cb({ success = false, error = 'Invalid auction ID' })
        return
    end

    TriggerServerEvent('auction:server:buyoutAuction', data.auctionId)
    cb({ success = true, message = 'Processing buyout...' })
end)

RegisterNuiCallback('getInventory', function(_, cb)
    refreshAuctionInventory(function(inventory)
        cb({ success = true, inventory = inventory })
    end)
end)

RegisterNuiCallback('getAuctions', function(_, cb)
    TriggerServerEvent('auction:server:getAuctions')
    cb({ success = true })
end)

RegisterNuiCallback('getPlayerAuctions', function(_, cb)
    TriggerServerEvent('auction:server:getPlayerAuctions')
    cb({ success = true })
end)

RegisterNuiCallback('calculateFeePreview', function(data, cb)
    TriggerServerEvent('auction:server:calculateFeePreview', data)
    cb({ success = true })
end)

RegisterNuiCallback('getCategories', function(_, cb)
    TriggerServerEvent('auction:server:getCategories')
    cb({ success = true })
end)

RegisterNuiCallback('getBalance', function(_, cb)
    TriggerServerEvent('auction:server:getBalance')
    cb({ success = true })
end)

RegisterNuiCallback('searchAuctions', function(data, cb)
    -- Validate input
    if not data or type(data) ~= "table" then
        cb({ success = false, error = 'Invalid search data' })
        return
    end
    
    -- Get player citizenid for filtering
    local citizenid = nil
    if isRSGCoreReady and RSGCore then
        local PlayerData = RSGCore.Functions.GetPlayerData()
        if PlayerData then
            citizenid = PlayerData.citizenid
        end
    end
    
    TriggerServerEvent('auction:server:searchAuctions', {
        query = data.query or '',
        page = data.page or 1,
        limit = data.limit or 10,
        filterOwn = data.filterOwn or false,
        citizenid = citizenid,
        category = data.category or nil
    })
    cb({ success = true })
end)

-- Collection system callbacks
RegisterNuiCallback('getPendingCollections', function(_, cb)
    TriggerServerEvent('auction:server:getPendingCollections')
    cb({ success = true })
end)

RegisterNuiCallback('collectItem', function(data, cb)
    if not data.auctionId or not data.itemName then
        cb({ success = false, error = 'Invalid item data' })
        return
    end
    
    TriggerServerEvent('auction:server:collectItem', data.auctionId, data.itemName)
    cb({ success = true, message = 'Collecting item...' })
end)

RegisterNuiCallback('collectMoney', function(_, cb)
    TriggerServerEvent('auction:server:collectMoney')
    cb({ success = true, message = 'Collecting money...' })
end)

-- Image load status from NUI
RegisterNuiCallback('imageLoaded', function(data, cb)
    if data.url then
        ImageCache.loaded[data.url] = true
        ImageCache.pending[data.url] = nil
        ImageCache.failed[data.url] = nil
    end
    cb({ success = true })
end)

-- Image failed to load from NUI
RegisterNuiCallback('imageFailed', function(data, cb)
    if data.url and data.itemName then
        reportMissingImage(data.itemName, data.url)
    end
    cb({ success = true })
end)

-- ============================================
-- SERVER EVENT HANDLERS
-- ============================================

RegisterNetEvent('auction:client:update', function(payload)
    if not isOpen then return end
    NUI.SendMessage(payload.action, payload.data)
end)

RegisterNetEvent('auction:client:receiveAuctions', function(data)
    if not isOpen then return end
    NUI.SendMessage('receiveAuctions', enrichHorseAuctionPayload(data))
end)

RegisterNetEvent('auction:client:receiveSearchResults', function(data)
    if not isOpen then return end
    NUI.SendMessage('receiveSearchResults', enrichHorseAuctionPayload(data))
end)

RegisterNetEvent('auction:client:createResult', function(result)
    if not isOpen then return end
    NUI.SendMessage('createResult', result)
    
    if result.success then
        if result.auction and result.auction.item and result.auction.item.metadata and result.auction.item.metadata.auctionType == 'horse' then
            TriggerEvent('rsg-horses:client:despawnHorseAfterListing')
        end

        refreshAuctionInventory()
    end
end)

RegisterNetEvent('auction:client:bidResult', function(result)
    if not isOpen then return end
    NUI.SendMessage('bidResult', result)
end)

RegisterNetEvent('auction:client:cancelResult', function(result)
    if not isOpen then return end
    NUI.SendMessage('cancelResult', result)

    if result.success then
        refreshAuctionInventory()
    end
end)

RegisterNetEvent('auction:client:buyoutResult', function(result)
    if not isOpen then return end
    NUI.SendMessage('buyoutResult', result)
end)

RegisterNetEvent('auction:client:notification', function(data)
    -- Validate data
    if not data or type(data) ~= "table" then
        return
    end
    
    -- Show notification even if UI is closed
    NUI.SendMessage('notification', data)

    -- Also show in-game notification
    if data.type == 'outbid' then
        local newHighBidCents = data.newHighBidCents or Money.dollarsToCents(data.newHighBid)
        local message = data.message or ('You were outbid on %s! New high bid: %s'):format(data.itemName or 'item', Money.format(newHighBidCents or 0))
        lib.notify({
            title = 'Auction',
            description = message,
            type = 'warning'
        })
    elseif data.type == 'won' then
        local amountCents = data.amountCents or Money.dollarsToCents(data.amount)
        local title = data.isBuyout and 'Item Purchased!' or 'Auction Won!'
        local desc = data.isBuyout
            and ('You bought %s x%d for %s via buyout! Visit the auctioneer to collect.'):format(data.itemName or 'item', data.count or 1, Money.format(amountCents or 0))
            or ('You won %s x%d for %s! Visit the auctioneer to collect.'):format(data.itemName or 'item', data.count or 1, Money.format(amountCents or 0))
        lib.notify({
            title = title,
            description = desc,
            type = 'success'
        })
    elseif data.type == 'sold' then
        local amountCents = data.amountCents or Money.dollarsToCents(data.amount)
        local title = data.isBuyout and 'Item Sold via Buyout!' or 'Auction Sold!'
        local desc = data.isBuyout
            and ('Your %s x%d was purchased for %s via buyout! Visit the auctioneer to collect your earnings.'):format(data.itemName or 'item', data.count or 1, Money.format(amountCents or 0))
            or ('Your %s x%d sold for %s! Visit the auctioneer to collect your earnings.'):format(data.itemName or 'item', data.count or 1, Money.format(amountCents or 0))
        lib.notify({
            title = title,
            description = desc,
            type = 'success'
        })
    elseif data.type == 'expired' then
        lib.notify({
            title = 'Auction Expired',
            description = ('Your %s x%d auction expired with no bids. Visit the auctioneer to retrieve your item.'):format(data.itemName or 'item', data.count or 1),
            type = 'info'
        })
    elseif data.type == 'info' and data.message then
        lib.notify({
            title = 'Auction House',
            description = data.message,
            type = 'info'
        })
    end
end)

RegisterNetEvent('auction:client:receivePlayerAuctions', function(data)
    if not isOpen then return end
    NUI.SendMessage('receivePlayerAuctions', data)
end)

RegisterNetEvent('auction:client:feePreview', function(data)
    if not isOpen then return end
    NUI.SendMessage('feePreview', data)
end)

RegisterNetEvent('auction:client:receiveCategories', function(data)
    if not isOpen then return end
    NUI.SendMessage('receiveCategories', {
        categories = data.categories
    })
end)

-- Balance update handler - forwards server balance changes to NUI
RegisterNetEvent('auction:client:balanceUpdated', function(data)
    -- Forward balance update to NUI regardless of UI state
    -- This ensures the UI always has current balance when opened
    NUI.SendMessage('balanceUpdated', data)
end)

-- Collection system event handlers
RegisterNetEvent('auction:client:receivePendingCollections', function(data)
    if not isOpen then return end
    NUI.SendMessage('receivePendingCollections', data)
end)

RegisterNetEvent('auction:client:collectionResult', function(result)
    if not isOpen then return end
    NUI.SendMessage('collectionResult', result)
    
    if result.success then
        -- Refresh inventory if item was collected
        if result.type == 'item' then
            refreshAuctionInventory()
        end
    end
end)

-- Webhook admin command results
RegisterNetEvent('auction:client:webhookResult', function(data)
    lib.notify({
        title = 'Webhook Admin',
        description = data.message or (data.success and 'Success' or 'Error'),
        type = data.success and 'success' or 'error'
    })
end)

-- ============================================
-- COMMANDS & KEYBINDS
-- ============================================
--[[
RegisterCommand('auction', function()
    if isOpen then
        NUI.Close()
    else
        NUI.Open()
    end
end, false)

RegisterCommand('auctions', function()
    if isOpen then
        NUI.Close()
    else
        NUI.Open()
    end
end, false)
--]]

-- Close on escape
Citizen.CreateThread(function()
    while true do
        Citizen.Wait(0)
        if isOpen and IsControlJustPressed(0, 0x8A23A67D) then -- ESC key for RDR3
            NUI.Close()
        end
    end
end)

-- ============================================
-- INITIALIZATION
-- ============================================

AddEventHandler('onClientResourceStart', function(resourceName)
    if GetCurrentResourceName() == resourceName then
        print('[Auction System] Client initialized')
    end
end)

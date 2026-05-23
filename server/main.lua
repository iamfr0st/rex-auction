local RSGCore = exports['rsg-core']:GetCoreObject()
-- Auction System Server
-- Handles auction state, escrow, validation, persistence, and broadcasting

local Auctions = {}
local Escrow = {
    items = {},     -- [auctionId] = { item, count, metadata, owner }
    funds = {}      -- [auctionId] = { playerId = amount }
}
local BidHistory = {}  -- [auctionId] = { { playerId, playerName, amount, timestamp } }
local AuctionEndTimers = {}  -- [auctionId] = timerId
local PendingCollections = {}  -- [citizenid] = { money = { amount, reason, auctionId? }, items = { { itemName, itemLabel, count, metadata, auctionId, image, soldFor, sellerName, collectedAt } } }

local SAVE_FILE = 'auctions.json'
local AUCTION_ID_PREFIX = 'AUC'
local HORSE_PREVIEW_IMAGE = 'nui://' .. GetCurrentResourceName() .. '/web/dist/horse-preview.svg'
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
local getHorseHandlingForModel
local getHorseHandlingForHorse

local function getHorseHandlingForXp(xp)
    local value = tonumber(xp) or 0

    if value >= 1000 then
        return 'HORSE_HANDLING_ELITE'
    elseif value >= 400 then
        return 'HORSE_HANDLING_RACE'
    elseif value >= 200 then
        return 'HORSE_HANDLING_STANDARD'
    end

    return 'HORSE_HANDLING_HEAVY'
end

-- ============================================
-- SECURITY: RATE LIMITING
-- ============================================

local RateLimits = {
    createAuction = { cooldown = 5000, actions = {} },      -- 5 seconds between auctions
    placeBid = { cooldown = 1000, actions = {} },           -- 1 second between bids
    buyoutAuction = { cooldown = 3000, actions = {} },      -- 3 seconds between buyouts
    collectItem = { cooldown = 500, actions = {} },         -- 0.5 seconds between collections
    collectMoney = { cooldown = 500, actions = {} },        -- 0.5 seconds between collections
}

local function checkRateLimit(actionType, src)
    local limit = RateLimits[actionType]
    if not limit then return true end
    
    local now = GetGameTimer()
    local lastAction = limit.actions[src] or 0
    
    if now - lastAction < limit.cooldown then
        return false, limit.cooldown - (now - lastAction)
    end
    
    limit.actions[src] = now
    return true
end

local function cleanupRateLimits()
    local now = GetGameTimer()
    local maxAge = 60000 -- Clean up entries older than 1 minute
    
    for actionType, limit in pairs(RateLimits) do
        for src, lastAction in pairs(limit.actions) do
            if now - lastAction > maxAge then
                limit.actions[src] = nil
            end
        end
    end
end

-- ============================================
-- SECURITY: MUTEX LOCKS FOR AUCTION OPERATIONS
-- ============================================

local AuctionLocks = {}  -- [auctionId] = true when locked

local function lockAuction(auctionId)
    if AuctionLocks[auctionId] then
        return false -- Already locked
    end
    AuctionLocks[auctionId] = true
    return true
end

local function unlockAuction(auctionId)
    AuctionLocks[auctionId] = nil
end

-- Execute function with auction lock (prevents race conditions)
local function withAuctionLock(auctionId, func)
    if not lockAuction(auctionId) then
        return { success = false, error = 'Auction is currently being processed. Please try again.' }
    end
    
    local result = func()
    unlockAuction(auctionId)
    return result
end

-- ============================================
-- UTILITY FUNCTIONS
-- ============================================

local function generateAuctionId()
    return AUCTION_ID_PREFIX .. '_' .. os.time() .. '_' .. math.random(1000, 9999)
end

local function broadcastToAll(action, data)
    TriggerClientEvent('auction:client:update', -1, { action = action, data = data })
end

-- Generate image URL from item name
local function getItemImage(itemName)
    if not itemName then return nil end

    local sharedItem = RSGCore and RSGCore.Shared and RSGCore.Shared.Items and RSGCore.Shared.Items[itemName]
    local imageName = sharedItem and sharedItem.image or (itemName .. '.png')

    return 'nui://rsg-inventory/html/images/' .. imageName
end

local function buildImageMetadataForUrl(imageUrl, itemName)
    return {
        url = imageUrl,
        itemName = itemName,
        fallbackUrl = 'nui://' .. GetCurrentResourceName() .. '/web/dist/fallback.svg',
        loaded = false
    }
end

local function getHorsePreviewImage(model)
    if not model then
        return HORSE_PREVIEW_IMAGE
    end

    return HORSE_PREVIEW_IMAGES[string.lower(tostring(model))] or HORSE_PREVIEW_IMAGE
end

local function isHorseAuctionMetadata(metadata)
    return type(metadata) == 'table' and metadata.auctionType == 'horse'
end

local function isAllowedHorseImageUrl(url)
    if type(url) ~= 'string' then
        return false
    end

    local trimmed = url:match('^%s*(.-)%s*$')
    if not trimmed or trimmed == '' then
        return false
    end

    local lowerUrl = string.lower(trimmed)
    if not (string.find(lowerUrl, 'https://', 1, true) == 1 or string.find(lowerUrl, 'http://', 1, true) == 1) then
        return false
    end

    local allowedHosts = {
        'cdn.discordapp.com',
        'media.discordapp.net',
        'images-ext-1.discordapp.net',
        'images-ext-2.discordapp.net',
    }

    for _, host in ipairs(allowedHosts) do
        if string.find(lowerUrl, '://' .. host .. '/', 1, true) then
            return true
        end
    end

    return false
end

local function buildImageMetadata(itemName)
    return buildImageMetadataForUrl(getItemImage(itemName), itemName)
end

-- Track missing images for debugging
local MissingImages = {}

-- Log missing image report from client
local function logMissingImage(itemName, imageUrl, playerSrc)
    if not MissingImages[itemName] then
        MissingImages[itemName] = { 
            count = 0, 
            firstReported = os.time(),
            url = imageUrl 
        }
    end
    MissingImages[itemName].count = MissingImages[itemName].count + 1
    MissingImages[itemName].lastReported = os.time()
    
    print(('[Auction] Missing image reported: %s (%s) by player %s'):format(
        itemName, imageUrl, playerSrc or 'unknown'
    ))
end

local function saveAuctions()
    local saveData = {
        auctions = Auctions,
        escrow = Escrow,
        bidHistory = BidHistory,
        pendingCollections = PendingCollections
    }
    SaveResourceFile(GetCurrentResourceName(), SAVE_FILE, json.encode(saveData, { indent = true }), -1)
end

local function loadAuctions()
    local fileData = LoadResourceFile(GetCurrentResourceName(), SAVE_FILE)
    if fileData then
        local decoded = json.decode(fileData)
        if decoded then
            Auctions = decoded.auctions or {}
            Escrow = decoded.escrow or { items = {}, funds = {} }
            BidHistory = decoded.bidHistory or {}
            -- Support both old and new format for backwards compatibility
            PendingCollections = decoded.pendingCollections or decoded.pendingPayouts or {}
            
            -- Backfill images for existing auctions
            for auctionId, auction in pairs(Auctions) do
                if auction.item then
                    if isHorseAuctionMetadata(auction.item.metadata) then
                        local horseImageUrl = auction.item.metadata and auction.item.metadata.horseImageUrl
                        local resolvedHandling = getHorseHandlingForHorse(
                            auction.item.metadata and auction.item.metadata.horseModel,
                            auction.item.metadata and auction.item.metadata.horseXp
                        )
                        if resolvedHandling then
                            auction.item.metadata.horseHandling = resolvedHandling
                        end
                        auction.item.image = horseImageUrl or auction.item.image or getHorsePreviewImage(auction.item.metadata.horseModel)
                    elseif not auction.item.image then
                        auction.item.image = getItemImage(auction.item.name)
                    end
                end
                -- Backfill image metadata for existing auctions
                if auction.item then
                    if isHorseAuctionMetadata(auction.item.metadata) then
                        local horseImageUrl = auction.item.metadata and auction.item.metadata.horseImageUrl
                        if horseImageUrl or not auction.item.imageMeta then
                            auction.item.imageMeta = buildImageMetadataForUrl(
                                horseImageUrl or auction.item.image or getHorsePreviewImage(auction.item.metadata.horseModel),
                                auction.item.name
                            )
                        end
                    elseif not auction.item.imageMeta then
                        auction.item.imageMeta = buildImageMetadata(auction.item.name)
                    end
                end
                -- Backfill cents values for existing auctions (convert old dollar values)
                if auction.startingBid and not auction.startingBidCents then
                    auction.startingBidCents = Money.dollarsToCents(auction.startingBid)
                end
                if auction.currentBid and not auction.currentBidCents then
                    auction.currentBidCents = Money.dollarsToCents(auction.currentBid)
                end
                if auction.soldFor and not auction.soldForCents then
                    auction.soldForCents = Money.dollarsToCents(auction.soldFor)
                end
                if auction.creationFee and not auction.creationFeeCents then
                    auction.creationFeeCents = Money.dollarsToCents(auction.creationFee)
                end
                -- Backfill buyout price (new field, defaults to nil)
                if auction.buyoutPrice and not auction.buyoutPriceCents then
                    auction.buyoutPriceCents = Money.dollarsToCents(auction.buyoutPrice)
                end
            end
            
            -- Backfill cents values in bid history
            for auctionId, history in pairs(BidHistory) do
                for _, bid in ipairs(history) do
                    if bid.amount and not bid.amountCents then
                        bid.amountCents = Money.dollarsToCents(bid.amount)
                    end
                end
            end
            
            -- Backfill cents values in escrow funds
            for auctionId, funds in pairs(Escrow.funds) do
                for citizenid, amount in pairs(funds) do
                    if type(amount) == "number" and amount < 10000 then
                        -- Likely old dollar value, convert to cents
                        Escrow.funds[auctionId][citizenid] = Money.dollarsToCents(amount)
                    end
                end
            end
            
            -- Restart timers for active auctions
            for auctionId, auction in pairs(Auctions) do
                if auction.status == 'active' then
                    local remaining = auction.endTime - os.time()
                    if remaining > 0 then
                        AuctionEndTimers[auctionId] = SetTimeout(remaining * 1000, function()
                            endAuction(auctionId)
                        end)
                    else
                        -- Auction should have ended
                        endAuction(auctionId)
                    end
                end
            end
        end
    end
end

-- ============================================
-- FRAMEWORK INITIALIZATION
-- ============================================

AddEventHandler('onResourceStart', function(resourceName)
    if GetCurrentResourceName() ~= resourceName then return end
    print('[Auction System] RSGCore loaded on server')
    loadAuctions()
end)

-- ============================================
-- RSG FRAMEWORK INTEGRATION
-- ============================================

local function getPlayer(src)
    if not RSGCore then return nil end
    return RSGCore.Functions.GetPlayer(src)
end

local function getPlayerInventory(src)
    local Player = getPlayer(src)
    if not Player then return nil end
    return Player.PlayerData.items
end

local function removePlayerItem(src, itemName, count)
    local Player = getPlayer(src)
    if not Player then return false end
    
    local item = Player.Functions.GetItemByName(itemName)
    if not item or item.amount < count then return false end
    
    Player.Functions.RemoveItem(itemName, count)
    TriggerClientEvent('rsg-inventory:client:ItemBox', src, RSGCore.Shared.Items[itemName], 'remove', count)
    return true
end

local function addPlayerItem(src, itemName, count, metadata)
    local Player = getPlayer(src)
    if not Player then return false end

    -- Get current count before adding
    local currentSlot = Player.Functions.GetItemByName(itemName)
    local countBefore = currentSlot and currentSlot.amount or 0

    Player.Functions.AddItem(itemName, count, false, metadata)
    TriggerClientEvent('rsg-inventory:client:ItemBox', src, RSGCore.Shared.Items[itemName], 'add', count)

    -- Verify item was added (RSGCore doesn't return success, so we check after)
    local slotAfter = Player.Functions.GetItemByName(itemName)
    local countAfter = slotAfter and slotAfter.amount or 0

    return countAfter >= countBefore + count
end

local function getNearbyAuctioneerConfig(src)
    local ped = GetPlayerPed(src)
    if not ped then return nil, nil end

    local playerCoords = GetEntityCoords(ped)
    if not playerCoords then return nil, nil end

    local npcs = Config.AuctioneerNPCs
    if not npcs then return nil, nil end

    local maxDistance = Config.InteractionDistance or 2.5

    for index, npcConfig in ipairs(npcs) do
        local npcCoords = npcConfig.coords
        local distance = #(playerCoords - npcCoords)
        if distance <= maxDistance then
            return npcConfig, index
        end
    end

    return nil, nil
end

local function getAuctioneerMoneyType(src)
    local npcConfig = getNearbyAuctioneerConfig(src)
    if npcConfig and npcConfig.bank and npcConfig.bank ~= '' then
        return npcConfig.bank
    end

    return 'bank'
end

local function getAuctioneerMoneyTypeByIndex(npcIndex)
    local config = Config.AuctioneerNPCs and Config.AuctioneerNPCs[npcIndex]
    if config and config.bank and config.bank ~= '' then
        return config.bank
    end

    return 'bank'
end

local function getPlayerMoney(src, moneyType)
    local Player = getPlayer(src)
    if not Player then return 0, 0 end
    
    local money = Player.PlayerData.money
    local cash = math.max(0, money['cash'] or 0)
    local resolvedMoneyType = moneyType or getAuctioneerMoneyType(src)
    local bank = money[resolvedMoneyType]

    if bank == nil then
        bank = money['bank'] or 0
    end

    bank = math.max(0, bank)

    return Money.dollarsToCents(cash), Money.dollarsToCents(bank)
end

RSGCore.Functions.CreateCallback('auction:server:getOpeningBalances', function(source, cb, npcIndex)
    local moneyType = npcIndex and getAuctioneerMoneyTypeByIndex(tonumber(npcIndex)) or getAuctioneerMoneyType(source)
    local cashCents, bankCents = getPlayerMoney(source, moneyType)

    cb({
        cashCents = cashCents,
        bankCents = bankCents,
        moneyType = moneyType
    })
end)

-- Emit balance update to client for NUI sync
local function emitBalanceUpdate(src, moneyType)
    local cashCents, bankCents = getPlayerMoney(src, moneyType)
    TriggerClientEvent('auction:client:balanceUpdated', src, {
        cash = cashCents,
        bank = bankCents
    })
end

local function removePlayerMoney(src, amountCents, silent)
    local Player = getPlayer(src)
    if not Player then return false end
    
    -- Convert cents to dollars for framework call
    local amountDollars = Money.centsToDollars(amountCents)
    local moneyType = getAuctioneerMoneyType(src)
    
    local cashCents, bankCents = getPlayerMoney(src, moneyType)
    local cashDollars = Money.centsToDollars(cashCents)
    
    if cashCents >= amountCents then
        Player.Functions.RemoveMoney('cash', amountDollars)
        if not silent then emitBalanceUpdate(src, moneyType) end
        return true
    elseif cashCents + bankCents >= amountCents then
        -- Use all cash first, then bank
        Player.Functions.RemoveMoney('cash', cashDollars)
        local remainingCents = amountCents - cashCents
        Player.Functions.RemoveMoney(moneyType, Money.centsToDollars(remainingCents))
        if not silent then emitBalanceUpdate(src, moneyType) end
        return true
    end
    return false
end

local function addPlayerMoney(src, amountCents, silent)
    local Player = getPlayer(src)
    if not Player then return false end
    
    -- Convert cents to dollars for framework call
    local amountDollars = Money.centsToDollars(amountCents)
    local moneyType = getAuctioneerMoneyType(src)
    
    Player.Functions.AddMoney(moneyType, amountDollars)
    if not silent then emitBalanceUpdate(src, moneyType) end
    return true
end

local function getPlayerInfo(src)
    local Player = getPlayer(src)
    if not Player then return nil end
    
    return {
        id = src,
        name = Player.PlayerData.charinfo.firstname .. ' ' .. Player.PlayerData.charinfo.lastname,
        citizenid = Player.PlayerData.citizenid
    }
end

local function buildHorseEscrowCitizenid(auctionId)
    return ('auction_escrow:%s'):format(tostring(auctionId))
end

local function getEligibleHorseSaleData(model)
    if GetResourceState('rsg-horses') ~= 'started' then
        return nil
    end

    local ok, saleData = pcall(function()
        return exports['rsg-horses']:GetEligibleHorseSaleData(model)
    end)

    if not ok or type(saleData) ~= 'table' then
        return nil
    end

    return saleData
end

getHorseHandlingForModel = function(model)
    return HORSE_HANDLING_BY_MODEL[string.lower(tostring(model or ''))]
end

getHorseHandlingForHorse = function(model, xp)
    local xpHandling = getHorseHandlingForXp(xp)
    if xpHandling then
        return xpHandling
    end

    return getHorseHandlingForModel(model)
end

local function copyOptionalHorseStatMetadata(sourceMetadata, targetMetadata)
    if type(sourceMetadata) ~= 'table' or type(targetMetadata) ~= 'table' then
        return
    end

    local allowedKeys = {
        'horseSpeedValue',
        'horseSpeedMinValue',
        'horseSpeedMaxValue',
        'horseSpeedEquipmentValue',
        'horseSpeedEquipmentMinValue',
        'horseSpeedEquipmentMaxValue',
        'horseSpeedCapacityValue',
        'horseSpeedCapacityMinValue',
        'horseSpeedCapacityMaxValue',
        'horseAccValue',
        'horseAccMinValue',
        'horseAccMaxValue',
        'horseAccEquipmentValue',
        'horseAccEquipmentMinValue',
        'horseAccEquipmentMaxValue',
        'horseAccCapacityValue',
        'horseAccCapacityMinValue',
        'horseAccCapacityMaxValue',
        'horseHandling',
        'preservedStats',
    }

    for _, key in ipairs(allowedKeys) do
        if sourceMetadata[key] ~= nil then
            targetMetadata[key] = sourceMetadata[key]
        end
    end

    if targetMetadata.horseHandling == nil then
        targetMetadata.horseHandling = getHorseHandlingForHorse(
            targetMetadata.horseModel or sourceMetadata.horseModel,
            targetMetadata.horseXp or sourceMetadata.horseXp
        )
    end
end

local function getOwnedHorseRow(src, horseDbId)
    local Player = getPlayer(src)
    if not Player or not horseDbId then
        return nil
    end

    return MySQL.single.await(
        'SELECT * FROM player_horses WHERE id = ? AND citizenid = ? AND active = ?',
        { tonumber(horseDbId), Player.PlayerData.citizenid, 1 }
    )
end

local function decodeHorseComponents(rawComponents)
    if type(rawComponents) == 'table' then
        return rawComponents
    end

    if type(rawComponents) == 'string' and rawComponents ~= '' then
        local ok, decoded = pcall(json.decode, rawComponents)
        if ok and type(decoded) == 'table' then
            return decoded
        end
    end

    return {}
end

local function persistHorseAuctionStats(horseRow, submittedMetadata)
    if type(horseRow) ~= 'table' or not horseRow.id or type(submittedMetadata) ~= 'table' or type(submittedMetadata.preservedStats) ~= 'table' then
        return
    end

    local components = decodeHorseComponents(horseRow.components)
    components.PreservedStats = submittedMetadata.preservedStats
    horseRow.components = json.encode(components)
    MySQL.update.await('UPDATE player_horses SET components = ? WHERE id = ?', { horseRow.components, horseRow.id })
end

local function moveHorseToEscrow(auctionId, horseDbId, citizenid)
    local updated = MySQL.update.await(
        'UPDATE player_horses SET citizenid = ?, active = ? WHERE id = ? AND citizenid = ?',
        { buildHorseEscrowCitizenid(auctionId), 0, tonumber(horseDbId), citizenid }
    )

    return (tonumber(updated) or 0) > 0
end

local function assignEscrowHorseToCitizen(auctionId, horseDbId, citizenid)
    local updated = MySQL.update.await(
        'UPDATE player_horses SET citizenid = ?, active = ? WHERE id = ? AND citizenid = ?',
        { citizenid, 0, tonumber(horseDbId), buildHorseEscrowCitizenid(auctionId) }
    )

    return (tonumber(updated) or 0) > 0
end

local function hasItem(src, itemName, count)
    local Player = getPlayer(src)
    if not Player then return false end
    
    local item = Player.Functions.GetItemByName(itemName)
    if not item then return false end
    
    return item.amount >= count
end

-- Check if player has an active auction for this item
local function hasActiveAuctionForItem(citizenid, itemName)
    for auctionId, auction in pairs(Auctions) do
        if auction.status == 'active' 
            and auction.owner.citizenid == citizenid 
            and auction.item.name == itemName then
            return auction
        end
    end
    return nil
end

-- Count active auctions for a player
local function countPlayerActiveAuctions(citizenid)
    local count = 0
    for auctionId, auction in pairs(Auctions) do
        if auction.status == 'active' and auction.owner.citizenid == citizenid then
            count = count + 1
        end
    end
    return count
end

-- ============================================
-- SECURITY: INPUT VALIDATION
-- ============================================

local function validateAuctionId(auctionId)
    if not auctionId or type(auctionId) ~= "string" then
        return false, "Invalid auction ID"
    end
    if #auctionId > 50 then
        return false, "Auction ID too long"
    end
    if not Auctions[auctionId] then
        return false, "Auction not found"
    end
    return true
end

local function validatePositiveNumber(value, fieldName, maxValue)
    if value == nil then
        return false, fieldName .. " is required"
    end
    if type(value) ~= "number" then
        value = tonumber(value)
        if not value then
            return false, fieldName .. " must be a number"
        end
    end
    if value <= 0 then
        return false, fieldName .. " must be positive"
    end
    if maxValue and value > maxValue then
        return false, fieldName .. " exceeds maximum allowed"
    end
    return true, value
end

local function validateItemName(itemName)
    if not itemName or type(itemName) ~= "string" then
        return false, "Invalid item name"
    end
    if #itemName > 100 then
        return false, "Item name too long"
    end
    -- Basic sanitization: only allow alphanumeric, underscore, hyphen
    if itemName:match("[^%w_%-]") then
        return false, "Item name contains invalid characters"
    end
    return true
end

local function validateCategory(categoryId)
    if not categoryId or type(categoryId) ~= "string" then
        return false, "Category is required"
    end
    if #categoryId > 50 then
        return false, "Category ID too long"
    end
    return isValidCategory(categoryId)
end

-- Check if an item is blacklisted from auctions
local function isItemBlacklisted(itemName)
    if not Config.BlacklistedItems or #Config.BlacklistedItems == 0 then
        return false
    end
    
    for _, blacklistedItem in ipairs(Config.BlacklistedItems) do
        if blacklistedItem == itemName then
            return true
        end
    end
    return false
end

-- Validate that a category id exists in config
local function isValidCategory(categoryId)
    if not categoryId or not Config.Categories then return false end
    for _, cat in ipairs(Config.Categories) do
        if cat.id == categoryId then
            return true
        end
    end
    return false
end

-- Build category list with resolved items from inventory-like data
local function getCategoryList()
    local categories = {}
    if not Config.Categories then return categories end
    for _, cat in ipairs(Config.Categories) do
        table.insert(categories, {
            id = cat.id,
            label = cat.label,
            icon = cat.icon or '📦',
            description = cat.description or ''
        })
    end
    return categories
end

-- ============================================
-- AUCTION CREATION FEE SYSTEM
-- ============================================

-- Calculate creation fee based on duration and quantity
-- Formula: BaseFee + (DurationMultiplier * hours) + (QuantityMultiplier * quantity)
-- Returns fee in CENTS
local function calculateCreationFee(durationSeconds, quantity)
    local feeConfig = Config.CreationFee
    
    -- If fees disabled, return 0
    if not feeConfig or not feeConfig.enabled then
        return 0
    end
    
    local baseFeeCents = Money.dollarsToCents(feeConfig.baseFee or 5)
    local durationMultiplierCents = Money.dollarsToCents(feeConfig.durationMultiplier or 2)
    local quantityMultiplierCents = Money.dollarsToCents(feeConfig.quantityMultiplier or 0.5)
    local maxFeeCents = Money.dollarsToCents(feeConfig.maxFee or 500)
    local minFeeCents = Money.dollarsToCents(feeConfig.minFee or 5)
    
    -- Convert duration to hours
    local durationHours = durationSeconds / 3600
    
    -- Calculate fee components (in cents)
    local durationFeeCents = math.floor(durationMultiplierCents * durationHours)
    local quantityFeeCents = quantityMultiplierCents * quantity
    
    -- Total fee in cents
    local totalFeeCents = baseFeeCents + durationFeeCents + quantityFeeCents
    
    -- Apply min/max caps
    totalFeeCents = math.max(minFeeCents, math.min(maxFeeCents, totalFeeCents))
    
    return totalFeeCents
end

-- Get fee breakdown for UI preview
-- All values returned in CENTS
local function getFeeBreakdown(durationSeconds, quantity)
    local feeConfig = Config.CreationFee
    
    if not feeConfig or not feeConfig.enabled then
        return {
            enabled = false,
            totalCents = 0,
            baseFeeCents = 0,
            durationFeeCents = 0,
            quantityFeeCents = 0
        }
    end
    
    local baseFeeCents = Money.dollarsToCents(feeConfig.baseFee or 5)
    local durationMultiplierCents = Money.dollarsToCents(feeConfig.durationMultiplier or 2)
    local quantityMultiplierCents = Money.dollarsToCents(feeConfig.quantityMultiplier or 0.5)
    local maxFeeCents = Money.dollarsToCents(feeConfig.maxFee or 500)
    local minFeeCents = Money.dollarsToCents(feeConfig.minFee or 5)
    
    local durationHours = durationSeconds / 3600
    local durationFeeCents = math.floor(durationMultiplierCents * durationHours)
    local quantityFeeCents = quantityMultiplierCents * quantity
    local totalFeeCents = baseFeeCents + durationFeeCents + quantityFeeCents
    
    -- Apply caps for display
    local cappedFeeCents = math.max(minFeeCents, math.min(maxFeeCents, totalFeeCents))
    local wasCapped = totalFeeCents > maxFeeCents
    
    return {
        enabled = true,
        baseFeeCents = baseFeeCents,
        durationFeeCents = durationFeeCents,
        quantityFeeCents = quantityFeeCents,
        totalCents = cappedFeeCents,
        maxFeeCents = maxFeeCents,
        minFeeCents = minFeeCents,
        wasCapped = wasCapped
    }
end

-- ============================================
-- PENDING COLLECTION SYSTEM
-- ============================================

-- Queue money for collection at auctioneer (for sellers)
-- amountCents: amount in CENTS
local function queueMoneyCollection(citizenid, amountCents, reason, auctionId, itemName, sellerName)
    if not PendingCollections[citizenid] then
        PendingCollections[citizenid] = { money = nil, items = {} }
    end
    PendingCollections[citizenid].money = {
        amountCents = amountCents,
        reason = reason or 'auction sale',
        auctionId = auctionId,
        itemName = itemName,
        collectedAt = nil
    }
    print(('[Auction] Queued %s money collection for %s (%s)'):format(Money.format(amountCents), citizenid, reason or 'unknown'))
    saveAuctions()
end

-- Queue item for collection at auctioneer (for winners)
-- soldForCents: sale price in CENTS
local function queueItemCollection(citizenid, itemName, itemLabel, count, metadata, auctionId, image, soldForCents, sellerName)
    if not PendingCollections[citizenid] then
        PendingCollections[citizenid] = { money = nil, items = {} }
    end

    local imageMeta
    if isHorseAuctionMetadata(metadata) then
        imageMeta = buildImageMetadataForUrl(image or getHorsePreviewImage((metadata or {}).horseModel), itemName)
    else
        imageMeta = buildImageMetadata(itemName)
    end

    table.insert(PendingCollections[citizenid].items, {
        itemName = itemName,
        itemLabel = itemLabel or itemName,
        count = count,
        metadata = metadata,
        auctionId = auctionId,
        image = image,
        imageMeta = imageMeta,
        soldForCents = soldForCents,
        sellerName = sellerName,
        collectedAt = nil
    })
    print(('[Auction] Queued item %s x%d for collection by %s'):format(itemName, count, citizenid))
    saveAuctions()
end

-- Get pending collections for a player
-- Returns amounts in CENTS
local function getPendingCollections(citizenid)
    local collections = PendingCollections[citizenid]
    if not collections then
        return { money = nil, items = {} }
    end
    
    -- Filter out already collected items
    local pendingItems = {}
    for _, item in ipairs(collections.items) do
        if not item.collectedAt then
            -- Ensure soldForCents exists (backwards compat with old soldFor)
            if not item.soldForCents and item.soldFor then
                item.soldForCents = Money.dollarsToCents(item.soldFor)
            end
            table.insert(pendingItems, item)
        end
    end
    
    local pendingMoney = collections.money and not collections.money.collectedAt and collections.money or nil
    
    -- Ensure amountCents exists (backwards compat with old amount)
    if pendingMoney and not pendingMoney.amountCents and pendingMoney.amount then
        pendingMoney.amountCents = Money.dollarsToCents(pendingMoney.amount)
    end
    
    return {
        money = pendingMoney,
        items = pendingItems
    }
end

-- Check if player is near any auctioneer NPC (server-side validation)
local function isPlayerNearAuctioneer(src)
    local ped = GetPlayerPed(src)
    if not ped then return false end
    
    local playerCoords = GetEntityCoords(ped)
    if not playerCoords then return false end
    
    local npcs = Config.AuctioneerNPCs
    if not npcs then return false end
    
    local maxDistance = Config.InteractionDistance or 2.5
    
    for _, npcConfig in ipairs(npcs) do
        local npcCoords = npcConfig.coords
        local distance = #(playerCoords - npcCoords)
        if distance <= maxDistance then
            return true
        end
    end
    
    return false
end

-- ============================================
-- AUCTION CORE FUNCTIONS
-- ============================================

local function createAuction(src, itemData)
    local playerInfo = getPlayerInfo(src)
    if not playerInfo then
        return { success = false, error = 'Player not found' }
    end

    local isHorseAuction = isHorseAuctionMetadata(itemData.metadata)

    -- Validate category selection
    local selectedCategory = isHorseAuction and 'horses' or itemData.category
    if not selectedCategory or selectedCategory == '' then
        return { success = false, error = 'Please select a category for your auction' }
    end

    if not isValidCategory(selectedCategory) then
        return { success = false, error = 'Invalid category selected' }
    end
    
    -- Check max auctions per player limit
    local maxAuctions = Config.MaxAuctionsPerPlayer or 10
    local currentAuctionCount = countPlayerActiveAuctions(playerInfo.citizenid)
    if currentAuctionCount >= maxAuctions then
        return { success = false, error = ('You have reached the maximum of %d active auctions'):format(maxAuctions) }
    end
    
    -- Check for duplicate auction (same owner + same item)
    local existingAuction = hasActiveAuctionForItem(playerInfo.citizenid, itemData.itemName)
    if existingAuction then
        print(('[Auction] Duplicate rejected: %s (%s) already has active auction %s for item %s'):format(
            playerInfo.name, playerInfo.citizenid, existingAuction.id, itemData.itemName
        ))
        return { success = false, error = 'You already have an active auction for this item', existingAuctionId = existingAuction.id }
    end

    local escrowItemData = nil

    if isHorseAuction then
        local horseDbId = itemData.metadata.horseDbId
        local submittedHorseMetadata = itemData.metadata
        local horseRow = getOwnedHorseRow(src, horseDbId)
        if not horseRow then
            return { success = false, error = 'Nearby active horse not found' }
        end

        local horseSaleData = getEligibleHorseSaleData(horseRow.horse)
        if not horseSaleData then
            return { success = false, error = 'Only horses configured as rare, epic, or legendary can be auctioned' }
        end

        itemData.itemName = itemData.itemName or ('horse_' .. tostring(horseRow.id))
        itemData.itemLabel = horseRow.name or 'Owned Horse'
        itemData.count = 1
        itemData.metadata = {
            auctionType = 'horse',
            auctionCategory = 'horses',
            horseDbId = tonumber(horseRow.id),
            horseId = tostring(horseRow.horseid),
            horseModel = tostring(horseRow.horse),
            horseName = tostring(horseRow.name or 'Owned Horse'),
            horseGender = horseRow.gender,
            horseStable = horseRow.stable,
            horseXp = tonumber(horseRow.horsexp) or 0,
            horseBorn = tonumber(horseRow.born) or 0,
            horseRarity = tostring(horseSaleData.rarity or 'rare'),
            horseSpawnCategory = tostring(horseSaleData.category or 'horse')
        }
        itemData.metadata.horseHandling = getHorseHandlingForHorse(horseRow.horse, horseRow.horsexp) or itemData.metadata.horseHandling
        copyOptionalHorseStatMetadata(submittedHorseMetadata, itemData.metadata)
        persistHorseAuctionStats(horseRow, submittedHorseMetadata)

        local customHorseImageUrl = type(itemData.customImageUrl) == 'string' and itemData.customImageUrl:match('^%s*(.-)%s*$') or nil
        if customHorseImageUrl and customHorseImageUrl ~= '' then
            if not isAllowedHorseImageUrl(customHorseImageUrl) then
                return { success = false, error = 'Horse image must be a Discord-hosted image URL' }
            end
            itemData.metadata.horseImageUrl = customHorseImageUrl
            itemData.image = customHorseImageUrl
        else
            itemData.image = getHorsePreviewImage(horseRow.horse)
        end

        escrowItemData = {
            escrowType = 'horse',
            itemName = itemData.itemName,
            count = 1,
            metadata = itemData.metadata,
            owner = src,
            ownerCitizenid = playerInfo.citizenid,
            horseDbId = tonumber(horseRow.id),
            horseId = tostring(horseRow.horseid)
        }
    else
        -- Check if item is blacklisted
        if isItemBlacklisted(itemData.itemName) then
            print(('[Auction] Blacklisted item rejected: %s (%s) tried to auction %s'):format(
                playerInfo.name, playerInfo.citizenid, itemData.itemName
            ))
            return { success = false, error = 'This item cannot be auctioned' }
        end

        -- Validate item ownership
        if not hasItem(src, itemData.itemName, itemData.count) then
            return { success = false, error = 'You do not have this item' }
        end

        escrowItemData = {
            itemName = itemData.itemName,
            count = itemData.count,
            metadata = itemData.metadata or {},
            owner = src,
            ownerCitizenid = playerInfo.citizenid
        }
    end
    
    -- Validate auction parameters
    -- Convert startingBid to cents (client sends in cents)
    local startingBidCents = itemData.startingBid
    if type(startingBidCents) ~= "number" then
        startingBidCents = Money.parseToCents(tostring(itemData.startingBid))
    end
    
    -- Minimum starting bid is 1 cent
    if not startingBidCents or startingBidCents < 1 then
        return { success = false, error = 'Starting bid must be at least $0.01' }
    end
    
    local minDuration = 60       -- 1 minute minimum for testing
    local maxDuration = 604800   -- 7 days maximum
    local duration = math.min(math.max(itemData.duration or 3600, minDuration), maxDuration)

    -- Validate and set buyout price (optional)
    local buyoutPriceCents = nil
    if itemData.buyoutPrice and itemData.buyoutPrice > 0 then
        -- Convert to cents if needed
        buyoutPriceCents = itemData.buyoutPrice
        if type(buyoutPriceCents) ~= "number" then
            buyoutPriceCents = Money.parseToCents(tostring(itemData.buyoutPrice))
        end

        -- Validate buyout price is at least starting bid
        if buyoutPriceCents < startingBidCents then
            return { success = false, error = 'Buyout price must be at least the starting bid' }
        end

        -- Validate buyout meets minimum multiplier if configured
        if Config.Buyout and Config.Buyout.enabled then
            local minMultiplier = Config.Buyout.minMultiplier or 1.5
            local minBuyoutCents = math.floor(startingBidCents * minMultiplier)
            if buyoutPriceCents < minBuyoutCents then
                return { success = false, error = ('Buyout price must be at least %s (%.1fx starting bid)'):format(Money.format(minBuyoutCents), minMultiplier) }
            end
        end
    end
    
    -- Calculate and validate creation fee (returns cents)
    local creationFeeCents = calculateCreationFee(duration, itemData.count or 1)
    
    if Config.CreationFee and Config.CreationFee.enabled and creationFeeCents > 0 then
        -- Check if player has enough money for fee
        local cashCents, bankCents = getPlayerMoney(src)
        local totalAvailableCents = cashCents + bankCents
        
        if totalAvailableCents < creationFeeCents then
            print(('[Auction] Insufficient funds for fee: %s (%s) needs %s, has %s'):format(
                playerInfo.name, playerInfo.citizenid, Money.format(creationFeeCents), Money.format(totalAvailableCents)
            ))
            return { 
                success = false, 
                error = ('Insufficient funds for creation fee: %s required'):format(Money.format(creationFeeCents)),
                feeCents = creationFeeCents,
                playerFundsCents = totalAvailableCents
            }
        end
        
        -- Deduct fee
        if not removePlayerMoney(src, creationFeeCents) then
            print(('[Auction] Failed to deduct fee from %s (%s)'):format(
                playerInfo.name, playerInfo.citizenid
            ))
            return { success = false, error = 'Failed to process creation fee' }
        end
        
        print(('[Auction] Deducted %s creation fee from %s (%s)'):format(
            Money.format(creationFeeCents), playerInfo.name, playerInfo.citizenid
        ))
    end
    
    local auctionId = generateAuctionId()
    local now = os.time()

    -- Remove item from inventory (escrow)
    if isHorseAuction then
        if not moveHorseToEscrow(auctionId, itemData.metadata.horseDbId, playerInfo.citizenid) then
            if creationFeeCents > 0 then
                addPlayerMoney(src, creationFeeCents)
            end
            return { success = false, error = 'Failed to move horse into escrow' }
        end
    else
        if not removePlayerItem(src, itemData.itemName, itemData.count) then
            -- Refund fee if item removal fails
            if creationFeeCents > 0 then
                addPlayerMoney(src, creationFeeCents)
            end
            return { success = false, error = 'Failed to remove item from inventory' }
        end
    end

    -- Use client-provided image or generate from item name
    local imageUrl = isHorseAuction
        and ((itemData.metadata and itemData.metadata.horseImageUrl) or itemData.image or getHorsePreviewImage(itemData.metadata.horseModel))
        or (itemData.image or getItemImage(itemData.itemName))
    
    local auction = {
        id = auctionId,
        owner = {
            id = src,
            name = playerInfo.name,
            citizenid = playerInfo.citizenid
        },
        item = {
            name = itemData.itemName,
            label = itemData.itemLabel or itemData.itemName,
            count = isHorseAuction and 1 or itemData.count,
            metadata = itemData.metadata or {},
            image = imageUrl,
            imageMeta = isHorseAuction
                and buildImageMetadataForUrl(imageUrl, itemData.itemName)
                or buildImageMetadata(itemData.itemName)
        },
        category = selectedCategory,
        startingBidCents = startingBidCents,
        currentBidCents = 0,
        highestBidder = nil,
        buyoutPriceCents = buyoutPriceCents,
        endTime = now + duration,
        createdAt = now,
        status = 'active',
        totalBids = 0,
        creationFeeCents = creationFeeCents
    }
    
    Auctions[auctionId] = auction
    Escrow.items[auctionId] = escrowItemData
    BidHistory[auctionId] = {}
    
    -- Set end timer
    AuctionEndTimers[auctionId] = SetTimeout(duration * 1000, function()
        endAuction(auctionId)
    end)
    
    saveAuctions()
    
    -- Send webhook notification
    SendWebhook('auctionCreated', {
        auctionId = auctionId,
        itemName = auction.item.name,
        itemLabel = auction.item.label,
        count = auction.item.count,
        startingBidCents = startingBidCents,
        sellerName = playerInfo.name,
        duration = duration,
        creationFeeCents = creationFeeCents
    })
    
    -- Broadcast new auction to all players
    broadcastToAll('auctionCreated', auction)
    
    return { success = true, auction = auction, creationFeeCents = creationFeeCents }
end

local function placeBid(src, auctionId, bidAmountCents)
    local playerInfo = getPlayerInfo(src)
    if not playerInfo then
        return { success = false, error = 'Player not found' }
    end
    
    local auction = Auctions[auctionId]
    if not auction then
        return { success = false, error = 'Auction not found' }
    end
    
    if auction.status ~= 'active' then
        return { success = false, error = 'This auction has ended' }
    end
    
    -- Check if auction ended
    if os.time() >= auction.endTime then
        endAuction(auctionId)
        return { success = false, error = 'This auction has ended' }
    end
    
    -- Owner cannot bid on own auction
    if auction.owner.citizenid == playerInfo.citizenid then
        return { success = false, error = 'You cannot bid on your own auction' }
    end
    
    -- Validate bid amount (bidAmountCents should already be in cents from client)
    if type(bidAmountCents) ~= "number" then
        bidAmountCents = Money.parseToCents(tostring(bidAmountCents))
    end
    
    -- Calculate minimum bid in cents (5% increase over current bid)
    local currentBidCents = auction.currentBidCents or 0
    local minBidCents = currentBidCents > 0 and math.ceil(currentBidCents * 1.05) or auction.startingBidCents
    
    if bidAmountCents < minBidCents then
        return { success = false, error = 'Minimum bid is ' .. Money.format(minBidCents), minBidCents = minBidCents }
    end
    
    -- Check if player has enough money
    local cashCents, bankCents = getPlayerMoney(src)
    local totalAvailableCents = cashCents + bankCents
    
    -- Check how much is already in escrow for this auction
    local previousBidCents = 0
    if Escrow.funds[auctionId] and Escrow.funds[auctionId][playerInfo.citizenid] then
        previousBidCents = Escrow.funds[auctionId][playerInfo.citizenid]
    end
    
    local additionalFundsNeededCents = bidAmountCents - previousBidCents
    
    if totalAvailableCents < additionalFundsNeededCents then
        return { success = false, error = 'Insufficient funds', minBidCents = minBidCents }
    end
    
    -- Handle previous highest bidder refund
    if auction.highestBidder and auction.highestBidder.citizenid ~= playerInfo.citizenid then
        -- Notify previous bidder they were outbid
        local prevBidder = auction.highestBidder.id
        local prevBidderCitizenid = auction.highestBidder.citizenid
        
        -- Return funds to previous bidder (remove from escrow)
        if Escrow.funds[auctionId] and Escrow.funds[auctionId][prevBidderCitizenid] then
            local refundAmountCents = Escrow.funds[auctionId][prevBidderCitizenid]
            Escrow.funds[auctionId][prevBidderCitizenid] = nil
            
            -- Find the previous bidder's server ID
            for _, p in ipairs(GetPlayers()) do
                local pPlayer = RSGCore.Functions.GetPlayer(tonumber(p))
                if pPlayer and pPlayer.PlayerData.citizenid == prevBidderCitizenid then
                    addPlayerMoney(tonumber(p), refundAmountCents)
                    TriggerClientEvent('auction:client:notification', tonumber(p), {
                        type = 'outbid',
                        auctionId = auctionId,
                        itemName = auction.item.label,
                        newHighBidCents = bidAmountCents
                    })
                    break
                end
            end
        end
    end
    
    -- Remove additional funds from player
    if additionalFundsNeededCents > 0 then
        if not removePlayerMoney(src, additionalFundsNeededCents) then
            return { success = false, error = 'Failed to process payment' }
        end
    end
    
    -- Add to escrow (store in cents)
    if not Escrow.funds[auctionId] then
        Escrow.funds[auctionId] = {}
    end
    Escrow.funds[auctionId][playerInfo.citizenid] = bidAmountCents
    
    -- Update auction
    local previousHighest = auction.highestBidder
    auction.currentBidCents = bidAmountCents
    auction.highestBidder = {
        id = src,
        name = playerInfo.name,
        citizenid = playerInfo.citizenid
    }
    auction.totalBids = auction.totalBids + 1
    
    -- Add to bid history
    table.insert(BidHistory[auctionId], 1, {
        playerId = src,
        playerName = playerInfo.name,
        citizenid = playerInfo.citizenid,
        amountCents = bidAmountCents,
        timestamp = os.time()
    })
    
    saveAuctions()
    
    -- Send webhook notification
    SendWebhook('bidPlaced', {
        auctionId = auctionId,
        itemLabel = auction.item.label,
        bidAmountCents = bidAmountCents,
        previousBidCents = previousBidCents,
        bidderName = playerInfo.name,
        totalBids = auction.totalBids
    })
    
    -- Broadcast bid update
    broadcastToAll('bidPlaced', {
        auctionId = auctionId,
        currentBidCents = bidAmountCents,
        highestBidder = {
            name = playerInfo.name,
            citizenid = playerInfo.citizenid
        },
        totalBids = auction.totalBids,
        bidHistory = BidHistory[auctionId]
    })
    
    return { success = true, auction = auction }
end

local function buyoutAuction(src, auctionId)
    local playerInfo = getPlayerInfo(src)
    if not playerInfo then
        return { success = false, error = 'Player not found' }
    end

    local auction = Auctions[auctionId]
    if not auction then
        return { success = false, error = 'Auction not found' }
    end

    if auction.status ~= 'active' then
        return { success = false, error = 'This auction has ended' }
    end

    -- Check if auction ended
    if os.time() >= auction.endTime then
        endAuction(auctionId)
        return { success = false, error = 'This auction has ended' }
    end

    -- Check if buyout is available
    if not auction.buyoutPriceCents or auction.buyoutPriceCents <= 0 then
        return { success = false, error = 'This auction does not have a buyout price' }
    end

    -- Owner cannot buyout own auction
    if auction.owner.citizenid == playerInfo.citizenid then
        return { success = false, error = 'You cannot buyout your own auction' }
    end

    local buyoutPriceCents = auction.buyoutPriceCents

    -- Check if player has enough money
    local cashCents, bankCents = getPlayerMoney(src)
    local totalAvailableCents = cashCents + bankCents

    if totalAvailableCents < buyoutPriceCents then
        return { success = false, error = 'Insufficient funds for buyout', requiredCents = buyoutPriceCents, availableCents = totalAvailableCents }
    end

    -- Handle previous highest bidder refund if exists
    if auction.highestBidder and auction.highestBidder.citizenid ~= playerInfo.citizenid then
        local prevBidderCitizenid = auction.highestBidder.citizenid

        -- Return funds to previous bidder (remove from escrow)
        if Escrow.funds[auctionId] and Escrow.funds[auctionId][prevBidderCitizenid] then
            local refundAmountCents = Escrow.funds[auctionId][prevBidderCitizenid]
            Escrow.funds[auctionId][prevBidderCitizenid] = nil

            -- Find the previous bidder's server ID and refund
            for _, p in ipairs(GetPlayers()) do
                local pPlayer = RSGCore.Functions.GetPlayer(tonumber(p))
                if pPlayer and pPlayer.PlayerData.citizenid == prevBidderCitizenid then
                    addPlayerMoney(tonumber(p), refundAmountCents)
                    TriggerClientEvent('auction:client:notification', tonumber(p), {
                        type = 'outbid',
                        auctionId = auctionId,
                        itemName = auction.item.label,
                        newHighBidCents = buyoutPriceCents,
                        message = 'Someone purchased the item via buyout!'
                    })
                    break
                end
            end
        end
    end

    -- Deduct buyout price from buyer
    if not removePlayerMoney(src, buyoutPriceCents) then
        return { success = false, error = 'Failed to process payment' }
    end

    -- Clear the auction timer
    if AuctionEndTimers[auctionId] then
        ClearTimeout(AuctionEndTimers[auctionId])
        AuctionEndTimers[auctionId] = nil
    end

    -- Update auction status
    auction.status = 'ended'
    auction.winner = {
        id = src,
        name = playerInfo.name,
        citizenid = playerInfo.citizenid
    }
    auction.soldForCents = buyoutPriceCents
    auction.totalBids = auction.totalBids + 1

    -- Add to bid history for record
    table.insert(BidHistory[auctionId], 1, {
        playerId = src,
        playerName = playerInfo.name,
        citizenid = playerInfo.citizenid,
        amountCents = buyoutPriceCents,
        timestamp = os.time(),
        isBuyout = true
    })

    -- Get item from escrow
    local itemData = Escrow.items[auctionId]
    local sellerCitizenid = auction.owner.citizenid

    -- Queue item for buyer to collect at auctioneer
    if itemData then
        queueItemCollection(
            playerInfo.citizenid,
            itemData.itemName,
            auction.item.label,
            itemData.count,
            itemData.metadata,
            auctionId,
            auction.item.image,
            buyoutPriceCents,
            auction.owner.name
        )

        -- Notify buyer
        TriggerClientEvent('auction:client:notification', src, {
            type = 'won',
            auctionId = auctionId,
            itemName = auction.item.label,
            count = auction.item.count,
            amountCents = buyoutPriceCents,
            isBuyout = true
        })

        -- Queue money for seller to collect at auctioneer
        queueMoneyCollection(
            sellerCitizenid,
            buyoutPriceCents,
            'auction buyout: ' .. auctionId,
            auctionId,
            auction.item.label,
            auction.owner.name
        )

        -- Notify seller
        for _, p in ipairs(GetPlayers()) do
            local pPlayer = RSGCore.Functions.GetPlayer(tonumber(p))
            if pPlayer and pPlayer.PlayerData.citizenid == sellerCitizenid then
                TriggerClientEvent('auction:client:notification', tonumber(p), {
                    type = 'sold',
                    auctionId = auctionId,
                    itemName = auction.item.label,
                    count = auction.item.count,
                    amountCents = buyoutPriceCents,
                    isBuyout = true
                })
                break
            end
        end

        Escrow.items[auctionId] = nil
    end

    -- Clear escrow funds
    Escrow.funds[auctionId] = nil

    saveAuctions()

    -- Send webhook notification
    SendWebhook('auctionBuyout', {
        auctionId = auctionId,
        itemName = auction.item.name,
        itemLabel = auction.item.label,
        count = auction.item.count,
        buyoutPriceCents = buyoutPriceCents,
        buyerName = playerInfo.name,
        sellerName = auction.owner.name,
        totalBids = auction.totalBids
    })

    -- Broadcast auction ended via buyout
    broadcastToAll('auctionEnded', {
        auctionId = auctionId,
        winner = auction.winner,
        soldForCents = buyoutPriceCents,
        status = auction.status,
        isBuyout = true
    })

    print(('[Auction] Buyout completed: %s purchased %s x%d for %s'):format(
        playerInfo.name, auction.item.label, auction.item.count, Money.format(buyoutPriceCents)
    ))

    return { success = true, auction = auction }
end

function endAuction(auctionId)
    local auction = Auctions[auctionId]
    if not auction then return end
    
    -- Clear timer
    if AuctionEndTimers[auctionId] then
        ClearTimeout(AuctionEndTimers[auctionId])
        AuctionEndTimers[auctionId] = nil
    end
    
    auction.status = 'ended'
    
    -- Determine outcome
    if auction.highestBidder then
        -- Winner found
        local winnerCitizenid = auction.highestBidder.citizenid
        local winAmountCents = auction.currentBidCents
        
        -- Transfer funds to seller (from escrow)
        local sellerCitizenid = auction.owner.citizenid
        
        -- Queue item for winner to collect at auctioneer
        local itemData = Escrow.items[auctionId]
        if itemData then
            queueItemCollection(
                winnerCitizenid,
                itemData.itemName,
                auction.item.label,
                itemData.count,
                itemData.metadata,
                auctionId,
                auction.item.image,
                winAmountCents,
                auction.owner.name
            )
            
            -- Notify winner they have items to collect
            for _, p in ipairs(GetPlayers()) do
                local pPlayer = RSGCore.Functions.GetPlayer(tonumber(p))
                if pPlayer and pPlayer.PlayerData.citizenid == winnerCitizenid then
                    TriggerClientEvent('auction:client:notification', tonumber(p), {
                        type = 'won',
                        auctionId = auctionId,
                        itemName = auction.item.label,
                        count = auction.item.count,
                        amountCents = winAmountCents
                    })
                    break
                end
            end
            
            -- Queue money for seller to collect at auctioneer
            queueMoneyCollection(
                sellerCitizenid,
                winAmountCents,
                'auction sale: ' .. auctionId,
                auctionId,
                auction.item.label,
                auction.owner.name
            )
            
            -- Notify seller they have money to collect
            for _, p in ipairs(GetPlayers()) do
                local pPlayer = RSGCore.Functions.GetPlayer(tonumber(p))
                if pPlayer and pPlayer.PlayerData.citizenid == sellerCitizenid then
                    TriggerClientEvent('auction:client:notification', tonumber(p), {
                        type = 'sold',
                        auctionId = auctionId,
                        itemName = auction.item.label,
                        count = auction.item.count,
                        amountCents = winAmountCents
                    })
                    break
                end
            end
            
            Escrow.items[auctionId] = nil
        end
        
        auction.winner = auction.highestBidder
        auction.soldForCents = winAmountCents
        
        -- Send webhook notification for won auction
        SendWebhook('auctionWon', {
            auctionId = auctionId,
            itemName = auction.item.name,
            itemLabel = auction.item.label,
            count = auction.item.count,
            finalPriceCents = winAmountCents,
            winnerName = auction.highestBidder.name,
            sellerName = auction.owner.name,
            totalBids = auction.totalBids
        })
    else
        -- No bids - return item to owner via collection
        local itemData = Escrow.items[auctionId]
        local ownerCitizenid = auction.owner.citizenid
        
        -- Send webhook notification for expired auction
        SendWebhook('auctionExpired', {
            auctionId = auctionId,
            itemName = auction.item.name,
            itemLabel = auction.item.label,
            count = auction.item.count,
            startingBidCents = auction.startingBidCents,
            sellerName = auction.owner.name
        })
        
        -- Queue item for owner to collect at auctioneer
        queueItemCollection(
            ownerCitizenid,
            itemData.itemName,
            auction.item.label,
            itemData.count,
            itemData.metadata,
            auctionId,
            auction.item.image,
            0,  -- soldForCents = 0 for expired auctions
            auction.owner.name
        )
        
        -- Notify owner their item is ready for collection
        for _, p in ipairs(GetPlayers()) do
            local pPlayer = RSGCore.Functions.GetPlayer(tonumber(p))
            if pPlayer and pPlayer.PlayerData.citizenid == ownerCitizenid then
                TriggerClientEvent('auction:client:notification', tonumber(p), {
                    type = 'expired',
                    auctionId = auctionId,
                    itemName = auction.item.label,
                    count = auction.item.count
                })
                break
            end
        end
        
        Escrow.items[auctionId] = nil
    end
    
    -- Clear escrow funds
    Escrow.funds[auctionId] = nil
    
    saveAuctions()
    
    -- Broadcast auction ended
    broadcastToAll('auctionEnded', {
        auctionId = auctionId,
        winner = auction.winner,
        soldForCents = auction.soldForCents,
        status = auction.status
    })
end

local function cancelAuction(src, auctionId)
    local playerInfo = getPlayerInfo(src)
    if not playerInfo then
        return { success = false, error = 'Player not found' }
    end
    
    local auction = Auctions[auctionId]
    if not auction then
        return { success = false, error = 'Auction not found' }
    end
    
    -- Verify ownership
    if auction.owner.citizenid ~= playerInfo.citizenid then
        return { success = false, error = 'You can only cancel your own auctions' }
    end
    
    if auction.status ~= 'active' then
        return { success = false, error = 'This auction cannot be cancelled' }
    end
    
    -- Check for bids
    if auction.totalBids > 0 then
        return { success = false, error = 'Cannot cancel auction with existing bids' }
    end
    
    -- Clear timer
    if AuctionEndTimers[auctionId] then
        ClearTimeout(AuctionEndTimers[auctionId])
        AuctionEndTimers[auctionId] = nil
    end
    
    -- Return item to owner
    local itemData = Escrow.items[auctionId]
    if itemData then
        if isHorseAuctionMetadata(itemData.metadata) then
            if not assignEscrowHorseToCitizen(auctionId, itemData.metadata.horseDbId, playerInfo.citizenid) then
                return { success = false, error = 'Failed to restore horse ownership' }
            end
        else
            addPlayerItem(src, itemData.itemName, itemData.count, itemData.metadata)
        end
        Escrow.items[auctionId] = nil
    end
    
    auction.status = 'cancelled'
    saveAuctions()
    
    -- Send webhook notification
    SendWebhook('auctionCancelled', {
        auctionId = auctionId,
        itemName = auction.item.name,
        itemLabel = auction.item.label,
        count = auction.item.count,
        startingBidCents = auction.startingBidCents,
        sellerName = playerInfo.name,
        reason = 'Cancelled by seller'
    })
    
    -- Broadcast cancellation
    broadcastToAll('auctionCancelled', { auctionId = auctionId })
    
    return { success = true }
end

-- ============================================
-- EVENTS
-- ============================================

RegisterNetEvent('auction:server:getAuctions', function()
    local src = source
    local auctionList = {}
    
    for id, auction in pairs(Auctions) do
        if auction.status == 'active' then
            table.insert(auctionList, auction)
        end
    end
    
    -- Sort by end time (ending soonest first)
    table.sort(auctionList, function(a, b)
        return a.endTime < b.endTime
    end)
    
    TriggerClientEvent('auction:client:receiveAuctions', src, {
        auctions = auctionList,
        bidHistory = BidHistory
    })
end)

-- Search auctions with pagination
RegisterNetEvent('auction:server:searchAuctions', function(params)
    local src = source
    
    -- Extract parameters with defaults
    local query = params.query or ''
    local page = tonumber(params.page) or 1
    local limit = tonumber(params.limit) or 10
    local filterOwn = params.filterOwn or false
    local citizenid = params.citizenid
    local categoryFilter = params.category or nil
    
    -- Clamp pagination values
    page = math.max(1, page)
    limit = math.min(math.max(1, limit), 50)  -- Max 50 per page
    
    -- Build filtered list
    local filteredList = {}
    local queryLower = string.lower(query)
    
    for id, auction in pairs(Auctions) do
        if auction.status == 'active' then
            local matchesSearch = true
            local matchesFilter = true
            local matchesCategory = true
            
            -- Apply search filter
            if query and #query > 0 then
                local idMatch = string.find(string.lower(auction.id), queryLower, 1, true)
                local nameMatch = string.find(string.lower(auction.item.name), queryLower, 1, true)
                local labelMatch = string.find(string.lower(auction.item.label), queryLower, 1, true)
                matchesSearch = (idMatch ~= nil) or (nameMatch ~= nil) or (labelMatch ~= nil)
            end
            
            -- Apply "my auctions" filter
            if filterOwn and citizenid then
                matchesFilter = auction.owner.citizenid == citizenid
            end
            
            -- Apply category filter
            if categoryFilter and #categoryFilter > 0 then
                matchesCategory = auction.category == categoryFilter
            end
            
            if matchesSearch and matchesFilter and matchesCategory then
                table.insert(filteredList, auction)
            end
        end
    end
    
    -- Sort by end time (ending soonest first)
    table.sort(filteredList, function(a, b)
        return a.endTime < b.endTime
    end)
    
    -- Calculate pagination
    local totalCount = #filteredList
    local totalPages = math.ceil(totalCount / limit)
    local startIndex = (page - 1) * limit + 1
    local endIndex = math.min(startIndex + limit - 1, totalCount)
    
    -- Extract page slice
    local pageResults = {}
    for i = startIndex, endIndex do
        if filteredList[i] then
            table.insert(pageResults, filteredList[i])
        end
    end
    
    TriggerClientEvent('auction:client:receiveSearchResults', src, {
        auctions = pageResults,
        bidHistory = BidHistory,
        pagination = {
            page = page,
            limit = limit,
            totalCount = totalCount,
            totalPages = totalPages,
            hasMore = page < totalPages,
            query = query
        }
    })
end)

RegisterNetEvent('auction:server:createAuction', function(data)
    local src = source
    
    -- Rate limit check
    local allowed, remaining = checkRateLimit('createAuction', src)
    if not allowed then
        TriggerClientEvent('auction:client:createResult', src, {
            success = false,
            error = ('Please wait %.1f seconds before creating another auction'):format(remaining / 1000)
        })
        return
    end
    
    -- Input validation
    if not data or type(data) ~= "table" then
        TriggerClientEvent('auction:client:createResult', src, {
            success = false,
            error = 'Invalid request data'
        })
        return
    end
    
    local result = createAuction(src, data)
    TriggerClientEvent('auction:client:createResult', src, result)
end)

RegisterNetEvent('auction:server:placeBid', function(auctionId, amount)
    local src = source
    
    -- Rate limit check
    local allowed, remaining = checkRateLimit('placeBid', src)
    if not allowed then
        TriggerClientEvent('auction:client:bidResult', src, {
            success = false,
            error = ('Please wait %.1f seconds before placing another bid'):format(remaining / 1000)
        })
        return
    end
    
    -- Input validation
    local valid, err = validateAuctionId(auctionId)
    if not valid then
        TriggerClientEvent('auction:client:bidResult', src, { success = false, error = err })
        return
    end
    
    local validAmount, amountErr = validatePositiveNumber(amount, "Bid amount")
    if not validAmount then
        TriggerClientEvent('auction:client:bidResult', src, { success = false, error = amountErr })
        return
    end
    
    -- Use mutex lock for race condition prevention
    if not lockAuction(auctionId) then
        TriggerClientEvent('auction:client:bidResult', src, {
            success = false,
            error = 'Auction is currently being processed. Please try again.'
        })
        return
    end
    
    local result = placeBid(src, auctionId, amount)
    unlockAuction(auctionId)
    TriggerClientEvent('auction:client:bidResult', src, result)
end)

RegisterNetEvent('auction:server:cancelAuction', function(auctionId)
    local src = source
    local result = cancelAuction(src, auctionId)
    TriggerClientEvent('auction:client:cancelResult', src, result)
end)

RegisterNetEvent('auction:server:buyoutAuction', function(auctionId)
    local src = source
    
    -- Rate limit check
    local allowed, remaining = checkRateLimit('buyoutAuction', src)
    if not allowed then
        TriggerClientEvent('auction:client:buyoutResult', src, {
            success = false,
            error = ('Please wait %.1f seconds before another buyout'):format(remaining / 1000)
        })
        return
    end
    
    -- Input validation
    local valid, err = validateAuctionId(auctionId)
    if not valid then
        TriggerClientEvent('auction:client:buyoutResult', src, { success = false, error = err })
        return
    end
    
    -- Use mutex lock for race condition prevention
    if not lockAuction(auctionId) then
        TriggerClientEvent('auction:client:buyoutResult', src, {
            success = false,
            error = 'Auction is currently being processed. Please try again.'
        })
        return
    end
    
    local result = buyoutAuction(src, auctionId)
    unlockAuction(auctionId)
    TriggerClientEvent('auction:client:buyoutResult', src, result)
end)

RegisterNetEvent('auction:server:getPlayerAuctions', function()
    local src = source
    local playerInfo = getPlayerInfo(src)
    if not playerInfo then return end
    
    local playerAuctions = {}
    
    for id, auction in pairs(Auctions) do
        if auction.owner.citizenid == playerInfo.citizenid then
            table.insert(playerAuctions, auction)
        end
    end
    
    TriggerClientEvent('auction:client:receivePlayerAuctions', src, { auctions = playerAuctions })
end)

-- Get current player balance
RegisterNetEvent('auction:server:getBalance', function()
    local src = source
    emitBalanceUpdate(src)
end)

-- Calculate fee preview for UI
RegisterNetEvent('auction:server:calculateFeePreview', function(data)
    local src = source
    
    -- Validate input
    local duration = tonumber(data.duration) or 3600
    local quantity = tonumber(data.quantity) or 1
    
    -- Clamp to valid ranges
    duration = math.min(math.max(duration, 60), 604800)
    quantity = math.max(1, quantity)
    
    local breakdown = getFeeBreakdown(duration, quantity)
    local playerFundsCents = 0
    
    local Player = getPlayer(src)
    if Player then
        local cashCents, bankCents = getPlayerMoney(src)
        playerFundsCents = cashCents + bankCents
    end
    
    TriggerClientEvent('auction:client:feePreview', src, {
        breakdown = breakdown,
        playerFundsCents = playerFundsCents,
        canAfford = playerFundsCents >= breakdown.totalCents
    })
end)

-- Client reports missing image
RegisterNetEvent('auction:server:reportMissingImage', function(itemName, imageUrl)
    local src = source
    logMissingImage(itemName, imageUrl, src)
end)

-- Send categories to client
RegisterNetEvent('auction:server:getCategories', function()
    local src = source
    local categories = getCategoryList()

    TriggerClientEvent('auction:client:receiveCategories', src, {
        categories = categories
    })
end)

-- ============================================
-- COLLECTION SYSTEM EVENTS
-- ============================================

-- Get pending collections for a player
RegisterNetEvent('auction:server:getPendingCollections', function()
    local src = source
    local Player = getPlayer(src)
    if not Player then return end
    
    local citizenid = Player.PlayerData.citizenid
    local collections = getPendingCollections(citizenid)
    
    TriggerClientEvent('auction:client:receivePendingCollections', src, collections)
end)

-- Collect a specific item
RegisterNetEvent('auction:server:collectItem', function(auctionId, itemName)
    local src = source
    
    -- Rate limit check
    local allowed, remaining = checkRateLimit('collectItem', src)
    if not allowed then
        TriggerClientEvent('auction:client:collectionResult', src, {
            success = false,
            error = 'Please wait before collecting again',
            type = 'item'
        })
        return
    end
    
    -- Input validation
    local validItem, itemErr = validateItemName(itemName)
    if not validItem then
        TriggerClientEvent('auction:client:collectionResult', src, {
            success = false,
            error = itemErr,
            type = 'item'
        })
        return
    end
    
    local Player = getPlayer(src)
    if not Player then 
        TriggerClientEvent('auction:client:collectionResult', src, {
            success = false,
            error = 'Player not found',
            type = 'item'
        })
        return 
    end
    
    local citizenid = Player.PlayerData.citizenid
    
    -- Verify player is near auctioneer
    if not isPlayerNearAuctioneer(src) then
        TriggerClientEvent('auction:client:collectionResult', src, {
            success = false,
            error = 'You must be near an auctioneer to collect items',
            type = 'item'
        })
        return
    end
    
    -- Get pending collections
    local collections = PendingCollections[citizenid]
    if not collections or not collections.items then
        TriggerClientEvent('auction:client:collectionResult', src, {
            success = false,
            error = 'No pending items to collect',
            type = 'item'
        })
        return
    end
    
    -- Find the specific item
    local itemIndex = nil
    local itemData = nil
    for i, item in ipairs(collections.items) do
        if item.auctionId == auctionId and item.itemName == itemName and not item.collectedAt then
            itemIndex = i
            itemData = item
            break
        end
    end
    
    if not itemData then
        TriggerClientEvent('auction:client:collectionResult', src, {
            success = false,
            error = 'Item not found or already collected',
            type = 'item'
        })
        return
    end

    if isHorseAuctionMetadata(itemData.metadata) then
        if not assignEscrowHorseToCitizen(auctionId, itemData.metadata.horseDbId, citizenid) then
            TriggerClientEvent('auction:client:collectionResult', src, {
                success = false,
                error = 'Failed to assign horse ownership',
                type = 'item'
            })
            return
        end
    else
        -- Add item to player inventory (verifies success internally)
        if not addPlayerItem(src, itemData.itemName, itemData.count, itemData.metadata) then
            TriggerClientEvent('auction:client:collectionResult', src, {
                success = false,
                error = 'Insufficient inventory space',
                type = 'item'
            })
            return
        end
    end
    
    -- Mark as collected
    collections.items[itemIndex].collectedAt = os.time()
    
    -- Clean up empty collections
    local hasRemaining = collections.money and not collections.money.collectedAt
    if not hasRemaining then
        local hasItems = false
        for _, item in ipairs(collections.items) do
            if not item.collectedAt then
                hasItems = true
                break
            end
        end
        if not hasItems then
            PendingCollections[citizenid] = nil
        end
    end
    
    saveAuctions()
    
    print(('[Auction] Item %s x%d collected by %s'):format(itemData.itemName, itemData.count, citizenid))
    
    TriggerClientEvent('auction:client:collectionResult', src, {
        success = true,
        type = 'item',
        auctionId = auctionId,
        itemName = itemData.itemName,
        itemLabel = itemData.itemLabel,
        count = itemData.count
    })
end)

-- Collect money
RegisterNetEvent('auction:server:collectMoney', function()
    local src = source
    
    -- Rate limit check
    local allowed, remaining = checkRateLimit('collectMoney', src)
    if not allowed then
        TriggerClientEvent('auction:client:collectionResult', src, {
            success = false,
            error = 'Please wait before collecting again',
            type = 'money'
        })
        return
    end
    
    local Player = getPlayer(src)
    if not Player then 
        TriggerClientEvent('auction:client:collectionResult', src, {
            success = false,
            error = 'Player not found',
            type = 'money'
        })
        return 
    end
    
    local citizenid = Player.PlayerData.citizenid
    
    -- Verify player is near auctioneer
    if not isPlayerNearAuctioneer(src) then
        TriggerClientEvent('auction:client:collectionResult', src, {
            success = false,
            error = 'You must be near an auctioneer to collect money',
            type = 'money'
        })
        return
    end
    
    -- Get pending collections
    local collections = PendingCollections[citizenid]
    if not collections or not collections.money or collections.money.collectedAt then
        TriggerClientEvent('auction:client:collectionResult', src, {
            success = false,
            error = 'No pending money to collect',
            type = 'money'
        })
        return
    end
    
    local moneyData = collections.money
    local amountCents = moneyData.amountCents or Money.dollarsToCents(moneyData.amount)
    
    -- Add money to player
    if not addPlayerMoney(src, amountCents) then
        TriggerClientEvent('auction:client:collectionResult', src, {
            success = false,
            error = 'Failed to add money',
            type = 'money'
        })
        return
    end
    
    -- Mark as collected
    collections.money.collectedAt = os.time()
    
    -- Clean up empty collections
    local hasItems = false
    for _, item in ipairs(collections.items) do
        if not item.collectedAt then
            hasItems = true
            break
        end
    end
    if not hasItems then
        PendingCollections[citizenid] = nil
    end
    
    saveAuctions()
    
    print(('[Auction] Money %s collected by %s'):format(Money.format(amountCents), citizenid))
    
    TriggerClientEvent('auction:client:collectionResult', src, {
        success = true,
        type = 'money',
        amountCents = amountCents
    })
end)

-- ============================================
-- NPC INTERACTION VALIDATION
-- ============================================

RegisterNetEvent('auction:server:validateNPCInteraction', function(data)
    local src = source
    
    -- Validate player exists
    local playerInfo = getPlayerInfo(src)
    if not playerInfo then
        print(('[Auction NPC] Validation failed: Player not found (source: %s)'):format(src))
        return
    end
    
    -- Validate NPC index is configured
    local npcIndex = data and data.npcIndex
    if not npcIndex or not Config.AuctioneerNPCs or not Config.AuctioneerNPCs[npcIndex] then
        print(('[Auction NPC] Validation failed: Invalid NPC index %s from player %s'):format(
            tostring(npcIndex), playerInfo.name
        ))
        return
    end
    
    local npcConfig = Config.AuctioneerNPCs[npcIndex]
    
    if Config.Debug then
        print(('[Auction NPC] Validated interaction: %s (%s) with %s'):format(
            playerInfo.name, playerInfo.citizenid, npcConfig.name or 'NPC'
        ))
    end
    
    -- Validation passed - tell client to open UI
    TriggerClientEvent('auction:client:openFromNPC', src, npcIndex)
end)

-- ============================================
-- CLEANUP
-- ============================================

-- Cleanup on resource stop
AddEventHandler('onResourceStop', function(resourceName)
    if GetCurrentResourceName() == resourceName then
        saveAuctions()
        print('[Auction System] Saved auctions to storage')
    end
end)

-- ============================================
-- PLAYER LOADED - NOTIFY PENDING COLLECTIONS
-- ============================================

-- RSGCore player loaded event
AddEventHandler('RSGCore:Server:PlayerLoaded', function(Player)
    if not Player then return end
    local src = Player.PlayerData.source
    local citizenid = Player.PlayerData.citizenid
    
    -- Check for pending collections and notify
    SetTimeout(1000, function()
        local collections = PendingCollections[citizenid]
        if collections then
            local itemCount = 0
            local hasMoney = collections.money and not collections.money.collectedAt
            
            for _, item in ipairs(collections.items or {}) do
                if not item.collectedAt then
                    itemCount = itemCount + 1
                end
            end
            
            if itemCount > 0 or hasMoney then
                local message = 'You have '
                if itemCount > 0 then
                    message = message .. itemCount .. ' item(s)'
                end
                if hasMoney then
                    if itemCount > 0 then
                        message = message .. ' and '
                    end
                    local moneyAmountCents = collections.money.amountCents or Money.dollarsToCents(collections.money.amount)
                    message = message .. Money.format(moneyAmountCents) .. ' in sales'
                end
                message = message .. ' to collect at the auctioneer!'
                
                TriggerClientEvent('auction:client:notification', src, {
                    type = 'info',
                    message = message
                })
            end
        end
    end)
end)

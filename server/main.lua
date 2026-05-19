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
    return 'nui://rsg-inventory/html/images/' .. itemName .. '.png'
end

-- Build image metadata for client (includes fallback info)
local function buildImageMetadata(itemName)
    return {
        url = getItemImage(itemName),
        itemName = itemName,
        fallbackUrl = 'nui://' .. GetCurrentResourceName() .. '/web/dist/fallback.svg',
        loaded = false
    }
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
                if auction.item and not auction.item.image then
                    auction.item.image = getItemImage(auction.item.name)
                end
                -- Backfill image metadata for existing auctions
                if auction.item and not auction.item.imageMeta then
                    auction.item.imageMeta = buildImageMetadata(auction.item.name)
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
    return true
end

local function addPlayerItem(src, itemName, count, metadata)
    local Player = getPlayer(src)
    if not Player then return false end

    -- Get current count before adding
    local currentSlot = Player.Functions.GetItemByName(itemName)
    local countBefore = currentSlot and currentSlot.amount or 0

    Player.Functions.AddItem(itemName, count, false, metadata)

    -- Verify item was added (RSGCore doesn't return success, so we check after)
    local slotAfter = Player.Functions.GetItemByName(itemName)
    local countAfter = slotAfter and slotAfter.amount or 0

    return countAfter >= countBefore + count
end

local function getPlayerMoney(src)
    local Player = getPlayer(src)
    if not Player then return 0, 0 end
    
    local money = Player.PlayerData.money
    return money['cash'] or 0, money['bank'] or 0
end

-- Emit balance update to client for NUI sync
local function emitBalanceUpdate(src)
    local cash, bank = getPlayerMoney(src)
    TriggerClientEvent('auction:client:balanceUpdated', src, {
        cash = cash,
        bank = bank
    })
end

local function removePlayerMoney(src, amount, silent)
    local Player = getPlayer(src)
    if not Player then return false end
    
    local cash, bank = getPlayerMoney(src)
    if cash >= amount then
        Player.Functions.RemoveMoney('cash', amount)
        if not silent then emitBalanceUpdate(src) end
        return true
    elseif cash + bank >= amount then
        Player.Functions.RemoveMoney('cash', cash)
        Player.Functions.RemoveMoney('bank', amount - cash)
        if not silent then emitBalanceUpdate(src) end
        return true
    end
    return false
end

local function addPlayerMoney(src, amount, silent)
    local Player = getPlayer(src)
    if not Player then return false end
    
    Player.Functions.AddMoney('bank', amount)
    if not silent then emitBalanceUpdate(src) end
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

-- Resolve item category from config patterns or explicit lists
-- Categories are checked in order defined in Config.Categories for deterministic results
local function resolveItemCategory(itemName)
    if not itemName then return nil end
    local itemNameLower = string.lower(itemName)

    -- Check explicit category items first
    if Config.Categories then
        for _, category in ipairs(Config.Categories) do
            if category.items and #category.items > 0 then
                for _, catItem in ipairs(category.items) do
                    if catItem == itemName then
                        return category.id
                    end
                end
            end
        end
    end

    -- Fall back to pattern matching (iterate in category order for priority)
    if Config.Categories and Config.CategoryPatterns then
        for _, category in ipairs(Config.Categories) do
            local catId = category.id
            local patterns = Config.CategoryPatterns[catId]
            if patterns then
                for _, pattern in ipairs(patterns) do
                    if string.find(itemNameLower, pattern, 1, true) then
                        return catId
                    end
                end
            end
        end
    end

    return 'other'
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
local function calculateCreationFee(durationSeconds, quantity)
    local feeConfig = Config.CreationFee
    
    -- If fees disabled, return 0
    if not feeConfig or not feeConfig.enabled then
        return 0
    end
    
    local baseFee = feeConfig.baseFee or 5
    local durationMultiplier = feeConfig.durationMultiplier or 2
    local quantityMultiplier = feeConfig.quantityMultiplier or 0.5
    local maxFee = feeConfig.maxFee or 500
    local minFee = feeConfig.minFee or 5
    
    -- Convert duration to hours
    local durationHours = durationSeconds / 3600
    
    -- Calculate fee components
    local durationFee = durationMultiplier * durationHours
    local quantityFee = quantityMultiplier * quantity
    
    -- Total fee
    local totalFee = baseFee + durationFee + quantityFee
    
    -- Apply min/max caps
    totalFee = math.max(minFee, math.min(maxFee, totalFee))
    
    -- Round to whole number
    return math.floor(totalFee)
end

-- Get fee breakdown for UI preview
local function getFeeBreakdown(durationSeconds, quantity)
    local feeConfig = Config.CreationFee
    
    if not feeConfig or not feeConfig.enabled then
        return {
            enabled = false,
            total = 0,
            baseFee = 0,
            durationFee = 0,
            quantityFee = 0
        }
    end
    
    local baseFee = feeConfig.baseFee or 5
    local durationMultiplier = feeConfig.durationMultiplier or 2
    local quantityMultiplier = feeConfig.quantityMultiplier or 0.5
    local maxFee = feeConfig.maxFee or 500
    local minFee = feeConfig.minFee or 5
    
    local durationHours = durationSeconds / 3600
    local durationFee = durationMultiplier * durationHours
    local quantityFee = quantityMultiplier * quantity
    local totalFee = baseFee + durationFee + quantityFee
    
    -- Apply caps for display
    local cappedFee = math.max(minFee, math.min(maxFee, totalFee))
    local wasCapped = totalFee > maxFee
    
    return {
        enabled = true,
        baseFee = baseFee,
        durationFee = math.floor(durationFee * 100) / 100,
        quantityFee = math.floor(quantityFee * 100) / 100,
        total = math.floor(cappedFee),
        maxFee = maxFee,
        minFee = minFee,
        wasCapped = wasCapped
    }
end

-- ============================================
-- PENDING COLLECTION SYSTEM
-- ============================================

-- Queue money for collection at auctioneer (for sellers)
local function queueMoneyCollection(citizenid, amount, reason, auctionId, itemName, sellerName)
    if not PendingCollections[citizenid] then
        PendingCollections[citizenid] = { money = nil, items = {} }
    end
    PendingCollections[citizenid].money = {
        amount = amount,
        reason = reason or 'auction sale',
        auctionId = auctionId,
        itemName = itemName,
        collectedAt = nil
    }
    print(('[Auction] Queued $%d money collection for %s (%s)'):format(amount, citizenid, reason or 'unknown'))
    saveAuctions()
end

-- Queue item for collection at auctioneer (for winners)
local function queueItemCollection(citizenid, itemName, itemLabel, count, metadata, auctionId, image, soldFor, sellerName)
    if not PendingCollections[citizenid] then
        PendingCollections[citizenid] = { money = nil, items = {} }
    end
    table.insert(PendingCollections[citizenid].items, {
        itemName = itemName,
        itemLabel = itemLabel or itemName,
        count = count,
        metadata = metadata,
        auctionId = auctionId,
        image = image,
        imageMeta = buildImageMetadata(itemName),
        soldFor = soldFor,
        sellerName = sellerName,
        collectedAt = nil
    })
    print(('[Auction] Queued item %s x%d for collection by %s'):format(itemName, count, citizenid))
    saveAuctions()
end

-- Get pending collections for a player
local function getPendingCollections(citizenid)
    local collections = PendingCollections[citizenid]
    if not collections then
        return { money = nil, items = {} }
    end
    
    -- Filter out already collected items
    local pendingItems = {}
    for _, item in ipairs(collections.items) do
        if not item.collectedAt then
            table.insert(pendingItems, item)
        end
    end
    
    local pendingMoney = collections.money and not collections.money.collectedAt and collections.money or nil
    
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
    
    -- Validate category selection
    local resolvedCategory = itemData.category or resolveItemCategory(itemData.itemName)
    if not isValidCategory(resolvedCategory) then
        resolvedCategory = resolveItemCategory(itemData.itemName)
    end
    
    -- Check for duplicate auction (same owner + same item)
    local existingAuction = hasActiveAuctionForItem(playerInfo.citizenid, itemData.itemName)
    if existingAuction then
        print(('[Auction] Duplicate rejected: %s (%s) already has active auction %s for item %s'):format(
            playerInfo.name, playerInfo.citizenid, existingAuction.id, itemData.itemName
        ))
        return { success = false, error = 'You already have an active auction for this item', existingAuctionId = existingAuction.id }
    end
    
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
    
    -- Validate auction parameters
    if itemData.startingBid < 1 then
        return { success = false, error = 'Starting bid must be at least $1' }
    end
    
    local minDuration = 60       -- 1 minute minimum for testing
    local maxDuration = 604800   -- 7 days maximum
    local duration = math.min(math.max(itemData.duration or 3600, minDuration), maxDuration)
    
    -- Calculate and validate creation fee
    local creationFee = calculateCreationFee(duration, itemData.count or 1)
    
    if Config.CreationFee and Config.CreationFee.enabled and creationFee > 0 then
        -- Check if player has enough money for fee
        local cash, bank = getPlayerMoney(src)
        local totalAvailable = cash + bank
        
        if totalAvailable < creationFee then
            print(('[Auction] Insufficient funds for fee: %s (%s) needs $%d, has $%d'):format(
                playerInfo.name, playerInfo.citizenid, creationFee, totalAvailable
            ))
            return { 
                success = false, 
                error = ('Insufficient funds for creation fee: $%d required'):format(creationFee),
                fee = creationFee,
                playerFunds = totalAvailable
            }
        end
        
        -- Deduct fee
        if not removePlayerMoney(src, creationFee) then
            print(('[Auction] Failed to deduct fee from %s (%s)'):format(
                playerInfo.name, playerInfo.citizenid
            ))
            return { success = false, error = 'Failed to process creation fee' }
        end
        
        print(('[Auction] Deducted $%d creation fee from %s (%s)'):format(
            creationFee, playerInfo.name, playerInfo.citizenid
        ))
    end
    
    -- Remove item from inventory (escrow)
    if not removePlayerItem(src, itemData.itemName, itemData.count) then
        -- Refund fee if item removal fails
        if creationFee > 0 then
            addPlayerMoney(src, creationFee)
        end
        return { success = false, error = 'Failed to remove item from inventory' }
    end
    
    local auctionId = generateAuctionId()
    local now = os.time()
    
    -- Use client-provided image or generate from item name
    local imageUrl = itemData.image or getItemImage(itemData.itemName)
    
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
            count = itemData.count,
            metadata = itemData.metadata or {},
            image = imageUrl,
            imageMeta = buildImageMetadata(itemData.itemName)
        },
        category = resolvedCategory,
        startingBid = itemData.startingBid,
        currentBid = 0,
        highestBidder = nil,
        endTime = now + duration,
        createdAt = now,
        status = 'active',
        totalBids = 0,
        creationFee = creationFee
    }
    
    Auctions[auctionId] = auction
    Escrow.items[auctionId] = {
        itemName = itemData.itemName,
        count = itemData.count,
        metadata = itemData.metadata or {},
        owner = src,
        ownerCitizenid = playerInfo.citizenid
    }
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
        startingBid = auction.startingBid,
        sellerName = playerInfo.name,
        duration = duration,
        creationFee = creationFee
    })
    
    -- Broadcast new auction to all players
    broadcastToAll('auctionCreated', auction)
    
    return { success = true, auction = auction, creationFee = creationFee }
end

local function placeBid(src, auctionId, bidAmount)
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
    
    -- Validate bid amount
    local minBid = auction.currentBid > 0 and auction.currentBid * 1.05 or auction.startingBid
    minBid = math.floor(minBid)
    
    if bidAmount < minBid then
        return { success = false, error = 'Minimum bid is $' .. minBid, minBid = minBid }
    end
    
    -- Check if player has enough money
    local cash, bank = getPlayerMoney(src)
    local totalAvailable = cash + bank
    
    -- Check how much is already in escrow for this auction
    local previousBid = 0
    if Escrow.funds[auctionId] and Escrow.funds[auctionId][playerInfo.citizenid] then
        previousBid = Escrow.funds[auctionId][playerInfo.citizenid]
    end
    
    local additionalFundsNeeded = bidAmount - previousBid
    
    if totalAvailable < additionalFundsNeeded then
        return { success = false, error = 'Insufficient funds', minBid = minBid }
    end
    
    -- Handle previous highest bidder refund
    if auction.highestBidder and auction.highestBidder.citizenid ~= playerInfo.citizenid then
        -- Notify previous bidder they were outbid
        local prevBidder = auction.highestBidder.id
        local prevBidderCitizenid = auction.highestBidder.citizenid
        
        -- Return funds to previous bidder (remove from escrow)
        if Escrow.funds[auctionId] and Escrow.funds[auctionId][prevBidderCitizenid] then
            local refundAmount = Escrow.funds[auctionId][prevBidderCitizenid]
            Escrow.funds[auctionId][prevBidderCitizenid] = nil
            
            -- Find the previous bidder's server ID
            for _, p in ipairs(GetPlayers()) do
                local pPlayer = RSGCore.Functions.GetPlayer(tonumber(p))
                if pPlayer and pPlayer.PlayerData.citizenid == prevBidderCitizenid then
                    addPlayerMoney(tonumber(p), refundAmount)
                    TriggerClientEvent('auction:client:notification', tonumber(p), {
                        type = 'outbid',
                        auctionId = auctionId,
                        itemName = auction.item.label,
                        newHighBid = bidAmount
                    })
                    break
                end
            end
        end
    end
    
    -- Remove additional funds from player
    if additionalFundsNeeded > 0 then
        if not removePlayerMoney(src, additionalFundsNeeded) then
            return { success = false, error = 'Failed to process payment' }
        end
    end
    
    -- Add to escrow
    if not Escrow.funds[auctionId] then
        Escrow.funds[auctionId] = {}
    end
    Escrow.funds[auctionId][playerInfo.citizenid] = bidAmount
    
    -- Update auction
    local previousHighest = auction.highestBidder
    auction.currentBid = bidAmount
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
        amount = bidAmount,
        timestamp = os.time()
    })
    
    saveAuctions()
    
    -- Send webhook notification
    SendWebhook('bidPlaced', {
        auctionId = auctionId,
        itemLabel = auction.item.label,
        bidAmount = bidAmount,
        previousBid = previousBid,
        bidderName = playerInfo.name,
        totalBids = auction.totalBids
    })
    
    -- Broadcast bid update
    broadcastToAll('bidPlaced', {
        auctionId = auctionId,
        currentBid = bidAmount,
        highestBidder = {
            name = playerInfo.name,
            citizenid = playerInfo.citizenid
        },
        totalBids = auction.totalBids,
        bidHistory = BidHistory[auctionId]
    })
    
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
        local winAmount = auction.currentBid
        
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
                winAmount,
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
                        amount = winAmount
                    })
                    break
                end
            end
            
            -- Queue money for seller to collect at auctioneer
            queueMoneyCollection(
                sellerCitizenid,
                winAmount,
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
                        amount = winAmount
                    })
                    break
                end
            end
            
            Escrow.items[auctionId] = nil
        end
        
        auction.winner = auction.highestBidder
        auction.soldFor = winAmount
        
        -- Send webhook notification for won auction
        SendWebhook('auctionWon', {
            auctionId = auctionId,
            itemName = auction.item.name,
            itemLabel = auction.item.label,
            count = auction.item.count,
            finalPrice = winAmount,
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
            startingBid = auction.startingBid,
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
            0,  -- soldFor = 0 for expired auctions
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
        soldFor = auction.soldFor,
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
        addPlayerItem(src, itemData.itemName, itemData.count, itemData.metadata)
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
        startingBid = auction.startingBid,
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
    local result = createAuction(src, data)
    TriggerClientEvent('auction:client:createResult', src, result)
end)

RegisterNetEvent('auction:server:placeBid', function(auctionId, amount)
    local src = source
    local result = placeBid(src, auctionId, amount)
    TriggerClientEvent('auction:client:bidResult', src, result)
end)

RegisterNetEvent('auction:server:cancelAuction', function(auctionId)
    local src = source
    local result = cancelAuction(src, auctionId)
    TriggerClientEvent('auction:client:cancelResult', src, result)
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
    local playerFunds = 0
    
    local Player = getPlayer(src)
    if Player then
        local money = Player.PlayerData.money
        playerFunds = (money['cash'] or 0) + (money['bank'] or 0)
    end
    
    TriggerClientEvent('auction:client:feePreview', src, {
        breakdown = breakdown,
        playerFunds = playerFunds,
        canAfford = playerFunds >= breakdown.total
    })
end)

-- Client reports missing image
RegisterNetEvent('auction:server:reportMissingImage', function(itemName, imageUrl)
    local src = source
    logMissingImage(itemName, imageUrl, src)
end)

-- Send categories and resolved item categories to client
RegisterNetEvent('auction:server:getCategories', function()
    local src = source
    local categories = getCategoryList()

    -- Resolve category for each item in player inventory
    local Player = getPlayer(src)
    local itemCategories = {}
    if Player then
        local inventory = Player.PlayerData.items
        if inventory then
            for _, item in pairs(inventory) do
                if item and item.amount > 0 then
                    itemCategories[item.name] = resolveItemCategory(item.name)
                end
            end
        end
    end

    TriggerClientEvent('auction:client:receiveCategories', src, {
        categories = categories,
        itemCategories = itemCategories
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

    -- Add item to player inventory (verifies success internally)
    if not addPlayerItem(src, itemData.itemName, itemData.count, itemData.metadata) then
        TriggerClientEvent('auction:client:collectionResult', src, {
            success = false,
            error = 'Insufficient inventory space',
            type = 'item'
        })
        return
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
        itemName = itemData.itemName,
        itemLabel = itemData.itemLabel,
        count = itemData.count
    })
end)

-- Collect money
RegisterNetEvent('auction:server:collectMoney', function()
    local src = source
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
    local amount = moneyData.amount
    
    -- Add money to player
    if not addPlayerMoney(src, amount) then
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
    
    print(('[Auction] Money $%d collected by %s'):format(amount, citizenid))
    
    TriggerClientEvent('auction:client:collectionResult', src, {
        success = true,
        type = 'money',
        amount = amount
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
    TriggerClientEvent('auction:client:openFromNPC', src)
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
                    message = message .. '$' .. collections.money.amount .. ' in sales'
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

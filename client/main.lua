local RSGCore = exports['rsg-core']:GetCoreObject()
-- Auction System Client
-- Handles NUI control, inventory checks, and server communication

NUI = {}
local isOpen = false
local playerInventory = {}

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

-- Generate image URL from item name
local function getItemImage(itemName)
    if not itemName then return nil end
    return 'nui://rsg-inventory/html/images/' .. itemName .. '.png'
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

-- Report missing image to server
local function reportMissingImage(itemName, imageUrl)
    if ImageCache.failed[imageUrl] then return end -- Already reported
    
    ImageCache.failed[imageUrl] = true
    TriggerServerEvent('auction:server:reportMissingImage', itemName, imageUrl)
    print(('[Auction] Image not found: %s (%s)'):format(itemName, imageUrl))
end

local function refreshInventory()
    local items = {}
    
    if not RSGCore then return items end
    
    -- RSG Framework inventory
    local PlayerData = RSGCore.Functions.GetPlayerData()
    local inventory = PlayerData.items
    
    if inventory then
        for slot, item in pairs(inventory) do
            if item and item.amount > 0 then
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

-- ============================================
-- NUI HELPERS
-- ============================================

function NUI.SendMessage(action, data)
    SendNuiMessage(json.encode({ action = action, data = data or {} }))
end

function NUI.Open(data)
    if isOpen then return end
    if not RSGCore then 
        lib.notify({ title = 'Error', description = 'RSGCore not loaded yet', type = 'error' })
        return 
    end
    
    isOpen = true
    
    -- Refresh inventory before opening
    local inventory = refreshInventory()
    local PlayerData = RSGCore.Functions.GetPlayerData()
    local cash, bank = 0, 0
    
    if PlayerData.money then
        cash = PlayerData.money['cash'] or 0
        bank = PlayerData.money['bank'] or 0
    end
    
    -- Get fee configuration
    local feeConfig = Config.CreationFee or {}
    
    SetNuiFocus(true, true)
    NUI.SendMessage('open', {
        inventory = inventory,
        cash = cash,
        bank = bank,
        citizenid = PlayerData.citizenid,
        playerName = PlayerData.charinfo and (PlayerData.charinfo.firstname .. ' ' .. PlayerData.charinfo.lastname) or 'Unknown',
        feeConfig = feeConfig
    })
    
    -- Request current auctions
    TriggerServerEvent('auction:server:getAuctions')
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
    
    -- Forward to server
    TriggerServerEvent('auction:server:createAuction', {
        itemName = data.itemName,
        itemLabel = item.label,
        count = data.count or 1,
        metadata = item.metadata,
        image = item.image,
        startingBid = data.startingBid or 1,
        duration = data.duration or 3600
    })
    
    cb({ success = true, message = 'Creating auction...' })
end)

RegisterNuiCallback('placeBid', function(data, cb)
    if not data.auctionId or not data.amount then
        cb({ success = false, error = 'Invalid bid data' })
        return
    end
    
    TriggerServerEvent('auction:server:placeBid', data.auctionId, data.amount)
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

RegisterNuiCallback('getInventory', function(_, cb)
    local inventory = refreshInventory()
    cb({ success = true, inventory = inventory })
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
    NUI.SendMessage('receiveAuctions', data)
end)

RegisterNetEvent('auction:client:createResult', function(result)
    if not isOpen then return end
    NUI.SendMessage('createResult', result)
    
    if result.success then
        -- Refresh inventory
        refreshInventory()
        NUI.SendMessage('inventoryUpdated', { inventory = playerInventory })
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
        -- Refresh inventory
        refreshInventory()
        NUI.SendMessage('inventoryUpdated', { inventory = playerInventory })
    end
end)

RegisterNetEvent('auction:client:notification', function(data)
    -- Show notification even if UI is closed
    NUI.SendMessage('notification', data)
    
    -- Also show in-game notification
    if data.type == 'outbid' then
        lib.notify({
            title = 'Auction',
            description = ('You were outbid on %s! New high bid: $%d'):format(data.itemName, data.newHighBid),
            type = 'warning'
        })
    elseif data.type == 'won' then
        lib.notify({
            title = 'Auction Won!',
            description = ('You won %s x%d for $%d!'):format(data.itemName, data.count, data.amount),
            type = 'success'
        })
    elseif data.type == 'sold' then
        lib.notify({
            title = 'Auction Sold!',
            description = ('Your %s x%d sold for $%d!'):format(data.itemName, data.count, data.amount),
            type = 'success'
        })
    elseif data.type == 'expired' then
        lib.notify({
            title = 'Auction Expired',
            description = ('Your %s x%d auction expired with no bids. Item returned.'):format(data.itemName, data.count),
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

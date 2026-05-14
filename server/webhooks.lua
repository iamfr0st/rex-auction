-- Discord Webhook System
-- Handles HTTP POST to Discord webhooks with retry logic and formatted embeds

local WebhookConfig = {
    -- Default webhook URL (can be overridden per event type)
    defaultUrl = nil,
    
    -- Event-specific webhook URLs
    urls = {
        auctionCreated = nil,
        bidPlaced = nil,
        auctionWon = nil,
        auctionExpired = nil,
        auctionCancelled = nil,
        highValueSale = nil,  -- Optional: for high-value transactions
    },
    
    -- Event toggles
    enabled = {
        auctionCreated = true,
        bidPlaced = false,    -- Off by default (can be spammy)
        auctionWon = true,
        auctionExpired = true,
        auctionCancelled = true,
        highValueSale = true,
    },
    
    -- High value threshold (triggers highValueSale webhook)
    highValueThreshold = 1000,
    
    -- Retry settings
    maxRetries = 3,
    retryDelay = 1000,  -- ms between retries
    
    -- Bot appearance
    botName = 'Auction House',
    botAvatar = 'https://i.imgur.com/example.png',  -- Replace with your avatar URL
}

-- Webhook queue for retry handling
local WebhookQueue = {}

-- ============================================
-- UTILITY FUNCTIONS
-- ============================================

local function getWebhookUrl(eventType)
    -- Check event-specific URL first
    if WebhookConfig.urls[eventType] then
        return WebhookConfig.urls[eventType]
    end
    -- Fall back to default URL
    return WebhookConfig.defaultUrl
end

local function isWebhookEnabled(eventType)
    return WebhookConfig.enabled[eventType] == true and getWebhookUrl(eventType) ~= nil
end

-- Format timestamp for Discord
local function formatTimestamp(timestamp)
    return os.date('!%Y-%m-%dT%H:%M:%S.000Z', timestamp or os.time())
end

-- Format currency
local function formatMoney(amount)
    return '$' .. tostring(amount):reverse():gsub('%d%d%d', '%1,'):reverse():gsub('^,', '')
end

-- ============================================
-- EMBED BUILDERS
-- ============================================

local EmbedBuilders = {}

function EmbedBuilders.auctionCreated(data)
    return {
        title = 'New Auction Created',
        color = 3447003,  -- Blue
        fields = {
            { name = 'Item', value = string.format('%s x%d', data.itemLabel or data.itemName, data.count or 1), inline = true },
            { name = 'Starting Bid', value = formatMoney(data.startingBid), inline = true },
            { name = 'Seller', value = data.sellerName or 'Unknown', inline = true },
            { name = 'Duration', value = string.format('%d minutes', math.floor((data.duration or 3600) / 60)), inline = true },
            { name = 'Auction ID', value = data.auctionId or 'N/A', inline = true },
        },
        footer = { text = 'Auction House', icon_url = WebhookConfig.botAvatar },
        timestamp = formatTimestamp(),
    }
end

function EmbedBuilders.bidPlaced(data)
    return {
        title = 'Bid Placed',
        color = 16776960,  -- Yellow
        fields = {
            { name = 'Item', value = data.itemLabel or 'Unknown Item', inline = true },
            { name = 'Bid Amount', value = formatMoney(data.bidAmount), inline = true },
            { name = 'Bidder', value = data.bidderName or 'Unknown', inline = true },
            { name = 'Previous Bid', value = data.previousBid and formatMoney(data.previousBid) or 'N/A', inline = true },
            { name = 'Total Bids', value = tostring(data.totalBids or 1), inline = true },
        },
        footer = { text = 'Auction House', icon_url = WebhookConfig.botAvatar },
        timestamp = formatTimestamp(),
    }
end

function EmbedBuilders.auctionWon(data)
    return {
        title = 'Auction Won!',
        color = 3066993,  -- Green
        fields = {
            { name = 'Item', value = string.format('%s x%d', data.itemLabel or data.itemName, data.count or 1), inline = true },
            { name = 'Final Price', value = formatMoney(data.finalPrice), inline = true },
            { name = 'Winner', value = data.winnerName or 'Unknown', inline = true },
            { name = 'Seller', value = data.sellerName or 'Unknown', inline = true },
            { name = 'Total Bids', value = tostring(data.totalBids or 0), inline = true },
        },
        footer = { text = 'Auction House', icon_url = WebhookConfig.botAvatar },
        timestamp = formatTimestamp(),
    }
end

function EmbedBuilders.auctionExpired(data)
    return {
        title = 'Auction Expired',
        color = 15158332,  -- Red
        fields = {
            { name = 'Item', value = string.format('%s x%d', data.itemLabel or data.itemName, data.count or 1), inline = true },
            { name = 'Starting Bid', value = formatMoney(data.startingBid), inline = true },
            { name = 'Seller', value = data.sellerName or 'Unknown', inline = true },
            { name = 'Reason', value = 'No bids placed', inline = false },
        },
        footer = { text = 'Auction House', icon_url = WebhookConfig.botAvatar },
        timestamp = formatTimestamp(),
    }
end

function EmbedBuilders.auctionCancelled(data)
    return {
        title = 'Auction Cancelled',
        color = 10038562,  -- Dark Red
        fields = {
            { name = 'Item', value = string.format('%s x%d', data.itemLabel or data.itemName, data.count or 1), inline = true },
            { name = 'Starting Bid', value = formatMoney(data.startingBid), inline = true },
            { name = 'Seller', value = data.sellerName or 'Unknown', inline = true },
            { name = 'Reason', value = data.reason or 'Cancelled by seller', inline = false },
        },
        footer = { text = 'Auction House', icon_url = WebhookConfig.botAvatar },
        timestamp = formatTimestamp(),
    }
end

function EmbedBuilders.highValueSale(data)
    return {
        title = 'High Value Sale!',
        color = 15844367,  -- Gold
        fields = {
            { name = 'Item', value = string.format('%s x%d', data.itemLabel or data.itemName, data.count or 1), inline = true },
            { name = 'Final Price', value = formatMoney(data.finalPrice), inline = true },
            { name = 'Winner', value = data.winnerName or 'Unknown', inline = true },
            { name = 'Seller', value = data.sellerName or 'Unknown', inline = true },
        },
        footer = { text = 'Auction House - High Value Alert', icon_url = WebhookConfig.botAvatar },
        timestamp = formatTimestamp(),
    }
end

-- ============================================
-- HTTP REQUEST
-- ============================================

local function sendWebhookRequest(url, payload, retryCount)
    retryCount = retryCount or 0
    
    PerformHttpRequest(url, function(errorCode, resultData, resultHeaders)
        if errorCode >= 200 and errorCode < 300 then
            if Config and Config.Debug then
                print('[Webhook] Successfully sent webhook')
            end
        else
            local errorMsg = string.format('HTTP %d: %s', errorCode, resultData or 'Unknown error')
            print('[Webhook] Failed to send: ' .. errorMsg)
            
            -- Retry logic
            if retryCount < WebhookConfig.maxRetries then
                print(string.format('[Webhook] Retrying (%d/%d)...', retryCount + 1, WebhookConfig.maxRetries))
                SetTimeout(WebhookConfig.retryDelay, function()
                    sendWebhookRequest(url, payload, retryCount + 1)
                end)
            else
                print('[Webhook] Max retries reached, giving up')
                -- Log to file for later review
                local logEntry = string.format('[%s] FAILED WEBHOOK: %s\n', os.date('%Y-%m-%d %H:%M:%S'), errorMsg)
                SaveResourceFile(GetCurrentResourceName(), 'webhook_errors.log', logEntry, -1)
            end
        end
    end, 'POST', json.encode(payload), {
        ['Content-Type'] = 'application/json'
    })
end

-- ============================================
-- PUBLIC API
-- ============================================

function SendWebhook(eventType, data)
    -- Check if webhook is enabled for this event type
    if not isWebhookEnabled(eventType) then
        if Config and Config.Debug then
            print(string.format('[Webhook] Event type "%s" is disabled or has no URL configured', eventType))
        end
        return false
    end
    
    -- Get webhook URL
    local url = getWebhookUrl(eventType)
    if not url then
        print('[Webhook] No URL configured for event type: ' .. eventType)
        return false
    end
    
    -- Build embed
    local builder = EmbedBuilders[eventType]
    if not builder then
        print('[Webhook] No embed builder for event type: ' .. eventType)
        return false
    end
    
    local embed = builder(data)
    if not embed then
        print('[Webhook] Failed to build embed for event type: ' .. eventType)
        return false
    end
    
    -- Construct payload
    local payload = {
        username = WebhookConfig.botName,
        avatar_url = WebhookConfig.botAvatar,
        embeds = { embed }
    }
    
    -- Send webhook
    sendWebhookRequest(url, payload)
    
    -- Check for high value sale
    if eventType == 'auctionWon' and data.finalPrice and data.finalPrice >= WebhookConfig.highValueThreshold then
        if isWebhookEnabled('highValueSale') then
            local highValueUrl = getWebhookUrl('highValueSale')
            if highValueUrl then
                sendWebhookRequest(highValueUrl, {
                    username = WebhookConfig.botName,
                    avatar_url = WebhookConfig.botAvatar,
                    embeds = { EmbedBuilders.highValueSale(data) }
                })
            end
        end
    end
    
    return true
end

-- Configure webhook URL at runtime
function SetWebhookUrl(eventType, url)
    if eventType == 'default' then
        WebhookConfig.defaultUrl = url
    elseif WebhookConfig.urls[eventType] then
        WebhookConfig.urls[eventType] = url
    else
        return false, 'Invalid event type'
    end
    return true
end

-- Get current webhook configuration
function GetWebhookConfig()
    return {
        defaultUrl = WebhookConfig.defaultUrl,
        urls = WebhookConfig.urls,
        enabled = WebhookConfig.enabled,
        highValueThreshold = WebhookConfig.highValueThreshold,
    }
end

-- Toggle webhook for event type
function ToggleWebhook(eventType, enabled)
    if WebhookConfig.enabled[eventType] ~= nil then
        WebhookConfig.enabled[eventType] = enabled
        return true
    end
    return false, 'Invalid event type'
end

-- Set high value threshold
function SetHighValueThreshold(amount)
    if type(amount) == 'number' and amount >= 0 then
        WebhookConfig.highValueThreshold = amount
        return true
    end
    return false, 'Invalid threshold value'
end

-- ============================================
-- CONFIG LOADING
-- ============================================

-- Load webhook config from main Config if available
function LoadWebhookConfig()
    if Config and Config.Webhooks then
        if Config.Webhooks.defaultUrl then
            WebhookConfig.defaultUrl = Config.Webhooks.defaultUrl
        end
        
        if Config.Webhooks.urls then
            for eventType, url in pairs(Config.Webhooks.urls) do
                if WebhookConfig.urls[eventType] then
                    WebhookConfig.urls[eventType] = url
                end
            end
        end
        
        if Config.Webhooks.enabled then
            for eventType, enabled in pairs(Config.Webhooks.enabled) do
                if WebhookConfig.enabled[eventType] ~= nil then
                    WebhookConfig.enabled[eventType] = enabled
                end
            end
        end
        
        if Config.Webhooks.highValueThreshold then
            WebhookConfig.highValueThreshold = Config.Webhooks.highValueThreshold
        end
        
        if Config.Webhooks.botName then
            WebhookConfig.botName = Config.Webhooks.botName
        end
        
        if Config.Webhooks.botAvatar then
            WebhookConfig.botAvatar = Config.Webhooks.botAvatar
        end
        
        if Config.Debug then
            print('[Webhook] Configuration loaded from Config')
        end
    end
end

-- Load on resource start
AddEventHandler('onResourceStart', function(resourceName)
    if GetCurrentResourceName() == resourceName then
        LoadWebhookConfig()
        print('[Webhook System] Initialized')
    end
end)

-- ============================================
-- ADMIN COMMANDS
-- ============================================

-- Set webhook URL command (admin only)
RegisterCommand('auctionwebhook', function(source, args, rawCommand)
    -- Permission check: only allow from console or admins
    if source ~= 0 then
        local Player = RSGCore.Functions.GetPlayer(source)
        if not Player then
            return
        end
        
        -- Check if player has admin permission
        -- RSG Framework uses PlayerData.group for permission level
        local playerGroup = Player.PlayerData.group
        if playerGroup ~= 'admin' and playerGroup ~= 'superadmin' and playerGroup ~= 'owner' then
            TriggerClientEvent('auction:client:webhookResult', source, {
                success = false,
                message = 'Permission denied'
            })
            return
        end
    end
    
    if #args < 2 then
        local helpMsg = [[
Usage: auctionwebhook <eventType> <url>
Event Types:
  default        - Default webhook URL
  auctionCreated - New auctions
  bidPlaced      - Bid notifications
  auctionWon     - Auction winners
  auctionExpired - Expired auctions
  auctionCancelled - Cancelled auctions
  highValueSale  - High value alerts

Example: auctionwebhook default https://discord.com/api/webhooks/...
]]
        if source == 0 then
            print(helpMsg)
        else
            TriggerClientEvent('auction:client:webhookResult', source, {
                success = false,
                message = helpMsg
            })
        end
        return
    end
    
    local eventType = args[1]
    local url = args[2]
    
    local success, err = SetWebhookUrl(eventType, url)
    
    if success then
        local msg = string.format('Webhook URL set for "%s"', eventType)
        if source == 0 then
            print('[Webhook] ' .. msg)
        else
            TriggerClientEvent('auction:client:webhookResult', source, {
                success = true,
                message = msg
            })
        end
    else
        if source == 0 then
            print('[Webhook] Error: ' .. (err or 'Unknown error'))
        else
            TriggerClientEvent('auction:client:webhookResult', source, {
                success = false,
                message = err or 'Unknown error'
            })
        end
    end
end, false)

-- Toggle webhook command (admin only)
RegisterCommand('auctionwebhooktoggle', function(source, args, rawCommand)
    -- Permission check
    if source ~= 0 then
        local Player = RSGCore.Functions.GetPlayer(source)
        if not Player then return end
        
        local playerGroup = Player.PlayerData.group
        if playerGroup ~= 'admin' and playerGroup ~= 'superadmin' and playerGroup ~= 'owner' then
            TriggerClientEvent('auction:client:webhookResult', source, {
                success = false,
                message = 'Permission denied'
            })
            return
        end
    end
    
    if #args < 2 then
        local msg = 'Usage: auctionwebhooktoggle <eventType> <true/false>'
        if source == 0 then
            print(msg)
        else
            TriggerClientEvent('auction:client:webhookResult', source, {
                success = false,
                message = msg
            })
        end
        return
    end
    
    local eventType = args[1]
    local enabled = args[2]:lower() == 'true'
    
    local success, err = ToggleWebhook(eventType, enabled)
    
    if success then
        local msg = string.format('Webhook "%s" %s', eventType, enabled and 'enabled' or 'disabled')
        if source == 0 then
            print('[Webhook] ' .. msg)
        else
            TriggerClientEvent('auction:client:webhookResult', source, {
                success = true,
                message = msg
            })
        end
    else
        if source == 0 then
            print('[Webhook] Error: ' .. (err or 'Unknown error'))
        else
            TriggerClientEvent('auction:client:webhookResult', source, {
                success = false,
                message = err or 'Unknown error'
            })
        end
    end
end, false)

-- View webhook status command
RegisterCommand('auctionwebhookstatus', function(source, args, rawCommand)
    -- Permission check
    if source ~= 0 then
        local Player = RSGCore.Functions.GetPlayer(source)
        if not Player then return end
        
        local playerGroup = Player.PlayerData.group
        if playerGroup ~= 'admin' and playerGroup ~= 'superadmin' and playerGroup ~= 'owner' then
            TriggerClientEvent('auction:client:webhookResult', source, {
                success = false,
                message = 'Permission denied'
            })
            return
        end
    end
    
    local config = GetWebhookConfig()
    local statusMsg = 'Webhook Status:\n'
    statusMsg = statusMsg .. string.format('Default URL: %s\n', config.defaultUrl or 'Not set')
    statusMsg = statusMsg .. string.format('High Value Threshold: %s\n', formatMoney(config.highValueThreshold))
    statusMsg = statusMsg .. 'Event Types:\n'
    
    for eventType, enabled in pairs(config.enabled) do
        local url = config.urls[eventType] or config.defaultUrl or 'Not configured'
        local urlDisplay = url ~= 'Not configured' and 'Configured' or url
        statusMsg = statusMsg .. string.format('  %s: %s (%s)\n', eventType, enabled and 'ON' or 'OFF', urlDisplay)
    end
    
    if source == 0 then
        print(statusMsg)
    else
        TriggerClientEvent('auction:client:webhookResult', source, {
            success = true,
            message = statusMsg
        })
    end
end, false)

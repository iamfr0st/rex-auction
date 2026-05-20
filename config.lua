-- Auction System Configuration

Config = {
    -- Categories for Auction Items
    -- Players select a category when creating an auction
    Categories = {
        {
            id = 'weapons',
            label = 'Weapons',
            icon = '🔫',
            description = 'Firearms, melee weapons, and ammunition',
            items = {}  -- Empty = allows any item matching weapon patterns
        },
        {
            id = 'ammunition',
            label = 'Ammunition',
            icon = '🎯',
            description = 'Bullets, arrows, and throwing weapons',
            items = {}
        },
        {
            id = 'clothing',
            label = 'Clothing',
            icon = '👒',
            description = 'Apparel, hats, and accessories',
            items = {}
        },
        {
            id = 'food',
            label = 'Food & Drink',
            icon = '🥩',
            description = 'Consumables, provisions, and beverages',
            items = {}
        },
        {
            id = 'resources',
            label = 'Resources',
            icon = '🪨',
            description = 'Ores, minerals, and raw materials',
            items = {}
        },
        {
            id = 'pelts',
            label = 'Pelts & Hides',
            icon = '🦌',
            description = 'Animal pelts, hides, and taxidermy',
            items = {}
        },
        {
            id = 'medicine',
            label = 'Medicine',
            icon = '💊',
            description = 'Tonics, medicines, and healing items',
            items = {}
        },
        {
            id = 'tools',
            label = 'Tools',
            icon = '🔧',
            description = 'Tools, kits, and crafting supplies',
            items = {}
        },
        {
            id = 'valuables',
            label = 'Valuables',
            icon = '💎',
            description = 'Jewelry, gold, and valuable items',
            items = {}
        },
        {
            id = 'other',
            label = 'Other',
            icon = '📦',
            description = 'Miscellaneous items',
            items = {}
        }
    },
    
    -- Auction Settings
    MinStartingBid = 0.01,      -- Minimum starting bid in dollars (1 cent)
    MinDuration = 60,           -- Minimum auction duration in seconds (1 minute)
    MaxDuration = 604800,       -- Maximum auction duration in seconds (7 days)
    DefaultDuration = 3600,     -- Default duration (1 hour)
    
    -- Bid Settings
    MinBidIncrement = 0.05,     -- 5% minimum increase over current bid
    
    -- Auction Creation Fee Settings
    -- Fee formula: BaseFee + (DurationMultiplier * hours) + (QuantityMultiplier * quantity)
    CreationFee = {
        enabled = true,              -- Enable/disable creation fees
        baseFee = 0.50,              -- Base fee for any auction
        durationMultiplier = 0.10,   -- Fee per hour of duration
        quantityMultiplier = 0.10,   -- Fee per item quantity
        maxFee = 500,                -- Maximum fee cap
        minFee = 0.50,               -- Minimum fee (base fee)
    },
    
    -- Item Blacklist
    -- Items in this list cannot be auctioned by players
    BlacklistedItems = {
        'dollar',
        'cent',
        'blood_dollar',
        'blood_cent',
        'money_clip',
        'blood_money_clip',
    },
    
    -- NPC Auctioneers
    -- Players interact with these NPCs to open the auction UI
    AuctioneerNPCs = {
        {
            model = 'cs_valauctionboss_01',   -- RDR2 auctioneer model
            coords = vector3(-240.97, 658.76, 113.33),  -- Valentine area
            heading = 149.33,
            name = 'Valentine Auctioneer',
            respawnDelay = 5000   -- Respawn after 5 seconds if killed/removed
        },
        -- Add more NPCs as needed:
        -- {
        --     model = 'cs_valauctionboss_01',
        --     coords = vector3(x, y, z),
        --     heading = h,
        --     name = 'Saint Denis Auctioneer',
        --     respawnDelay = 5000
        -- },
    },
    
    -- NPC Interaction Settings (ox_target)
    InteractionDistance = 2.5,      -- Max distance to target NPC
    
    -- UI Settings
    RefreshInterval = 1000,     -- UI refresh rate in ms
    
    -- Notification Settings
    NotificationDuration = 5000, -- How long notifications show (ms)
    
    -- Persistence
    SaveInterval = 60000,       -- Auto-save interval in ms (1 minute)
    
    -- Debug
    Debug = false,
    
    -- Discord Webhooks
    Webhooks = {
        -- Default webhook URL (used if event-specific URL not set)
        -- Set to your Discord webhook URL, e.g., 'https://discord.com/api/webhooks/...'
        defaultUrl = nil,
        
        -- Event-specific webhook URLs (optional, overrides defaultUrl)
        urls = {
            auctionCreated = nil,     -- New auctions
            bidPlaced = nil,          -- Bid notifications (can be spammy)
            auctionWon = nil,         -- Auction winners
            auctionExpired = nil,     -- Expired auctions (no bids)
            auctionCancelled = nil,   -- Cancelled auctions
            highValueSale = nil,      -- High value alerts
        },
        
        -- Enable/disable specific webhook types
        enabled = {
            auctionCreated = true,
            bidPlaced = false,        -- Off by default (can be spammy)
            auctionWon = true,
            auctionExpired = true,
            auctionCancelled = true,
            highValueSale = true,
        },
        
        -- High value threshold (triggers additional highValueSale webhook)
        highValueThreshold = 1000,
        
        -- Bot appearance in Discord
        botName = 'Auction House',
        botAvatar = nil,  -- Set to an image URL for custom avatar
    }
}

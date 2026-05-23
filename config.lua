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
            items = {}
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
            id = 'horses',
            label = 'Horses',
            icon = '🐎',
            description = 'Owned horses listed from nearby active mounts',
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
    MinStartingBid = 0.01,
    MinDuration = 60,
    MaxDuration = 604800,
    DefaultDuration = 3600,
    MaxAuctionsPerPlayer = 10,

    -- Rate Limiting (milliseconds between actions)
    RateLimits = {
        createAuction = 5000,
        placeBid = 1000,
        buyoutAuction = 3000,
        collectItem = 500,
        collectMoney = 500,
    },

    -- Bid Settings
    MinBidIncrement = 0.05,

    -- Buyout Price Settings
    Buyout = {
        enabled = true,
        minMultiplier = 1.5,
    },

    -- Auction Creation Fee Settings
    CreationFee = {
        enabled = true,
        baseFee = 0.50,
        durationMultiplier = 0.10,
        quantityMultiplier = 0.10,
        maxFee = 500,
        minFee = 0.50,
    },

    -- Item Blacklist
    BlacklistedItems = {
        'dollar',
        'cent',
        'blood_dollar',
        'blood_cent',
        'money_clip',
        'blood_money_clip',
    },

    -- NPC Auctioneers
    AuctioneerNPCs = {
        {
            model = 'cs_valauctionboss_01',
            coords = vector3(-240.97, 658.76, 113.33),
            heading = 149.33,
            bank = 'valbank',
            name = 'Valentine Auctioneer',
            respawnDelay = 5000
        },
    },

    -- NPC Interaction Settings (ox_target)
    InteractionDistance = 2.5,

    -- UI Settings
    RefreshInterval = 1000,

    -- Notification Settings
    NotificationDuration = 5000,

    -- Persistence
    SaveInterval = 60000,

    -- Debug
    Debug = false,

    -- Discord Webhooks
    Webhooks = {
        defaultUrl = nil,
        urls = {
            auctionCreated = nil,
            bidPlaced = nil,
            auctionWon = nil,
            auctionBuyout = nil,
            auctionExpired = nil,
            auctionCancelled = nil,
            highValueSale = nil,
        },
        enabled = {
            auctionCreated = true,
            bidPlaced = false,
            auctionWon = true,
            auctionBuyout = true,
            auctionExpired = true,
            auctionCancelled = true,
            highValueSale = true,
        },
        highValueThreshold = 1000,
        botName = 'Auction House',
        botAvatar = nil,
    }
}

# REX Auction System

A real-time auction house system for RedM servers running RSG Framework. Players can list items for auction, place bids, and receive items/money through an in-game UI accessed via NPC auctioneers.

[Buy me a Beer](https://buymeacoffee.com/rexshack)

## Changelog

### v2.1.0 - Security & Stability Update

**Security Improvements:**
- Added rate limiting for all auction operations (create, bid, buyout, collect) to prevent spam attacks
- Implemented mutex locks on auction operations to prevent race conditions and double-spending
- Added comprehensive input validation on all server events (auctionId, item names, bid amounts)
- Added webhook URL validation to prevent SSRF attacks (only Discord URLs allowed)
- Added maximum auctions per player limit (configurable, default: 10)

**Client Stability:**
- Added proper nil guards for RSGCore availability checks
- Added PlayerData validation before accessing properties
- Added inventory access safety checks
- Added input validation on NUI callbacks

**New Configuration Options:**
- `Config.MaxAuctionsPerPlayer` - Maximum active auctions per player (default: 10)
- `Config.RateLimits` - Cooldown times in milliseconds for each action type

## Features

- **Real-time Auctions**: Live bidding with instant updates across all connected players
- **NPC Auctioneers**: Interact with NPCs using ox_target to open the auction UI
- **Item Categories**: Organize auctions by category with automatic item classification
- **Buyout / "Buy Now"**: Sellers can set a buyout price for immediate purchase (configurable minimum multiplier)
- **Auction Creation Fees**: Optional fees based on duration and quantity (configurable)
- **Collection Kiosk**: Winners collect items and sellers collect money at the auctioneer NPC
- **Item Escrow**: Items are held securely during active auctions
- **Bid Escrow**: Bid amounts are held and automatically refunded if outbid
- **Offline Queuing**: Pending collections are saved and available when players reconnect
- **Discord Webhooks**: Optional notifications for auction events (created, bids, wins, expires, buyouts)
- **High Value Alerts**: Separate webhook notifications for high-value sales
- **Admin Commands**: In-game webhook configuration for server staff

## Requirements

- RedM server
- [rsg-core](https://github.com/Rexshack-RedM/rsg-core)
- [ox_lib](https://github.com/overextended/ox_lib)
- [ox_target](https://github.com/overextended/ox_target)
- [rsg-inventory](https://github.com/Rexshack-RedM/rsg-inventory) (for item images)

## Installation

### 1. Download & Place Resource

Download or clone this repository into your server's `resources` folder:

```
resources/[local]/rex-auction/
```

### 2. Add to server.cfg

Ensure the resource starts **after** its dependencies:

```cfg
ensure rsg-core
ensure ox_lib
ensure ox_target
ensure rsg-inventory
ensure rex-auction
```

### 3. Configure the Resource

Edit `config.lua` to customize:
- NPC auctioneer locations
- Auction duration limits
- Blacklisted items
- Discord webhook URLs

### 4. Restart Server

Restart your server or refresh resources:

```
refresh
ensure rex-auction
```

### 5. Build the UI (If Modifying)

The auction UI is pre-built in `web/dist/`. If you want to modify the UI or the build is missing, follow these steps:

#### Install Node.js

Download Node.js from the official website: **https://nodejs.org/**

**Recommended**: Install the **LTS (Long Term Support)** version for stability. The LTS version is tested and reliable for production use.

#### Verify Installation

Open a terminal/command prompt and verify Node.js and npm are installed:

```bash
node --version
npm --version
```

You should see version numbers output (e.g., `v20.11.0` for Node, `10.2.4` for npm).

#### Install Dependencies

Navigate to the `web` folder and install dependencies:

```bash
# Windows
cd resources\[local]\rex-auction\web
npm install

# Linux / macOS
cd resources/[local]/rex-auction/web
npm install
```

**Using Yarn instead of npm:**
```bash
yarn install
```

#### Build the UI

After installing dependencies, build the production files:

```bash
# Using npm
npm run build

# Using Yarn
yarn build
```

The built files will be output to `web/dist/`. FiveM will serve these files automatically.

#### Development Mode (Optional)

For live preview during development:

```bash
npm run dev
```

This starts a local dev server with hot-reload. Access the preview in your browser at `http://localhost:5173`.

### Node.js Troubleshooting

| Issue | Solution |
|-------|----------|
| `node: command not found` | Node.js not installed or not in PATH. Reinstall Node.js and restart your terminal. |
| `npm: command not found` | npm should install with Node.js. If missing, reinstall Node.js. |
| `EACCES permission error` | Permission denied on npm global folder. Use `sudo npm install` (Linux/macOS) or run terminal as Administrator (Windows). |
| `ENOENT: no such file or directory` | You're not in the correct folder. Navigate to `rex-auction/web` before running commands. |
| Build succeeds but UI doesn't load | Check `fxmanifest.lua` has `ui_page 'web/build/index.html'` and `files { 'web/build/**/*' }`. Note: some manifests use `web/dist/` - verify the path matches your build output. |
| Old UI showing after rebuild | Clear FiveM cache: delete `cache/browser` folder in your FiveM installation directory, then restart server. |

## Configuration

### Basic Settings (`config.lua`)

```lua
Config = {
    -- Auction Limits
    MinStartingBid = 0.01,      -- Minimum starting bid in dollars (1 cent)
    MinDuration = 60,           -- 1 minute minimum
    MaxDuration = 604800,       -- 7 days maximum
    DefaultDuration = 3600,     -- 1 hour default
    MaxAuctionsPerPlayer = 10,  -- Maximum active auctions per player

    -- Bid Settings
    MinBidIncrement = 0.05,     -- 5% minimum increase

    -- Buyout Price Settings
    Buyout = {
        enabled = true,         -- Enable/disable buyout feature
        minMultiplier = 1.5,    -- Buyout must be at least 1.5x starting bid
    },

    -- Auction Creation Fee Settings
    CreationFee = {
        enabled = true,         -- Enable/disable creation fees
        baseFee = 0.50,         -- Base fee for any auction
        durationMultiplier = 0.10,  -- Fee per hour of duration
        quantityMultiplier = 0.10,  -- Fee per item quantity
        maxFee = 500,           -- Maximum fee cap
        minFee = 0.50,          -- Minimum fee (base fee)
    },

    -- Rate Limiting (milliseconds between actions)
    RateLimits = {
        createAuction = 5000,   -- 5 seconds between creating auctions
        placeBid = 1000,        -- 1 second between bids
        buyoutAuction = 3000,   -- 3 seconds between buyouts
        collectItem = 500,      -- 0.5 seconds between item collections
        collectMoney = 500,     -- 0.5 seconds between money collections
    },

    -- Blacklisted Items (cannot be auctioned)
    BlacklistedItems = {
        'dollar',
        'cent',
        'blood_dollar',
        'blood_cent',
    },

    -- NPC Auctioneers
    AuctioneerNPCs = {
        {
            model = 'cs_valauctionboss_01',
            coords = vector3(-240.97, 658.76, 113.33),
            heading = 149.33,
            name = 'Valentine Auctioneer',
        },
    },

    -- Interaction
    InteractionDistance = 2.5,
}
```

### Categories (`config.lua`)

Categories organize auctions in the UI. Players select a category when creating an auction, and can filter by category when browsing.

```lua
Config.Categories = {
    { id = 'valuables', label = 'Valuables', icon = 'fa-gem', description = 'Gold, jewelry, and other valuables' },
    { id = 'weapons', label = 'Weapons', icon = 'fa-crosshairs', description = 'Firearms, melee weapons, and ammunition' },
    { id = 'pelts', label = 'Pelts & Hides', icon = 'fa-paw', description = 'Animal pelts, hides, and leather' },
    { id = 'herbs', label = 'Herbs & Plants', icon = 'fa-leaf', description = 'Medicinal plants and ingredients' },
    { id = 'provisions', label = 'Provisions', icon = 'fa-drumstick-bite', description = 'Food, drinks, and consumables' },
    { id = 'materials', label = 'Materials', icon = 'fa-box', description = 'Crafting materials and resources' },
    { id = 'other', label = 'Other', icon = 'fa-ellipsis', description = 'Miscellaneous items' },
}
```

#### Automatic Category Assignment

Items can be automatically assigned to categories based on their name using pattern matching:

```lua
Config.CategoryPatterns = {
    valuables = { 'gold', 'silver', 'diamond', 'ring', 'watch', 'jewel' },
    weapons = { 'pistol', 'rifle', 'shotgun', 'knife', 'bow', 'ammo' },
    pelts = { 'pelt', 'hide', 'fur', 'leather', 'skin' },
    herbs = { 'herb', 'plant', 'flower', 'mushroom', 'root' },
    provisions = { 'meat', 'fish', 'bread', 'whiskey', 'coffee', 'canned' },
    materials = { 'wood', 'metal', 'cloth', 'feather', 'ore' },
}
```

When a player creates an auction, the system checks the item name against these patterns. If no pattern matches, the item defaults to "other". Players can override the suggested category when listing.

### Discord Webhooks

Configure webhooks in `config.lua`:

```lua
Config.Webhooks = {
    -- Default URL (used if event-specific URL not set)
    defaultUrl = 'https://discord.com/api/webhooks/YOUR_WEBHOOK_HERE',
    
    -- Event-specific URLs (optional)
    urls = {
        auctionCreated = nil,
        bidPlaced = nil,
        auctionWon = nil,
        auctionBuyout = nil,      -- Buyout purchases
        auctionExpired = nil,
        auctionCancelled = nil,
        highValueSale = nil,
    },

    -- Enable/disable events
    enabled = {
        auctionCreated = true,
        bidPlaced = false,      -- Off by default (can be spammy)
        auctionWon = true,
        auctionBuyout = true,   -- Buyout purchase notifications
        auctionExpired = true,
        auctionCancelled = true,
        highValueSale = true,
    },
    
    -- High value threshold ($)
    highValueThreshold = 1000,
    
    -- Bot appearance
    botName = 'Auction House',
    botAvatar = nil,  -- Set to image URL for custom avatar
}
```

## Usage

### Player Commands

| Command | Description |
|---------|-------------|
| `/auction` | Open/close the auction UI |
| `/auctions` | Alias for `/auction` |

### Player Actions

1. **List an Item**: Approach an NPC auctioneer, interact via ox_target, select an item from your inventory, choose a category, set starting bid, optional buyout price, and duration
2. **Place a Bid**: Browse active auctions by category, enter your bid amount (must be 5% higher than current bid)
3. **Buy Now**: If a buyout price is set, purchase the item immediately for that price (bypasses bidding)
4. **Cancel Auction**: Cancel your own auctions (only if no bids placed)
5. **Collect Winnings**: When you win an auction, visit the auctioneer NPC and use the "Collect Items" tab to claim your items
6. **Collect Earnings**: When your auction sells, visit the auctioneer NPC to collect your money

### Collection System

When an auction ends, items and money are **not** automatically delivered. Instead, they are held at the auctioneer for collection:

- **Winners**: Must visit an auctioneer NPC and collect won items from the "Collect Items" tab
- **Sellers**: Must visit an auctioneer NPC to collect the sale proceeds
- **Inventory Check**: Items can only be collected if you have sufficient inventory space
- **Persistence**: Pending collections are saved and remain available even after server restarts or player disconnects

The collection UI shows:
- Item name, quantity, and image
- Money amounts owed
- Collection status (pending/collected)

### Admin Commands

| Command | Description | Permission |
|---------|-------------|------------|
| `auctionwebhook <eventType> <url>` | Set webhook URL for event type | admin/superadmin/owner |
| `auctionwebhooktoggle <eventType> <true/false>` | Enable/disable webhook event | admin/superadmin/owner |
| `auctionwebhookstatus` | View current webhook configuration | admin/superadmin/owner |

**Event Types:**
- `default` - Default webhook URL
- `auctionCreated` - New auctions listed
- `bidPlaced` - Bid notifications
- `auctionWon` - Auction winners
- `auctionBuyout` - Items purchased via buyout
- `auctionExpired` - Expired auctions (no bids)
- `auctionCancelled` - Cancelled auctions
- `highValueSale` - High value sale alerts

**Example:**
```
auctionwebhook default https://discord.com/api/webhooks/123456789/abcdef...
auctionwebhooktoggle bidPlaced true
auctionwebhookstatus
```

## Server Events

Events available for external resources:

### Server Events (Trigger from client)

```lua
-- Get all active auctions
TriggerServerEvent('auction:server:getAuctions')

-- Get available categories
TriggerServerEvent('auction:server:getCategories')

-- Search auctions with filters
TriggerServerEvent('auction:server:searchAuctions', {
    query = 'gold',
    category = 'valuables',
    sortBy = 'price_asc'
})

-- Create a new auction
TriggerServerEvent('auction:server:createAuction', {
    itemName = 'apple',
    itemLabel = 'Apple',
    count = 10,
    startingBid = 50,
    buyoutPrice = 100,        -- Optional: immediate purchase price
    duration = 3600,
    category = 'provisions'   -- Category ID from Config.Categories
})

-- Place a bid
TriggerServerEvent('auction:server:placeBid', auctionId, bidAmount)

-- Buyout an auction (immediate purchase)
TriggerServerEvent('auction:server:buyoutAuction', auctionId)

-- Cancel an auction
TriggerServerEvent('auction:server:cancelAuction', auctionId)

-- Get player's active auctions
TriggerServerEvent('auction:server:getPlayerAuctions')

-- Get player's balance
TriggerServerEvent('auction:server:getBalance')

-- Calculate fee preview before creating auction
TriggerServerEvent('auction:server:calculateFeePreview', {
    duration = 3600,
    count = 10
})

-- Get pending collections (items/money to collect)
TriggerServerEvent('auction:server:getPendingCollections')

-- Collect a pending item
TriggerServerEvent('auction:server:collectItem', auctionId, itemName)

-- Collect pending money
TriggerServerEvent('auction:server:collectMoney')
```

### Client Events (Listen for responses)

```lua
-- Receive auction list
RegisterNetEvent('auction:client:receiveAuctions', function(data)
    -- data.auctions - table of active auctions
    -- data.bidHistory - table of bid histories
end)

-- Receive search results
RegisterNetEvent('auction:client:receiveSearchResults', function(data)
    -- data.auctions - table of matching auctions
end)

-- Receive category list
RegisterNetEvent('auction:client:receiveCategories', function(categories)
    -- categories - table of { id, label, icon, description }
end)

-- Receive player's active auctions
RegisterNetEvent('auction:client:receivePlayerAuctions', function(data)
    -- data.auctions - table of player's auctions
end)

-- Auction creation result
RegisterNetEvent('auction:client:createResult', function(result)
    -- result.success - boolean
    -- result.error - error message if failed
    -- result.auctionId - ID of created auction if successful
end)

-- Bid result
RegisterNetEvent('auction:client:bidResult', function(result)
    -- result.success - boolean
    -- result.error - error message if failed
end)

-- Buyout result
RegisterNetEvent('auction:client:buyoutResult', function(result)
    -- result.success - boolean
    -- result.error - error message if failed
end)

-- Cancel result
RegisterNetEvent('auction:client:cancelResult', function(result)
    -- result.success - boolean
    -- result.error - error message if failed
end)

-- Fee preview result
RegisterNetEvent('auction:client:feePreview', function(data)
    -- data.fee - calculated fee amount
end)

-- Balance updated
RegisterNetEvent('auction:client:balanceUpdated', function(data)
    -- data.balance - player's money balance
end)

-- Receive pending collections
RegisterNetEvent('auction:client:receivePendingCollections', function(data)
    -- data.items - table of items waiting to be collected
    -- data.money - table of money amounts waiting to be collected
end)

-- Collection result
RegisterNetEvent('auction:client:collectionResult', function(result)
    -- result.success - boolean
    -- result.error - error message if failed
    -- result.type - 'item' or 'money'
end)

-- Notification events
RegisterNetEvent('auction:client:notification', function(data)
    -- data.type: 'won', 'sold', 'outbid', 'expired', 'info', 'buyout'
    -- data.message: notification text
end)
```

## File Structure

```
rex-auction/
├── fxmanifest.lua          # Resource manifest
├── config.lua              # Configuration
├── server/
│   ├── main.lua            # Server-side auction logic
│   └── webhooks.lua        # Discord webhook system
├── client/
│   ├── main.lua            # Client-side UI handling
│   └── npc.lua             # NPC spawning/targeting
└── web/
    └── dist/               # Built UI files
```

## Troubleshooting

### Resource Won't Start

**Symptom**: `[REX-Auction] Script execution failed` in console

**Solutions**:
1. Verify all dependencies are installed and started before rex-auction
2. Check server.cfg load order:
   ```cfg
   ensure rsg-core
   ensure ox_lib
   ensure ox_target
   ensure rex-auction
   ```
3. Check for Lua syntax errors: `lua_check` in console

### NPCs Not Spawning

**Symptom**: Auctioneer NPCs don't appear at configured locations

**Solutions**:
1. Verify model name is valid for RDR2 (`cs_valauctionboss_01` is confirmed working)
2. Check coordinates are valid and not inside objects
3. Enable debug mode in config and use `/auction:npcs` command to check status
4. Ensure ox_target is properly installed and running

### UI Not Opening

**Symptom**: NPC interaction works but UI doesn't appear

**Solutions**:
1. Verify `web/dist/` folder exists and contains built UI files
2. Check browser console (F8 → `nui_devtools`) for JavaScript errors
3. Ensure NUI focus is being set correctly

### Items Not Showing in UI

**Symptom**: Inventory appears empty in auction UI

**Solutions**:
1. Verify rsg-inventory is running
2. Check item images exist in `rsg-inventory/html/images/`
3. Ensure items have valid `name` and `label` properties

### Webhooks Not Sending

**Symptom**: Discord webhooks not received

**Solutions**:
1. Verify webhook URL is correct (test in browser)
2. Check `webhook_errors.log` in resource folder for failures
3. Enable `Config.Debug = true` to see webhook activity in console
4. Verify event is enabled in config: `Config.Webhooks.enabled.auctionWon = true`
5. Use `auctionwebhookstatus` command to check configuration

### Permission Denied for Admin Commands

**Symptom**: `Permission denied` when using admin commands

**Solutions**:
1. Verify player has correct group in database (`admin`, `superadmin`, or `owner`)
2. Check RSGCore permission system is functioning
3. Console commands (source 0) always have permission

### Auction Data Not Persisting

**Symptom**: Auctions disappear after server restart

**Solutions**:
1. Verify `auctions.json` is being created in resource folder
2. Check file permissions on server (resource needs write access)
3. Look for save errors in server console

### Player Not Receiving Items/Money

**Symptom**: Won auction but didn't receive item or money

**Solutions**:
1. Items and money must be collected at an auctioneer NPC via the "Collect Items" tab
2. Check `PendingCollections` in `auctions.json` - uncollected items are persisted
3. Ensure player has sufficient inventory space before collecting items
4. Check server console for delivery errors during collection
5. Verify RSGCore `AddItem` and `AddMoney` functions work correctly

## Support

For issues or feature requests, contact the resource developer or submit an issue on the repository.

## License

This resource is provided as-is for use with RSG Framework on RedM servers.

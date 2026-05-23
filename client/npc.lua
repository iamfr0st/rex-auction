-- Auction System NPC Handler
-- Handles spawning, persistence, and ox_target interaction with auctioneer NPCs

local SpawnedNPCs = {}  -- [npcIndex] = { entity, coords, heading, data }

-- Target option name for ox_target (used for removal)
local TARGET_OPTION_NAME = 'auction_npc_interact'

-- ============================================
-- NPC SPAWNING
-- ============================================

local function loadModel(model)
    local modelHash = GetHashKey(model)
    
    if not IsModelValid(modelHash) then
        print(('[Auction NPC] Invalid model: %s'):format(model))
        return nil
    end
    
    RequestModel(modelHash, false)
    
    local timeout = 0
    while not HasModelLoaded(modelHash) and timeout < 50 do
        Wait(100)
        timeout = timeout + 1
    end
    
    if not HasModelLoaded(modelHash) then
        print(('[Auction NPC] Failed to load model: %s'):format(model))
        return nil
    end
    
    return modelHash
end

local function addTargetToEntity(entity, npcConfig, index)
    exports.ox_target:addLocalEntity(entity, {
        {
            name = TARGET_OPTION_NAME,
            label = npcConfig.name or 'Open Auction House',
            icon = 'fa-solid fa-gavel',
            distance = Config.InteractionDistance or 2.5,
            onSelect = function(data)
                if NUI.IsOpen() then
                    NUI.Close()
                    return
                end
                
                -- Request server validation
                TriggerServerEvent('auction:server:validateNPCInteraction', {
                    npcIndex = index,
                    npcName = npcConfig.name
                })
            end
        }
    })
end

local function removeTargetFromEntity(entity)
    exports.ox_target:removeLocalEntity(entity, TARGET_OPTION_NAME)
end

local function findExistingNPC(npcConfig)
    local coords = npcConfig.coords
    local modelHash = GetHashKey(npcConfig.model)

    for _, ped in ipairs(GetGamePool('CPed')) do
        if DoesEntityExist(ped) and GetEntityModel(ped) == modelHash then
            local pedCoords = GetEntityCoords(ped)
            if #(pedCoords - coords) <= 3.0 then
                return ped
            end
        end
    end

    return nil
end

local function cleanupExistingNPCs()
    if not Config.AuctioneerNPCs then return end

    for index, npcConfig in ipairs(Config.AuctioneerNPCs) do
        while true do
            local ped = findExistingNPC(npcConfig)
            if not ped then
                break
            end

            removeTargetFromEntity(ped)
            SetEntityAsMissionEntity(ped, true, true)
            DeletePed(ped)

            if Config.Debug then
                print(('[Auction NPC] Cleaned up existing %s before spawn (index %d, entity: %d)'):format(
                    npcConfig.name or 'NPC', index, ped
                ))
            end

            Wait(0)
        end
    end
end

local function spawnNPC(npcConfig, index)
    -- Validate npcConfig
    if not npcConfig or type(npcConfig) ~= "table" then
        print('[Auction NPC] Invalid NPC config at index ' .. tostring(index))
        return nil
    end
    
    if SpawnedNPCs[index] and DoesEntityExist(SpawnedNPCs[index].entity) then
        return SpawnedNPCs[index].entity
    end

    local existingPed = findExistingNPC(npcConfig)
    if existingPed then
        addTargetToEntity(existingPed, npcConfig, index)
        SpawnedNPCs[index] = {
            entity = existingPed,
            coords = npcConfig.coords,
            heading = npcConfig.heading,
            data = npcConfig
        }

        if Config.Debug then
            print(('[Auction NPC] Rebound existing %s at index %d (entity: %d)'):format(
                npcConfig.name or 'NPC', index, existingPed
            ))
        end

        return existingPed
    end
    
    local modelHash = loadModel(npcConfig.model)
    if not modelHash then return nil end
    
    local coords = npcConfig.coords
    local heading = npcConfig.heading
    
    -- Validate coords
    if not coords or not coords.x or not coords.y or not coords.z then
        print('[Auction NPC] Invalid coords for NPC at index ' .. tostring(index))
        return nil
    end
    
    -- Create ped at coords
    local ped = CreatePed(modelHash, coords.x, coords.y, coords.z -1, heading, true, true, true, true)
    
    if not ped or ped == 0 then
        print(('[Auction NPC] Failed to create ped at index %d'):format(index))
        return nil
    end
    
    -- Configure ped
    SetEntityAsMissionEntity(ped, true, true)
    SetRandomOutfitVariation(ped, true)
    SetPedCanBeTargetted(ped, true)
    SetBlockingOfNonTemporaryEvents(ped, true)
    SetPedCanBeKnockedOffVehicle(ped, false)
    SetPedCanPlayAmbientAnims(ped, true)
    SetPedCanPlayAmbientBaseAnims(ped, true)
    TaskStandStill(ped, -1)
    
    -- Add ox_target option to this entity
    addTargetToEntity(ped, npcConfig, index)
    
    -- Store reference
    SpawnedNPCs[index] = {
        entity = ped,
        coords = coords,
        heading = heading,
        data = npcConfig
    }
    
    if Config.Debug then
        print(('[Auction NPC] Spawned %s at index %d (entity: %d)'):format(
            npcConfig.name or 'NPC', index, ped
        ))
    end
    
    return ped
end

local function despawnNPC(index)
    local npcData = SpawnedNPCs[index]
    if not npcData then return end
    
    if DoesEntityExist(npcData.entity) then
        -- Remove ox_target option from this entity
        removeTargetFromEntity(npcData.entity)
        DeletePed(npcData.entity)
    end
    
    SpawnedNPCs[index] = nil
end

local function spawnAllNPCs()
    if not Config.AuctioneerNPCs then return end
    
    for index, npcConfig in ipairs(Config.AuctioneerNPCs) do
        spawnNPC(npcConfig, index)
    end
end

local function despawnAllNPCs()
    for index, _ in pairs(SpawnedNPCs) do
        despawnNPC(index)
    end
    SpawnedNPCs = {}
end

-- ============================================
-- SERVER EVENT - UI OPEN
-- ============================================

RegisterNetEvent('auction:client:openFromNPC', function(npcIndex)
    NUI.Open({ npcIndex = npcIndex })
end)

-- ============================================
-- RESPAWN MONITORING
-- ============================================

CreateThread(function()
    -- Wait for player to load
    while not PlayerPedId() or PlayerPedId() == 0 do
        Wait(500)
    end
    
    -- Initial spawn
    Wait(1000)
    cleanupExistingNPCs()
    spawnAllNPCs()
    
    -- Periodic respawn check
    while true do
        Wait(2000)
        
        if not Config.AuctioneerNPCs then
            goto continue
        end
        
        for index, npcConfig in ipairs(Config.AuctioneerNPCs) do
            local spawned = SpawnedNPCs[index]
            
            if not spawned or not DoesEntityExist(spawned.entity) then
                local existingPed = findExistingNPC(npcConfig)
                if existingPed then
                    SpawnedNPCs[index] = {
                        entity = existingPed,
                        coords = npcConfig.coords,
                        heading = npcConfig.heading,
                        data = npcConfig
                    }
                    addTargetToEntity(existingPed, npcConfig, index)
                    goto npc_continue
                end

                -- NPC missing, check respawn timer
                if not spawned or not spawned.respawnTimer then
                    if Config.Debug then
                        print(('[Auction NPC] Scheduling respawn for %s'):format(npcConfig.name or 'NPC'))
                    end
                    
                    -- Set respawn timer
                    if spawned then
                        spawned.respawnTimer = GetGameTimer() + (npcConfig.respawnDelay or 5000)
                    else
                        SpawnedNPCs[index] = {
                            respawnTimer = GetGameTimer() + (npcConfig.respawnDelay or 5000)
                        }
                    end
                elseif GetGameTimer() >= spawned.respawnTimer then
                    -- Timer elapsed, respawn
                    spawnNPC(npcConfig, index)
                    SpawnedNPCs[index].respawnTimer = nil
                end
            end

            ::npc_continue::
        end
        
        ::continue::
    end
end)

-- ============================================
-- CLEANUP
-- ============================================

AddEventHandler('onClientResourceStop', function(resourceName)
    if GetCurrentResourceName() ~= resourceName then return end
    
    -- Despawn all NPCs (this also removes target options)
    despawnAllNPCs()
    
    -- Clean up models
    for _, npcConfig in ipairs(Config.AuctioneerNPCs or {}) do
        local modelHash = GetHashKey(npcConfig.model)
        if HasModelLoaded(modelHash) then
            SetModelAsNoLongerNeeded(modelHash)
        end
    end
end)

-- ============================================
-- DEBUG COMMANDS
-- ============================================

if Config.Debug then
    RegisterCommand('auction:npcs', function()
        print('[Auction NPC] Spawned NPCs:')
        for index, npcData in pairs(SpawnedNPCs) do
            local exists = DoesEntityExist(npcData.entity)
            print(('  [%d] %s - Entity: %d, Exists: %s'):format(
                index, 
                npcData.data.name or 'Unknown',
                npcData.entity,
                tostring(exists)
            ))
        end
    end, false)
    
    RegisterCommand('auction:respawn', function()
        despawnAllNPCs()
        Wait(1000)
        spawnAllNPCs()
        print('[Auction NPC] Respawned all NPCs')
    end, false)
end

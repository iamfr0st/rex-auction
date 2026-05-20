-- Money Utility Module
-- All money values are stored internally as integer cents to avoid float precision issues
-- This module provides conversion, formatting, and validation functions

Money = {}

-- Convert dollars (float/string) to cents (integer)
-- Examples: 1.00 -> 100, 0.20 -> 20, "5.50" -> 550
function Money.dollarsToCents(dollars)
    if type(dollars) == "string" then
        dollars = tonumber(dollars)
    end
    
    if type(dollars) ~= "number" then
        return 0
    end
    
    -- Round to avoid floating point errors
    return math.floor(dollars * 100 + 0.5)
end

-- Convert cents (integer) to dollars (float)
-- Examples: 100 -> 1.0, 20 -> 0.2, 550 -> 5.5
function Money.centsToDollars(cents)
    if type(cents) ~= "number" then
        return 0.0
    end
    
    return cents / 100
end

-- Format cents as a dollar string with 2 decimal places
-- Examples: 100 -> "$1.00", 20 -> "$0.20", 550 -> "$5.50"
function Money.format(cents)
    if type(cents) ~= "number" then
        return "$0.00"
    end
    
    local dollars = math.floor(cents / 100)
    local remainder = math.abs(cents % 100)
    
    return string.format("$%d.%02d", dollars, remainder)
end

-- Format cents as a dollar string with commas for thousands
-- Examples: 100000 -> "$1,000.00", 123456 -> "$1,234.56"
function Money.formatWithCommas(cents)
    if type(cents) ~= "number" then
        return "$0.00"
    end
    
    local dollars = math.floor(cents / 100)
    local remainder = math.abs(cents % 100)
    
    -- Format with commas
    local formattedDollars = tostring(dollars):reverse():gsub("(%d%d%d)", "%1,"):reverse():gsub("^,", "")
    
    return string.format("$%s.%02d", formattedDollars, remainder)
end

-- Parse a dollar string input to cents
-- Accepts formats: "1", "1.00", "$1.00", "0.20", ".50"
-- Returns: cents (integer) or nil if invalid
function Money.parseToCents(input)
    if not input then return nil end
    
    -- Convert to string if number
    if type(input) == "number" then
        return Money.dollarsToCents(input)
    end
    
    if type(input) ~= "string" then
        return nil
    end
    
    -- Remove dollar sign and whitespace
    input = input:gsub("[$%s]", "")
    
    -- Handle empty string
    if input == "" then return nil end
    
    -- Parse the number
    local dollars = tonumber(input)
    if not dollars then return nil end
    
    -- Check for negative
    if dollars < 0 then return nil end
    
    return Money.dollarsToCents(dollars)
end

-- Validate that a cent value is valid (non-negative integer)
function Money.isValidCents(cents)
    return type(cents) == "number" 
        and cents == math.floor(cents) 
        and cents >= 0
end

-- Calculate percentage of cents (returns integer cents)
-- Example: 1000 cents with 5% = 50 cents
function Money.percent(cents, percentage)
    if not Money.isValidCents(cents) then
        return 0
    end
    
    return math.floor(cents * percentage / 100 + 0.5)
end

-- Add two cent values safely
function Money.add(centsA, centsB)
    return (centsA or 0) + (centsB or 0)
end

-- Subtract two cent values safely (returns 0 if result negative)
function Money.subtract(centsA, centsB)
    local result = (centsA or 0) - (centsB or 0)
    return result > 0 and result or 0
end

-- Check if centsA >= centsB
function Money.greaterOrEqual(centsA, centsB)
    return (centsA or 0) >= (centsB or 0)
end

-- Get minimum of two cent values
function Money.min(centsA, centsB)
    return math.min(centsA or 0, centsB or 0)
end

-- Get maximum of two cent values
function Money.max(centsA, centsB)
    return math.max(centsA or 0, centsB or 0)
end

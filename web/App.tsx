import { useState, useEffect, useCallback, useMemo } from 'react';
import { isDebug, useNuiEvent, fetchNui } from './hooks/useNui';

// Money formatting utilities - all values are in CENTS
const Money = {
  // Format cents as dollar string with 2 decimal places
  format: (cents: number | null | undefined): string => {
    if (cents === null || cents === undefined || isNaN(cents)) return '$0.00';
    const dollars = Math.floor(cents / 100);
    const remainder = Math.abs(cents % 100);
    const remainderStr = remainder < 10 ? '0' + remainder : remainder.toString();
    return `$${dollars}.${remainderStr}`;
  },
  
  // Format cents with commas for thousands
  formatWithCommas: (cents: number | null | undefined): string => {
    if (cents === null || cents === undefined || isNaN(cents)) return '$0.00';
    const dollars = Math.floor(cents / 100);
    const remainder = Math.abs(cents % 100);
    const remainderStr = remainder < 10 ? '0' + remainder : remainder.toString();
    const formattedDollars = dollars.toLocaleString();
    return `$${formattedDollars}.${remainderStr}`;
  },
  
  // Convert dollars (float) to cents (integer)
  dollarsToCents: (dollars: number): number => {
    return Math.round(dollars * 100);
  },
  
  // Convert cents to dollars (float)
  centsToDollars: (cents: number): number => {
    return cents / 100;
  },
  
  // Parse a dollar string input to cents
  parseToCents: (input: string | number): number => {
    if (typeof input === 'number') {
      return Math.round(input * 100);
    }
    // Remove $ and whitespace
    const cleaned = input.replace(/[$\s]/g, '');
    const dollars = parseFloat(cleaned);
    if (isNaN(dollars) || dollars < 0) return 0;
    return Math.round(dollars * 100);
  }
};

// Types
interface ImageMeta {
  url: string;
  itemName: string;
  fallbackUrl: string;
  loaded?: boolean;
  failed?: boolean;
}

interface InventoryItem {
  name: string;
  label: string;
  count: number;
  slot: number;
  metadata: Record<string, any>;
  image?: string;
  imageMeta?: ImageMeta;
}

interface Player {
  id: number;
  name: string;
  citizenid: string;
}

interface Auction {
  id: string;
  owner: Player;
  item: {
    name: string;
    label: string;
    count: number;
    metadata: Record<string, any>;
    image?: string;
    imageMeta?: ImageMeta;
  };
  category?: string;
  startingBidCents: number;
  currentBidCents: number;
  buyoutPriceCents?: number;
  highestBidder: Player | null;
  endTime: number;
  createdAt: number;
  status: 'active' | 'ended' | 'cancelled';
  totalBids: number;
  winner?: Player;
  soldForCents?: number;
}

interface BidEntry {
  playerId: number;
  playerName: string;
  citizenid: string;
  amountCents: number;
  timestamp: number;
}

interface Notification {
  id: string;
  type: 'outbid' | 'won' | 'lost' | 'sold' | 'expired' | 'error' | 'success' | 'info';
  title: string;
  message: string;
}

interface PlayerData {
  inventory: InventoryItem[];
  cashCents: number;
  bankCents: number;
  citizenid: string;
  playerName: string;
  feeConfig?: FeeConfig;
  buyoutConfig?: BuyoutConfig;
  categories?: Category[];
}

interface FeeConfig {
  enabled: boolean;
  baseFee: number;
  durationMultiplier: number;
  quantityMultiplier: number;
  maxFee: number;
  minFee: number;
}

interface FeeBreakdown {
  enabled: boolean;
  baseFeeCents: number;
  durationFeeCents: number;
  quantityFeeCents: number;
  totalCents: number;
  maxFeeCents?: number;
  minFeeCents?: number;
  wasCapped?: boolean;
}

interface FeePreview {
  breakdown: FeeBreakdown;
  playerFundsCents: number;
  canAfford: boolean;
}

interface Pagination {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
  query: string;
}

interface Category {
  id: string;
  label: string;
  icon: string;
  description: string;
}

interface BuyoutConfig {
  enabled: boolean;
  minMultiplier: number;
}

type ViewMode = 'card' | 'list';

// Pending Collection Types
interface PendingItem {
  itemName: string;
  itemLabel: string;
  count: number;
  metadata: Record<string, any>;
  auctionId: string;
  image?: string;
  imageMeta?: ImageMeta;
  soldForCents: number;
  sellerName: string;
  collectedAt?: number;
}

interface PendingMoney {
  amountCents: number;
  reason: string;
  auctionId?: string;
  itemName?: string;
  collectedAt?: number;
}

interface PendingCollections {
  money: PendingMoney | null;
  items: PendingItem[];
}

// Image cache for tracking loaded images across components
const imageCache: Record<string, { loaded: boolean; failed: boolean }> = {};

// Async Image Component with fallback and error handling
function AsyncImage({ 
  imageMeta, 
  alt, 
  className,
  fallbackIcon = '📦'
}: { 
  imageMeta?: ImageMeta; 
  alt: string; 
  className?: string;
  fallbackIcon?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);

  const imageUrl = imageMeta?.url;
  const fallbackUrl = imageMeta?.fallbackUrl;
  const itemName = imageMeta?.itemName;

  useEffect(() => {
    if (!imageUrl) {
      setFailed(true);
      return;
    }

    // Check cache first
    if (imageCache[imageUrl]?.loaded) {
      setLoaded(true);
      setFailed(false);
      setCurrentUrl(imageUrl);
      return;
    }

    if (imageCache[imageUrl]?.failed) {
      setFailed(true);
      setLoaded(false);
      setCurrentUrl(fallbackUrl || null);
      return;
    }

    // Start loading
    setLoaded(false);
    setFailed(false);
    setCurrentUrl(imageUrl);
  }, [imageUrl, fallbackUrl]);

  const handleLoad = useCallback(() => {
    if (!imageUrl) return;
    
    setLoaded(true);
    setFailed(false);
    imageCache[imageUrl] = { loaded: true, failed: false };
    
    // Report to Lua
    fetchNui('imageLoaded', { url: imageUrl, itemName }, { success: true });
  }, [imageUrl, itemName]);

  const handleError = useCallback(() => {
    if (!imageUrl) return;
    
    setFailed(true);
    setLoaded(false);
    imageCache[imageUrl] = { loaded: false, failed: true };
    
    // Switch to fallback
    if (fallbackUrl) {
      setCurrentUrl(fallbackUrl);
    }
    
    // Report to Lua
    fetchNui('imageFailed', { url: imageUrl, itemName }, { success: true });
  }, [imageUrl, itemName, fallbackUrl]);

  // No image metadata - show placeholder
  if (!imageMeta || !imageUrl) {
    return (
      <div className={`${className || ''} flex items-center justify-center bg-stone-800`}>
        <span className="text-3xl text-stone-600">{fallbackIcon}</span>
      </div>
    );
  }

  // Image failed and no fallback - show placeholder
  if (failed && !fallbackUrl) {
    return (
      <div className={`${className || ''} flex items-center justify-center bg-stone-800`}>
        <span className="text-3xl text-stone-600">{fallbackIcon}</span>
      </div>
    );
  }

  return (
    <div className={`${className || ''} relative overflow-hidden`}>
      <img 
        src={currentUrl || ''} 
        alt={alt}
        className={`w-full h-full object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={handleLoad}
        onError={handleError}
      />
      {(!loaded && !failed) && (
        <div className="absolute inset-0 flex items-center justify-center bg-stone-800">
          <div className="animate-pulse text-stone-600 text-2xl">⏳</div>
        </div>
      )}
    </div>
  );
}

// Notification Component
function NotificationToast({ notification, onDismiss }: { notification: Notification; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const icons: Record<string, string> = {
    outbid: '⚠',
    won: '🏆',
    lost: '💔',
    sold: '💰',
    expired: '⏰',
    error: '❌',
    success: '✓',
    info: 'ℹ'
  };

  const colors: Record<string, string> = {
    outbid: 'border-amber-600 bg-amber-900/90',
    won: 'border-emerald-600 bg-emerald-900/90',
    lost: 'border-rose-600 bg-rose-900/90',
    sold: 'border-green-600 bg-green-900/90',
    expired: 'border-stone-600 bg-stone-800/90',
    error: 'border-red-600 bg-red-900/90',
    success: 'border-green-600 bg-green-900/90',
    info: 'border-blue-600 bg-blue-900/90'
  };

  return (
    <div className={`flex items-start gap-3 p-4 rounded-lg border shadow-lg animate-slideIn ${colors[notification.type]}`}>
      <span className="text-xl">{icons[notification.type]}</span>
      <div className="flex-1">
        <p className="text-white font-medium text-sm">{notification.title}</p>
        <p className="text-stone-300 text-xs mt-1">{notification.message}</p>
      </div>
      <button onClick={onDismiss} className="text-stone-400 hover:text-white text-sm">✕</button>
    </div>
  );
}

// Countdown Timer Component
function CountdownTimer({ endTime }: { endTime: number }) {
  const [remaining, setRemaining] = useState(endTime - Math.floor(Date.now() / 1000));

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(Math.max(0, endTime - Math.floor(Date.now() / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [endTime]);

  if (remaining <= 0) return <span className="text-red-400 font-semibold">Ended</span>;

  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;

  const timeString = hours > 0
    ? `${hours}h ${minutes}m ${seconds}s`
    : minutes > 0
      ? `${minutes}m ${seconds}s`
      : `${seconds}s`;

  const colorClass = remaining < 60 ? 'text-red-400' : remaining < 300 ? 'text-amber-400' : 'text-stone-200';

  return <span className={`font-mono ${colorClass}`}>{timeString}</span>;
}

// Helper to get category info by id
function getCategoryInfo(categoryId: string | undefined, categories: Category[] | undefined): Category | undefined {
  if (!categoryId || !categories) return undefined;
  return categories.find(c => c.id === categoryId);
}

function isHorseAuctionEntry(item: InventoryItem | null | undefined): boolean {
  if (!item) return false;
  return item?.metadata?.auctionType === 'horse'
    || item?.metadata?.auctionCategory === 'horses'
    || typeof item?.metadata?.horseId !== 'undefined'
    || typeof item?.metadata?.horseModel !== 'undefined'
    || String(item.name || '').startsWith('horse_');
}

function isHorseAuction(auction: Auction | null | undefined): boolean {
  if (!auction) return false;
  return auction?.item?.metadata?.auctionType === 'horse'
    || auction?.item?.metadata?.auctionCategory === 'horses'
    || typeof auction?.item?.metadata?.horseId !== 'undefined'
    || typeof auction?.item?.metadata?.horseModel !== 'undefined'
    || String(auction?.item?.name || '').startsWith('horse_')
    || auction?.category === 'horses';
}

function formatHorseModelName(model: string | undefined): string {
  if (!model) return 'Unknown Breed';
  const normalized = model.replace(/^a_c_horse_/i, '').replace(/^a_c_/i, '').replace(/_/g, ' ').trim();
  return normalized
    .split(' ')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

const horseCoatLabels: Record<string, string> = {
  a_c_horse_arabian_white: 'White',
  a_c_horse_arabian_redchestnut_pc: 'Red Chestnut',
  a_c_horse_arabian_warpedbrindle_pc: 'Warped Brindle',
  a_c_horse_andalusian_perlino: 'Perlino',
  a_c_horse_mustang_tigerstripedbay: 'Tiger Striped Bay',
  a_c_horse_shire_ravenblack: 'Raven Black',
  a_c_horse_kladruber_black: 'Black',
  a_c_horse_appaloosa_fewspotted_pc: 'Few Spotted',
  a_c_horse_mustang_goldendun: 'Golden Dun',
  a_c_horse_nokota_whiteroan: 'White Roan',
  a_c_horse_missourifoxtrotter_silverdapplepinto: 'Silver Dapple Pinto',
};

const horseHandlingByModel: Record<string, string> = {
  a_c_horse_arabian_white: 'Elite',
  a_c_horse_arabian_redchestnut_pc: 'Elite',
  a_c_horse_arabian_warpedbrindle_pc: 'Elite',
  a_c_horse_andalusian_perlino: 'Standard',
  a_c_horse_mustang_tigerstripedbay: 'Standard',
  a_c_horse_shire_ravenblack: 'Heavy',
  a_c_horse_kladruber_black: 'Standard',
  a_c_horse_appaloosa_fewspotted_pc: 'Standard',
  a_c_horse_mustang_goldendun: 'Standard',
  a_c_horse_nokota_whiteroan: 'Race',
  a_c_horse_missourifoxtrotter_silverdapplepinto: 'Standard',
};

function getHorseCoatLabel(model: string | undefined): string {
  if (!model) return 'Unknown';
  return horseCoatLabels[String(model).toLowerCase()] || 'Unknown';
}

function getHorseHandlingFromModel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  return horseHandlingByModel[String(model).toLowerCase()];
}

function getHorseLevel(xp: number): number {
  if (xp >= 4000) return 10;
  if (xp >= 3000) return 9;
  if (xp >= 2000) return 8;
  if (xp >= 1000) return 7;
  if (xp >= 500) return 6;
  if (xp >= 400) return 5;
  if (xp >= 300) return 4;
  if (xp >= 200) return 3;
  if (xp >= 100) return 2;
  return 1;
}

function getHorseBondingLevel(xp: number): number {
  if (xp > 3750) return 4;
  if (xp > 2500) return 3;
  if (xp > 1250) return 2;
  return 1;
}

function getHorseHandlingLabel(level: number): string {
  if (level >= 7) return 'Elite';
  if (level >= 5) return 'Race';
  if (level >= 3) return 'Standard';
  return 'Heavy';
}

function normalizeHorseHandlingLabel(
  handling: string | undefined,
  fallbackLevel: number,
  model?: string | undefined,
): string {
  if (fallbackLevel >= 7) return 'Elite';
  if (fallbackLevel >= 5) return 'Race';
  if (fallbackLevel >= 3) return 'Standard';

  const value = String(handling || '').toUpperCase();

  if (value === 'HORSE_HANDLING_ELITE' || value === 'ELITE') return 'Elite';
  if (value === 'HORSE_HANDLING_RACE' || value === 'RACE') return 'Race';
  if (value === 'HORSE_HANDLING_STANDARD' || value === 'STANDARD') return 'Standard';
  if (value === 'HORSE_HANDLING_HEAVY' || value === 'HEAVY') return 'Heavy';

  const modelHandling = getHorseHandlingFromModel(model);
  if (modelHandling) return modelHandling;

  return getHorseHandlingLabel(fallbackLevel);
}

function getHorseAgeDays(born: number): number | null {
  if (!born || born <= 0) return null;
  return Math.max(0, Math.floor((Date.now() / 1000 - born) / 86400));
}

function getHorseAuctionDetails(auction: Auction) {
  const metadata = auction.item.metadata || {};
  const xp = Number(metadata.horseXp || 0);
  const level = getHorseLevel(xp);
  const bond = getHorseBondingLevel(xp);
  const ageDays = getHorseAgeDays(Number(metadata.horseBorn || 0));

  return {
    breed: formatHorseModelName(metadata.horseModel),
    coat: getHorseCoatLabel(metadata.horseModel),
    gender: metadata.horseGender || 'Unknown',
    stable: metadata.horseStable || 'Unknown',
    horseId: metadata.horseId || 'Unknown',
    xp,
    level,
    bond,
    ageDays,
    speed: Number(metadata.horseSpeedValue ?? level),
    acceleration: Number(metadata.horseAccValue ?? level),
    handling: normalizeHorseHandlingLabel(metadata.horseHandling, level, metadata.horseModel),
  };
}

function HorseStatBar({ value }: { value: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: 10 }, (_, index) => (
        <span
          key={index}
          className={`h-2 w-3 rounded-sm ${index < Math.max(0, Math.min(10, value)) ? 'bg-amber-500' : 'bg-stone-700'}`}
        />
      ))}
    </div>
  );
}

function getHorseHandlingBadgeLabel(handling: string): string {
  const normalized = String(handling || '').toLowerCase();
  if (normalized === 'elite') return 'E';
  if (normalized === 'race') return 'R';
  if (normalized === 'standard') return 'S';
  return 'H';
}

function HorseStatBadge({
  label,
  value,
  accentClass = 'text-amber-300',
}: {
  label: string;
  value: string;
  accentClass?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-amber-700/50 bg-stone-900/90 shadow-inner shadow-black/30">
        <span className={`text-sm font-semibold ${accentClass}`}>{value}</span>
      </div>
      <span className="text-[10px] uppercase tracking-[0.2em] text-stone-500">{label}</span>
    </div>
  );
}

// Auction Card Component
function AuctionCard({ 
  auction, 
  onSelect, 
  isSelected,
  playerCitizenid,
  categories
}: { 
  auction: Auction; 
  onSelect: () => void;
  isSelected: boolean;
  playerCitizenid: string;
  categories?: Category[];
}) {
  const isOwnAuction = auction.owner.citizenid === playerCitizenid;
  const isHighestBidder = auction.highestBidder?.citizenid === playerCitizenid;
  const categoryInfo = getCategoryInfo(auction.category, categories);
  const isHorse = isHorseAuction(auction);

  return (
    <div 
      onClick={onSelect}
      className={`p-4 rounded-lg border cursor-pointer transition-all duration-200 hover:scale-[1.02] ${
        isSelected 
          ? 'border-amber-500 bg-amber-950/50 shadow-lg shadow-amber-900/30' 
          : 'border-stone-700 bg-stone-900/50 hover:border-stone-600'
      }`}
    >
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-white font-semibold truncate">{auction.item.label}</h3>
            {categoryInfo && (
              <span className="px-1.5 py-0.5 text-[10px] bg-stone-700 text-stone-300 rounded flex-shrink-0" title={categoryInfo.description}>
                {categoryInfo.icon} {categoryInfo.label}
              </span>
            )}
          </div>
          <p className="text-stone-500 text-xs">ID: {auction.id}</p>
          <p className="text-stone-400 text-xs">Qty: {auction.item.count}</p>
        </div>
        <div className="flex flex-col gap-1 items-end">
          {isOwnAuction && (
            <span className="px-2 py-0.5 text-xs bg-amber-800 text-amber-200 rounded">Your Auction</span>
          )}
          {isHighestBidder && !isOwnAuction && (
            <span className="px-2 py-0.5 text-xs bg-emerald-800 text-emerald-200 rounded">Winning</span>
          )}
        </div>
      </div>

      <AsyncImage 
        imageMeta={auction.item.imageMeta}
        alt={auction.item.label}
        className="w-full h-36 rounded-lg mb-3"
        fallbackIcon={isHorse ? '🐎' : '📦'}
      />

      <div className="flex justify-between items-center text-sm">
        <div>
          <p className="text-stone-500 text-xs">Current Bid</p>
          <p className="text-amber-400 font-semibold">
            {Money.formatWithCommas((auction.currentBidCents || 0) > 0 ? auction.currentBidCents : auction.startingBidCents)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-stone-500 text-xs">Ends In</p>
          <CountdownTimer endTime={auction.endTime} />
        </div>
      </div>

      {auction.buyoutPriceCents && auction.buyoutPriceCents > 0 && (
        <div className="mt-2 pt-2 border-t border-stone-700/50 flex items-center justify-between">
          <span className="text-emerald-400 text-xs font-medium">Buy Now</span>
          <span className="text-emerald-300 text-sm font-semibold">{Money.format(auction.buyoutPriceCents)}</span>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-stone-700/50 flex justify-between text-xs text-stone-500">
        <span>By {auction.owner.name}</span>
        <span>{auction.totalBids} bid{auction.totalBids !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}

// Auction List Row Component (Compact)
function AuctionListRow({ 
  auction, 
  onSelect, 
  isSelected,
  playerCitizenid,
  categories
}: { 
  auction: Auction; 
  onSelect: () => void;
  isSelected: boolean;
  playerCitizenid: string;
  categories?: Category[];
}) {
  const isOwnAuction = auction.owner.citizenid === playerCitizenid;
  const isHighestBidder = auction.highestBidder?.citizenid === playerCitizenid;
  const categoryInfo = getCategoryInfo(auction.category, categories);
  const isHorse = isHorseAuction(auction);

  return (
    <div 
      onClick={onSelect}
      className={`flex items-center gap-4 p-3 rounded-lg border cursor-pointer transition-all duration-200 ${
        isSelected 
          ? 'border-amber-500 bg-amber-950/50' 
          : 'border-stone-700/50 bg-stone-900/30 hover:bg-stone-800/50 hover:border-stone-600'
      }`}
    >
      {/* Item Image */}
      <AsyncImage 
        imageMeta={auction.item.imageMeta}
        alt={auction.item.label}
        className="w-12 h-12 rounded-lg flex-shrink-0"
        fallbackIcon={isHorse ? '🐎' : '📦'}
      />
      
      {/* Item Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-white font-medium truncate">{auction.item.label}</h3>
          {categoryInfo && (
            <span className="px-1.5 py-0.5 text-[10px] bg-stone-700 text-stone-300 rounded flex-shrink-0">
              {categoryInfo.icon}
            </span>
          )}
          {isOwnAuction && (
            <span className="px-1.5 py-0.5 text-[10px] bg-amber-800 text-amber-200 rounded flex-shrink-0">Yours</span>
          )}
          {isHighestBidder && !isOwnAuction && (
            <span className="px-1.5 py-0.5 text-[10px] bg-emerald-800 text-emerald-200 rounded flex-shrink-0">Winning</span>
          )}
        </div>
        <p className="text-stone-500 text-xs truncate">ID: {auction.id} | Qty: {auction.item.count} | By {auction.owner.name}</p>
      </div>
      
      {/* Bid Info */}
      <div className="text-right flex-shrink-0 w-28">
        <p className="text-amber-400 font-semibold text-sm">
          {Money.formatWithCommas((auction.currentBidCents || 0) > 0 ? auction.currentBidCents : auction.startingBidCents)}
        </p>
        <p className="text-stone-500 text-xs">{auction.totalBids} bid{auction.totalBids !== 1 ? 's' : ''}</p>
      </div>

      {/* Buyout */}
      {auction.buyoutPriceCents && auction.buyoutPriceCents > 0 && (
        <div className="text-right flex-shrink-0 w-24">
          <p className="text-emerald-400 font-semibold text-sm">{Money.format(auction.buyoutPriceCents)}</p>
          <p className="text-emerald-600 text-xs">Buy Now</p>
        </div>
      )}

      {/* Timer */}
      <div className="text-right flex-shrink-0 w-24">
        <CountdownTimer endTime={auction.endTime} />
      </div>
    </div>
  );
}

// Create Auction Form Component
function CreateAuctionForm({
  inventory,
  onCreate,
  onClose,
  isSubmitting,
  feeConfig,
  buyoutConfig,
  playerFundsCents,
  categories
}: {
  inventory: InventoryItem[];
  onCreate: (data: { itemName: string; count: number; startingBid: number; duration: number; category: string; buyoutPrice?: number; customImageUrl?: string }) => void;
  onClose: () => void;
  isSubmitting: boolean;
  feeConfig?: FeeConfig;
  buyoutConfig?: BuyoutConfig;
  playerFundsCents: number;
  categories?: Category[];
}) {
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [count, setCount] = useState(1);
  const [startingBidDollars, setStartingBidDollars] = useState<string>('1.00');
  const [buyoutDollars, setBuyoutDollars] = useState<string>('');
  const [duration, setDuration] = useState(3600);
  const [searchQuery, setSearchQuery] = useState('');
  const [customHorseImageUrl, setCustomHorseImageUrl] = useState('');

  const filteredInventory = useMemo(() => {
    let items = inventory;
    if (searchQuery) {
      items = items.filter(item =>
        item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    return items;
  }, [inventory, searchQuery]);

  // Calculate local fee preview (client-side for responsiveness)
  // All values in CENTS
  const localFeePreview = useMemo(() => {
    if (!feeConfig || !feeConfig.enabled) {
      return { enabled: false, totalCents: 0, baseFeeCents: 0, durationFeeCents: 0, quantityFeeCents: 0 };
    }

    const baseFeeCents = Money.dollarsToCents(feeConfig.baseFee || 5);
    const durationMultiplierCents = Money.dollarsToCents(feeConfig.durationMultiplier || 2);
    const quantityMultiplierCents = Money.dollarsToCents(feeConfig.quantityMultiplier || 0.5);
    const maxFeeCents = Money.dollarsToCents(feeConfig.maxFee || 500);
    const minFeeCents = Money.dollarsToCents(feeConfig.minFee || 5);

    const durationHours = duration / 3600;
    const durationFeeCents = Math.floor(durationMultiplierCents * durationHours);
    const quantityFeeCents = quantityMultiplierCents * count;
    const totalFeeCents = baseFeeCents + durationFeeCents + quantityFeeCents;

    const cappedFeeCents = Math.max(minFeeCents, Math.min(maxFeeCents, totalFeeCents));
    const wasCapped = totalFeeCents > maxFeeCents;

    return {
      enabled: true,
      baseFeeCents,
      durationFeeCents,
      quantityFeeCents,
      totalCents: cappedFeeCents,
      maxFeeCents,
      minFeeCents,
      wasCapped
    };
  }, [feeConfig, duration, count]);

  const canAffordFee = playerFundsCents >= localFeePreview.totalCents;
  const selectedCategoryLabel = categories?.find(c => c.id === selectedCategory)?.label || '';
  const isHorseListing = isHorseAuctionEntry(selectedItem);

  // Calculate buyout validation
  const startingBidCents = Money.parseToCents(startingBidDollars);
  const buyoutCents = buyoutDollars ? Money.parseToCents(buyoutDollars) : 0;
  const minBuyoutCents = buyoutConfig?.enabled ? Math.ceil(startingBidCents * (buyoutConfig.minMultiplier || 1.5)) : 0;
  const isBuyoutValid = !buyoutDollars || buyoutCents >= minBuyoutCents;

  const handleSubmit = (e: import('react').FormEvent) => {
    e.preventDefault();
    if (!selectedItem || count < 1 || startingBidCents < 1) return;
    if (!canAffordFee) return;
    if (!selectedCategory) return;
    if (buyoutDollars && !isBuyoutValid) return;
    onCreate({
      itemName: selectedItem.name,
      count: isHorseListing ? 1 : count,
      startingBid: startingBidCents,
      duration,
      category: selectedCategory,
      buyoutPrice: buyoutDollars ? buyoutCents : undefined,
      customImageUrl: isHorseListing ? customHorseImageUrl.trim() || undefined : undefined
    });
  };

  const durationOptions = [
    { label: '1 Minute', value: 60 },
    { label: '10 Minutes', value: 600 },
    { label: '30 Minutes', value: 1800 },
    { label: '1 Hour', value: 3600 },
    { label: '6 Hours', value: 21600 },
    { label: '12 Hours', value: 43200 },
    { label: '1 Day', value: 86400 },
    { label: '3 Days', value: 259200 },
    { label: '7 Days', value: 604800 }
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-stone-700">
        <h2 className="text-xl font-semibold text-white">Create Auction</h2>
        <button onClick={onClose} className="text-stone-400 hover:text-white text-lg">✕</button>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Item Selection */}
        <div>
          <label className="block text-stone-300 text-sm mb-2">Select Item</label>
          <input
            type="text"
            placeholder="Search inventory..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-white placeholder-stone-500 focus:outline-none focus:border-amber-600 mb-2"
          />
          <div className="max-h-52 overflow-y-auto border border-stone-700 rounded-lg">
            {filteredInventory.length === 0 ? (
              <p className="p-3 text-stone-500 text-sm text-center">
                No items found
              </p>
            ) : (
              filteredInventory.map((item) => (
                  <div
                    key={item.name}
                    onClick={() => {
                      setSelectedItem(item);
                      setCount(1);
                      setCustomHorseImageUrl('');
                      if (isHorseAuctionEntry(item)) {
                        setSelectedCategory('horses');
                      }
                    }}
                    className={`flex justify-between items-center p-3 cursor-pointer transition-colors ${
                      selectedItem?.name === item.name
                        ? 'bg-amber-900/50 border-l-2 border-amber-500'
                        : 'hover:bg-stone-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <AsyncImage
                        imageMeta={item.imageMeta}
                        alt={item.label}
                        className="w-8 h-8 rounded"
                        fallbackIcon={isHorseAuctionEntry(item) ? '🐎' : '📦'}
                      />
                      <div>
                        <p className="text-white text-sm">{item.label}</p>
                        <p className="text-stone-500 text-xs">{item.name}</p>
                      </div>
                    </div>
                    <span className="text-stone-400 text-sm">x{item.count}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {selectedItem && (
            <>
              {/* Quantity */}
              {isHorseListing ? (
                <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-4">
                  <p className="text-amber-300 text-sm font-medium">Horse Listing</p>
                  <p className="text-stone-400 text-xs mt-1">
                    Bring your active owned horse close to the auctioneer to list it here.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-stone-500">Horse ID</p>
                      <p className="text-white">{selectedItem.metadata.horseId || 'Unknown'}</p>
                    </div>
                    <div>
                      <p className="text-stone-500">Model</p>
                      <p className="text-white break-all">{selectedItem.metadata.horseModel || 'Unknown'}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-stone-300 text-sm mb-2">Quantity</label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setCount(Math.max(1, count - 1))}
                      className="w-10 h-10 bg-stone-800 border border-stone-700 rounded-lg text-white hover:bg-stone-700"
                    >-</button>
                    <input
                      type="number"
                      min={1}
                      max={selectedItem.count}
                      value={count}
                      onChange={(e) => setCount(Math.min(selectedItem.count, Math.max(1, parseInt(e.target.value) || 1)))}
                      className="flex-1 bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-white text-center focus:outline-none focus:border-amber-600"
                    />
                    <button
                      type="button"
                      onClick={() => setCount(Math.min(selectedItem.count, count + 1))}
                      className="w-10 h-10 bg-stone-800 border border-stone-700 rounded-lg text-white hover:bg-stone-700"
                    >+</button>
                    <button
                      type="button"
                      onClick={() => setCount(selectedItem.count)}
                      className="px-3 h-10 bg-stone-800 border border-stone-700 rounded-lg text-stone-300 text-sm hover:bg-stone-700"
                    >Max</button>
                  </div>
                  <p className="text-stone-500 text-xs mt-1">Available: {selectedItem.count}</p>
                </div>
              )}

              {/* Starting Bid */}
              <div>
                <label className="block text-stone-300 text-sm mb-2">Starting Bid ($)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={startingBidDollars}
                  onChange={(e) => setStartingBidDollars(e.target.value)}
                  className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-amber-600"
                />
                <p className="text-stone-500 text-xs mt-1">Minimum: $0.01 (enter amount like 0.20 or 1.50)</p>
              </div>

              {/* Buyout Price */}
              {buyoutConfig?.enabled && (
                <div>
                  <label className="block text-stone-300 text-sm mb-2">Buyout Price ($) <span className="text-stone-500 text-xs">(optional)</span></label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Leave empty for no buyout"
                    value={buyoutDollars}
                    onChange={(e) => setBuyoutDollars(e.target.value)}
                    className={`w-full bg-stone-800 border rounded-lg px-3 py-2 text-white focus:outline-none ${
                      buyoutDollars && !isBuyoutValid ? 'border-red-600 focus:border-red-500' : 'border-stone-700 focus:border-amber-600'
                    }`}
                  />
                  {buyoutDollars && !isBuyoutValid && (
                    <p className="text-red-400 text-xs mt-1">
                      Minimum buyout: {Money.format(minBuyoutCents)} ({buyoutConfig.minMultiplier}x starting bid)
                    </p>
                  )}
                  {buyoutDollars && isBuyoutValid && (
                    <p className="text-emerald-400 text-xs mt-1">
                      Buyers can instantly purchase for {Money.format(buyoutCents)}
                    </p>
                  )}
                  {!buyoutDollars && (
                    <p className="text-stone-500 text-xs mt-1">
                      Minimum: {Money.format(minBuyoutCents)} ({buyoutConfig.minMultiplier}x starting bid)
                    </p>
                  )}
                </div>
              )}

              {/* Duration */}
              <div>
                <label className="block text-stone-300 text-sm mb-2">Duration</label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(parseInt(e.target.value))}
                  className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-amber-600"
                >
                  {durationOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Category */}
              <div>
                <label className="block text-stone-300 text-sm mb-2">Category</label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  disabled={isHorseListing}
                  className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-amber-600"
                >
                  <option value="">Select a category...</option>
                  {categories?.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.icon} {cat.label}</option>
                  ))}
                </select>
              </div>

              {isHorseListing && (
                <div>
                  <label className="block text-stone-300 text-sm mb-2">Custom Horse Image (Optional)</label>
                  <input
                    type="text"
                    placeholder="https://cdn.discordapp.com/..."
                    value={customHorseImageUrl}
                    onChange={(e) => setCustomHorseImageUrl(e.target.value)}
                    className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-amber-600"
                  />
                  <p className="text-stone-500 text-xs mt-1">
                    Discord-hosted image URLs only.
                  </p>
                </div>
              )}

              {/* Fee Breakdown */}
              {localFeePreview.enabled && (
                <div className={`rounded-lg p-4 border ${
                  canAffordFee
                    ? 'bg-stone-800/50 border-stone-700'
                    : 'bg-red-950/50 border-red-800'
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-stone-400 text-xs uppercase tracking-wide">Creation Fee</h4>
                    <span className={`text-lg font-bold ${canAffordFee ? 'text-amber-400' : 'text-red-400'}`}>
                      {Money.format(localFeePreview.totalCents)}
                    </span>
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-stone-500">Base fee</span>
                      <span className="text-stone-300">{Money.format(localFeePreview.baseFeeCents)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-500">Duration ({(duration / 3600).toFixed(1)} hrs × {Money.format(feeConfig?.durationMultiplier ? Money.dollarsToCents(feeConfig.durationMultiplier) : 200)})</span>
                      <span className="text-stone-300">{Money.format(localFeePreview.durationFeeCents)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-500">Quantity ({count} × {Money.format(feeConfig?.quantityMultiplier ? Money.dollarsToCents(feeConfig.quantityMultiplier) : 50)})</span>
                      <span className="text-stone-300">{Money.format(localFeePreview.quantityFeeCents)}</span>
                    </div>
                    {localFeePreview.wasCapped && (
                      <div className="flex justify-between text-amber-400">
                        <span>Fee capped at max</span>
                        <span>{Money.format(localFeePreview.maxFeeCents || 0)}</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 pt-3 border-t border-stone-700/50 flex justify-between text-xs">
                    <span className="text-stone-500">Your funds</span>
                    <span className={canAffordFee ? 'text-emerald-400' : 'text-red-400'}>
                      {Money.formatWithCommas(playerFundsCents)}
                    </span>
                  </div>
                </div>
              )}

              {/* Summary */}
              <div className="bg-stone-800/50 rounded-lg p-4 border border-stone-700">
                <h4 className="text-stone-400 text-xs uppercase tracking-wide mb-3">Auction Summary</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-stone-400">Item</span>
                    <span className="text-white">{selectedItem.label} x{isHorseListing ? 1 : count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-400">Category</span>
                    <span className={selectedCategory ? 'text-amber-400' : 'text-red-400'}>
                      {selectedCategoryLabel || 'Select a category'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-400">Starting Bid</span>
                    <span className="text-amber-400">{Money.format(Money.parseToCents(startingBidDollars))}</span>
                  </div>
                  {buyoutDollars && isBuyoutValid && (
                    <div className="flex justify-between">
                      <span className="text-stone-400">Buyout Price</span>
                      <span className="text-emerald-400">{Money.format(buyoutCents)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-stone-400">Duration</span>
                    <span className="text-white">{durationOptions.find(o => o.value === duration)?.label}</span>
                  </div>
                  {localFeePreview.enabled && (
                    <div className="flex justify-between">
                      <span className="text-stone-400">Creation Fee</span>
                      <span className={canAffordFee ? 'text-amber-400' : 'text-red-400'}>{Money.format(localFeePreview.totalCents)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={isSubmitting || !canAffordFee || !selectedCategory}
                className={`w-full font-semibold py-3 rounded-lg transition-colors ${
                  isSubmitting || !canAffordFee || !selectedCategory
                    ? 'bg-stone-700 text-stone-400 cursor-not-allowed'
                    : 'bg-amber-700 hover:bg-amber-600 text-white'
                }`}
              >
                {!selectedCategory
                  ? 'Select a category first'
                  : !canAffordFee
                    ? `Insufficient Funds (Need ${Money.format(localFeePreview.totalCents)})`
                    : isSubmitting
                      ? 'Creating...'
                      : `Create Auction (${Money.format(localFeePreview.totalCents)} fee)`
                }
              </button>
            </>
          )}
        </form>
    </div>
  );
}

// Auction Detail View Component
function AuctionDetailView({
  auction,
  bidHistory,
  playerCitizenid,
  playerFundsCents,
  onPlaceBid,
  onBuyout,
  onCancel,
  onBack,
  categories
}: {
  auction: Auction;
  bidHistory: BidEntry[];
  playerCitizenid: string;
  playerFundsCents: { cashCents: number; bankCents: number };
  onPlaceBid: (amountCents: number) => void;
  onBuyout: () => void;
  onCancel: () => void;
  onBack: () => void;
  categories?: Category[];
}) {
  const [bidAmountDollars, setBidAmountDollars] = useState<string>('');
  const [showConfirmCancel, setShowConfirmCancel] = useState(false);
  const [showConfirmBuyout, setShowConfirmBuyout] = useState(false);

  const isOwnAuction = auction.owner.citizenid === playerCitizenid;
  const isHighestBidder = auction.highestBidder?.citizenid === playerCitizenid;
  const categoryInfo = getCategoryInfo(auction.category, categories);
  const horseDetails = isHorseAuction(auction) ? getHorseAuctionDetails(auction) : null;
  const totalFundsCents = playerFundsCents.cashCents + playerFundsCents.bankCents;
  const currentBidCents = auction.currentBidCents || 0;
  const startingBidCents = auction.startingBidCents || 0;
  const buyoutPriceCents = auction.buyoutPriceCents || 0;
  const minBidCents = currentBidCents > 0 
    ? Math.ceil(currentBidCents * 1.05) 
    : startingBidCents;
  const canBid = !isOwnAuction && auction.status === 'active' && totalFundsCents >= minBidCents;
  const canBuyout = !isOwnAuction && auction.status === 'active' && buyoutPriceCents > 0 && totalFundsCents >= buyoutPriceCents;
  const canCancel = isOwnAuction && auction.totalBids === 0 && auction.status === 'active';

  const handleBid = () => {
    const bidCents = Money.parseToCents(bidAmountDollars);
    if (bidCents >= minBidCents && bidCents <= totalFundsCents) {
      onPlaceBid(bidCents);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-stone-700">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-stone-400 hover:text-white text-lg">←</button>
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-white">{auction.item.label}</h2>
            <p className="text-stone-500 text-xs">Auction ID: {auction.id}</p>
          </div>
          {isOwnAuction && (
            <span className="px-2 py-0.5 text-xs bg-amber-800 text-amber-200 rounded">Your Auction</span>
          )}
          {isHighestBidder && !isOwnAuction && (
            <span className="px-2 py-0.5 text-xs bg-emerald-800 text-emerald-200 rounded">You're Winning!</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Item Info */}
        <div className="p-4 border-b border-stone-700/50">
          <div className="flex gap-4">
            <AsyncImage 
              imageMeta={auction.item.imageMeta}
              alt={auction.item.label}
              className="w-24 h-24 bg-stone-800 rounded-lg border border-stone-700"
              fallbackIcon={horseDetails ? '🐎' : '📦'}
            />
            <div className="flex-1">
              <p className="text-white font-medium">{auction.item.label}</p>
              <p className="text-stone-500 text-sm">Quantity: {auction.item.count}</p>
              {categoryInfo && (
                <p className="text-stone-400 text-sm mt-1">
                  <span className="text-stone-500">Category:</span> {categoryInfo.icon} {categoryInfo.label}
                </p>
              )}
              <p className="text-stone-500 text-sm mt-1">Seller: {auction.owner.name}</p>
            </div>
          </div>
        </div>

        {horseDetails && (
          <div className="px-4 pb-4 border-b border-stone-700/50">
            <div className="rounded-xl border border-amber-800/40 bg-gradient-to-r from-amber-950/40 to-stone-900 p-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-amber-200 text-sm font-semibold uppercase tracking-wide">Horse Details</h3>
                  <p className="text-stone-500 text-xs mt-1">Saved horse data attached to this listing</p>
                </div>
                <span className="px-2 py-1 text-xs rounded-md bg-stone-800 text-stone-300">
                  Bonding {horseDetails.bond}/4
                </span>
              </div>

              <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                <div className="rounded-xl border border-stone-800 bg-stone-950/70 p-3">
                  <AsyncImage
                    imageMeta={auction.item.imageMeta}
                    alt={auction.item.label}
                    className="w-full h-56 rounded-lg object-contain bg-stone-900"
                    fallbackIcon="🐎"
                  />
                  <div className="mt-4 flex items-center justify-center gap-3">
                    <HorseStatBadge label="Speed" value={`${horseDetails.speed}`} />
                    <HorseStatBadge label="Accel" value={`${horseDetails.acceleration}`} />
                    <HorseStatBadge label="Handling" value={getHorseHandlingBadgeLabel(horseDetails.handling)} accentClass="text-stone-100" />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-stone-900/60 border border-stone-800 p-3">
                      <p className="text-stone-500 text-xs uppercase tracking-wide mb-1">Breed</p>
                      <p className="text-white">{horseDetails.breed}</p>
                    </div>
                    <div className="rounded-lg bg-stone-900/60 border border-stone-800 p-3">
                      <p className="text-stone-500 text-xs uppercase tracking-wide mb-1">Coat</p>
                      <p className="text-white">{horseDetails.coat}</p>
                    </div>
                    <div className="rounded-lg bg-stone-900/60 border border-stone-800 p-3">
                      <p className="text-stone-500 text-xs uppercase tracking-wide mb-1">Gender</p>
                      <p className="text-white">{horseDetails.gender}</p>
                    </div>
                    <div className="rounded-lg bg-stone-900/60 border border-stone-800 p-3">
                      <p className="text-stone-500 text-xs uppercase tracking-wide mb-1">Horse ID</p>
                      <p className="text-white">{horseDetails.horseId}</p>
                    </div>
                    <div className="rounded-lg bg-stone-900/60 border border-stone-800 p-3">
                      <p className="text-stone-500 text-xs uppercase tracking-wide mb-1">Stable</p>
                      <p className="text-white">{horseDetails.stable}</p>
                    </div>
                    <div className="rounded-lg bg-stone-900/60 border border-stone-800 p-3">
                      <p className="text-stone-500 text-xs uppercase tracking-wide mb-1">Training</p>
                      <p className="text-white">Level {horseDetails.level} • {horseDetails.xp.toLocaleString()} XP</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-lg bg-stone-900/60 border border-stone-800 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-stone-400 text-xs uppercase tracking-wide">Speed</span>
                        <span className="text-amber-300 text-xs font-medium">{horseDetails.speed}/10</span>
                      </div>
                      <HorseStatBar value={horseDetails.speed} />
                    </div>
                    <div className="rounded-lg bg-stone-900/60 border border-stone-800 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-stone-400 text-xs uppercase tracking-wide">Acceleration</span>
                        <span className="text-amber-300 text-xs font-medium">{horseDetails.acceleration}/10</span>
                      </div>
                      <HorseStatBar value={horseDetails.acceleration} />
                    </div>
                    <div className="rounded-lg bg-stone-900/60 border border-stone-800 p-3">
                      <p className="text-stone-400 text-xs uppercase tracking-wide mb-1">Handling</p>
                      <p className="text-white">{horseDetails.handling}</p>
                    </div>
                    <div className="rounded-lg bg-stone-900/60 border border-stone-800 p-3">
                      <p className="text-stone-400 text-xs uppercase tracking-wide mb-1">Age</p>
                      <p className="text-white">{horseDetails.ageDays === null ? 'Unknown' : `${horseDetails.ageDays} day${horseDetails.ageDays === 1 ? '' : 's'}`}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bidding Section */}
        {auction.status === 'active' && (
          <div className="p-4 border-b border-stone-700/50">
            <div className="flex justify-between items-center mb-3">
              <div>
                <p className="text-stone-500 text-xs">Current Bid</p>
                <p className="text-2xl font-bold text-amber-400">
                  {Money.formatWithCommas(currentBidCents > 0 ? currentBidCents : startingBidCents)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-stone-500 text-xs">Ends In</p>
                <p className="text-lg"><CountdownTimer endTime={auction.endTime} /></p>
              </div>
            </div>

            {auction.highestBidder && (
              <p className="text-stone-400 text-sm mb-3">
                Highest bidder: <span className="text-white">{auction.highestBidder.name}</span>
              </p>
            )}

            {/* Buyout Section */}
            {buyoutPriceCents > 0 && (
              <div className="mb-4 p-3 bg-emerald-950/50 border border-emerald-800/50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-emerald-400 text-sm font-medium">Buyout Price</span>
                  <span className="text-emerald-300 text-lg font-bold">{Money.format(buyoutPriceCents)}</span>
                </div>
                {!isOwnAuction && (
                  showConfirmBuyout ? (
                    <div className="space-y-2">
                      <p className="text-emerald-300 text-sm">Buy this item instantly for {Money.format(buyoutPriceCents)}?</p>
                      <div className="flex gap-2">
                        <button
                          onClick={onBuyout}
                          className="flex-1 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-sm font-semibold"
                        >
                          Yes, Buy Now
                        </button>
                        <button
                          onClick={() => setShowConfirmBuyout(false)}
                          className="flex-1 py-2 bg-stone-800 hover:bg-stone-700 text-white rounded-lg text-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowConfirmBuyout(true)}
                      disabled={!canBuyout}
                      className={`w-full py-2 rounded-lg font-semibold transition-colors ${
                        canBuyout
                          ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
                          : 'bg-stone-800 text-stone-500 cursor-not-allowed'
                      }`}
                    >
                      {totalFundsCents < buyoutPriceCents ? 'Insufficient Funds' : 'Buy Now'}
                    </button>
                  )
                )}
                {isOwnAuction && (
                  <p className="text-stone-500 text-xs text-center">You cannot buy your own auction</p>
                )}
              </div>
            )}

            {!isOwnAuction && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Enter bid amount..."
                    value={bidAmountDollars}
                    onChange={(e) => setBidAmountDollars(e.target.value)}
                    className="flex-1 bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-amber-600"
                  />
                  <button
                    onClick={() => setBidAmountDollars(Money.centsToDollars(minBidCents).toFixed(2))}
                    className="px-3 bg-stone-800 border border-stone-700 rounded-lg text-stone-300 text-sm hover:bg-stone-700"
                  >
                    Min
                  </button>
                </div>
                <p className="text-stone-500 text-xs">
                  Min bid: {Money.format(minBidCents)} | Your funds: {Money.formatWithCommas(totalFundsCents)}
                </p>
                <button
                  onClick={handleBid}
                  disabled={!canBid || Money.parseToCents(bidAmountDollars) < minBidCents}
                  className={`w-full py-3 rounded-lg font-semibold transition-colors ${
                    canBid && Money.parseToCents(bidAmountDollars) >= minBidCents
                      ? 'bg-amber-700 hover:bg-amber-600 text-white'
                      : 'bg-stone-800 text-stone-500 cursor-not-allowed'
                  }`}
                >
                  {totalFundsCents < minBidCents ? 'Insufficient Funds' : `Place Bid: ${Money.format(Money.parseToCents(bidAmountDollars))}`}
                </button>
              </div>
            )}

            {canCancel && (
              <div className="mt-4 pt-4 border-t border-stone-700/50">
                {showConfirmCancel ? (
                  <div className="space-y-2">
                    <p className="text-amber-400 text-sm">Cancel this auction? Item will be returned.</p>
                    <div className="flex gap-2">
                      <button
                        onClick={onCancel}
                        className="flex-1 py-2 bg-red-800 hover:bg-red-700 text-white rounded-lg text-sm"
                      >
                        Yes, Cancel
                      </button>
                      <button
                        onClick={() => setShowConfirmCancel(false)}
                        className="flex-1 py-2 bg-stone-800 hover:bg-stone-700 text-white rounded-lg text-sm"
                      >
                        No, Keep It
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowConfirmCancel(true)}
                    className="w-full py-2 bg-stone-800 hover:bg-stone-700 text-stone-400 rounded-lg text-sm"
                  >
                    Cancel Auction
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Bid History */}
        <div className="p-4">
          <h3 className="text-white font-medium mb-3">Bid History ({auction.totalBids})</h3>
          {bidHistory.length === 0 ? (
            <p className="text-stone-500 text-sm text-center py-4">No bids yet</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {bidHistory.map((bid, index) => (
                <div
                  key={index}
                  className={`flex justify-between items-center p-2 rounded ${
                    bid.citizenid === playerCitizenid ? 'bg-amber-900/30' : 'bg-stone-800/50'
                  }`}
                >
                  <div>
                    <p className="text-white text-sm">{bid.playerName}</p>
                    <p className="text-stone-500 text-xs">
                      {new Date(bid.timestamp * 1000).toLocaleTimeString()}
                    </p>
                  </div>
                  <span className="text-amber-400 font-medium">{Money.format(bid.amountCents)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Category Sidebar Component
function CategorySidebar({
  categories,
  selectedCategory,
  onSelectCategory,
  visible = true
}: {
  categories?: Category[];
  selectedCategory: string;
  onSelectCategory: (categoryId: string) => void;
  visible?: boolean;
}) {
  if (!visible || !categories || categories.length === 0) return null;

  const buttonBaseClass = "w-full text-left px-3 py-2.5 rounded-lg mb-1 text-sm transition-colors flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 focus-visible:ring-offset-stone-900";

  return (
    <div className="w-48 border-r border-stone-700 flex flex-col bg-stone-900/30">
      <div className="p-3 border-b border-stone-700">
        <h3 className="text-stone-400 text-xs uppercase tracking-wide font-medium">Categories</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <button
          onClick={() => onSelectCategory('')}
          className={`${buttonBaseClass} ${
            !selectedCategory 
              ? 'bg-amber-900/60 text-amber-200 border-l-2 border-amber-500' 
              : 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'
          }`}
        >
          <span className="text-base">📦</span>
          <span>All Items</span>
        </button>
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => onSelectCategory(cat.id)}
            className={`${buttonBaseClass} ${
              selectedCategory === cat.id 
                ? 'bg-amber-900/60 text-amber-200 border-l-2 border-amber-500' 
                : 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'
            }`}
            title={cat.description}
          >
            <span className="text-base">{cat.icon}</span>
            <span className="truncate">{cat.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Collection Kiosk Component
function CollectionKiosk({
  pendingCollections,
  onCollectItem,
  onCollectMoney,
  collectingItem,
  collectingMoney,
  onBack
}: {
  pendingCollections: PendingCollections;
  onCollectItem: (auctionId: string, itemName: string) => void;
  onCollectMoney: () => void;
  collectingItem: string | null;
  collectingMoney: boolean;
  onBack: () => void;
}) {
  const hasItems = pendingCollections.items.length > 0;
  const hasMoney = pendingCollections.money && (pendingCollections.money.amountCents || 0) > 0;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-stone-700">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-stone-400 hover:text-white text-lg">←</button>
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-white">Collection Kiosk</h2>
            <p className="text-stone-500 text-xs">Collect your winnings and sales</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* No collections message */}
        {!hasItems && !hasMoney && (
          <div className="h-64 flex items-center justify-center">
            <div className="text-center">
              <p className="text-4xl text-stone-700 mb-2">📭</p>
              <p className="text-stone-500">No pending collections</p>
              <p className="text-stone-600 text-sm mt-1">Win auctions or sell items to collect here</p>
            </div>
          </div>
        )}

        {/* Money Section */}
        {hasMoney && (
          <div className="bg-gradient-to-r from-amber-900/40 to-amber-800/20 border border-amber-700/50 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-amber-800/50 rounded-xl flex items-center justify-center">
                  <span className="text-2xl">💰</span>
                </div>
                <div>
                  <p className="text-amber-300 text-sm font-medium">Sales Earnings</p>
                  <p className="text-white text-2xl font-bold">
                    {Money.formatWithCommas(pendingCollections.money!.amountCents || 0)}
                  </p>
                  <p className="text-stone-400 text-xs mt-1">
                    {pendingCollections.money!.reason}
                    {pendingCollections.money!.itemName && ` - ${pendingCollections.money!.itemName}`}
                  </p>
                </div>
              </div>
              <button
                onClick={onCollectMoney}
                disabled={collectingMoney}
                className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
                  collectingMoney
                    ? 'bg-stone-700 text-stone-400 cursor-wait'
                    : 'bg-amber-700 hover:bg-amber-600 text-white'
                }`}
              >
                {collectingMoney ? 'Collecting...' : 'Collect'}
              </button>
            </div>
          </div>
        )}

        {/* Items Section */}
        {hasItems && (
          <div>
            <h3 className="text-stone-400 text-sm font-medium mb-3 uppercase tracking-wide">
              Won Items ({pendingCollections.items.length})
            </h3>
            <div className="space-y-3">
              {pendingCollections.items.map((item, index) => (
                <div
                  key={`${item.auctionId}-${index}`}
                  className="bg-stone-900/50 border border-stone-700 rounded-xl p-4 hover:border-stone-600 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <AsyncImage
                      imageMeta={item.imageMeta}
                      alt={item.itemLabel}
                      className="w-16 h-16 rounded-lg flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium truncate">{item.itemLabel}</p>
                      <p className="text-stone-400 text-sm">Quantity: {item.count}</p>
                      {(item.soldForCents || 0) > 0 && (
                        <p className="text-amber-400 text-sm mt-1">
                          Won for {Money.format(item.soldForCents)}
                        </p>
                      )}
                      <p className="text-stone-500 text-xs mt-1">
                        From: {item.sellerName}
                      </p>
                    </div>
                    <button
                      onClick={() => onCollectItem(item.auctionId, item.itemName)}
                      disabled={collectingItem === item.auctionId}
                      className={`px-5 py-2.5 rounded-lg font-medium transition-colors ${
                        collectingItem === item.auctionId
                          ? 'bg-stone-700 text-stone-400 cursor-wait'
                          : 'bg-emerald-700 hover:bg-emerald-600 text-white'
                      }`}
                    >
                      {collectingItem === item.auctionId ? 'Collecting...' : 'Collect'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer Info */}
      {(hasItems || hasMoney) && (
        <div className="p-4 border-t border-stone-700 bg-stone-900/50">
          <p className="text-stone-500 text-xs text-center">
            Items are collected to your inventory. Money is deposited to your bank.
          </p>
        </div>
      )}
    </div>
  );
}

// Main App Component
export default function App() {
  const [visible, setVisible] = useState(isDebug);
  const [view, setView] = useState<'list' | 'create' | 'detail' | 'collect'>('list');
  const [playerData, setPlayerData] = useState<PlayerData>({
    inventory: [],
    cashCents: 0,
    bankCents: 0,
    citizenid: '',
    playerName: ''
  });
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [bidHistory, setBidHistory] = useState<Record<string, BidEntry[]>>({});
  const [selectedAuctionId, setSelectedAuctionId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'mine'>('all');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // New state for view toggle, search, and pagination
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 10,
    totalCount: 0,
    totalPages: 0,
    hasMore: false,
    query: ''
  });
  const [isSearching, setIsSearching] = useState(false);
  const [pendingCollections, setPendingCollections] = useState<PendingCollections>({ money: null, items: [] });
  const [collectingItem, setCollectingItem] = useState<string | null>(null);
  const [collectingMoney, setCollectingMoney] = useState(false);

  // Add notification helper
  const addNotification = useCallback((notification: Omit<Notification, 'id'>) => {
    const id = Date.now().toString();
    setNotifications(prev => [...prev, { ...notification, id }]);
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // NUI Event Handlers
  useNuiEvent('open', (data: PlayerData) => {
    setPlayerData(data);
    setVisible(true);
    setView('list');
  });

  useNuiEvent('close', () => {
    setVisible(false);
    setView('list');
    setSelectedAuctionId(null);
  });

  useNuiEvent('receiveAuctions', (data: { auctions: Auction[]; bidHistory: Record<string, BidEntry[]> }) => {
    setAuctions(data.auctions);
    setBidHistory(data.bidHistory || {});
    setPagination(prev => ({
      ...prev,
      totalCount: data.auctions.length,
      totalPages: Math.ceil(data.auctions.length / prev.limit),
      hasMore: data.auctions.length > prev.limit
    }));
  });

  useNuiEvent('receiveSearchResults', (data: { auctions: Auction[]; bidHistory: Record<string, BidEntry[]>; pagination: Pagination }) => {
    setAuctions(data.auctions);
    setBidHistory(data.bidHistory || {});
    setPagination(data.pagination);
    setIsSearching(false);
  });

  useNuiEvent('auctionCreated', (auction: Auction) => {
    // Refresh search results to include new auction
    handleSearch(searchQuery, pagination.page);
    setBidHistory(prev => ({ ...prev, [auction.id]: [] }));
    setView('list');
    setIsSubmitting(false);
    addNotification({
      type: 'success',
      title: 'Auction Created',
      message: `${auction.item.label} (ID: ${auction.id}) is now up for auction!`
    });
  });

  useNuiEvent('bidPlaced', (data: { auctionId: string; currentBidCents: number; highestBidder: Player; totalBids: number; bidHistory: BidEntry[] }) => {
    setAuctions(prev => prev.map(a => 
      a.id === data.auctionId 
        ? { ...a, currentBidCents: data.currentBidCents, highestBidder: data.highestBidder, totalBids: data.totalBids }
        : a
    ));
    setBidHistory(prev => ({ ...prev, [data.auctionId]: data.bidHistory }));
    addNotification({
      type: 'success',
      title: 'Bid Placed',
      message: `Your bid of ${Money.format(data.currentBidCents)} is now the highest!`
    });
  });

  useNuiEvent('auctionEnded', (data: { auctionId: string; winner?: Player; soldForCents?: number }) => {
    // Refresh search results to remove ended auction
    handleSearch(searchQuery, pagination.page);
    if (selectedAuctionId === data.auctionId) {
      setSelectedAuctionId(null);
      setView('list');
    }
  });

  useNuiEvent('auctionCancelled', (data: { auctionId: string }) => {
    // Refresh search results to remove cancelled auction
    handleSearch(searchQuery, pagination.page);
    if (selectedAuctionId === data.auctionId) {
      setSelectedAuctionId(null);
      setView('list');
    }
    addNotification({
      type: 'info',
      title: 'Auction Cancelled',
      message: 'Your auction has been cancelled and item returned.'
    });
  });

  useNuiEvent('notification', (data: { type: string; auctionId: string; itemName: string; count?: number; amountCents?: number; newHighBidCents?: number }) => {
    const titles: Record<string, string> = {
      outbid: 'Outbid!',
      won: 'Auction Won!',
      lost: 'Auction Lost',
      sold: 'Item Sold!',
      expired: 'Auction Expired'
    };

    const messages: Record<string, string> = {
      outbid: `You were outbid on ${data.itemName}. New bid: ${Money.format(data.newHighBidCents)}`,
      won: `You won ${data.itemName}${data.count ? ` x${data.count}` : ''} for ${Money.format(data.amountCents)}!`,
      lost: `You lost the auction for ${data.itemName}`,
      sold: `Your ${data.itemName}${data.count ? ` x${data.count}` : ''} sold for ${Money.format(data.amountCents)}!`,
      expired: `Your ${data.itemName} auction expired. Item returned.`
    };

    addNotification({
      type: data.type as Notification['type'],
      title: titles[data.type] || 'Notification',
      message: messages[data.type] || ''
    });
  });

  useNuiEvent('createResult', (result: { success: boolean; error?: string; auction?: Auction }) => {
    // Only handle errors here - auctionCreated broadcast handles successful creation
    if (!result.success && result.error) {
      setIsSubmitting(false);
      addNotification({
        type: 'error',
        title: 'Error',
        message: result.error
      });
    }
  });

  useNuiEvent('bidResult', (result: { success: boolean; error?: string; auction?: Auction; minBid?: number }) => {
    if (!result.success && result.error) {
      addNotification({
        type: 'error',
        title: 'Bid Failed',
        message: result.error
      });
    }
  });

  useNuiEvent('buyoutResult', (result: { success: boolean; error?: string; auction?: Auction }) => {
    if (result.success) {
      // Refresh to remove the purchased auction
      handleSearch(searchQuery, pagination.page);
      if (selectedAuctionId === result.auction?.id) {
        setSelectedAuctionId(null);
        setView('list');
      }
      addNotification({
        type: 'success',
        title: 'Purchase Complete!',
        message: `You bought ${result.auction?.item?.label} for ${Money.format(result.auction?.buyoutPriceCents || 0)}!`
      });
    } else if (result.error) {
      addNotification({
        type: 'error',
        title: 'Purchase Failed',
        message: result.error
      });
    }
  });

  useNuiEvent('cancelResult', (result: { success: boolean; error?: string }) => {
    if (!result.success && result.error) {
      addNotification({
        type: 'error',
        title: 'Cancel Failed',
        message: result.error
      });
    }
  });

  useNuiEvent('inventoryUpdated', (data: { inventory: InventoryItem[] }) => {
    setPlayerData(prev => ({ ...prev, inventory: data.inventory }));
  });

  // Balance update handler - receives real-time balance changes from server
  useNuiEvent('balanceUpdated', (data: { cash: number; bank: number }) => {
    setPlayerData(prev => ({ ...prev, cashCents: data.cash, bankCents: data.bank }));
  });

  useNuiEvent('feePreview', (data: FeePreview) => {
    // Fee preview is calculated client-side for responsiveness
    // This handler is available for server-side validation if needed
  });

  // Collection system event handlers
  useNuiEvent('receivePendingCollections', (data: PendingCollections) => {
    setPendingCollections(data);
  });

  useNuiEvent('collectionResult', (result: { success: boolean; error?: string; type: 'item' | 'money'; auctionId?: string; itemName?: string; itemLabel?: string; count?: number; amountCents?: number }) => {
    if (result.success) {
      if (result.type === 'item') {
        setCollectingItem(null);
        // Remove collected item from pending
        setPendingCollections(prev => ({
          ...prev,
          items: prev.items.filter(item => item.auctionId !== result.auctionId)
        }));
        addNotification({
          type: 'success',
          title: 'Item Collected',
          message: `Collected ${result.itemLabel} x${result.count}`
        });
        // Refresh collections
        fetchNui('getPendingCollections', {}, { money: null, items: [] });
      } else if (result.type === 'money') {
        setCollectingMoney(false);
        setPendingCollections(prev => ({ ...prev, money: null }));
        addNotification({
          type: 'success',
          title: 'Money Collected',
          message: `Collected ${Money.format(result.amountCents)}`
        });
        fetchNui('getPendingCollections', {}, { money: null, items: [] });
      }
    } else {
      setCollectingItem(null);
      setCollectingMoney(false);
      addNotification({
        type: 'error',
        title: 'Collection Failed',
        message: result.error || 'Unknown error'
      });
    }
  });

  // NUI Actions
  const handleClose = useCallback(() => {
    setVisible(false);
    fetchNui('close', {}, { success: true });
  }, []);

  const handleCreateAuction = useCallback((data: { itemName: string; count: number; startingBid: number; duration: number; category: string; buyoutPrice?: number; customImageUrl?: string }) => {
    setIsSubmitting(true);
    fetchNui('createAuction', data, { success: true });
  }, []);

  const handlePlaceBid = useCallback((auctionId: string, amountCents: number) => {
    fetchNui('placeBid', { auctionId, amountCents }, { success: true });
  }, []);

  const handleCancelAuction = useCallback((auctionId: string) => {
    fetchNui('cancelAuction', { auctionId }, { success: true });
  }, []);

  const handleBuyoutAuction = useCallback((auctionId: string) => {
    fetchNui('buyoutAuction', { auctionId }, { success: true });
  }, []);

  // Collection handlers
  const handleGetPendingCollections = useCallback(() => {
    fetchNui('getPendingCollections', {}, { money: null, items: [] });
  }, []);

  const handleCollectItem = useCallback((auctionId: string, itemName: string) => {
    setCollectingItem(auctionId);
    fetchNui('collectItem', { auctionId, itemName }, { success: true });
  }, []);

  const handleCollectMoney = useCallback(() => {
    setCollectingMoney(true);
    fetchNui('collectMoney', {}, { success: true });
  }, []);

  // Search and pagination handlers
  const handleSearch = useCallback((query: string, page: number = 1, category?: string) => {
    setIsSearching(true);
    const effectiveCategory = category !== undefined ? category : categoryFilter;
    fetchNui('searchAuctions', {
      query,
      page,
      limit: pagination.limit,
      filterOwn: activeTab === 'mine',
      category: effectiveCategory || undefined
    }, { success: true });
  }, [pagination.limit, activeTab, categoryFilter]);

  const handlePageChange = useCallback((newPage: number) => {
    handleSearch(searchQuery, newPage);
  }, [handleSearch, searchQuery]);

  // Debounced search
  useEffect(() => {
    if (!visible) return;
    
    const timer = setTimeout(() => {
      if (searchQuery !== pagination.query || searchQuery.length > 0 || categoryFilter) {
        handleSearch(searchQuery, 1);
      }
    }, 300);
    
    return () => clearTimeout(timer);
  }, [searchQuery, categoryFilter, visible]);

  // ESC key handler
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleClose]);

  // Mock data for development
  useEffect(() => {
    if (isDebug) {
      setPlayerData({
        inventory: [
          { name: 'gold_nugget', label: 'Gold Nugget', count: 5, slot: 1, metadata: {} },
          { name: 'revolver_schofield', label: 'Schofield Revolver', count: 1, slot: 2, metadata: { condition: 85 } },
          { name: 'meat_deer', label: 'Deer Meat', count: 12, slot: 3, metadata: {} },
          { name: 'arrow_improved', label: 'Improved Arrows', count: 24, slot: 4, metadata: {} },
          { name: 'pelt_bear', label: 'Bear Pelt', count: 1, slot: 5, metadata: { quality: 'perfect' } },
        ],
        cashCents: 50000,
        bankCents: 250000,
        citizenid: 'player1',
        playerName: 'Test Player',
        feeConfig: {
          enabled: true,
          baseFee: 5,
          durationMultiplier: 2,
          quantityMultiplier: 0.5,
          maxFee: 500,
          minFee: 5
        },
        buyoutConfig: {
          enabled: true,
          minMultiplier: 1.5
        },
        categories: [
          { id: 'weapons', label: 'Weapons', icon: '🔫', description: 'Firearms, melee weapons, and ammunition' },
          { id: 'ammunition', label: 'Ammunition', icon: '🎯', description: 'Bullets, arrows, and throwing weapons' },
          { id: 'clothing', label: 'Clothing', icon: '👒', description: 'Apparel, hats, and accessories' },
          { id: 'food', label: 'Food & Drink', icon: '🥩', description: 'Consumables, provisions, and beverages' },
          { id: 'resources', label: 'Resources', icon: '🪨', description: 'Ores, minerals, and raw materials' },
          { id: 'pelts', label: 'Pelts & Hides', icon: '🦌', description: 'Animal pelts, hides, and taxidermy' },
          { id: 'horses', label: 'Horses', icon: '🐎', description: 'Owned horses listed from nearby active mounts' },
          { id: 'medicine', label: 'Medicine', icon: '💊', description: 'Tonics, medicines, and healing items' },
          { id: 'tools', label: 'Tools', icon: '🔧', description: 'Tools, kits, and crafting supplies' },
          { id: 'valuables', label: 'Valuables', icon: '💎', description: 'Jewelry, gold, and valuable items' },
          { id: 'other', label: 'Other', icon: '📦', description: 'Miscellaneous items' }
        ]
      });

      setAuctions([
        {
          id: 'AUC_1',
          owner: { id: 2, name: 'John Marston', citizenid: 'citizen2' },
          item: { name: 'gold_nugget', label: 'Gold Nugget', count: 10, metadata: {} },
          category: 'valuables',
          startingBidCents: 100,
          currentBidCents: 250,
          highestBidder: { id: 3, name: 'Arthur Morgan', citizenid: 'citizen3' },
          endTime: Math.floor(Date.now() / 1000) + 1800,
          createdAt: Math.floor(Date.now() / 1000) - 3600,
          status: 'active',
          totalBids: 5
        },
        {
          id: 'AUC_2',
          owner: { id: 4, name: 'Dutch van der Linde', citizenid: 'citizen4' },
          item: { name: 'revolver_schofield', label: 'Schofield Revolver', count: 1, metadata: { condition: 90 } },
          category: 'weapons',
          startingBidCents: 500,
          currentBidCents: 0,
          buyoutPriceCents: 1500,
          highestBidder: null,
          endTime: Math.floor(Date.now() / 1000) + 3600,
          createdAt: Math.floor(Date.now() / 1000) - 1800,
          status: 'active',
          totalBids: 0
        },
        {
          id: 'AUC_3',
          owner: { id: 5, name: 'Sadie Adler', citizenid: 'citizen5' },
          item: { name: 'pelt_bear', label: 'Perfect Bear Pelt', count: 1, metadata: { quality: 'perfect' } },
          category: 'pelts',
          startingBidCents: 200,
          currentBidCents: 350,
          highestBidder: { id: 1, name: 'Test Player', citizenid: 'player1' },
          endTime: Math.floor(Date.now() / 1000) + 120,
          createdAt: Math.floor(Date.now() / 1000) - 7200,
          status: 'active',
          totalBids: 3
        }
      ]);

      setBidHistory({
        'AUC_1': [
          { playerId: 3, playerName: 'Arthur Morgan', citizenid: 'citizen3', amountCents: 250, timestamp: Math.floor(Date.now() / 1000) - 300 },
          { playerId: 6, playerName: 'Charles Smith', citizenid: 'citizen6', amountCents: 200, timestamp: Math.floor(Date.now() / 1000) - 900 },
          { playerId: 3, playerName: 'Arthur Morgan', citizenid: 'citizen3', amountCents: 150, timestamp: Math.floor(Date.now() / 1000) - 1500 },
          { playerId: 7, playerName: 'Javier Escuella', citizenid: 'citizen7', amountCents: 100, timestamp: Math.floor(Date.now() / 1000) - 2100 },
        ],
        'AUC_3': [
          { playerId: 1, playerName: 'Test Player', citizenid: 'player1', amountCents: 350, timestamp: Math.floor(Date.now() / 1000) - 600 },
          { playerId: 8, playerName: 'Hosea Matthews', citizenid: 'citizen8', amountCents: 200, timestamp: Math.floor(Date.now() / 1000) - 1200 },
        ]
      });

      // Mock pending collections
      setPendingCollections({
        money: {
          amountCents: 1250,
          reason: 'Auction sale',
          auctionId: 'AUC_4',
          itemName: 'Schofield Revolver'
        },
        items: [
          {
            itemName: 'pelt_bear',
            itemLabel: 'Perfect Bear Pelt',
            count: 1,
            metadata: { quality: 'perfect' },
            auctionId: 'AUC_3',
            image: 'nui://rsg-inventory/html/images/pelt_bear.png',
            imageMeta: {
              url: 'nui://rsg-inventory/html/images/pelt_bear.png',
              itemName: 'pelt_bear',
              fallbackUrl: 'nui://rex-auction/web/dist/fallback.svg'
            },
            soldForCents: 350,
            sellerName: 'Sadie Adler'
          },
          {
            itemName: 'gold_nugget',
            itemLabel: 'Gold Nugget',
            count: 5,
            metadata: {},
            auctionId: 'AUC_5',
            image: 'nui://rsg-inventory/html/images/gold_nugget.png',
            imageMeta: {
              url: 'nui://rsg-inventory/html/images/gold_nugget.png',
              itemName: 'gold_nugget',
              fallbackUrl: 'nui://rex-auction/web/dist/fallback.svg'
            },
            soldForCents: 500,
            sellerName: 'Dutch van der Linde'
          }
        ]
      });
    }
  }, []);

  if (!visible) return null;

  const selectedAuction = selectedAuctionId ? auctions.find(a => a.id === selectedAuctionId) : null;

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4">
      {/* Notification Stack */}
      <div className="fixed top-4 right-4 w-80 space-y-2 z-50">
        {notifications.map(notification => (
          <NotificationToast
            key={notification.id}
            notification={notification}
            onDismiss={() => removeNotification(notification.id)}
          />
        ))}
      </div>

      {/* Main Container */}
      <div className="w-[1150px] max-w-[95vw] h-[780px] max-h-[90vh] bg-stone-950 border border-stone-700 rounded-xl shadow-2xl flex overflow-hidden">
        {/* Navigation Sidebar */}
        <div className="w-56 border-r border-stone-700 flex flex-col flex-shrink-0">
          <div className="p-4 border-b border-stone-700">
            <h1 className="text-amber-500 text-lg font-bold tracking-wide">AUCTION HOUSE</h1>
            <p className="text-stone-500 text-xs mt-1">Welcome, {playerData.playerName}</p>
          </div>

          {/* Player Funds */}
          <div className="p-4 border-b border-stone-700/50">
            <p className="text-stone-400 text-xs mb-1">Available Funds</p>
            <p className="text-amber-400 text-lg font-semibold">
              {Money.formatWithCommas(playerData.cashCents + playerData.bankCents)}
            </p>
            <p className="text-stone-500 text-xs mt-1">
              Cash: {Money.format(playerData.cashCents)} | Bank: {Money.formatWithCommas(playerData.bankCents)}
            </p>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4">
            <button
              onClick={() => { setView('list'); setSelectedAuctionId(null); }}
              className={`w-full text-left px-3 py-2 rounded-lg mb-1 text-sm transition-colors ${
                view === 'list' || view === 'detail' ? 'bg-amber-900/50 text-amber-200' : 'text-stone-400 hover:bg-stone-800'
              }`}
            >
              Browse Auctions
            </button>
            <button
              onClick={() => setView('create')}
              className={`w-full text-left px-3 py-2 rounded-lg mb-1 text-sm transition-colors ${
                view === 'create' ? 'bg-amber-900/50 text-amber-200' : 'text-stone-400 hover:bg-stone-800'
              }`}
            >
              Create Auction
            </button>
            <button
              onClick={() => {
                setView('collect');
                handleGetPendingCollections();
              }}
              className={`w-full text-left px-3 py-2 rounded-lg mb-1 text-sm transition-colors flex items-center justify-between ${
                view === 'collect' ? 'bg-amber-900/50 text-amber-200' : 'text-stone-400 hover:bg-stone-800'
              }`}
            >
              <span>Collect Items</span>
              {(pendingCollections.items.length > 0 || pendingCollections.money) && (
                <span className="bg-amber-600 text-white text-xs px-2 py-0.5 rounded-full">
                  {pendingCollections.items.length + (pendingCollections.money ? 1 : 0)}
                </span>
              )}
            </button>
          </nav>

          {/* Close Button */}
          <div className="p-4 border-t border-stone-700">
            <button
              onClick={handleClose}
              className="w-full py-2 bg-stone-800 hover:bg-stone-700 text-stone-400 rounded-lg text-sm transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        {/* Category Sidebar - Only visible in list view */}
        <CategorySidebar
          categories={playerData.categories}
          selectedCategory={categoryFilter}
          onSelectCategory={(categoryId) => {
            setCategoryFilter(categoryId);
            handleSearch(searchQuery, 1, categoryId);
          }}
          visible={view === 'list'}
        />

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {view === 'list' && (
            <>
              {/* Header with Tabs and Search */}
              <div className="p-4 border-b border-stone-700 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setActiveTab('all');
                        setSearchQuery('');
                        setCategoryFilter('');
                        handleSearch('', 1, '');
                      }}
                      className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                        activeTab === 'all' ? 'bg-amber-700 text-white' : 'bg-stone-800 text-stone-400 hover:bg-stone-700'
                      }`}
                    >
                      All Auctions
                    </button>
                    <button
                      onClick={() => {
                        setActiveTab('mine');
                        setSearchQuery('');
                        setCategoryFilter('');
                        handleSearch('', 1, '');
                      }}
                      className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                        activeTab === 'mine' ? 'bg-amber-700 text-white' : 'bg-stone-800 text-stone-400 hover:bg-stone-700'
                      }`}
                    >
                      My Auctions
                    </button>
                  </div>
                  <button
                    onClick={() => setView('create')}
                    className="px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    + New Auction
                  </button>
                </div>
                
                {/* Search Bar and View Toggle */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      placeholder="Search by item name or auction ID..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-white placeholder-stone-500 focus:outline-none focus:border-amber-600 pr-8"
                    />
                    {isSearching && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
                      </div>
                    )}
                  </div>
                  
                  {/* View Toggle */}
                  <div className="flex bg-stone-800 border border-stone-700 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setViewMode('card')}
                      className={`px-3 py-2 text-sm transition-colors ${
                        viewMode === 'card' ? 'bg-amber-700 text-white' : 'text-stone-400 hover:text-white'
                      }`}
                      title="Card View"
                    >
                      ▦
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`px-3 py-2 text-sm transition-colors ${
                        viewMode === 'list' ? 'bg-amber-700 text-white' : 'text-stone-400 hover:text-white'
                      }`}
                      title="List View"
                    >
                      ☰
                    </button>
                  </div>
                </div>
                
                {/* Results Count with active category indicator */}
                <div className="flex items-center justify-between text-xs text-stone-500">
                  <span>
                    {pagination.totalCount > 0 
                      ? `${pagination.totalCount} auction${pagination.totalCount !== 1 ? 's' : ''} found`
                      : 'No auctions found'
                    }
                    {categoryFilter && (
                      <span className="text-amber-400 ml-1">
                        in {playerData.categories?.find(c => c.id === categoryFilter)?.label || 'category'}
                      </span>
                    )}
                    {searchQuery && ` for "${searchQuery}"`}
                  </span>
                  {pagination.totalPages > 1 && (
                    <span>Page {pagination.page} of {pagination.totalPages}</span>
                  )}
                </div>
              </div>

              {/* Auction List/Grid */}
              <div className="flex-1 overflow-y-auto p-4">
                {auctions.length === 0 ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <p className="text-4xl text-stone-700 mb-2">📦</p>
                      <p className="text-stone-500">
                        {searchQuery ? 'No auctions match your search' : 'No auctions available'}
                      </p>
                      {!searchQuery && (
                        <button
                          onClick={() => setView('create')}
                          className="mt-4 px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white rounded-lg text-sm"
                        >
                          Create First Auction
                        </button>
                      )}
                    </div>
                  </div>
                ) : viewMode === 'card' ? (
                  <div className="grid grid-cols-2 gap-3">
                    {auctions.map(auction => (
                      <AuctionCard
                        key={auction.id}
                        auction={auction}
                        playerCitizenid={playerData.citizenid}
                        isSelected={selectedAuctionId === auction.id}
                        categories={playerData.categories}
                        onSelect={() => {
                          setSelectedAuctionId(auction.id);
                          setView('detail');
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {auctions.map(auction => (
                      <AuctionListRow
                        key={auction.id}
                        auction={auction}
                        playerCitizenid={playerData.citizenid}
                        categories={playerData.categories}
                        isSelected={selectedAuctionId === auction.id}
                        onSelect={() => {
                          setSelectedAuctionId(auction.id);
                          setView('detail');
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
              
              {/* Pagination Controls */}
              {pagination.totalPages > 1 && (
                <div className="p-4 border-t border-stone-700 flex items-center justify-center gap-2">
                  <button
                    onClick={() => handlePageChange(1)}
                    disabled={pagination.page === 1}
                    className="px-3 py-1.5 bg-stone-800 border border-stone-700 rounded-lg text-stone-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    First
                  </button>
                  <button
                    onClick={() => handlePageChange(pagination.page - 1)}
                    disabled={pagination.page === 1}
                    className="px-3 py-1.5 bg-stone-800 border border-stone-700 rounded-lg text-stone-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    Prev
                  </button>
                  
                  {/* Page Numbers */}
                  <div className="flex gap-1">
                    {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                      let pageNum: number;
                      if (pagination.totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (pagination.page <= 3) {
                        pageNum = i + 1;
                      } else if (pagination.page >= pagination.totalPages - 2) {
                        pageNum = pagination.totalPages - 4 + i;
                      } else {
                        pageNum = pagination.page - 2 + i;
                      }
                      
                      return (
                        <button
                          key={pageNum}
                          onClick={() => handlePageChange(pageNum)}
                          className={`w-8 h-8 rounded-lg text-sm transition-colors ${
                            pagination.page === pageNum
                              ? 'bg-amber-700 text-white'
                              : 'bg-stone-800 text-stone-400 hover:text-white'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>
                  
                  <button
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={!pagination.hasMore}
                    className="px-3 py-1.5 bg-stone-800 border border-stone-700 rounded-lg text-stone-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    Next
                  </button>
                  <button
                    onClick={() => handlePageChange(pagination.totalPages)}
                    disabled={!pagination.hasMore}
                    className="px-3 py-1.5 bg-stone-800 border border-stone-700 rounded-lg text-stone-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    Last
                  </button>
                </div>
              )}
            </>
          )}

          {view === 'create' && (
            <CreateAuctionForm
              inventory={playerData.inventory}
              onCreate={handleCreateAuction}
              onClose={() => setView('list')}
              isSubmitting={isSubmitting}
              feeConfig={playerData.feeConfig}
              buyoutConfig={playerData.buyoutConfig}
              playerFundsCents={playerData.cashCents + playerData.bankCents}
              categories={playerData.categories}
            />
          )}

          {view === 'detail' && selectedAuction && (
            <AuctionDetailView
              auction={selectedAuction}
              bidHistory={bidHistory[selectedAuction.id] || []}
              playerCitizenid={playerData.citizenid}
              playerFundsCents={{ cashCents: playerData.cashCents, bankCents: playerData.bankCents }}
              onPlaceBid={(amountCents) => handlePlaceBid(selectedAuction.id, amountCents)}
              onBuyout={() => handleBuyoutAuction(selectedAuction.id)}
              onCancel={() => handleCancelAuction(selectedAuction.id)}
              onBack={() => { setView('list'); setSelectedAuctionId(null); }}
              categories={playerData.categories}
            />
          )}

          {view === 'collect' && (
            <CollectionKiosk
              pendingCollections={pendingCollections}
              onCollectItem={handleCollectItem}
              onCollectMoney={handleCollectMoney}
              collectingItem={collectingItem}
              collectingMoney={collectingMoney}
              onBack={() => setView('list')}
            />
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        .animate-slideIn {
          animation: slideIn 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}

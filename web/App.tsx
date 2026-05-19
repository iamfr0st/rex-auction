import { useState, useEffect, useCallback, useMemo } from 'react';
import { isDebug, useNuiEvent, fetchNui } from './hooks/useNui';

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
  startingBid: number;
  currentBid: number;
  highestBidder: Player | null;
  endTime: number;
  createdAt: number;
  status: 'active' | 'ended' | 'cancelled';
  totalBids: number;
  winner?: Player;
  soldFor?: number;
}

interface BidEntry {
  playerId: number;
  playerName: string;
  citizenid: string;
  amount: number;
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
  cash: number;
  bank: number;
  citizenid: string;
  playerName: string;
  feeConfig?: FeeConfig;
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
  baseFee: number;
  durationFee: number;
  quantityFee: number;
  total: number;
  maxFee?: number;
  minFee?: number;
  wasCapped?: boolean;
}

interface FeePreview {
  breakdown: FeeBreakdown;
  playerFunds: number;
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
  soldFor: number;
  sellerName: string;
  collectedAt?: number;
}

interface PendingMoney {
  amount: number;
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

      <div className="flex justify-between items-center text-sm">
        <div>
          <p className="text-stone-500 text-xs">Current Bid</p>
          <p className="text-amber-400 font-semibold">
            ${auction.currentBid > 0 ? auction.currentBid.toLocaleString() : auction.startingBid.toLocaleString()}
          </p>
        </div>
        <div className="text-right">
          <p className="text-stone-500 text-xs">Ends In</p>
          <CountdownTimer endTime={auction.endTime} />
        </div>
      </div>

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
          ${auction.currentBid > 0 ? auction.currentBid.toLocaleString() : auction.startingBid.toLocaleString()}
        </p>
        <p className="text-stone-500 text-xs">{auction.totalBids} bid{auction.totalBids !== 1 ? 's' : ''}</p>
      </div>
      
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
  playerFunds,
  categories
}: {
  inventory: InventoryItem[];
  onCreate: (data: { itemName: string; count: number; startingBid: number; duration: number; category: string }) => void;
  onClose: () => void;
  isSubmitting: boolean;
  feeConfig?: FeeConfig;
  playerFunds: number;
  categories?: Category[];
}) {
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [count, setCount] = useState(1);
  const [startingBid, setStartingBid] = useState(100);
  const [duration, setDuration] = useState(3600);
  const [searchQuery, setSearchQuery] = useState('');

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

  // Group inventory by category (simple pattern matching for demo)
  const inventoryByCategory = useMemo(() => {
    const grouped: Record<string, InventoryItem[]> = { 'all': filteredInventory };

    if (categories && categories.length > 0) {
      categories.forEach(cat => {
        const patternKey = cat.id.toLowerCase();
        grouped[cat.id] = filteredInventory.filter(item => {
          const nameLower = item.name.toLowerCase();
          const labelLower = item.label.toLowerCase();

          // Simple pattern matching based on category
          switch (cat.id) {
            case 'weapons':
              return nameLower.includes('revolver') || nameLower.includes('pistol') ||
                     nameLower.includes('rifle') || nameLower.includes('shotgun') ||
                     nameLower.includes('bow') || nameLower.includes('knife') ||
                     nameLower.includes('weapon') || nameLower.includes('tomahawk');
            case 'ammunition':
              return nameLower.includes('ammo') || nameLower.includes('arrow') ||
                     nameLower.includes('bullet') || nameLower.includes('shell');
            case 'clothing':
              return nameLower.includes('shirt') || nameLower.includes('pants') ||
                     nameLower.includes('hat') || nameLower.includes('coat') ||
                     nameLower.includes('vest') || nameLower.includes('boots') ||
                     nameLower.includes('outfit') || nameLower.includes('clothing');
            case 'food':
              return nameLower.includes('meat') || nameLower.includes('fish') ||
                     nameLower.includes('bread') || nameLower.includes('fruit') ||
                     nameLower.includes('drink') || nameLower.includes('food') ||
                     nameLower.includes('canned') || nameLower.includes('alcohol');
            case 'resources':
              return nameLower.includes('ore') || nameLower.includes('wood') ||
                     nameLower.includes('stone') || nameLower.includes('metal') ||
                     nameLower.includes('coal') || nameLower.includes('iron') ||
                     nameLower.includes('gold_nugget') || nameLower.includes('silver');
            case 'pelts':
              return nameLower.includes('pelt') || nameLower.includes('hide') ||
                     nameLower.includes('skin') || nameLower.includes('fur') ||
                     nameLower.includes('carcass') || nameLower.includes('feather');
            case 'medicine':
              return nameLower.includes('tonic') || nameLower.includes('medicine') ||
                     nameLower.includes('pills') || nameLower.includes('health') ||
                     nameLower.includes('remedy');
            case 'tools':
              return nameLower.includes('tool') || nameLower.includes('kit') ||
                     nameLower.includes('rope') || nameLower.includes('bait') ||
                     nameLower.includes('fishing') || nameLower.includes('camp');
            case 'valuables':
              return nameLower.includes('gold') || nameLower.includes('silver') ||
                     nameLower.includes('jewel') || nameLower.includes('diamond') ||
                     nameLower.includes('ring') || nameLower.includes('coin') ||
                     nameLower.includes('gem') || nameLower.includes('treasure');
            default:
              return false;
          }
        });
      });
    }

    return grouped;
  }, [filteredInventory, categories]);

  const displayItems = selectedCategory && selectedCategory !== 'all'
    ? (inventoryByCategory[selectedCategory] || [])
    : filteredInventory;

  // Calculate local fee preview (client-side for responsiveness)
  const localFeePreview = useMemo(() => {
    if (!feeConfig || !feeConfig.enabled) {
      return { enabled: false, total: 0, baseFee: 0, durationFee: 0, quantityFee: 0 };
    }

    const baseFee = feeConfig.baseFee || 5;
    const durationMultiplier = feeConfig.durationMultiplier || 2;
    const quantityMultiplier = feeConfig.quantityMultiplier || 0.5;
    const maxFee = feeConfig.maxFee || 500;
    const minFee = feeConfig.minFee || 5;

    const durationHours = duration / 3600;
    const durationFee = durationMultiplier * durationHours;
    const quantityFee = quantityMultiplier * count;
    const totalFee = baseFee + durationFee + quantityFee;

    const cappedFee = Math.max(minFee, Math.min(maxFee, totalFee));
    const wasCapped = totalFee > maxFee;

    return {
      enabled: true,
      baseFee,
      durationFee: Math.floor(durationFee * 100) / 100,
      quantityFee: Math.floor(quantityFee * 100) / 100,
      total: Math.floor(cappedFee),
      maxFee,
      minFee,
      wasCapped
    };
  }, [feeConfig, duration, count]);

  const canAffordFee = playerFunds >= localFeePreview.total;
  const selectedCategoryLabel = categories?.find(c => c.id === selectedCategory)?.label || 'All Items';

  const handleSubmit = (e: import('react').FormEvent) => {
    e.preventDefault();
    if (!selectedItem || count < 1 || startingBid < 1) return;
    if (!canAffordFee) return;
    if (!selectedCategory) return;
    onCreate({
      itemName: selectedItem.name,
      count,
      startingBid,
      duration,
      category: selectedCategory
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
    <div className="h-full flex">
      {/* Category Sidebar */}
      <div className="w-44 border-r border-stone-700 flex flex-col bg-stone-900/50">
        <div className="p-3 border-b border-stone-700">
          <h3 className="text-stone-400 text-xs uppercase tracking-wide">Categories</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <button
            type="button"
            onClick={() => setSelectedCategory('')}
            className={`w-full text-left px-3 py-2 rounded-lg mb-1 text-sm transition-colors ${
              !selectedCategory ? 'bg-amber-900/50 text-amber-200' : 'text-stone-400 hover:bg-stone-800'
            }`}
          >
            📦 All Items
          </button>
          {categories?.map(cat => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={`w-full text-left px-3 py-2 rounded-lg mb-1 text-sm transition-colors ${
                selectedCategory === cat.id ? 'bg-amber-900/50 text-amber-200' : 'text-stone-400 hover:bg-stone-800'
              }`}
            >
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Form */}
      <div className="flex-1 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-stone-700">
          <h2 className="text-xl font-semibold text-white">Create Auction</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-white text-lg">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Category Selection Required */}
          {!selectedCategory && (
            <div className="bg-amber-950/50 border border-amber-700 rounded-lg p-4">
              <p className="text-amber-200 text-sm">
                <span className="font-bold">Step 1:</span> Select a category from the sidebar to filter items
              </p>
            </div>
          )}

          {/* Item Selection */}
          <div>
            <label className="block text-stone-300 text-sm mb-2">
              {selectedCategory ? `Select Item (${selectedCategoryLabel})` : 'Select Item'}
            </label>
            <input
              type="text"
              placeholder="Search inventory..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-white placeholder-stone-500 focus:outline-none focus:border-amber-600 mb-2"
            />
            <div className="max-h-52 overflow-y-auto border border-stone-700 rounded-lg">
              {displayItems.length === 0 ? (
                <p className="p-3 text-stone-500 text-sm text-center">
                  {selectedCategory ? `No items in ${selectedCategoryLabel}` : 'No items found'}
                </p>
              ) : (
                displayItems.map((item) => (
                  <div
                    key={item.name}
                    onClick={() => {
                      setSelectedItem(item);
                      setCount(1);
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

              {/* Starting Bid */}
              <div>
                <label className="block text-stone-300 text-sm mb-2">Starting Bid ($)</label>
                <input
                  type="number"
                  min={1}
                  value={startingBid}
                  onChange={(e) => setStartingBid(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-amber-600"
                />
              </div>

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
                      ${localFeePreview.total}
                    </span>
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-stone-500">Base fee</span>
                      <span className="text-stone-300">${localFeePreview.baseFee}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-500">Duration ({(duration / 3600).toFixed(1)} hrs × ${feeConfig?.durationMultiplier || 2})</span>
                      <span className="text-stone-300">${localFeePreview.durationFee.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-500">Quantity ({count} × ${feeConfig?.quantityMultiplier || 0.5})</span>
                      <span className="text-stone-300">${localFeePreview.quantityFee.toFixed(2)}</span>
                    </div>
                    {localFeePreview.wasCapped && (
                      <div className="flex justify-between text-amber-400">
                        <span>Fee capped at max</span>
                        <span>${localFeePreview.maxFee}</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 pt-3 border-t border-stone-700/50 flex justify-between text-xs">
                    <span className="text-stone-500">Your funds</span>
                    <span className={canAffordFee ? 'text-emerald-400' : 'text-red-400'}>
                      ${playerFunds.toLocaleString()}
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
                    <span className="text-white">{selectedItem.label} x{count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-400">Category</span>
                    <span className={selectedCategory ? 'text-amber-400' : 'text-red-400'}>
                      {selectedCategoryLabel || 'Select a category'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-400">Starting Bid</span>
                    <span className="text-amber-400">${startingBid.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-400">Duration</span>
                    <span className="text-white">{durationOptions.find(o => o.value === duration)?.label}</span>
                  </div>
                  {localFeePreview.enabled && (
                    <div className="flex justify-between">
                      <span className="text-stone-400">Creation Fee</span>
                      <span className={canAffordFee ? 'text-amber-400' : 'text-red-400'}>${localFeePreview.total}</span>
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
                    ? `Insufficient Funds (Need $${localFeePreview.total})`
                    : isSubmitting
                      ? 'Creating...'
                      : `Create Auction ($${localFeePreview.total} fee)`
                }
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

// Auction Detail View Component
function AuctionDetailView({
  auction,
  bidHistory,
  playerCitizenid,
  playerFunds,
  onPlaceBid,
  onCancel,
  onBack,
  categories
}: {
  auction: Auction;
  bidHistory: BidEntry[];
  playerCitizenid: string;
  playerFunds: { cash: number; bank: number };
  onPlaceBid: (amount: number) => void;
  onCancel: () => void;
  onBack: () => void;
  categories?: Category[];
}) {
  const [bidAmount, setBidAmount] = useState(0);
  const [showConfirmCancel, setShowConfirmCancel] = useState(false);

  const isOwnAuction = auction.owner.citizenid === playerCitizenid;
  const isHighestBidder = auction.highestBidder?.citizenid === playerCitizenid;
  const categoryInfo = getCategoryInfo(auction.category, categories);
  const totalFunds = playerFunds.cash + playerFunds.bank;
  const minBid = auction.currentBid > 0 
    ? Math.ceil(auction.currentBid * 1.05) 
    : auction.startingBid;
  const canBid = !isOwnAuction && auction.status === 'active' && totalFunds >= minBid;
  const canCancel = isOwnAuction && auction.totalBids === 0 && auction.status === 'active';

  const handleBid = () => {
    if (bidAmount >= minBid && bidAmount <= totalFunds) {
      onPlaceBid(bidAmount);
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

        {/* Bidding Section */}
        {auction.status === 'active' && (
          <div className="p-4 border-b border-stone-700/50">
            <div className="flex justify-between items-center mb-3">
              <div>
                <p className="text-stone-500 text-xs">Current Bid</p>
                <p className="text-2xl font-bold text-amber-400">
                  ${auction.currentBid > 0 ? auction.currentBid.toLocaleString() : auction.startingBid.toLocaleString()}
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

            {!isOwnAuction && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={minBid}
                    max={totalFunds}
                    value={bidAmount}
                    onChange={(e) => setBidAmount(Math.max(minBid, parseInt(e.target.value) || minBid))}
                    className="flex-1 bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-amber-600"
                  />
                  <button
                    onClick={() => setBidAmount(minBid)}
                    className="px-3 bg-stone-800 border border-stone-700 rounded-lg text-stone-300 text-sm hover:bg-stone-700"
                  >
                    Min
                  </button>
                </div>
                <p className="text-stone-500 text-xs">
                  Min bid: ${minBid.toLocaleString()} | Your funds: ${totalFunds.toLocaleString()}
                </p>
                <button
                  onClick={handleBid}
                  disabled={!canBid || bidAmount < minBid}
                  className={`w-full py-3 rounded-lg font-semibold transition-colors ${
                    canBid && bidAmount >= minBid
                      ? 'bg-amber-700 hover:bg-amber-600 text-white'
                      : 'bg-stone-800 text-stone-500 cursor-not-allowed'
                  }`}
                >
                  {totalFunds < minBid ? 'Insufficient Funds' : `Place Bid: $${bidAmount.toLocaleString()}`}
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
                  <span className="text-amber-400 font-medium">${bid.amount.toLocaleString()}</span>
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
  const hasMoney = pendingCollections.money && pendingCollections.money.amount > 0;

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
                    ${pendingCollections.money!.amount.toLocaleString()}
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
                      {item.soldFor > 0 && (
                        <p className="text-amber-400 text-sm mt-1">
                          Won for ${item.soldFor.toLocaleString()}
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
    cash: 0,
    bank: 0,
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

  useNuiEvent('bidPlaced', (data: { auctionId: string; currentBid: number; highestBidder: Player; totalBids: number; bidHistory: BidEntry[] }) => {
    setAuctions(prev => prev.map(a => 
      a.id === data.auctionId 
        ? { ...a, currentBid: data.currentBid, highestBidder: data.highestBidder, totalBids: data.totalBids }
        : a
    ));
    setBidHistory(prev => ({ ...prev, [data.auctionId]: data.bidHistory }));
    addNotification({
      type: 'success',
      title: 'Bid Placed',
      message: `Your bid of $${data.currentBid.toLocaleString()} is now the highest!`
    });
  });

  useNuiEvent('auctionEnded', (data: { auctionId: string; winner?: Player; soldFor?: number }) => {
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

  useNuiEvent('notification', (data: { type: string; auctionId: string; itemName: string; count?: number; amount?: number; newHighBid?: number }) => {
    const titles: Record<string, string> = {
      outbid: 'Outbid!',
      won: 'Auction Won!',
      lost: 'Auction Lost',
      sold: 'Item Sold!',
      expired: 'Auction Expired'
    };

    const messages: Record<string, string> = {
      outbid: `You were outbid on ${data.itemName}. New bid: $${data.newHighBid?.toLocaleString()}`,
      won: `You won ${data.itemName}${data.count ? ` x${data.count}` : ''} for $${data.amount?.toLocaleString()}!`,
      lost: `You lost the auction for ${data.itemName}`,
      sold: `Your ${data.itemName}${data.count ? ` x${data.count}` : ''} sold for $${data.amount?.toLocaleString()}!`,
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
    setPlayerData(prev => ({ ...prev, cash: data.cash, bank: data.bank }));
  });

  useNuiEvent('feePreview', (data: FeePreview) => {
    // Fee preview is calculated client-side for responsiveness
    // This handler is available for server-side validation if needed
  });

  // Collection system event handlers
  useNuiEvent('receivePendingCollections', (data: PendingCollections) => {
    setPendingCollections(data);
  });

  useNuiEvent('collectionResult', (result: { success: boolean; error?: string; type: 'item' | 'money'; itemName?: string; itemLabel?: string; count?: number; amount?: number }) => {
    if (result.success) {
      if (result.type === 'item') {
        setCollectingItem(null);
        // Remove collected item from pending
        setPendingCollections(prev => ({
          ...prev,
          items: prev.items.filter(item => item.auctionId !== result.itemName)
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
          message: `Collected $${result.amount?.toLocaleString()}`
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

  const handleCreateAuction = useCallback((data: { itemName: string; count: number; startingBid: number; duration: number; category: string }) => {
    setIsSubmitting(true);
    fetchNui('createAuction', data, { success: true });
  }, []);

  const handlePlaceBid = useCallback((auctionId: string, amount: number) => {
    fetchNui('placeBid', { auctionId, amount }, { success: true });
  }, []);

  const handleCancelAuction = useCallback((auctionId: string) => {
    fetchNui('cancelAuction', { auctionId }, { success: true });
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
        cash: 500,
        bank: 2500,
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
        categories: [
          { id: 'weapons', label: 'Weapons', icon: '🔫', description: 'Firearms, melee weapons, and ammunition' },
          { id: 'ammunition', label: 'Ammunition', icon: '🎯', description: 'Bullets, arrows, and throwing weapons' },
          { id: 'clothing', label: 'Clothing', icon: '👒', description: 'Apparel, hats, and accessories' },
          { id: 'food', label: 'Food & Drink', icon: '🥩', description: 'Consumables, provisions, and beverages' },
          { id: 'resources', label: 'Resources', icon: '🪨', description: 'Ores, minerals, and raw materials' },
          { id: 'pelts', label: 'Pelts & Hides', icon: '🦌', description: 'Animal pelts, hides, and taxidermy' },
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
          startingBid: 100,
          currentBid: 250,
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
          startingBid: 500,
          currentBid: 0,
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
          startingBid: 200,
          currentBid: 350,
          highestBidder: { id: 1, name: 'Test Player', citizenid: 'player1' },
          endTime: Math.floor(Date.now() / 1000) + 120,
          createdAt: Math.floor(Date.now() / 1000) - 7200,
          status: 'active',
          totalBids: 3
        }
      ]);

      setBidHistory({
        'AUC_1': [
          { playerId: 3, playerName: 'Arthur Morgan', citizenid: 'citizen3', amount: 250, timestamp: Math.floor(Date.now() / 1000) - 300 },
          { playerId: 6, playerName: 'Charles Smith', citizenid: 'citizen6', amount: 200, timestamp: Math.floor(Date.now() / 1000) - 900 },
          { playerId: 3, playerName: 'Arthur Morgan', citizenid: 'citizen3', amount: 150, timestamp: Math.floor(Date.now() / 1000) - 1500 },
          { playerId: 7, playerName: 'Javier Escuella', citizenid: 'citizen7', amount: 100, timestamp: Math.floor(Date.now() / 1000) - 2100 },
        ],
        'AUC_3': [
          { playerId: 1, playerName: 'Test Player', citizenid: 'player1', amount: 350, timestamp: Math.floor(Date.now() / 1000) - 600 },
          { playerId: 8, playerName: 'Hosea Matthews', citizenid: 'citizen8', amount: 200, timestamp: Math.floor(Date.now() / 1000) - 1200 },
        ]
      });

      // Mock pending collections
      setPendingCollections({
        money: {
          amount: 1250,
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
            soldFor: 350,
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
            soldFor: 500,
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
              ${(playerData.cash + playerData.bank).toLocaleString()}
            </p>
            <p className="text-stone-500 text-xs mt-1">
              Cash: ${playerData.cash.toLocaleString()} | Bank: ${playerData.bank.toLocaleString()}
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
              playerFunds={playerData.cash + playerData.bank}
              categories={playerData.categories}
            />
          )}

          {view === 'detail' && selectedAuction && (
            <AuctionDetailView
              auction={selectedAuction}
              bidHistory={bidHistory[selectedAuction.id] || []}
              playerCitizenid={playerData.citizenid}
              playerFunds={{ cash: playerData.cash, bank: playerData.bank }}
              onPlaceBid={(amount) => handlePlaceBid(selectedAuction.id, amount)}
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

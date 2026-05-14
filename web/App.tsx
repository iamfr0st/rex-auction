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

// Auction Card Component
function AuctionCard({ 
  auction, 
  onSelect, 
  isSelected,
  playerCitizenid 
}: { 
  auction: Auction; 
  onSelect: () => void;
  isSelected: boolean;
  playerCitizenid: string;
}) {
  const isOwnAuction = auction.owner.citizenid === playerCitizenid;
  const isHighestBidder = auction.highestBidder?.citizenid === playerCitizenid;

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
        <div>
          <h3 className="text-white font-semibold">{auction.item.label}</h3>
          <p className="text-stone-500 text-xs">ID: {auction.id}</p>
          <p className="text-stone-400 text-xs">Qty: {auction.item.count}</p>
        </div>
        {isOwnAuction && (
          <span className="px-2 py-0.5 text-xs bg-amber-800 text-amber-200 rounded">Your Auction</span>
        )}
        {isHighestBidder && !isOwnAuction && (
          <span className="px-2 py-0.5 text-xs bg-emerald-800 text-emerald-200 rounded">Winning</span>
        )}
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

// Create Auction Form Component
function CreateAuctionForm({ 
  inventory, 
  onCreate, 
  onClose,
  isSubmitting
}: { 
  inventory: InventoryItem[]; 
  onCreate: (data: { itemName: string; count: number; startingBid: number; duration: number }) => void;
  onClose: () => void;
  isSubmitting: boolean;
}) {
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [count, setCount] = useState(1);
  const [startingBid, setStartingBid] = useState(100);
  const [duration, setDuration] = useState(3600);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredInventory = useMemo(() => {
    if (!searchQuery) return inventory;
    return inventory.filter(item => 
      item.label.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [inventory, searchQuery]);

  const handleSubmit = (e: import('react').FormEvent) => {
    e.preventDefault();
    if (!selectedItem || count < 1 || startingBid < 1) return;
    onCreate({
      itemName: selectedItem.name,
      count,
      startingBid,
      duration
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
          <div className="max-h-48 overflow-y-auto border border-stone-700 rounded-lg">
            {filteredInventory.length === 0 ? (
              <p className="p-3 text-stone-500 text-sm text-center">No items found</p>
            ) : (
              filteredInventory.map((item) => (
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
                  <div>
                    <p className="text-white text-sm">{item.label}</p>
                    <p className="text-stone-500 text-xs">{item.name}</p>
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

            {/* Summary */}
            <div className="bg-stone-800/50 rounded-lg p-4 border border-stone-700">
              <h4 className="text-stone-400 text-xs uppercase tracking-wide mb-3">Auction Summary</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-stone-400">Item</span>
                  <span className="text-white">{selectedItem.label} x{count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-400">Starting Bid</span>
                  <span className="text-amber-400">${startingBid.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-400">Duration</span>
                  <span className="text-white">{durationOptions.find(o => o.value === duration)?.label}</span>
                </div>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className={`w-full font-semibold py-3 rounded-lg transition-colors ${
                isSubmitting 
                  ? 'bg-stone-700 text-stone-400 cursor-not-allowed' 
                  : 'bg-amber-700 hover:bg-amber-600 text-white'
              }`}
            >
              {isSubmitting ? 'Creating...' : 'Create Auction'}
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
  playerFunds,
  onPlaceBid,
  onCancel,
  onBack
}: {
  auction: Auction;
  bidHistory: BidEntry[];
  playerCitizenid: string;
  playerFunds: { cash: number; bank: number };
  onPlaceBid: (amount: number) => void;
  onCancel: () => void;
  onBack: () => void;
}) {
  const [bidAmount, setBidAmount] = useState(0);
  const [showConfirmCancel, setShowConfirmCancel] = useState(false);

  const isOwnAuction = auction.owner.citizenid === playerCitizenid;
  const isHighestBidder = auction.highestBidder?.citizenid === playerCitizenid;
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
            <div className="space-y-2 max-h-48 overflow-y-auto">
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

// Main App Component
export default function App() {
  const [visible, setVisible] = useState(isDebug);
  const [view, setView] = useState<'list' | 'create' | 'detail'>('list');
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
  });

  useNuiEvent('auctionCreated', (auction: Auction) => {
    setAuctions(prev => {
      // Prevent duplicates - only add if not already in list
      if (prev.some(a => a.id === auction.id)) {
        return prev;
      }
      return [auction, ...prev];
    });
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
    setAuctions(prev => prev.filter(a => a.id !== data.auctionId));
    if (selectedAuctionId === data.auctionId) {
      setSelectedAuctionId(null);
      setView('list');
    }
  });

  useNuiEvent('auctionCancelled', (data: { auctionId: string }) => {
    setAuctions(prev => prev.filter(a => a.id !== data.auctionId));
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

  // NUI Actions
  const handleClose = useCallback(() => {
    setVisible(false);
    fetchNui('close', {}, { success: true });
  }, []);

  const handleCreateAuction = useCallback((data: { itemName: string; count: number; startingBid: number; duration: number }) => {
    setIsSubmitting(true);
    fetchNui('createAuction', data, { success: true });
  }, []);

  const handlePlaceBid = useCallback((auctionId: string, amount: number) => {
    fetchNui('placeBid', { auctionId, amount }, { success: true });
  }, []);

  const handleCancelAuction = useCallback((auctionId: string) => {
    fetchNui('cancelAuction', { auctionId }, { success: true });
  }, []);

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
        playerName: 'Test Player'
      });

      setAuctions([
        {
          id: 'AUC_1',
          owner: { id: 2, name: 'John Marston', citizenid: 'citizen2' },
          item: { name: 'gold_nugget', label: 'Gold Nugget', count: 10, metadata: {} },
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
    }
  }, []);

  if (!visible) return null;

  const selectedAuction = selectedAuctionId ? auctions.find(a => a.id === selectedAuctionId) : null;
  const myAuctions = auctions.filter(a => a.owner.citizenid === playerData.citizenid);
  const displayAuctions = activeTab === 'mine' ? myAuctions : auctions;

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
      <div className="w-[900px] max-w-[95vw] h-[700px] max-h-[90vh] bg-stone-950 border border-stone-700 rounded-xl shadow-2xl flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 border-r border-stone-700 flex flex-col">
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

        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          {view === 'list' && (
            <>
              {/* Header with Tabs */}
              <div className="p-4 border-b border-stone-700 flex items-center justify-between">
                <div className="flex gap-2">
                  <button
                    onClick={() => setActiveTab('all')}
                    className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                      activeTab === 'all' ? 'bg-amber-700 text-white' : 'bg-stone-800 text-stone-400 hover:bg-stone-700'
                    }`}
                  >
                    All Auctions ({auctions.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('mine')}
                    className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                      activeTab === 'mine' ? 'bg-amber-700 text-white' : 'bg-stone-800 text-stone-400 hover:bg-stone-700'
                    }`}
                  >
                    My Auctions ({myAuctions.length})
                  </button>
                </div>
                <button
                  onClick={() => setView('create')}
                  className="px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  + New Auction
                </button>
              </div>

              {/* Auction Grid */}
              <div className="flex-1 overflow-y-auto p-4">
                {displayAuctions.length === 0 ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <p className="text-4xl text-stone-700 mb-2">📦</p>
                      <p className="text-stone-500">No auctions available</p>
                      <button
                        onClick={() => setView('create')}
                        className="mt-4 px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white rounded-lg text-sm"
                      >
                        Create First Auction
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {displayAuctions.map(auction => (
                      <AuctionCard
                        key={auction.id}
                        auction={auction}
                        playerCitizenid={playerData.citizenid}
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
            </>
          )}

          {view === 'create' && (
            <CreateAuctionForm
              inventory={playerData.inventory}
              onCreate={handleCreateAuction}
              onClose={() => setView('list')}
              isSubmitting={isSubmitting}
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

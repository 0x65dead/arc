import React, { useState, useEffect } from 'react';
import { 
  Search, Globe, FileText, Wallet, ExternalLink, Clock, ArrowRight, 
  CheckCircle2, AlertCircle, X, Sparkles, RefreshCw, Copy, Check,
  Menu, Shield, Settings, ShoppingBag
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { ethers } from 'ethers';
import { 
  useAccount, useConnect, useDisconnect, useWriteContract, usePublicClient
} from 'wagmi';
import { injected } from 'wagmi/connectors';

// --- Deployment Addresses ---
const CONTROLLER_ADDRESS = '0x2FE2560B2FE6D54e50806F531223247CcfEd739B';
const REGISTRAR_ADDRESS = '0x3dC38247c4f9672B2C98aCfdc5C1302f8d897E9C';
const RESOLVER_ADDRESS = '0x027d6dCc8F1235dfdd47E532e77909363C701E54';
const MARKET_ADDRESS = '0xC94Ff1964840BdF8E6952455a2342Ffc6B0bA299';
const REGISTRY_ADDRESS = '0xCA78696791670CbC14eE802e6DcDfD661a458978';
const UNIVERSAL_RESOLVER_ADDRESS = '0xA3F364a558eb712AFbB4929df49e538A800438BC';

// Block from which we start indexing on-chain events (contract deployment block)
const DEPLOY_BLOCK = 52346600;

// --- Simplified ABIs for on-chain calls ---
const CONTROLLER_ABI = [
  'function available(string calldata nm) external view returns (bool)',
  'function valid(string calldata nm) external view returns (bool)',
  'function price(string memory nm, uint256 dur) public view returns (uint256)',
  'function makeCommitment(string calldata nm, address o, bytes32 s) public pure returns (bytes32)',
  'function commit(bytes32 c) external',
  'function register(string calldata nm, address o, uint256 dur, bytes32 s) external payable',
  'function renew(string calldata nm, uint256 dur) external payable'
];

const RESOLVER_ABI = [
  'function addr(bytes32 node) external view returns (address)',
  'function text(bytes32 node, string calldata key) external view returns (string memory)',
  'function setAddr(bytes32 node, address a) external',
  'function setText(bytes32 node, string calldata key, string calldata value) external'
];

const REGISTRAR_ABI = [
  'function ownerOf(uint256 id) external view returns (address)',
  'function tokenURI(uint256 id) external view returns (string memory)',
  'function labels(uint256 id) external view returns (string memory)',
  'function isApprovedForAll(address owner, address operator) external view returns (bool)',
  'function setApprovalForAll(address operator, bool approved) external',
  'function approve(address to, uint256 id) external',
  'function getApproved(uint256 id) external view returns (address)',
  'function nameExpires(uint256 id) external view returns (uint256)'
];

const MARKET_ABI = [
  'function listings(uint256 id) external view returns (address seller, uint256 price)',
  'function listingCurrency(uint256 id) external view returns (uint8)',
  'function list(uint256 id, uint256 price) external',
  'function unlist(uint256 id) external',
  'function buy(uint256 id, uint256 maxPrice) external payable'
];

// --- Custom Name Hash Helpers ---
export function namehash(name: string): string {
  let node = '0x0000000000000000000000000000000000000000000000000000000000000000';
  if (!name) return node;
  const labels = name.split('.');
  for (let i = labels.length - 1; i >= 0; i--) {
    const labelHash = ethers.keccak256(ethers.toUtf8Bytes(labels[i]));
    node = ethers.keccak256(ethers.concat([node, labelHash]));
  }
  return node;
}

export function labelToId(label: string): string {
  const hash = ethers.keccak256(ethers.toUtf8Bytes(label));
  return BigInt(hash).toString();
}

// Fetch logs in bounded-size chunks to stay under RPC provider block-range caps.
// On a chunk failure we stop and return whatever was collected so far rather than
// throwing, matching this file's existing warn-and-continue error handling style.
async function fetchLogsWithChunking(
  provider: ethers.JsonRpcProvider,
  filter: { address: string; topics: any[] },
  startBlock: number,
  endBlock: number,
  chunkSize: number = 10000
): Promise<ethers.Log[]> {
  let currentBlock = startBlock;
  let allLogs: ethers.Log[] = [];

  while (currentBlock <= endBlock) {
    const chunkEndBlock = Math.min(currentBlock + chunkSize - 1, endBlock);
    try {
      const logs = await provider.getLogs({
        ...filter,
        fromBlock: currentBlock,
        toBlock: chunkEndBlock,
      });
      allLogs = allLogs.concat(logs);
    } catch (err) {
      console.warn(`Failed to fetch logs for blocks ${currentBlock}-${chunkEndBlock}:`, err);
      // Stop rather than looping forever; caller receives the partial result collected so far.
      break;
    }
    currentBlock = chunkEndBlock + 1;
  }
  return allLogs;
}

// Pre-seeded list of domains to look up or list in the market/explore view
const DEFAULT_TRACKED_DOMAINS = [
  'first', 'arc', 'domain', 'test', 'alice', 'bob', 'charlie', 'degen', 'usdc', 'crypto', 'stable', 'finance', 'finality'
];

export function parseRevertReason(err: any): string {
  if (!err) return 'Unknown error occurred.';
  const message = err.message || '';
  
  if (message.includes('!owner')) return 'Error: Not the owner of this domain.';
  if (message.includes('!minted')) return 'Error: Domain has not been minted.';
  if (message.includes('early')) return 'Error: Commitment is too young. Please wait for the 60-second delay.';
  if (message.includes('commit expired')) return 'Error: Commitment has expired. Please commit again.';
  if (message.includes('invalid')) return 'Error: Domain name is invalid.';
  if (message.includes('duration')) return 'Error: Registration duration is invalid.';
  if (message.includes('underpaid')) return 'Error: Insufficient native USDC value sent.';
  if (message.includes('taken')) return 'Error: Domain is already registered.';
  if (message.includes('expired')) return 'Error: Domain has expired.';
  if (message.includes('!listed')) return 'Error: Domain is not listed in the marketplace.';
  if (message.includes('price moved')) return 'Error: Listing price has changed.';
  if (message.includes('seller changed')) return 'Error: Owner of the domain has changed.';
  
  const revertMatch = message.match(/reverted with reason "([^"]+)"/) || message.match(/revert:? ([\w! ]+)/i);
  if (revertMatch && revertMatch[1]) {
    return `Transaction reverted: ${revertMatch[1]}`;
  }
  
  return message.slice(0, 120) + (message.length > 120 ? '...' : '');
}

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState<'search' | 'my-domains' | 'marketplace' | 'explorer' | 'docs'>('search');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Wagmi Connection Hooks
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  // Local state for searched & registered names
  const [trackedNames, setTrackedNames] = useState<string[]>(() => {
    const saved = localStorage.getItem('arc_tracked_names');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return Array.from(new Set([...DEFAULT_TRACKED_DOMAINS, ...parsed]));
      } catch {
        return DEFAULT_TRACKED_DOMAINS;
      }
    }
    return DEFAULT_TRACKED_DOMAINS;
  });

  // Track state of user's commitment flow in local storage to prevent loss on refresh
  const [activeCommitment, setActiveCommitment] = useState<{
    name: string;
    secret: string;
    hash: string;
    owner: string;
    timestamp: number;
    step: 'idle' | 'committing' | 'waiting' | 'ready' | 'registering' | 'completed';
    txHash?: string;
  } | null>(() => {
    const saved = localStorage.getItem('arc_active_commitment');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return null;
      }
    }
    return null;
  });

  // Inputs
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<{
    name: string;
    available: boolean;
    priceWei: bigint;
    priceFormatted: string;
    isValid: boolean;
    checkedOnChain: boolean;
    owner?: string;
    resolver?: string;
  } | null>(null);

  // Core loading states
  const [isSearching, setIsSearching] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // Toasts
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [copiedName, setCopiedName] = useState<string | null>(null);

  // Selected domain for record management
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [isManagingRecords, setIsManagingRecords] = useState(false);
  const [recordAddr, setRecordAddr] = useState('');
  const [recordTwitter, setRecordTwitter] = useState('');
  const [recordDesc, setRecordDesc] = useState('');
  const [isUpdatingRecord, setIsUpdatingRecord] = useState(false);

  // Dynamic on-chain statistics states
  const [statsRevenue, setStatsRevenue] = useState('0.00');
  const [statsNamesCount, setStatsNamesCount] = useState('0');

  // Marketplace states
  const [marketplaceListings, setMarketplaceListings] = useState<Array<{
    name: string;
    id: string;
    price: string;
    seller: string;
    isUSDCListing: boolean;
  }>>([]);
  
  // User Domains state
  const [userDomains, setUserDomains] = useState<Array<{
    name: string;
    id: string;
    owner: string;
    expiry: number;
    svgUrl: string;
    resolvedAddress?: string;
  }>>([]);
  const [isLoadingDomains, setIsLoadingDomains] = useState(false);

  // Listing states
  const [isListingToken, setIsListingToken] = useState<string | null>(null);
  const [listingPrice, setListingPrice] = useState('');
  const [isSubmittingListing, setIsSubmittingListing] = useState(false);

  // Wagmi Write Contract Hook
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  // writeContractAsync only resolves once the wallet returns a tx hash, not once the
  // tx is mined. Every flow below (commit/reveal timing, refetching domains after a
  // mint) depends on the tx actually being confirmed first, so we wait on the receipt
  // before moving to the next step.
  const waitForTx = async (hash: `0x${string}`) => {
    if (!publicClient) return;
    await publicClient.waitForTransactionReceipt({ hash });
  };

  const [isRenewing, setIsRenewing] = useState<string | null>(null);

  const triggerRenew = async (name: string) => {
    if (!address) return;
    setIsRenewing(name);
    try {
      showSuccess(`Estimating renewal cost for ${name}.arc...`);
      const provider = new ethers.JsonRpcProvider('https://rpc.testnet.arc.network');
      const controller = new ethers.Contract(CONTROLLER_ADDRESS, CONTROLLER_ABI, provider);
      const priceWei = await controller.price(name, 31536000); // 1 year renewal

      showSuccess(`Please approve the renewal transaction for ${name}.arc in your wallet...`);
      const tx = await writeContractAsync({
        address: CONTROLLER_ADDRESS,
        abi: CONTROLLER_ABI,
        functionName: 'renew',
        args: [name, 31536000],
        value: BigInt(priceWei.toString()) // Paid in native USDC gas token (18 decimals)
      });
      showSuccess('Confirming renewal on-chain...');
      await waitForTx(tx);
      showSuccess(`Successfully renewed ${name}.arc for 1 year!`);
      fetchDomainsAndListings();
    } catch (err: any) {
      console.error('Renewal failed:', err);
      showError(parseRevertReason(err));
    } finally {
      setIsRenewing(null);
    }
  };

  // Save tracked domains to local storage
  const addTrackedName = (name: string) => {
    const cleaned = name.trim().toLowerCase().replace('.arc', '');
    if (!cleaned) return;
    setTrackedNames(prev => {
      const next = Array.from(new Set([...prev, cleaned]));
      localStorage.setItem('arc_tracked_names', JSON.stringify(next));
      return next;
    });
  };

  // Toast helper
  const showSuccess = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast(null), 4000);
  };

  const showError = (msg: string) => {
    setErrorToast(msg);
    setTimeout(() => setErrorToast(null), 4000);
  };

  // Copy helper
  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedName(label);
    setTimeout(() => setCopiedName(null), 1500);
  };

  // Keep commitment state synchronized
  useEffect(() => {
    if (activeCommitment) {
      localStorage.setItem('arc_active_commitment', JSON.stringify(activeCommitment));
    } else {
      localStorage.removeItem('arc_active_commitment');
    }
  }, [activeCommitment]);

  // Handle countdown timer for reveal delay
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (activeCommitment && activeCommitment.step === 'waiting') {
      const elapsed = Math.floor((Date.now() - activeCommitment.timestamp) / 1000);
      const remaining = Math.max(0, 60 - elapsed);
      setCountdown(remaining);
      if (remaining <= 0) {
        setActiveCommitment(prev => prev ? { ...prev, step: 'ready' } : null);
      } else {
        interval = setInterval(() => {
          setCountdown(prev => {
            if (prev <= 1) {
              setActiveCommitment(current => current ? { ...current, step: 'ready' } : null);
              clearInterval(interval);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }
    }
    return () => clearInterval(interval);
  }, [activeCommitment]);

  // --- Real RPC Reading ---
  const handleSearchOnChain = async (e?: React.FormEvent, forcedQuery?: string) => {
    if (e) e.preventDefault();
    const query = (forcedQuery !== undefined ? forcedQuery : searchQuery).trim().toLowerCase().replace('.arc', '');
    if (!query) return;

    // Check validity locally first (only lowercase, digits, dashes)
    const isValid = /^[a-z0-9-]+$/.test(query) && query.length >= 2;
    if (!isValid) {
      setSearchResult({
        name: query,
        available: false,
        priceWei: 0n,
        priceFormatted: '0',
        isValid: false,
        checkedOnChain: false
      });
      return;
    }

    setIsSearching(true);
    try {
      const provider = new ethers.JsonRpcProvider('https://rpc.testnet.arc.network');
      const controller = new ethers.Contract(CONTROLLER_ADDRESS, CONTROLLER_ABI, provider);
      
      const isAvailable = await controller.available(query);
      const priceWei = await controller.price(query, 31536000); // 1 year
      const priceFormatted = ethers.formatEther(priceWei);

      let ownerAddress = '';
      let resolverAddress = '';
      if (!isAvailable) {
        try {
          const registry = new ethers.Contract(REGISTRY_ADDRESS, [
            'function owner(bytes32 node) view returns (address)',
            'function resolver(bytes32 node) view returns (address)'
          ], provider);
          const node = namehash(`${query}.arc`);
          ownerAddress = await registry.owner(node);
          resolverAddress = await registry.resolver(node);
        } catch (e) {
          console.warn('Could not read owner/resolver:', e);
        }
      }

      const isOwnedByUser = isConnected && address && userDomains.some(dom => dom.name.toLowerCase() === query);

      setSearchResult({
        name: query,
        available: isOwnedByUser ? false : isAvailable,
        priceWei: BigInt(priceWei.toString()),
        priceFormatted: parseFloat(priceFormatted).toFixed(2),
        isValid: true,
        checkedOnChain: true,
        owner: isOwnedByUser ? address : ownerAddress,
        resolver: resolverAddress
      });
      addTrackedName(query);
    } catch (err: any) {
      console.error('Error querying onchain:', err);
      // Fallback calculations in case RPC is congested
      const len = query.length;
      let cost = '5';
      if (len === 2) cost = '2.0';
      else if (len === 3) cost = '640';
      else if (len === 4) cost = '160';

      const isOwnedByUser = isConnected && address && userDomains.some(dom => dom.name.toLowerCase() === query);

      setSearchResult({
        name: query,
        available: isOwnedByUser ? false : true,
        priceWei: ethers.parseEther(cost),
        priceFormatted: cost,
        isValid: true,
        checkedOnChain: true,
        owner: isOwnedByUser ? address : undefined
      });
    } finally {
      setIsSearching(false);
    }
  };

  // Debounced search-as-you-type trigger
  useEffect(() => {
    const query = searchQuery.trim().toLowerCase().replace('.arc', '');
    if (!query || query.length < 2) {
      setSearchResult(null);
      return;
    }

    const timer = setTimeout(() => {
      handleSearchOnChain(undefined, query);
    }, 450); // 450ms debounce delay

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // --- STEP 1: COMMIT NAME ---
  const triggerCommit = async () => {
    if (!searchResult || !isConnected || !address) {
      showError('Please connect your Web3 wallet first!');
      return;
    }

    try {
      // 1. Generate secret & commitment
      const secret = ethers.hexlify(ethers.randomBytes(32));
      const provider = new ethers.JsonRpcProvider('https://rpc.testnet.arc.network');
      const controller = new ethers.Contract(CONTROLLER_ADDRESS, CONTROLLER_ABI, provider);
      
      const hash = await controller.makeCommitment(searchResult.name, address, secret);

      setActiveCommitment({
        name: searchResult.name,
        secret,
        hash,
        owner: address,
        timestamp: Date.now(),
        step: 'committing'
      });

      // 2. Broadcast Transaction
      showSuccess('Please approve the commitment transaction in your wallet...');
      const tx = await writeContractAsync({
        address: CONTROLLER_ADDRESS,
        abi: CONTROLLER_ABI,
        functionName: 'commit',
        args: [hash]
      });

      // Wait for the commit to actually be mined before starting the countdown.
      // minCommitAge/maxCommitAge are enforced against the mined block timestamp,
      // not against when the wallet returned this hash.
      showSuccess('Waiting for commitment to confirm on-chain...');
      await waitForTx(tx);

      setActiveCommitment(prev => prev ? {
        ...prev,
        step: 'waiting',
        timestamp: Date.now(),
        txHash: tx
      } : null);

      showSuccess('Commitment confirmed! Beginning 60s maturity countdown...');
    } catch (err: any) {
      console.error('Commit failed:', err);
      setActiveCommitment(null);
      showError(parseRevertReason(err));
    }
  };

  // --- STEP 3: REVEAL AND REGISTER ---
  const triggerRegister = async () => {
    if (!activeCommitment || !address) return;

    try {
      setActiveCommitment(prev => prev ? { ...prev, step: 'registering' } : null);
      showSuccess('Estimating cost and preparing registration transaction...');

      const provider = new ethers.JsonRpcProvider('https://rpc.testnet.arc.network');
      const controller = new ethers.Contract(CONTROLLER_ADDRESS, CONTROLLER_ABI, provider);
      const priceWei = await controller.price(activeCommitment.name, 31536000);

      const tx = await writeContractAsync({
        address: CONTROLLER_ADDRESS,
        abi: CONTROLLER_ABI,
        functionName: 'register',
        args: [
          activeCommitment.name,
          address,
          31536000, // 1 year duration
          activeCommitment.secret
        ],
        value: BigInt(priceWei.toString()) // Paid in native USDC gas token (18 decimals)
      });

      showSuccess('Confirming registration on-chain...');
      await waitForTx(tx);

      confetti({ particleCount: 200, spread: 80, origin: { y: 0.6 } });
      showSuccess(`Successfully registered ${activeCommitment.name}.arc!`);
      
      setActiveCommitment(prev => prev ? { ...prev, step: 'completed', txHash: tx } : null);
      addTrackedName(activeCommitment.name);
      
      // Clear commitment after 5s
      setTimeout(() => {
        setActiveCommitment(null);
        setSearchResult(null);
        setSearchQuery('');
        setActiveTab('my-domains');
      }, 5000);
    } catch (err: any) {
      console.error('Registration failed:', err);
      setActiveCommitment(prev => prev ? { ...prev, step: 'ready' } : null);
      showError(parseRevertReason(err));
    }
  };

  // --- Fetch Marketplace and User Domains ---
  const fetchDomainsAndListings = async () => {
    setIsLoadingDomains(true);

    try {
      const provider = new ethers.JsonRpcProvider('https://rpc.testnet.arc.network');

      // Resolve the current chain head once and reuse it for every chunked scan below,
      // instead of re-querying per log fetch.
      const latestBlock = await provider.getBlockNumber();

      const listResults: typeof userDomains = [];
      const marketResults: typeof marketplaceListings = [];

      // Discover all registered names and compute live statistics by indexing on-chain events
      const controllerInterface = new ethers.Interface([
        'event NameRegistered(string name, bytes32 indexed label, address indexed owner, uint256 cost, uint256 expires)',
        'event NameRenewed(string name, bytes32 indexed label, uint256 cost, uint256 expires)'
      ]);

      const marketInterface = new ethers.Interface([
        'event Listed(uint256 indexed id, address indexed seller, uint256 price)',
        'event PriceChanged(uint256 indexed id, address indexed seller, uint256 price)',
        'event Unlisted(uint256 indexed id, address indexed seller)',
        'event Sold(uint256 indexed id, address indexed seller, address indexed buyer, uint256 price, uint256 fee)'
      ]);

      const discoveredNames = new Set<string>(DEFAULT_TRACKED_DOMAINS);
      const registeredNamesCount = new Set<string>();
      // Hoisted out of the try block below so the revenue-summing block can reuse it
      // without re-fetching the same NameRegistered logs a second time.
      let registeredLogs: ethers.Log[] = [];

      try {
        registeredLogs = await fetchLogsWithChunking(
          provider,
          {
            address: CONTROLLER_ADDRESS,
            topics: [ethers.id("NameRegistered(string,bytes32,address,uint256,uint256)")]
          },
          DEPLOY_BLOCK,
          latestBlock
        );

        registeredLogs.forEach(log => {
          try {
            const parsed = controllerInterface.parseLog(log);
            if (parsed) {
              const { name } = parsed.args;
              const cleaned = name.trim().toLowerCase().replace('.arc', '');
              if (cleaned) {
                discoveredNames.add(cleaned);
                registeredNamesCount.add(cleaned);
              }
            }
          } catch (e) {
            console.warn('Failed to parse NameRegistered log:', e);
          }
        });
      } catch (logErr) {
        console.warn('Failed to fetch NameRegistered logs:', logErr);
      }

      // TOTAL REVENUE = lifetime gross volume, i.e. the sum of 'cost' across every
      // NameRegistered + NameRenewed event. Reading the contract's live USDC balance
      // instead would undercount as soon as the owner withdraws funds, so we sum the
      // historical event stream rather than reading current treasury state.
      let totalRevenueWei = 0n;
      try {
        registeredLogs.forEach(log => {
          try {
            const parsed = controllerInterface.parseLog(log);
            if (parsed) {
              totalRevenueWei += BigInt(parsed.args.cost.toString());
            }
          } catch (e) {
            // Already warned above during discovery pass; skip.
          }
        });

        const renewedLogs = await fetchLogsWithChunking(
          provider,
          {
            address: CONTROLLER_ADDRESS,
            topics: [ethers.id("NameRenewed(string,bytes32,uint256,uint256)")]
          },
          DEPLOY_BLOCK,
          latestBlock
        );

        renewedLogs.forEach(log => {
          try {
            const parsed = controllerInterface.parseLog(log);
            if (parsed) {
              totalRevenueWei += BigInt(parsed.args.cost.toString());
            }
          } catch (e) {
            console.warn('Failed to parse NameRenewed log:', e);
          }
        });
      } catch (err) {
        console.warn('Failed to sum revenue from events:', err);
      }

      const formattedRevenue = parseFloat(ethers.formatEther(totalRevenueWei));
      setStatsRevenue(formattedRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

      // Fetch on-chain total Transfer logs from zero address to compute exact minted count
      let mintsCount = 0;
      try {
        const mintLogs = await fetchLogsWithChunking(
          provider,
          {
            address: REGISTRAR_ADDRESS,
            topics: [
              ethers.id("Transfer(address,address,uint256)"),
              ethers.zeroPadValue(ethers.ZeroAddress, 32)
            ]
          },
          DEPLOY_BLOCK,
          latestBlock
        );
        mintsCount = mintLogs.length;
      } catch (mintErr) {
        console.warn('Failed to fetch Transfer (mint) logs:', mintErr);
      }

      // NAMES CLAIMED: Use the count of mints, or fall back to registeredNamesCount if non-empty, or discoveredNames
      const fallbackSize = registeredNamesCount.size > 0 ? registeredNamesCount.size : discoveredNames.size;
      const finalNamesCount = mintsCount > 0 ? mintsCount : fallbackSize;
      setStatsNamesCount(finalNamesCount.toLocaleString());

      // Helper map for token IDs
      const idToNameMap = new Map<string, string>();
      discoveredNames.forEach(name => {
        idToNameMap.set(labelToId(name), name);
      });

      // Reconstruct Marketplace active listings by reading listings mapping from the contract
      try {
        const listedLogs = await fetchLogsWithChunking(
          provider,
          {
            address: MARKET_ADDRESS,
            topics: [ethers.id("Listed(uint256,address,uint256)")]
          },
          DEPLOY_BLOCK,
          latestBlock
        );

        const uniqueTokenIds = new Set<string>();
        listedLogs.forEach(log => {
          try {
            const parsed = marketInterface.parseLog(log);
            if (parsed) {
              uniqueTokenIds.add(parsed.args.id.toString());
            }
          } catch (e) {
            console.warn('Failed to parse Listed log:', e);
          }
        });

        const marketContract = new ethers.Contract(MARKET_ADDRESS, MARKET_ABI, provider);
        await Promise.all(Array.from(uniqueTokenIds).map(async (idStr) => {
          try {
            const id = BigInt(idStr);
            const listing = await marketContract.listings(id);
            const seller = listing[0];
            const price = listing[1];

            if (seller && seller !== ethers.ZeroAddress) {
              let name = idToNameMap.get(idStr);
              if (!name) {
                try {
                  // Fetch the on-chain label if we don't have it
                  const registrarContract = new ethers.Contract(REGISTRAR_ADDRESS, ["function labels(uint256) view returns (string)"], provider);
                  name = await registrarContract.labels(id);
                } catch {
                  name = '';
                }
              }

              if (!name) {
                name = `Token #${idStr.slice(0, 6)}`;
              }

              marketResults.push({
                name,
                id: idStr,
                price: ethers.formatEther(price),
                seller,
                isUSDCListing: false
              });
            }
          } catch (err) {
            console.warn(`Failed to fetch onchain listing detail for token ${idStr}:`, err);
          }
        }));
      } catch (marketErr) {
        console.warn('Failed to fetch Market logs:', marketErr);
      }

      // Filter user owned domains from Transfer events filtered by to: userAddress
      if (isConnected && address) {
        try {
          const paddedAddress = ethers.zeroPadValue(address, 32);
          const transferLogs = await fetchLogsWithChunking(
            provider,
            {
              address: REGISTRAR_ADDRESS,
              topics: [
                ethers.id("Transfer(address,address,uint256)"),
                null,
                paddedAddress
              ]
            },
            DEPLOY_BLOCK,
            latestBlock
          );
          
          // Create a set to ensure a user doesn't have duplicate entries if transferred multiple times
          const ownedTokenIds = new Set<string>();
          const registrarInterface = new ethers.Interface([
            'event Transfer(address indexed from, address indexed to, uint256 indexed id)'
          ]);

          transferLogs.forEach(log => {
            try {
              const parsed = registrarInterface.parseLog(log);
              if (parsed && parsed.args && parsed.args.id !== undefined) {
                ownedTokenIds.add(parsed.args.id.toString());
              } else if (log.topics[3]) {
                ownedTokenIds.add(BigInt(log.topics[3]).toString());
              }
            } catch(e) {
              try {
                if (log.topics[3]) {
                  ownedTokenIds.add(BigInt(log.topics[3]).toString());
                }
              } catch (innerErr) {
                console.warn("Failed to parse Transfer log:", e);
              }
            }
          });

          // Fetch metadata for each owned token
          const ownedDomainsData: typeof userDomains = [];
          const registrarContract = new ethers.Contract(REGISTRAR_ADDRESS, [
            "function tokenURI(uint256) view returns (string)",
            "function labels(uint256) view returns (string)",
            "function nameExpires(uint256) view returns (uint256)",
            "function ownerOf(uint256) view returns (address)"
          ], provider);

          for (const idStr of Array.from(ownedTokenIds)) {
            try {
              const id = BigInt(idStr);
              
              // Verify ownership is still current to prevent displaying previously owned transfer history
              const currentOwner = await registrarContract.ownerOf(id).catch(() => ethers.ZeroAddress);
              if (currentOwner.toLowerCase() !== address.toLowerCase()) {
                continue;
              }

              // Fetch the human-readable label
              const label = await registrarContract.labels(id).catch(() => '');
              const name = label || idToNameMap.get(idStr) || `Token #${idStr.slice(0, 6)}`;

              // Fetch the on-chain SVG metadata
              const tokenURI = await registrarContract.tokenURI(id).catch(() => '');
              
              let svgUrl = '';
              try {
                if (tokenURI && tokenURI.startsWith('data:application/json;base64,')) {
                  const jsonB64 = tokenURI.substring('data:application/json;base64,'.length);
                  const jsonStr = atob(jsonB64);
                  const parsed = JSON.parse(jsonStr);
                  svgUrl = parsed.image;
                }
              } catch (e) {
                console.warn('Failed to parse tokenURI, fallback to local rendering', e);
              }

              if (!svgUrl) {
                const svg = generateLocalSVG(name);
                svgUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
              }

              let expiry = Math.floor(Date.now() / 1000) + 31536000;
              try {
                const exp = await registrarContract.nameExpires(id);
                expiry = Number(exp);
              } catch {
                // Fallback
              }

              let resolvedAddress = ethers.ZeroAddress;
              if (name && !name.startsWith('Token #')) {
                try {
                  const node = namehash(`${name}.arc`);
                  const resolverContract = new ethers.Contract(RESOLVER_ADDRESS, RESOLVER_ABI, provider);
                  resolvedAddress = await resolverContract.addr(node);
                } catch {
                  // Fallback
                }
              }

              ownedDomainsData.push({
                id: idStr,
                name: name,
                owner: currentOwner,
                expiry: expiry,
                svgUrl: svgUrl,
                resolvedAddress: resolvedAddress
              });
            } catch (err) {
              console.warn(`Failed to fetch metadata for token ${idStr}:`, err);
            }
          }

          listResults.push(...ownedDomainsData);

        } catch (err) {
          console.warn('Failed to fetch user Transfer logs:', err);
        }
      }

      setUserDomains(listResults);
      setMarketplaceListings(marketResults);
    } catch (err) {
      console.warn('Failed to load on-chain domains/listings, using fallback cache:', err);
    } finally {
      setIsLoadingDomains(false);
    }
  };

  // Refetch when tab changes or tracked domains update
  useEffect(() => {
    fetchDomainsAndListings();
  }, [activeTab, trackedNames, isConnected, address]);

  // --- Edit Records ---
  const openRecordManager = async (name: string) => {
    setSelectedDomain(name);
    setRecordAddr('');
    setRecordTwitter('');
    setRecordDesc('');
    setIsManagingRecords(true);

    try {
      const provider = new ethers.JsonRpcProvider('https://rpc.testnet.arc.network');
      const resolver = new ethers.Contract(RESOLVER_ADDRESS, RESOLVER_ABI, provider);
      const node = namehash(`${name}.arc`);

      const currentAddr = await resolver.addr(node).catch(() => '');
      const twitter = await resolver.text(node, 'twitter').catch(() => '');
      const description = await resolver.text(node, 'description').catch(() => '');

      setRecordAddr(currentAddr && currentAddr !== ethers.ZeroAddress ? currentAddr : '');
      setRecordTwitter(twitter || '');
      setRecordDesc(description || '');
    } catch (err) {
      console.warn('Could not read existing record data, proceeding empty.');
    }
  };

  const updateRecords = async () => {
    if (!selectedDomain || !address) return;
    setIsUpdatingRecord(true);

    try {
      const node = namehash(`${selectedDomain}.arc`);
      const provider = new ethers.JsonRpcProvider('https://rpc.testnet.arc.network');
      const registry = new ethers.Contract(REGISTRY_ADDRESS, [
        'function owner(bytes32 node) view returns (address)'
      ], provider);
      
      const nodeOwner = await registry.owner(node).catch(() => ethers.ZeroAddress);
      if (nodeOwner.toLowerCase() !== address.toLowerCase()) {
        showError('You must be the owner of the node in the Registry to update its resolver records.');
        setIsUpdatingRecord(false);
        return;
      }

      // Update primary address record
      if (recordAddr) {
        showSuccess('Please approve the address configuration transaction...');
        const addrTx = await writeContractAsync({
          address: RESOLVER_ADDRESS,
          abi: RESOLVER_ABI,
          functionName: 'setAddr',
          args: [node, recordAddr]
        });
        await waitForTx(addrTx);
      }

      // Update description text record
      if (recordDesc) {
        showSuccess('Please approve the profile description transaction...');
        const descTx = await writeContractAsync({
          address: RESOLVER_ADDRESS,
          abi: RESOLVER_ABI,
          functionName: 'setText',
          args: [node, 'description', recordDesc]
        });
        await waitForTx(descTx);
      }

      showSuccess('Records successfully configured on-chain!');
      setIsManagingRecords(false);
      fetchDomainsAndListings();
    } catch (err: any) {
      console.error(err);
      showError(parseRevertReason(err));
    } finally {
      setIsUpdatingRecord(false);
    }
  };

  // --- Marketplace Actions ---
  const initiateListing = (name: string) => {
    setIsListingToken(name);
    setListingPrice('');
  };

  const submitListing = async () => {
    if (!isListingToken || !listingPrice) return;
    setIsSubmittingListing(true);

    try {
      const id = labelToId(isListingToken);
      const priceWei = ethers.parseEther(listingPrice);

      // Check approval first via getApproved
      const provider = new ethers.JsonRpcProvider('https://rpc.testnet.arc.network');
      const registrar = new ethers.Contract(REGISTRAR_ADDRESS, REGISTRAR_ABI, provider);
      const approvedAddress = await registrar.getApproved(id).catch(() => ethers.ZeroAddress);

      if (approvedAddress.toLowerCase() !== MARKET_ADDRESS.toLowerCase()) {
        showSuccess('Please approve the marketplace listing permission first...');
        const approveTx = await writeContractAsync({
          address: REGISTRAR_ADDRESS,
          abi: REGISTRAR_ABI,
          functionName: 'approve',
          args: [MARKET_ADDRESS, id]
        });
        await waitForTx(approveTx);
      }

      showSuccess('Please approve the secondary marketplace listing transaction...');
      const listTx = await writeContractAsync({
        address: MARKET_ADDRESS,
        abi: MARKET_ABI,
        functionName: 'list',
        args: [id, priceWei]
      });
      await waitForTx(listTx);

      showSuccess(`Domain ${isListingToken}.arc listed for ${listingPrice} USDC!`);
      setIsListingToken(null);
      fetchDomainsAndListings();
    } catch (err: any) {
      console.error(err);
      showError(parseRevertReason(err));
    } finally {
      setIsSubmittingListing(false);
    }
  };

  const cancelListing = async (name: string) => {
    try {
      const id = labelToId(name);
      showSuccess('Please approve the listing cancellation transaction...');
      const unlistTx = await writeContractAsync({
        address: MARKET_ADDRESS,
        abi: MARKET_ABI,
        functionName: 'unlist',
        args: [id]
      });
      await waitForTx(unlistTx);
      showSuccess(`Domain ${name}.arc has been successfully unlisted.`);
      fetchDomainsAndListings();
    } catch (err: any) {
      console.error(err);
      showError(parseRevertReason(err));
    }
  };

  const purchaseListing = async (listing: typeof marketplaceListings[0]) => {
    try {
      const priceWei = ethers.parseEther(listing.price);
      showSuccess(`Purchasing ${listing.name}.arc for ${listing.price} USDC...`);
      const buyTx = await writeContractAsync({
        address: MARKET_ADDRESS,
        abi: MARKET_ABI,
        functionName: 'buy',
        args: [listing.id, priceWei],
        value: priceWei // Paid in native USDC (18 decimals)
      });
      showSuccess('Confirming purchase on-chain...');
      await waitForTx(buyTx);
      confetti({ particleCount: 150, spread: 80 });
      showSuccess(`Congratulations! You are the new owner of ${listing.name}.arc.`);
      fetchDomainsAndListings();
    } catch (err: any) {
      console.error(err);
      showError(parseRevertReason(err));
    }
  };

  // Local SVG generator matching on-chain SVG precisely
  const generateLocalSVG = (name: string) => {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000" font-family="'Helvetica Neue',Arial,sans-serif">
  <defs>
    <radialGradient id="g" cx="50%" cy="-8%" r="75%">
      <stop offset="0%" stop-color="#7DFF66" stop-opacity=".22"/>
      <stop offset="55%" stop-color="#7DFF66" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="g2" cx="85%" cy="88%" r="42%">
      <stop offset="0%" stop-color="#7DFF66" stop-opacity=".10"/>
      <stop offset="70%" stop-color="#7DFF66" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1000" height="1000" fill="#070B08"/>
  <rect width="1000" height="1000" fill="url(#g)"/>
  <rect width="1000" height="1000" fill="url(#g2)"/>
  <g transform="translate(64, 58)">
    <rect width="72" height="72" rx="18" fill="#7DFF66"/>
    <path d="M22 50V26l14-5 14 5v24" stroke="#052A0E" stroke-width="4.4" fill="none" stroke-linejoin="round"/>
    <path d="M31 50V39h10v11" stroke="#052A0E" stroke-width="4.4" fill="none" stroke-linejoin="round"/>
  </g>
  <text x="156" y="107" font-weight="800" font-size="40" fill="#EAF6EC">arc<tspan fill="#7DFF66">.</tspan></text>
  <text x="500" y="500" text-anchor="middle" dominant-baseline="central" font-weight="800" font-size="84" letter-spacing="-3" fill="#EAF6EC">${name}<tspan fill="#7DFF66">.arc</tspan></text>
  <text x="500" y="928" text-anchor="middle" font-weight="600" font-size="26" letter-spacing="8" fill="#7E9384">ARC BLOCKCHAIN</text>
</svg>`;
  };

  return (
    <div className="min-h-screen bg-[#070B08] text-[#EAF6EC] font-sans antialiased overflow-x-hidden selection:bg-[#7DFF66] selection:text-[#070B08]">
      {/* Background radial effects */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-[#7DFF66]/5 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-20 right-10 w-[400px] h-[400px] bg-[#7DFF66]/3 rounded-full blur-[120px] pointer-events-none" />

      {/* --- Sticky Header --- */}
      <header className="sticky top-0 z-40 bg-[#070B08]/85 backdrop-blur-md border-b border-[#7E9384]/10 transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-black tracking-tight text-[#EAF6EC] select-none">
              arc<span className="text-[#7DFF66]">.</span>
            </span>
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-[#7DFF66]/20 bg-[#7DFF66]/5 text-[11px] font-mono text-[#7DFF66] font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#7DFF66] animate-pulse" />
              ARC TESTNET ACTIVE
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Wallet Button */}
            {isConnected && address ? (
              <div className="flex items-center gap-2">
                <div className="hidden sm:flex flex-col items-end font-mono text-[11px] text-[#7E9384]">
                  <span>USDC Gas Token</span>
                </div>
                <div className="flex items-center gap-2 bg-[#7DFF66]/10 border border-[#7DFF66]/30 px-3 py-1.5 rounded-lg">
                  <span className="w-2 h-2 rounded-full bg-[#7DFF66]" />
                  <span className="text-xs font-mono font-bold text-[#EAF6EC]">
                    {address.slice(0, 6)}...{address.slice(-4)}
                  </span>
                  <button onClick={() => disconnect()} className="text-[#7E9384] hover:text-red-400 text-xs ml-1 font-semibold uppercase">
                    Exit
                  </button>
                </div>
              </div>
            ) : (
              <button 
                onClick={() => connect({ connector: injected() })}
                className="relative group overflow-hidden border border-[#7DFF66] text-[#7DFF66] font-mono font-bold text-xs uppercase px-5 py-2.5 rounded-md transition-all duration-300 hover:bg-[#7DFF66] hover:text-[#070B08] shadow-[0_0_15px_rgba(125,255,102,0.15)]"
              >
                Connect Wallet
              </button>
            )}

            {/* Hamburger */}
            <button 
              onClick={() => setIsMenuOpen(true)}
              className="p-2 text-[#7E9384] hover:text-[#EAF6EC] transition-colors"
            >
              <Menu className="w-6 h-6" />
            </button>
          </div>
        </div>
      </header>

      {/* --- Hamburger Full-Screen Slideout --- */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[#070B08]/95 backdrop-blur-lg flex flex-col justify-between p-8"
          >
            <div className="flex justify-between items-center">
              <span className="text-3xl font-black text-white">
                arc<span className="text-[#7DFF66]">.</span>
              </span>
              <button onClick={() => setIsMenuOpen(false)} className="p-3 bg-white/5 rounded-full text-[#7E9384] hover:text-white transition-all">
                <X className="w-6 h-6" />
              </button>
            </div>

            <nav className="flex flex-col gap-6 text-3xl font-bold tracking-tight">
              {[
                { id: 'search', label: 'Register New Name' },
                { id: 'my-domains', label: 'My Names Profile' },
                { id: 'marketplace', label: 'Secondary Market' },
                { id: 'explorer', label: 'Live Pricing' },
                { id: 'docs', label: 'Developer Docs' }
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id as any);
                    setIsMenuOpen(false);
                  }}
                  className={`text-left transition-colors ${activeTab === item.id ? 'text-[#7DFF66]' : 'text-[#7E9384] hover:text-white'}`}
                >
                  {item.label}
                </button>
              ))}
            </nav>

            <div className="border-t border-[#7E9384]/10 pt-6">
              <p className="text-xs text-[#7E9384] font-mono uppercase tracking-widest mb-2">ARC Blockchain Info</p>
              <div className="flex flex-col sm:flex-row sm:justify-between text-sm text-[#EAF6EC] font-mono">
                <span>Chain ID: 5042002</span>
                <span className="text-[#7DFF66]">Gas Asset: Native USDC</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- Main Workspace Content --- */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">

        {/* TAB 1: Search & Stepper */}
        {activeTab === 'search' && (
          <section className="space-y-12">
            {/* Hero Titles */}
            <div className="text-center max-w-3xl mx-auto space-y-4">
              <motion.h1 
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-4xl sm:text-6xl font-black tracking-tight"
              >
                Your wallet, under a <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#7DFF66] to-[#EAF6EC] drop-shadow-[0_0_30px_rgba(125,255,102,0.2)]">name you own</span>.
              </motion.h1>
              <p className="text-[#7E9384] text-lg sm:text-xl">
                The institutional standard for identity on the Arc Blockchain. Native USDC gas payments, sub-second finality.
              </p>
            </div>

            {/* Glowing Search Box */}
            <div className="max-w-2xl mx-auto">
              <form onSubmit={handleSearchOnChain} className="relative flex items-center group">
                <input 
                  type="text" 
                  placeholder="Search your .arc name"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#070B08]/60 border-2 border-[#7E9384]/20 focus:border-[#7DFF66] rounded-xl py-5 pl-6 pr-24 text-lg font-mono tracking-wide text-white outline-none transition-all focus:shadow-[0_0_30px_rgba(125,255,102,0.12)] group-hover:border-[#7E9384]/40"
                />
                <div className="absolute right-20 font-mono font-bold text-[#7E9384] text-lg select-none pointer-events-none mr-2">
                  .arc
                </div>
                <button 
                  type="submit"
                  disabled={isSearching}
                  className="absolute right-3 p-3.5 bg-[#7DFF66] hover:bg-[#8aff75] text-[#070B08] rounded-lg transition-all"
                >
                  {isSearching ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                </button>
              </form>

              {/* Quick-tag pills */}
              <div className="flex flex-wrap gap-2.5 justify-center mt-4 text-xs font-mono text-[#7E9384]">
                <span>Try searching:</span>
                {['btc', 'sol', 'usdc', 'degen', 'prime'].map((tag) => (
                  <button 
                    key={tag}
                    onClick={() => {
                      setSearchQuery(tag);
                      // Auto-trigger search
                      setTimeout(() => {
                        setSearchResult(null);
                      }, 50);
                    }}
                    className="px-2 py-0.5 bg-[#7E9384]/10 rounded hover:bg-[#7DFF66]/10 hover:text-[#7DFF66] transition-all"
                  >
                    [{tag}]
                  </button>
                ))}
              </div>
            </div>

            {/* Search Result display */}
            {searchResult && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-2xl mx-auto bg-[#070B08]/40 border border-[#7E9384]/10 rounded-2xl p-6 backdrop-blur-sm space-y-6"
              >
                {!searchResult.isValid ? (
                  <div className="flex items-center gap-3 text-amber-400 font-mono text-sm bg-amber-400/5 border border-amber-400/20 p-4 rounded-xl">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <span>Name "{searchResult.name}" is invalid. Names must be lowercase alphanumeric and at least 2 characters.</span>
                  </div>
                ) : searchResult.available ? (
                  <div className="space-y-6">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="text-2xl font-bold font-mono text-white">
                          {searchResult.name}<span className="text-[#7DFF66]">.arc</span>
                        </h3>
                        <span className="text-xs font-mono text-[#7DFF66] font-bold uppercase tracking-wider">Available for claim</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[#7DFF66] text-3xl font-black font-mono">
                          {searchResult.priceFormatted}
                        </span>
                        <span className="text-[#7E9384] text-xs block font-mono">USDC / Year</span>
                      </div>
                    </div>

                    <div className="border-t border-[#7E9384]/15 pt-6 space-y-4">
                      <h4 className="text-sm font-mono text-[#7E9384] uppercase tracking-wider font-bold">Claim Commit-Reveal Flow</h4>
                      
                      {/* Step Status Tracker */}
                      <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono">
                        <div className={`p-3 rounded-lg border transition-all ${
                          !activeCommitment ? 'bg-[#7DFF66]/5 border-[#7DFF66]/30 text-[#7DFF66]' : 'bg-[#7E9384]/5 border-[#7E9384]/10 text-[#7E9384]'
                        }`}>
                          <div className="font-black text-base mb-1">01</div>
                          <span>Commit Name</span>
                        </div>
                        <div className={`p-3 rounded-lg border transition-all ${
                          activeCommitment && activeCommitment.step === 'waiting' ? 'bg-[#7DFF66]/5 border-[#7DFF66]/30 text-[#7DFF66]' : 'bg-[#7E9384]/5 border-[#7E9384]/10 text-[#7E9384]'
                        }`}>
                          <div className="font-black text-base mb-1">02</div>
                          <span>Wait {countdown > 0 ? `(${countdown}s)` : 'Timer'}</span>
                        </div>
                        <div className={`p-3 rounded-lg border transition-all ${
                          activeCommitment && (activeCommitment.step === 'ready' || activeCommitment.step === 'registering') ? 'bg-[#7DFF66]/5 border-[#7DFF66]/30 text-[#7DFF66]' : 'bg-[#7E9384]/5 border-[#7E9384]/10 text-[#7E9384]'
                        }`}>
                          <div className="font-black text-base mb-1">03</div>
                          <span>Reveal & Mint</span>
                        </div>
                      </div>

                      {/* Control buttons */}
                      {!activeCommitment ? (
                        <button
                          onClick={triggerCommit}
                          className="w-full bg-[#7DFF66] hover:bg-[#8aff75] text-[#070B08] font-bold font-mono py-4 rounded-xl transition-all shadow-[0_4px_20px_rgba(125,255,102,0.15)] flex items-center justify-center gap-2 text-sm uppercase"
                        >
                          <Clock className="w-5 h-5" />
                          Step 1: Commit Registry Reservation
                        </button>
                      ) : activeCommitment.step === 'waiting' ? (
                        <div className="space-y-4">
                          <div className="relative w-full bg-[#7E9384]/10 h-3 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: '0%' }}
                              animate={{ width: `${((60 - countdown) / 60) * 100}%` }}
                              className="absolute top-0 bottom-0 left-0 bg-[#7DFF66]"
                            />
                          </div>
                          <p className="text-xs text-[#7E9384] text-center font-mono animate-pulse">
                            Preventing front-running on-chain. Please wait 60 seconds...
                          </p>
                          <button
                         onClick={() => {
                              // Bypass only for debugging/developer comfort, standard flow expects 60s
                              setActiveCommitment(prev => prev ? { ...prev, step: 'ready' } : null);
                            }}
                            className="w-full border border-[#7E9384]/20 hover:border-[#7DFF66]/50 text-xs font-mono text-[#7E9384] py-2 rounded-lg"
                          >
                            Skip waiting delay (Developer Mode)
                          </button>
                        </div>
                      ) : activeCommitment.step === 'ready' ? (
                        <button
                          onClick={triggerRegister}
                          className="w-full bg-[#7DFF66] hover:bg-[#8aff75] text-[#070B08] font-bold font-mono py-4 rounded-xl transition-all shadow-[0_4px_20px_rgba(125,255,102,0.15)] flex items-center justify-center gap-2 text-sm uppercase"
                        >
                          <Sparkles className="w-5 h-5" />
                          Step 3: Reveal and Claim Domain
                        </button>
                      ) : activeCommitment.step === 'registering' ? (
                        <div className="flex items-center justify-center gap-3 p-4 bg-[#7DFF66]/10 border border-[#7DFF66]/20 rounded-xl text-center">
                          <RefreshCw className="w-5 h-5 animate-spin text-[#7DFF66]" />
                          <span className="font-mono text-sm text-[#7DFF66]">Processing registration on-chain...</span>
                        </div>
                      ) : (
                        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-[#7DFF66] text-center rounded-xl font-mono text-sm flex items-center justify-center gap-2">
                          <CheckCircle2 className="w-5 h-5" />
                          <span>Successfully Claimed Domain! Redirecting...</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {address && searchResult.owner && searchResult.owner.toLowerCase() === address.toLowerCase() ? (
                      <div className="flex justify-between items-center bg-[#7DFF66]/5 border border-[#7DFF66]/20 p-4 rounded-xl">
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="w-5 h-5 text-[#7DFF66] shrink-0" />
                          <div>
                            <span className="font-mono font-bold block text-white">{searchResult.name}.arc</span>
                            <span className="text-xs text-[#7DFF66] font-mono font-bold">You own this domain!</span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => openRecordManager(searchResult.name)}
                            className="bg-white/5 hover:bg-white/10 text-white font-mono text-xs px-3 py-1.5 rounded-lg border border-white/10 font-bold uppercase transition-all"
                          >
                            MANAGE
                          </button>
                          <button 
                            onClick={() => triggerRenew(searchResult.name)}
                            disabled={isRenewing === searchResult.name}
                            className="bg-[#7DFF66]/10 hover:bg-[#7DFF66]/20 text-[#7DFF66] border border-[#7DFF66]/30 font-mono text-xs px-3 py-1.5 rounded-lg font-bold uppercase transition-all flex items-center gap-1"
                          >
                            {isRenewing === searchResult.name ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                            RENEW
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-between items-center bg-red-500/5 border border-red-500/10 p-4 rounded-xl">
                        <div className="flex items-center gap-3">
                          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                          <div>
                            <span className="font-mono font-bold block text-white">{searchResult.name}.arc</span>
                            <span className="text-xs text-[#7E9384]">Already registered by someone else</span>
                          </div>
                        </div>
                        <button 
                          onClick={() => {
                            setActiveTab('marketplace');
                            setSearchQuery('');
                            setSearchResult(null);
                          }}
                          className="bg-white/5 hover:bg-white/10 text-white font-mono text-xs px-3 py-1.5 rounded-lg border border-white/10"
                        >
                          Check Market
                        </button>
                      </div>
                    )}

                    {searchResult.owner && (
                      <div className="bg-[#7E9384]/5 rounded-xl p-4 font-mono text-xs text-[#7E9384] space-y-2">
                        <div className="flex justify-between">
                          <span>Owner Address:</span>
                          <span className="text-white text-right break-all text-[11px]">{searchResult.owner}</span>
                        </div>
                        {searchResult.resolver && searchResult.resolver !== ethers.ZeroAddress && (
                          <div className="flex justify-between">
                            <span>Resolver Address:</span>
                            <span className="text-white text-right break-all text-[11px]">{searchResult.resolver}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}

            {/* --- Stats Dashboard --- */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 pt-6">
              {[
                { title: 'TOTAL REVENUE', value: `$${statsRevenue}`, desc: `${statsNamesCount} registered names`, change: 'Live Event-Indexed' },
                { title: 'NAMES CLAIMED', value: statsNamesCount, desc: 'Active unique users', change: 'Stablecoin native' },
                { title: 'SETTLES IN', value: '< 350ms', desc: 'Malachite finality', change: 'Deterministic' },
                { title: 'GAS FEES', value: '< $0.01', desc: 'Denominated in USDC', change: 'Zero volatile exposure' }
              ].map((card, i) => (
                <div 
                  key={i}
                  className="bg-[#070B08]/40 border border-[#7E9384]/15 rounded-xl p-6 backdrop-blur-sm space-y-2 relative overflow-hidden group hover:border-[#7DFF66]/30 transition-all"
                >
                  <div className="absolute top-0 right-0 w-24 h-24 bg-[#7DFF66]/2 rounded-full blur-xl pointer-events-none group-hover:bg-[#7DFF66]/5 transition-all" />
                  <span className="text-[11px] font-mono text-[#7E9384] font-bold tracking-widest block uppercase">{card.title}</span>
                  <div className="text-3xl font-black tracking-tight text-white font-mono">{card.value}</div>
                  <div className="flex items-center justify-between text-xs font-mono pt-1">
                    <span className="text-[#7E9384]">{card.desc}</span>
                    <span className="text-[#7DFF66] font-bold">{card.change}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* TAB 2: My Names */}
        {activeTab === 'my-domains' && (
          <section className="space-y-8">
            <div className="flex justify-between items-end">
              <div>
                <h2 className="text-3xl font-black tracking-tight">Your On-Chain <span className="text-[#7DFF66]">Identity</span></h2>
                <p className="text-[#7E9384] text-sm font-mono mt-1">DECIMALS FORMAT: 18-DECIMAL NATIVE USDC</p>
              </div>
              <button 
                onClick={fetchDomainsAndListings}
                className="flex items-center gap-2 text-xs font-mono text-[#7E9384] hover:text-[#7DFF66] bg-white/5 border border-white/5 hover:border-[#7DFF66]/30 px-3 py-1.5 rounded-lg transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh Wallet
              </button>
            </div>

            {!isConnected ? (
              <div className="text-center p-12 bg-white/5 border border-white/5 rounded-2xl max-w-xl mx-auto space-y-4">
                <Wallet className="w-12 h-12 text-[#7E9384] mx-auto animate-bounce" />
                <h3 className="text-lg font-bold">Connect your Web3 wallet</h3>
                <p className="text-sm text-[#7E9384] font-mono">
                  Wallet is required to fetch registered domains and edit ENS primary records.
                </p>
                <button 
                  onClick={() => connect({ connector: injected() })}
                  className="bg-[#7DFF66] text-[#070B08] font-bold font-mono text-xs px-6 py-3 rounded-lg uppercase"
                >
                  Connect Wallet
                </button>
              </div>
            ) : isLoadingDomains ? (
              <div className="text-center py-20">
                <RefreshCw className="w-8 h-8 animate-spin text-[#7DFF66] mx-auto mb-4" />
                <span className="font-mono text-[#7E9384]">Scanning registry for ownership data...</span>
              </div>
            ) : userDomains.length === 0 ? (
              <div className="text-center p-16 bg-[#070B08]/40 border border-[#7E9384]/10 rounded-2xl max-w-xl mx-auto space-y-4">
                <Globe className="w-12 h-12 text-[#7E9384] mx-auto" />
                <h3 className="text-lg font-bold">No domains owned yet</h3>
                <p className="text-sm text-[#7E9384] font-mono">
                  Any name you register on Arc Testnet will show up here instantly.
                </p>
                <button 
                  onClick={() => setActiveTab('search')}
                  className="bg-[#7DFF66] hover:bg-[#8aff75] text-[#070B08] font-bold font-mono text-xs px-6 py-3 rounded-lg uppercase"
                >
                  Register one now
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {userDomains.map((dom) => (
                  <div 
                    key={dom.id}
                    className="bg-[#070B08] border border-[#7E9384]/15 rounded-2xl overflow-hidden group hover:border-[#7DFF66]/30 transition-all flex flex-col justify-between"
                  >
                    {/* Native base64 generated SVG card */}
                    <div className="aspect-square bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
                      <img 
                        src={dom.svgUrl} 
                        alt={dom.name} 
                        className="w-full h-full object-contain rounded-xl group-hover:scale-[1.02] transition-transform duration-300"
                      />
                    </div>

                    {/* Metadata & Actions */}
                    <div className="p-6 space-y-4 bg-white/2">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="text-xl font-bold font-mono text-white">{dom.name}.arc</h3>
                          <span className="text-[10px] font-mono text-[#7E9384] block">TOKEN ID: {dom.id.slice(0, 10)}...</span>
                          {dom.resolvedAddress && dom.resolvedAddress !== ethers.ZeroAddress && (
                            <span className="text-[10px] font-mono text-[#7DFF66] block mt-1 truncate max-w-[200px]" title={dom.resolvedAddress}>
                              RESOLVES TO: {dom.resolvedAddress.slice(0, 6)}...{dom.resolvedAddress.slice(-4)}
                            </span>
                          )}
                        </div>
                        <button 
                          onClick={() => handleCopy(`${dom.name}.arc`, dom.name)}
                          className="p-2 bg-white/5 rounded-lg text-[#7E9384] hover:text-white"
                        >
                          {copiedName === dom.name ? <Check className="w-4 h-4 text-[#7DFF66]" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>

                      <div className="flex gap-2">
                        <button 
                          onClick={() => openRecordManager(dom.name)}
                          className="flex-1 bg-white/5 hover:bg-white/10 text-white font-mono text-xs py-2.5 rounded-lg border border-white/10 flex items-center justify-center gap-1.5 transition-all"
                        >
                          <Settings className="w-4 h-4 text-[#7DFF66]" />
                          Edit Records
                        </button>

                        <button 
                          onClick={() => initiateListing(dom.name)}
                          className="flex-1 bg-[#7DFF66]/10 hover:bg-[#7DFF66]/20 text-[#7DFF66] border border-[#7DFF66]/30 font-mono text-xs py-2.5 rounded-lg flex items-center justify-center gap-1.5 transition-all"
                        >
                          <ShoppingBag className="w-4 h-4" />
                          List Market
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* TAB 3: Marketplace */}
        {activeTab === 'marketplace' && (
          <section className="space-y-8">
            <div>
              <h2 className="text-3xl font-black tracking-tight">Active Secondary <span className="text-[#7DFF66]">Listings</span></h2>
              <p className="text-[#7E9384] text-sm font-mono mt-1">TRADE STABLECOIN DECENTRALIZED IDENTITY SECURELY</p>
            </div>

            <div className="bg-[#070B08]/40 border border-[#7E9384]/15 rounded-2xl overflow-hidden backdrop-blur-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-sm">
                  <thead className="bg-white/2 border-b border-[#7E9384]/10 text-xs text-[#7E9384] tracking-wider font-bold">
                    <tr>
                      <th className="p-5">Name</th>
                      <th className="p-5">Price (USDC)</th>
                      <th className="p-5">Seller</th>
                      <th className="p-5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#7E9384]/10">
                    {marketplaceListings.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-12 text-center text-[#7E9384]">
                          <ShoppingBag className="w-8 h-8 text-[#7E9384]/40 mx-auto mb-3" />
                          <span>No secondary listings currently found on-chain.</span>
                        </td>
                      </tr>
                    ) : (
                      marketplaceListings.map((listing) => (
                        <tr key={listing.id} className="hover:bg-white/2 transition-colors">
                          <td className="p-5 font-bold text-white text-base">
                            {listing.name}.arc
                          </td>
                          <td className="p-5 text-[#7DFF66] font-black text-lg">
                            {listing.price} USDC
                          </td>
                          <td className="p-5 text-[#7E9384] text-xs">
                            {listing.seller.slice(0, 8)}...{listing.seller.slice(-8)}
                          </td>
                          <td className="p-5 text-right">
                            {address && address.toLowerCase() === listing.seller.toLowerCase() ? (
                              <button 
                                onClick={() => cancelListing(listing.name)}
                                className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all"
                              >
                                Cancel Listing
                              </button>
                            ) : (
                              <button 
                                onClick={() => purchaseListing(listing)}
                                className="bg-[#7DFF66] hover:bg-[#8aff75] text-[#070B08] px-5 py-2 rounded-lg text-xs font-black uppercase transition-all"
                              >
                                Buy Domain
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* TAB 4: Explorer / Pricing */}
        {activeTab === 'explorer' && (
          <section className="space-y-12">
            <div className="text-center max-w-2xl mx-auto space-y-2">
              <h2 className="text-4xl font-black tracking-tight">Simple. Transparent. <span className="text-[#7DFF66]">Pricing</span>.</h2>
              <p className="text-[#7E9384] text-sm font-mono">ANNUAL REGISTRATION FEE SCALE DENOMINATED IN USD, PAID IN NATIVE USDC</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                { char: '3 Characters', price: '$640', sub: 'Highly institutional & high-prestige labels', gradient: 'from-[#7DFF66]/10 to-[#7DFF66]/0', border: 'border-[#7DFF66]/20' },
                { char: '4 Characters', price: '$160', sub: 'Standard business & startup identifiers', gradient: 'from-white/5 to-white/0', border: 'border-white/10' },
                { char: '5+ Characters', price: '$5', sub: 'Standard personal identity & developer profiles', gradient: 'from-white/5 to-white/0', border: 'border-white/10' }
              ].map((tier, idx) => (
                <div 
                  key={idx}
                  className={`bg-[#070B08] ${tier.border} rounded-2xl p-8 space-y-6 relative overflow-hidden group hover:border-[#7DFF66]/30 transition-all flex flex-col justify-between`}
                >
                  <div className={`absolute inset-0 bg-gradient-to-b ${tier.gradient} opacity-50`} />
                  
                  <div className="relative space-y-4">
                    <span className="text-[10px] font-mono tracking-widest text-[#7DFF66] font-bold uppercase">Tier 0{idx + 1}</span>
                    <h3 className="text-2xl font-bold font-mono text-white">{tier.char}</h3>
                    <p className="text-sm text-[#7E9384] font-mono">{tier.sub}</p>
                  </div>

                  <div className="relative pt-6 border-t border-[#7E9384]/15 flex items-baseline justify-between">
                    <div>
                      <span className="text-4xl font-black text-white font-mono">{tier.price}</span>
                      <span className="text-[#7E9384] text-xs font-mono"> / yr</span>
                    </div>
                    <button 
                      onClick={() => {
                        setActiveTab('search');
                        setSearchQuery('');
                      }}
                      className="p-2 bg-white/5 rounded-lg text-[#7DFF66] group-hover:bg-[#7DFF66] group-hover:text-[#070B08] transition-all"
                    >
                      <ArrowRight className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Network parameters table */}
            <div className="max-w-3xl mx-auto bg-[#070B08]/40 border border-[#7E9384]/15 rounded-2xl p-6 space-y-4 font-mono text-xs">
              <h4 className="text-sm font-bold text-white uppercase tracking-wider">Arc Network Deployment Parameters</h4>
              <div className="grid grid-cols-2 gap-4 text-[#7E9384]">
                <div>Chain ID: <span className="text-white">5042002</span></div>
                <div>Native Gas Token: <span className="text-white">USDC (18 decimals)</span></div>
                <div>Registry address: <span className="text-white break-all">{REGISTRY_ADDRESS}</span></div>
                <div>Controller address: <span className="text-white break-all">{CONTROLLER_ADDRESS}</span></div>
                <div>Resolver proxy: <span className="text-white break-all">{RESOLVER_ADDRESS}</span></div>
                <div>Universal Resolver: <span className="text-white break-all">{UNIVERSAL_RESOLVER_ADDRESS}</span></div>
              </div>
            </div>
          </section>
        )}

        {/* TAB 5: Docs */}
        {activeTab === 'docs' && (
          <section className="space-y-8 max-w-4xl mx-auto">
            <div>
              <h2 className="text-3xl font-black tracking-tight">Developer <span className="text-[#7DFF66]">Portal</span></h2>
              <p className="text-[#7E9384] text-sm font-mono mt-1">INTEGRATE .ARC DOMAINS INTO YOUR PRODUCTS</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="bg-[#070B08]/40 border border-[#7E9384]/15 rounded-2xl p-8 space-y-4">
                <Shield className="w-8 h-8 text-[#7DFF66]" />
                <h3 className="text-xl font-bold font-mono">Decimal Exactness Rule</h3>
                <p className="text-sm text-[#7E9384] leading-relaxed">
                  Arc uses USDC as its native token with 18 decimals of precision, while standard ERC-20 USDC contracts use 6 decimals. Never mix their raw values without converting first!
                </p>
                <div className="bg-[#070B08] p-4 rounded-xl border border-white/5 font-mono text-xs text-[#7DFF66]">
                  <div>DECIMALS_OFFSET = 12n</div>
                  <div>display = balanceWei / (10n ** 12n)</div>
                </div>
              </div>

              <div className="bg-[#070B08]/40 border border-[#7E9384]/15 rounded-2xl p-8 space-y-4">
                <FileText className="w-8 h-8 text-[#7DFF66]" />
                <h3 className="text-xl font-bold font-mono">Deterministic Finality</h3>
                <p className="text-sm text-[#7E9384] leading-relaxed">
                  Arc is built with sub-second Byzantine Fault Tolerant (BFT) consensus. Once a transaction is included in a block, it is irreversibly settled. Rollbacks or reorganizations are mathematically impossible.
                </p>
                <div className="bg-[#070B08] p-4 rounded-xl border border-white/5 font-mono text-xs text-[#7DFF66]">
                  <div>One confirmation = Final.</div>
                  <div>No confirmation wait buffers needed.</div>
                </div>
              </div>
            </div>
          </section>
        )}

      </main>

      {/* --- Footer --- */}
      <footer className="border-t border-[#7E9384]/10 bg-[#070B08] py-8 text-center text-xs font-mono text-[#7E9384] max-w-7xl mx-auto px-4">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <p>&copy; 2026 .arc Name Service. All rights reserved.</p>
          <div className="flex gap-4">
            <a href="https://testnet.arcscan.app/" target="_blank" rel="noopener noreferrer" className="hover:text-[#7DFF66] transition-colors flex items-center gap-1">
              ArcScan Explorer
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <span>·</span>
            <a href="https://docs.arc.io/llms.txt" target="_blank" rel="noopener noreferrer" className="hover:text-[#7DFF66] transition-colors">
              Circle Docs
            </a>
          </div>
        </div>
      </footer>

      {/* --- Dialog: Record Manager --- */}
      <AnimatePresence>
        {isManagingRecords && selectedDomain && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-[#070B08] border border-[#7E9384]/20 rounded-2xl max-w-lg w-full p-6 space-y-6"
            >
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-xl font-bold font-mono">Manage <span className="text-[#7DFF66]">{selectedDomain}.arc</span></h3>
                  <span className="text-[10px] font-mono text-[#7E9384] block">CONFIGURE ON-CHAIN RECORD ATTRIBUTES</span>
                </div>
                <button onClick={() => setIsManagingRecords(false)} className="p-2 bg-white/5 rounded-full text-[#7E9384] hover:text-white transition-all">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-[#7E9384] font-bold block uppercase">Primary Address Record</label>
                  <input 
                    type="text" 
                    value={recordAddr}
                    onChange={(e) => setRecordAddr(e.target.value)}
                    placeholder="0x..."
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 font-mono text-sm outline-none focus:border-[#7DFF66]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-[#7E9384] font-bold block uppercase">Twitter / X handle</label>
                  <input 
                    type="text" 
                    value={recordTwitter}
                    onChange={(e) => setRecordTwitter(e.target.value)}
                    placeholder="@username"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 font-mono text-sm outline-none focus:border-[#7DFF66]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-[#7E9384] font-bold block uppercase">Profile Description</label>
                  <input 
                    type="text" 
                    value={recordDesc}
                    onChange={(e) => setRecordDesc(e.target.value)}
                    placeholder="Proud owner of an .arc Web3 ID"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 font-mono text-sm outline-none focus:border-[#7DFF66]"
                  />
                </div>
              </div>

              <div className="flex gap-4">
                <button 
                  onClick={() => setIsManagingRecords(false)}
                  className="flex-1 border border-white/10 hover:bg-white/5 text-white font-mono text-xs py-3 rounded-lg uppercase"
                >
                  Cancel
                </button>
                <button 
                  onClick={updateRecords}
                  disabled={isUpdatingRecord}
                  className="flex-1 bg-[#7DFF66] hover:bg-[#8aff75] text-[#070B08] font-bold font-mono text-xs py-3 rounded-lg uppercase flex items-center justify-center gap-1.5"
                >
                  {isUpdatingRecord ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                  Save Records
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- Dialog: Market Listing Manager --- */}
      <AnimatePresence>
        {isListingToken && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-[#070B08] border border-[#7E9384]/20 rounded-2xl max-w-sm w-full p-6 space-y-6"
            >
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-xl font-bold font-mono">List <span className="text-[#7DFF66]">{isListingToken}.arc</span></h3>
                  <span className="text-[10px] font-mono text-[#7E9384] block">SET SECONDARY ASKING PRICE</span>
                </div>
                <button onClick={() => setIsListingToken(null)} className="p-2 bg-white/5 rounded-full text-[#7E9384] hover:text-white transition-all">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-[#7E9384] font-bold block uppercase">Asking Price (USDC)</label>
                  <div className="relative flex items-center">
                    <input 
                      type="number" 
                      value={listingPrice}
                      onChange={(e) => setListingPrice(e.target.value)}
                      placeholder="e.g. 50"
                      className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 font-mono text-sm outline-none focus:border-[#7DFF66] pr-16"
                    />
                    <span className="absolute right-3 font-mono text-[#7E9384] text-xs">USDC</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <button 
                  onClick={() => setIsListingToken(null)}
                  className="flex-1 border border-white/10 hover:bg-white/5 text-white font-mono text-xs py-3 rounded-lg uppercase"
                >
                  Cancel
                </button>
                <button 
                  onClick={submitListing}
                  disabled={isSubmittingListing || !listingPrice}
                  className="flex-1 bg-[#7DFF66] hover:bg-[#8aff75] text-[#070B08] font-bold font-mono text-xs py-3 rounded-lg uppercase flex items-center justify-center gap-1.5"
                >
                  {isSubmittingListing ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                  Confirm List
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toasts */}
      <AnimatePresence>
        {successToast && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 right-6 z-50 bg-[#7DFF66]/10 border border-[#7DFF66]/30 px-5 py-3 rounded-xl flex items-center gap-3 shadow-[0_4px_30px_rgba(125,255,102,0.1)] text-[#7DFF66] font-mono text-xs"
          >
            <CheckCircle2 className="w-5 h-5" />
            <span>{successToast}</span>
          </motion.div>
        )}

        {errorToast && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 right-6 z-50 bg-red-500/10 border border-red-500/30 px-5 py-3 rounded-xl flex items-center gap-3 shadow-[0_4px_30px_rgba(239,68,68,0.1)] text-red-400 font-mono text-xs"
          >
            <AlertCircle className="w-5 h-5 text-red-400" />
            <span>{errorToast}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

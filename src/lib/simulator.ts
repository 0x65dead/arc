import { Domain, Transaction, WalletState, CommitmentState } from '../types';

const INITIAL_DOMAINS: Record<string, Domain> = {
  'satoshi': {
    name: 'satoshi',
    fullName: 'satoshi.arc',
    owner: '0x3dC38247c4f9672B2C98aCfdc5C1302f8d897E9C',
    controller: '0x3dC38247c4f9672B2C98aCfdc5C1302f8d897E9C',
    resolver: '0x509dBb88e25410E7A7865B206ee41E7DbC800B96',
    expires: Math.floor(Date.now() / 1000) + 31536000 * 5, // 5 years
    createdAt: Date.now() - 31536000000,
    pricePaid: '5.0',
    marketPrice: null,
    records: {
      addresses: {
        'ETH': '0x71C7656EC7ab88b098defB751B7401B5f6d1476B',
        'BTC': '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        'ARC': '0x3dC38247c4f9672B2C98aCfdc5C1302f8d897E9C'
      },
      text: {
        'avatar': 'https://images.unsplash.com/photo-1621761191319-c6fb62004040?w=150&auto=format&fit=crop&q=80',
        'email': 'satoshi@bitcoin.org',
        'twitter': 'satoshi',
        'github': 'bitcoin',
        'description': 'The architect of peer-to-peer digital cash.'
      },
      contentHash: 'ipfs://QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco'
    }
  },
  'vitalik': {
    name: 'vitalik',
    fullName: 'vitalik.arc',
    owner: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    controller: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    resolver: '0x509dBb88e25410E7A7865B206ee41E7DbC800B96',
    expires: Math.floor(Date.now() / 1000) + 31536000 * 2, // 2 years
    createdAt: Date.now() - 15000000000,
    pricePaid: '5.0',
    marketPrice: '120.0', // listed for sale
    records: {
      addresses: {
        'ETH': '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        'ARC': '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
      },
      text: {
        'avatar': 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=150&auto=format&fit=crop&q=80',
        'email': 'vitalik@ethereum.org',
        'twitter': 'vitalikbuterin',
        'github': 'vbuterin',
        'description': 'Fascinated by decentralized consensus systems.'
      },
      contentHash: ''
    }
  },
  'alice': {
    name: 'alice',
    fullName: 'alice.arc',
    owner: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    controller: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    resolver: '0x509dBb88e25410E7A7865B206ee41E7DbC800B96',
    expires: Math.floor(Date.now() / 1000) + 31536000, // 1 year
    createdAt: Date.now() - 500000000,
    pricePaid: '5.0',
    marketPrice: null,
    records: {
      addresses: {
        'ETH': '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        'ARC': '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
      },
      text: {
        'avatar': 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
        'description': 'Creative Web3 designer exploring decentralized identity.'
      },
      contentHash: ''
    }
  }
};

// Generate a mock hash
export function generateHash(): string {
  const chars = '0123456789abcdef';
  let hash = '0x';
  for (let i = 0; i < 64; i++) {
    hash += chars[Math.floor(Math.random() * 16)];
  }
  return hash;
}

export function getSimulatedRegistry(): Record<string, Domain> {
  const saved = localStorage.getItem('arc_sim_registry');
  if (!saved) {
    localStorage.setItem('arc_sim_registry', JSON.stringify(INITIAL_DOMAINS));
    return INITIAL_DOMAINS;
  }
  return JSON.parse(saved);
}

export function saveSimulatedRegistry(registry: Record<string, Domain>) {
  localStorage.setItem('arc_sim_registry', JSON.stringify(registry));
}

export function getSimulatedTransactions(): Transaction[] {
  const saved = localStorage.getItem('arc_sim_txs');
  if (!saved) {
    const initialTxs: Transaction[] = [
      {
        hash: '0xb9dcde447ef7b34daf68b234aa7b483f6c939ebf3afec2e2cefa5953a686795c',
        type: 'register',
        status: 'success',
        from: '0x0000000000000000000000000000000000000000',
        to: '0x3dC38247c4f9672B2C98aCfdc5C1302f8d897E9C',
        value: '5.0 ARC',
        block: 52346615,
        timestamp: Math.floor(Date.now() / 1000) - 31536000,
        gasUsed: 793740,
        payload: 'ENSRegistry: Minted satoshi.arc to 0x3dC38247c4f9672B2C98aCfdc5C1302f8d897E9C'
      },
      {
        hash: '0xe3f9899eb10417c2317a4588173d5987a6fe47955520c4a3d31a1f76c10d277c',
        type: 'register',
        status: 'success',
        from: '0x0000000000000000000000000000000000000000',
        to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        value: '5.0 ARC',
        block: 52346618,
        timestamp: Math.floor(Date.now() / 1000) - 15000000,
        gasUsed: 1871404,
        payload: 'ENSRegistry: Minted vitalik.arc to 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
      }
    ];
    localStorage.setItem('arc_sim_txs', JSON.stringify(initialTxs));
    return initialTxs;
  }
  return JSON.parse(saved);
}

export function saveSimulatedTransactions(txs: Transaction[]) {
  localStorage.setItem('arc_sim_txs', JSON.stringify(txs));
}

export function getSimulatedWallet(): WalletState {
  const saved = localStorage.getItem('arc_sim_wallet');
  if (!saved) {
    const initialWallet: WalletState = {
      address: '0x71C7656EC7ab88b098defB751B7401B5f6d1476B',
      balance: '150.00',
      usdcBalance: '2500.00',
      isConnected: true
    };
    localStorage.setItem('arc_sim_wallet', JSON.stringify(initialWallet));
    return initialWallet;
  }
  return JSON.parse(saved);
}

export function saveSimulatedWallet(wallet: WalletState) {
  localStorage.setItem('arc_sim_wallet', JSON.stringify(wallet));
}

export function getSimulatedCommitments(): CommitmentState[] {
  const saved = localStorage.getItem('arc_sim_commitments');
  return saved ? JSON.parse(saved) : [];
}

export function saveSimulatedCommitments(commits: CommitmentState[]) {
  localStorage.setItem('arc_sim_commitments', JSON.stringify(commits));
}

// Calculate price based on domain length and duration
export function calculatePrice(name: string, durationSeconds: number): { native: string, usdc: string } {
  const len = name.length;
  let pricePerYear = 5; // default 5+ chars

  if (len === 2) pricePerYear = 2;
  else if (len === 3) pricePerYear = 640;
  else if (len === 4) pricePerYear = 160;

  const years = durationSeconds / (365 * 24 * 3600);
  const totalPrice = pricePerYear * years;

  return {
    native: totalPrice.toFixed(4),
    usdc: totalPrice.toFixed(2)
  };
}

// Check validity of name
export function isValidName(name: string): { valid: boolean, reason?: string } {
  if (!name) return { valid: false, reason: 'Name cannot be empty' };
  if (name.length < 2) return { valid: false, reason: 'Name is too short (min 2 characters)' };
  
  // Lowercase, a-z, 0-9, or hyphens only (matching ENS valid rules)
  const regex = /^[a-z0-9-]+$/;
  if (!regex.test(name)) {
    return { valid: false, reason: 'Only lowercase alphanumeric characters and hyphens are allowed' };
  }
  return { valid: true };
}

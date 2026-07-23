export interface DomainRecord {
  addresses: Record<string, string>;
  text: Record<string, string>;
  contentHash: string;
}

export interface Domain {
  name: string; // "alice"
  fullName: string; // "alice.arc"
  owner: string;
  controller: string;
  resolver: string;
  expires: number; // Expiry timestamp (seconds)
  records: DomainRecord;
  pricePaid: string; // In ARC (as ETH)
  marketPrice: string | null; // In ARC, if listed for sale
  createdAt: number;
}

export interface Transaction {
  hash: string;
  type: 'commit' | 'register' | 'renew' | 'setResolver' | 'setRecord' | 'transfer' | 'listMarket' | 'buyMarket';
  status: 'pending' | 'success' | 'failed';
  from: string;
  to: string;
  value: string;
  block: number;
  timestamp: number;
  gasUsed: number;
  payload: string;
}

export interface WalletState {
  address: string;
  balance: string; // in ARC (e.g. "150.25")
  usdcBalance: string; // in USDC (e.g. "5000.00")
  isConnected: boolean;
}

export interface CommitmentState {
  name: string;
  owner: string;
  secret: string;
  hash: string;
  timestamp: number; // When commit was made
}

export const NETWORK_INFO = {
  chainId: 5042002,
  chainName: 'Arc Testnet',
  rpcUrl: 'https://rpc.testnet.arc.io',
  explorerUrl: 'https://explorer.testnet.arc.network', // mock or real if exists
  currencySymbol: 'ARC',
  registryAddress: '0xCA78696791670CbC14eE802e6DcDfD661a458978',
  registrarAddress: '0x3dC38247c4f9672B2C98aCfdc5C1302f8d897E9C',
  resolverAddress: '0x027d6dCc8F1235dfdd47E532e77909363C701E54',
  controllerAddress: '0x2FE2560B2FE6D54e50806F531223247CcfEd739B',
  marketAddress: '0xC94Ff1964840BdF8E6952455a2342Ffc6B0bA299'
};

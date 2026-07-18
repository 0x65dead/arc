import { ethers } from 'ethers';
import { NETWORK_INFO } from '../types';

// Real Contract ABIs (simplified for client-side usage)
export const CONTROLLER_ABI = [
  'function available(string calldata nm) external view returns (bool)',
  'function valid(string calldata nm) external view returns (bool)',
  'function price(string memory nm, uint256 dur) public view returns (uint256)',
  'function priceUSDC(string memory nm, uint256 dur) public view returns (uint256)',
  'function makeCommitment(string calldata nm, address o, bytes32 s) public pure returns (bytes32)',
  'function commit(bytes32 c) external',
  'function register(string calldata nm, address o, uint256 dur, bytes32 s) external payable',
  'function register(string calldata nm, address o, uint256 dur, bytes32 s, address referrer) external payable',
  'function renew(string calldata nm, uint256 dur) external payable',
  'function minCommitAge() public view returns (uint256)',
  'function maxCommitAge() public view returns (uint256)',
  'function minLen() public view returns (uint256)',
  'function price2() public view returns (uint256)',
  'function price3() public view returns (uint256)',
  'function price4() public view returns (uint256)',
  'function price5plus() public view returns (uint256)'
];

export const REGISTRY_ABI = [
  'function owner(bytes32 node) external view returns (address)',
  'function resolver(bytes32 node) external view returns (address)',
  'function recordExists(bytes32 node) external view returns (bool)'
];

export const RESOLVER_ABI = [
  'function addr(bytes32 node) external view returns (address)',
  'function text(bytes32 node, string calldata key) external view returns (string memory)',
  'function contenthash(bytes32 node) external view returns (bytes memory)',
  'function setAddr(bytes32 node, address a) external',
  'function setText(bytes32 node, string calldata key, string calldata value) external',
  'function setContenthash(bytes32 node, bytes calldata hash) external'
];

export const REGISTRAR_ABI = [
  'function ownerOf(uint256 id) external view returns (address)',
  'function safeTransferFrom(address from, address to, uint256 id) external',
  'function transferFrom(address from, address to, uint256 id) external'
];

// Helper to calculate standard ENS namehash
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

// Get standard RPC Provider for reading data
export function getRpcProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(NETWORK_INFO.rpcUrl);
}

// Read domain data directly from on-chain contracts using RPC Provider (without wallet)
export async function fetchOnChainDomain(name: string): Promise<{
  exists: boolean;
  owner: string;
  resolver: string;
  resolvedAddress: string;
  avatar: string;
  twitter: string;
  github: string;
  email: string;
  description: string;
  price?: string;
} | null> {
  try {
    const provider = getRpcProvider();
    const controller = new ethers.Contract(NETWORK_INFO.controllerAddress, CONTROLLER_ABI, provider);
    const registry = new ethers.Contract(NETWORK_INFO.registryAddress, REGISTRY_ABI, provider);
    
    // Check if valid first
    const isValid = await controller.valid(name);
    if (!isValid) return null;

    // Check availability
    const isAvailable = await controller.available(name);
    if (isAvailable) {
      // Calculate Price
      const p = await controller.price(name, 31536000); // 1 year
      const ethPrice = ethers.formatEther(p);
      return {
        exists: false,
        owner: '0x0000000000000000000000000000000000000000',
        resolver: '0x0000000000000000000000000000000000000000',
        resolvedAddress: '0x0000000000000000000000000000000000000000',
        avatar: '',
        twitter: '',
        github: '',
        email: '',
        description: '',
        price: ethPrice
      };
    }

    // It's registered! Fetch node details
    const fullName = `${name}.arc`;
    const node = namehash(fullName);
    
    const owner = await registry.owner(node);
    const resolverAddress = await registry.resolver(node);
    
    let resolvedAddress = '0x0000000000000000000000000000000000000000';
    let avatar = '';
    let twitter = '';
    let github = '';
    let email = '';
    let description = '';

    if (resolverAddress && resolverAddress !== ethers.ZeroAddress) {
      const resolver = new ethers.Contract(resolverAddress, RESOLVER_ABI, provider);
      try {
        resolvedAddress = await resolver.addr(node);
      } catch (e) {
        console.warn('Failed to fetch address record', e);
      }

      const keys = ['avatar', 'twitter', 'github', 'email', 'description'];
      const textRecords = await Promise.all(
        keys.map(async (key) => {
          try {
            return await resolver.text(node, key);
          } catch {
            return '';
          }
        })
      );
      [avatar, twitter, github, email, description] = textRecords;
    }

    return {
      exists: true,
      owner,
      resolver: resolverAddress,
      resolvedAddress,
      avatar,
      twitter,
      github,
      email,
      description
    };
  } catch (error) {
    console.error('Error fetching on-chain domain:', error);
    return null;
  }
}

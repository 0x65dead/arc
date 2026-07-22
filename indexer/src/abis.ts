import { ethers } from 'ethers';

// Event-only interfaces — these services never write to the chain, so no
// function ABIs are needed, just enough to decode logs.
export const CONTROLLER_EVENTS = new ethers.Interface([
  'event NameRegistered(string name, bytes32 indexed label, address indexed owner, uint256 cost, uint256 expires)',
  'event NameRenewed(string name, bytes32 indexed label, uint256 cost, uint256 expires)'
]);

export const REGISTRAR_EVENTS = new ethers.Interface([
  'event Transfer(address indexed from, address indexed to, uint256 indexed id)'
]);

export const MARKET_EVENTS = new ethers.Interface([
  'event Listed(uint256 indexed id, address indexed seller, uint256 price)',
  'event PriceChanged(uint256 indexed id, address indexed seller, uint256 price)',
  'event Unlisted(uint256 indexed id, address indexed seller)',
  'event Sold(uint256 indexed id, address indexed seller, address indexed buyer, uint256 price, uint256 fee)'
]);

export const TOPICS = {
  NameRegistered: ethers.id('NameRegistered(string,bytes32,address,uint256,uint256)'),
  NameRenewed: ethers.id('NameRenewed(string,bytes32,uint256,uint256)'),
  Transfer: ethers.id('Transfer(address,address,uint256)'),
  Listed: ethers.id('Listed(uint256,address,uint256)'),
  PriceChanged: ethers.id('PriceChanged(uint256,address,uint256)'),
  Unlisted: ethers.id('Unlisted(uint256,address)'),
  Sold: ethers.id('Sold(uint256,address,address,uint256,uint256)')
};

// Must stay byte-for-byte identical to the frontend's labelToId so that a
// token_id computed here always matches the one the contract actually used.
export function labelToId(label: string): string {
  const hash = ethers.keccak256(ethers.toUtf8Bytes(label));
  return BigInt(hash).toString();
}

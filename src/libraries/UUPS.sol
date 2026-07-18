// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

abstract contract Initializable {
    bool internal _initialized;
    constructor() { _initialized = true; }
    modifier initializer() { require(!_initialized, "init"); _initialized = true; _; }
}

interface IProxiable {
    function proxiableUUID() external view returns (bytes32);
}

abstract contract UUPS is Initializable {
    bytes32 internal constant _IMPL = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    
    function _authorizeUpgrade(address newImpl) internal virtual;
    
    function upgradeToAndCall(address newImpl, bytes calldata data) external payable {
        _authorizeUpgrade(newImpl);
        require(newImpl.code.length > 0, "!contract");
        require(IProxiable(newImpl).proxiableUUID() == _IMPL, "!uuid");
        assembly { sstore(_IMPL, newImpl) }
        if (data.length > 0) {
            (bool ok, bytes memory r) = newImpl.delegatecall(data);
            require(ok, string(r));
        }
    }
    
    function implementation() external view returns (address a) {
        assembly { a := sload(_IMPL) }
    }
    
    function proxiableUUID() external pure returns (bytes32) { return _IMPL; }
}

contract ERC1967Proxy {
    bytes32 internal constant _IMPL = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    
    constructor(address impl, bytes memory data) {
        assembly { sstore(_IMPL, impl) }
        (bool ok, bytes memory r) = impl.delegatecall(data);
        require(ok, string(r));
    }
    
    fallback() external payable { _d(); }
    receive() external payable { _d(); }
    
    function _d() internal {
        assembly {
            let impl := sload(_IMPL)
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}
